"""Application settings, read from environment variables (or a .env file in development)."""

from datetime import datetime
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


def _split(value: object) -> object:
    """Accepts "a,b" or a JSON-free list so comma-separated env vars work."""
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: Literal["development", "test", "production"] = "production"
    database_url: str = "postgresql+psycopg://localhost/innotech_dev"
    # Browser origins allowed to call the API: the student portal and the admin panel.
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)

    # Signs our own session tokens (HS256). At least 32 random characters; changing it signs everyone out.
    session_secret: str = ""
    # Google OAuth client IDs (Google Cloud Console) whose ID tokens are accepted at sign-in.
    google_client_ids: Annotated[list[str], NoDecode] = Field(default_factory=list)
    # Google Workspace domain behind @kiet.edu accounts: their ID tokens must carry this "hd" claim.
    kiet_google_domain: str = "kiet.edu"
    # Students stay signed in through the registration window; organisers sign in again each day.
    portal_session_hours: int = 7 * 24
    admin_session_hours: int = 12

    # Development only: POST /dev/token signs anyone in without Google.
    dev_sign_in: bool = False

    # These accounts are always super admins, so the first admin can sign in and add the others.
    super_admin_emails: Annotated[list[str], NoDecode] = Field(default_factory=list)

    registration_opens: datetime = datetime.fromisoformat("2026-10-03T00:00:00+05:30")
    registration_closes: datetime = datetime.fromisoformat("2026-10-15T23:59:59+05:30")
    # Department admins' finalist nominations are due by then (the event document says 24 October, 6:00 PM). After it,
    # only a super admin can still change them. Organisers can change or clear it in the admin panel.
    nominations_deadline: datetime | None = datetime.fromisoformat("2026-10-24T18:00:00+05:30")
    # Results (finalists) cannot be published before this: the event document declares finalists on 26 October.
    results_publish_from: datetime | None = datetime.fromisoformat("2026-10-26T00:00:00+05:30")
    # Testing only: treat registration as open regardless of the dates above.
    force_registration_open: bool = False

    # Invitation emails: "ses" sends through Amazon SES, "log" only writes them to the log.
    email_backend: Literal["ses", "log"] = "log"
    email_sender: str = "InnoTech26 <no-reply@innotech.kiet.edu>"
    # Where students write with questions; also the Reply-To of every email.
    contact_email: str = "innotech@kiet.edu"
    ses_region: str = ""
    portal_url: str = "https://innotech.kiet.edu"

    # Limits abuse of the invitation emails: invitations a team can send in 24 hours.
    invitations_per_team_per_day: int = 20

    @field_validator("cors_origins", "google_client_ids", "super_admin_emails", mode="before")
    @classmethod
    def split_lists(cls, value: object) -> object:
        return _split(value)

    @field_validator("super_admin_emails")
    @classmethod
    def lower_emails(cls, value: list[str]) -> list[str]:
        return [email.lower() for email in value]

    @model_validator(mode="after")
    def check_safe_for_production(self) -> "Settings":
        if self.environment == "production":
            if self.dev_sign_in:
                raise ValueError("DEV_SIGN_IN must not be set in production.")
            if self.force_registration_open:
                raise ValueError("FORCE_REGISTRATION_OPEN must not be set in production.")
            if len(self.session_secret) < 32:
                raise ValueError("SESSION_SECRET must be at least 32 characters in production.")
            if not self.google_client_ids:
                raise ValueError("GOOGLE_CLIENT_IDS is required in production.")
            if "*" in self.cors_origins:
                raise ValueError("CORS_ORIGINS must list the exact frontend origins in production.")
            # A forgotten EMAIL_BACKEND would silently turn every email into a log line.
            if "email_backend" not in self.model_fields_set:
                raise ValueError('EMAIL_BACKEND must be set explicitly in production ("ses", or "log" until SES is ready).')
        if self.email_backend == "ses" and not self.ses_region:
            raise ValueError("SES_REGION is required when EMAIL_BACKEND=ses.")
        if not self.session_secret and self.environment != "production":
            # Development and tests only: a fixed secret so tokens survive restarts.
            self.session_secret = "development-only-session-secret-not-for-production"
        dates = [
            self.registration_opens,
            self.registration_closes,
            *(d for d in (self.nominations_deadline, self.results_publish_from) if d),
        ]
        if any(moment.tzinfo is None for moment in dates):
            raise ValueError("Registration, nomination and results dates must include a timezone offset, e.g. +05:30.")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
