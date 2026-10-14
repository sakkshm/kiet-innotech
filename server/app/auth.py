"""
Who is calling.

Signing in exchanges proof of an email address for our own session token:
- Google: the browser gets an ID token from Google Identity Services and posts it to /auth/google. It must be
  signed by Google, issued to one of our OAuth clients, unexpired and carry a verified email. @kiet.edu accounts
  must also come from KIET's Google Workspace ("hd" claim), which is what makes the @kiet.edu rule trustworthy.
- (Later) email + one-time code, issuing the same session token.

Every other request carries the session token (Authorization: Bearer <token>). It is an HS256 JWT whose audience
is the app it was issued for ("portal" or "admin"), so a student token never opens the admin panel.
"""

import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Annotated, Any, Literal

import jwt
from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import rules
from .config import Settings, get_settings
from .db import get_db
from .errors import ApiError
from .models import Admin, Juror, User, utcnow

logger = logging.getLogger(__name__)

App = Literal["portal", "admin"]

GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
SESSION_ISSUER = "innotech-api"
BANNED = "Your InnoTech26 account has been suspended by the organisers. If you think this is a mistake, write to innotech@kiet.edu."
# Writing last_seen_at on every request would double the write load; once every few minutes is enough.
LAST_SEEN_RESOLUTION = timedelta(minutes=5)


@dataclass(frozen=True)
class Identity:
    email: str
    name: str


# ---------- Signing in ----------


@lru_cache
def _google_keys() -> jwt.PyJWKClient:
    # Keys are cached; an unknown key id triggers one refetch, which handles Google's key rotation.
    return jwt.PyJWKClient(GOOGLE_JWKS_URL, cache_keys=True, lifespan=3600, timeout=5)


def _truthy(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.lower() == "true")


def verify_google_credential(credential: str, settings: Settings) -> tuple[Identity, str]:
    """The identity and Google account id ("sub") behind a Google ID token."""
    invalid = ApiError("Google sign-in failed. Please try again.", 401)
    if not settings.google_client_ids:
        raise ApiError("Google sign-in is not configured on this server.", 503)
    try:
        key = _google_keys().get_signing_key_from_jwt(credential)
        claims = jwt.decode(
            credential,
            key.key,
            algorithms=["RS256"],
            audience=settings.google_client_ids,
            options={"require": ["exp", "iat", "iss", "aud", "sub", "email"]},
            leeway=30,
        )
    except jwt.PyJWKClientConnectionError as exc:
        logger.error("Could not fetch Google signing keys: %s", exc)
        raise ApiError("Sign-in is temporarily unavailable. Please try again shortly.", 503) from exc
    except jwt.PyJWTError as exc:
        raise invalid from exc
    if claims.get("iss") not in GOOGLE_ISSUERS:
        raise invalid
    if not _truthy(claims.get("email_verified")):
        raise ApiError("Your Google account email is not verified.", 403)

    email = str(claims["email"]).strip().lower()
    if rules.is_kiet_email(email) and claims.get("hd") != settings.kiet_google_domain:
        # A personal Google account registered with a @kiet.edu address is not proof of being a KIET student.
        raise ApiError("Sign in with your official KIET Google account.", 403)
    name = str(claims.get("name") or claims.get("given_name") or "").strip()[:200]
    return Identity(email=email, name=name), str(claims["sub"])


def issue_session(identity: Identity, app: App, settings: Settings) -> dict[str, str]:
    """Our session token, returned to the browser as {token, expires_at, email, name}."""
    hours = settings.admin_session_hours if app == "admin" else settings.portal_session_hours
    now = int(time.time())
    expires = now + hours * 3600
    claims = {"iss": SESSION_ISSUER, "aud": app, "sub": identity.email, "name": identity.name, "iat": now, "exp": expires}
    return {
        "token": jwt.encode(claims, settings.session_secret, algorithm="HS256"),
        "expires_at": datetime.fromtimestamp(expires, UTC).isoformat(),
        "email": identity.email,
        "name": identity.name,
    }


def find_admin(db: Session, email: str, settings: Settings) -> Admin | None:
    # Server-configured super admins always win over a stored row, which might say "admin" from before.
    if email in settings.super_admin_emails:
        stored = db.get(Admin, email)
        return Admin(
            email=email,
            name=stored.name if stored else email.split("@")[0],
            role="super_admin",
            department=None,
            created_at=stored.created_at if stored else None,
            created_by=stored.created_by if stored else "server configuration",
        )
    return db.get(Admin, email)


def sign_in(db: Session, identity: Identity, app: App, settings: Settings, google_sub: str | None = None) -> dict[str, str]:
    """Checks the account may use `app`, records the sign-in and issues a session."""
    if app == "admin":
        # Organisers and appointed judges use the admin panel; judges see only their own judging page.
        if find_admin(db, identity.email, settings) is None:
            juror = db.get(Juror, identity.email)
            if juror is None:
                raise ApiError("This account is not an InnoTech26 organiser or judge.", 403)
            check_judge_window(db, juror)
    else:
        user = _get_or_create_user(db, identity)
        if user.banned_at is not None:
            raise ApiError(BANNED, 403)
        if google_sub and user.google_sub != google_sub:
            user.google_sub = google_sub
        if identity.name:
            user.name = identity.name
        user.last_seen_at = utcnow()
        try:
            db.commit()
        except IntegrityError:
            # The Google account id moved to another email (rare): keep the email as the identity.
            db.rollback()
    return issue_session(identity, app, settings)


# ---------- Every request ----------


def verify_session(token: str, app: App, settings: Settings) -> Identity:
    try:
        claims = jwt.decode(
            token,
            settings.session_secret,
            algorithms=["HS256"],
            audience=app,
            issuer=SESSION_ISSUER,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
            leeway=30,
        )
    except jwt.PyJWTError as exc:
        raise ApiError("Your session has expired. Please sign in again.", 401) from exc
    email = str(claims["sub"]).strip().lower()
    if "@" not in email:
        raise ApiError("Your session has expired. Please sign in again.", 401)
    return Identity(email=email, name=str(claims.get("name") or "").strip()[:200])


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise ApiError("Please sign in.", 401)
    return authorization[7:].strip()


def get_portal_identity(
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> Identity:
    return verify_session(_bearer(authorization), "portal", settings)


def get_admin_identity(
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> Identity:
    return verify_session(_bearer(authorization), "admin", settings)


def _get_or_create_user(db: Session, identity: Identity) -> User:
    user = db.scalar(select(User).where(User.email == identity.email))
    if user is not None:
        return user
    user = User(email=identity.email, name=identity.name or identity.email.split("@")[0])
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # Two first requests raced to create the same account; the other one won.
        db.rollback()
        user = db.scalar(select(User).where(User.email == identity.email))
        if user is None:
            raise
    return user


def get_current_user(
    identity: Annotated[Identity, Depends(get_portal_identity)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    """The signed-in student's account, created on their first request."""
    user = _get_or_create_user(db, identity)
    if user.banned_at is not None:
        raise ApiError(BANNED, 403)
    if utcnow() - user.last_seen_at > LAST_SEEN_RESOLUTION:
        user.last_seen_at = utcnow()
        db.commit()
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_current_admin(
    identity: Annotated[Identity, Depends(get_admin_identity)],
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Admin:
    admin = find_admin(db, identity.email, settings)
    if admin is None:
        raise ApiError("This account is not an InnoTech26 organiser.", 403)
    return admin


CurrentAdmin = Annotated[Admin, Depends(get_current_admin)]


def require_super_admin(admin: CurrentAdmin) -> Admin:
    if admin.role != "super_admin":
        raise ApiError("Only a super admin can do this.", 403)
    return admin


SuperAdmin = Annotated[Admin, Depends(require_super_admin)]


def check_judge_window(db: Session, juror: Juror) -> None:
    """Judges who are not organisers use the panel only around their room's time slot (see services.judging.judge_access)."""
    from .services.judging import judge_access  # imported here: the services import this module's helpers

    if reason := judge_access(db, juror):
        raise ApiError(reason, 403)


def get_current_juror(
    identity: Annotated[Identity, Depends(get_admin_identity)],
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Juror:
    juror = db.get(Juror, identity.email)
    if juror is None:
        raise ApiError("This account is not an appointed InnoTech26 judge.", 403)
    if find_admin(db, identity.email, settings) is None:
        check_judge_window(db, juror)
    return juror


CurrentJuror = Annotated[Juror, Depends(get_current_juror)]


@dataclass(frozen=True)
class Staff:
    """Who is acting at an event desk: an organiser, a judge, or both (an organiser who also judges)."""

    email: str
    admin: Admin | None
    juror: Juror | None


def get_current_staff(
    identity: Annotated[Identity, Depends(get_admin_identity)],
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Staff:
    admin = find_admin(db, identity.email, settings)
    juror = db.get(Juror, identity.email)
    if admin is None and juror is None:
        raise ApiError("This account is not an InnoTech26 organiser or judge.", 403)
    if admin is None and juror is not None:
        check_judge_window(db, juror)
    return Staff(email=identity.email, admin=admin, juror=juror)


CurrentStaff = Annotated[Staff, Depends(get_current_staff)]
