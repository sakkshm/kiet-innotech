"""
The event schedule an organiser can change while the event runs: when registration opens and closes, the
deadline for department admins' finalist nominations, and the earliest moment results can be published.

Other colleges and schools may be given a later registration deadline than KIET teams (COE KIET included) and startups
(`extended_closes`); until the general deadline passes, nothing differs for anyone.

The planned dates come from the settings (REGISTRATION_OPENS, REGISTRATION_CLOSES, REGISTRATION_EXTENDED_CLOSES,
NOMINATIONS_DEADLINE, RESULTS_PUBLISH_FROM). Once a
super admin saves a change, it is stored in the database (the `app_state` row "schedule") and wins over the settings.
Every request reads it fresh, so a change applies to all API workers at once and no redeploy is needed.
"""

import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .. import rules
from ..config import Settings
from ..errors import ApiError
from ..models import AppState, utcnow
from ..schemas import RegistrationOut, ScheduleDatesOut, ScheduleOut
from . import audit

logger = logging.getLogger(__name__)

SCHEDULE_KEY = "schedule"
# Sanity limits, so a typo cannot open registration for years or put it in the distant past.
MAX_WINDOW = timedelta(days=366)
EARLIEST = datetime(2020, 1, 1, tzinfo=UTC)
LATEST = datetime(2100, 1, 1, tzinfo=UTC)


@dataclass(frozen=True)
class Schedule:
    opens: datetime
    closes: datetime
    # Other colleges and schools can register until this; None = the same deadline as everyone.
    extended_closes: datetime | None
    nominations_deadline: datetime | None
    # Results cannot be published before this (the event document declares finalists on 26 October).
    results_from: datetime | None
    # True once an organiser has saved a change (otherwise these are the planned dates from the settings).
    customised: bool
    updated_by: str | None
    updated_at: datetime | None
    # Development and tests only (FORCE_REGISTRATION_OPEN): registration counts as open whatever the dates say.
    force_open: bool

    def closes_for(self, extended: bool) -> datetime:
        """The later deadline (`extended`: not a KIET department), or the general one."""
        return max(self.closes, self.extended_closes) if extended and self.extended_closes else self.closes

    def registration_state(self, now: datetime | None = None, extended: bool = False) -> rules.RegistrationState:
        return "open" if self.force_open else rules.window_state(self.opens, self.closes_for(extended), now)

    def latest_state(self, now: datetime | None = None) -> rules.RegistrationState:
        """Open while anyone can still register: what public pages show before a visitor says who they are."""
        return self.registration_state(now, extended=True)

    def nominations_closed(self, now: datetime | None = None) -> bool:
        return self.nominations_deadline is not None and (now or utcnow()) > self.nominations_deadline

    def results_due(self, now: datetime | None = None) -> bool:
        return self.results_from is None or (now or utcnow()) >= self.results_from


def _aware(value: object) -> datetime | None:
    """A timezone-aware datetime from a stored ISO string, or None if it is missing or unusable."""
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def _stored(row: AppState | None) -> dict | None:
    if row is None or not row.value:
        return None
    try:
        data = json.loads(row.value)
    except ValueError:
        data = None
    if isinstance(data, dict) and _aware(data.get("opens")) and _aware(data.get("closes")):
        return data
    # A damaged row must never lock students out: fall back to the planned dates and say so.
    logger.error("Ignoring an unreadable schedule row: %r", row.value[:200])
    return None


def load(db: Session, settings: Settings, *, lock: bool = False) -> Schedule:
    statement = select(AppState).where(AppState.key == SCHEDULE_KEY).execution_options(populate_existing=True)
    row = db.scalar(statement.with_for_update() if lock else statement)
    data = _stored(row)
    if data is None:
        return Schedule(
            opens=settings.registration_opens,
            closes=settings.registration_closes,
            extended_closes=settings.registration_extended_closes,
            nominations_deadline=settings.nominations_deadline,
            results_from=settings.results_publish_from,
            customised=False,
            updated_by=None,
            updated_at=None,
            force_open=settings.force_registration_open,
        )
    return Schedule(
        opens=_aware(data["opens"]),  # type: ignore[arg-type]
        closes=_aware(data["closes"]),  # type: ignore[arg-type]
        # A stored null means "no extension"; a missing key means the planned extension still applies.
        extended_closes=_aware(data["extended_closes"]) if "extended_closes" in data else settings.registration_extended_closes,
        # A stored null means "no deadline"; a missing key means the planned deadline still applies.
        nominations_deadline=_aware(data["nominations_deadline"]) if "nominations_deadline" in data else settings.nominations_deadline,
        results_from=_aware(data["results_from"]) if "results_from" in data else settings.results_publish_from,
        customised=True,
        updated_by=data.get("by"),
        updated_at=row.updated_at if row else None,
        force_open=settings.force_registration_open,
    )


def day(moment: datetime) -> str:
    """e.g. "12 October 2026", in IST, for messages to students."""
    local = moment.astimezone(rules.IST)
    return f"{local.day} {local:%B %Y}"


def _check(
    opens: datetime,
    closes: datetime,
    deadline: datetime | None,
    results_from: datetime | None = None,
    extended_closes: datetime | None = None,
) -> None:
    for name, moment in (
        ("opening", opens),
        ("closing", closes),
        ("extended closing", extended_closes),
        ("nomination deadline", deadline),
        ("results", results_from),
    ):
        if moment is not None and not EARLIEST <= moment <= LATEST:
            raise ApiError(f"The {name} date is not a sensible date.", 422)
    if closes <= opens:
        raise ApiError("Registration must close after it opens.", 422)
    if closes - opens > MAX_WINDOW:
        raise ApiError("Registration can stay open for at most a year.", 422)
    if extended_closes is not None and extended_closes < closes:
        raise ApiError("The later deadline cannot be earlier than the general closing date.", 422)
    if extended_closes is not None and extended_closes - opens > MAX_WINDOW:
        raise ApiError("Registration can stay open for at most a year.", 422)
    if results_from is not None and deadline is not None and results_from < deadline:
        raise ApiError("Results can only be published after the nominations deadline.", 422)
    if results_from is not None and results_from < closes:
        raise ApiError("Results can only be published after registration closes.", 422)


def _write(
    db: Session,
    settings: Settings,
    actor: str,
    *,
    opens: datetime,
    closes: datetime,
    extended_closes: datetime | None,
    deadline: datetime | None,
    results_from: datetime | None,
) -> Schedule:
    # Create the row if needed, then lock it, so two organisers saving at once run one after the other.
    db.execute(insert(AppState).values(key=SCHEDULE_KEY, value="", updated_at=utcnow()).on_conflict_do_nothing(index_elements=["key"]))
    row = db.scalar(select(AppState).where(AppState.key == SCHEDULE_KEY).with_for_update().execution_options(populate_existing=True))
    assert row is not None
    row.value = json.dumps(
        {
            "opens": opens.isoformat(),
            "closes": closes.isoformat(),
            "extended_closes": extended_closes.isoformat() if extended_closes else None,
            "nominations_deadline": deadline.isoformat() if deadline else None,
            "results_from": results_from.isoformat() if results_from else None,
            "by": actor,
        }
    )
    row.updated_at = utcnow()
    return load(db, settings, lock=True)


def _describe(schedule: Schedule) -> str:
    deadline = schedule.nominations_deadline.isoformat() if schedule.nominations_deadline else "none"
    results = schedule.results_from.isoformat() if schedule.results_from else "any time"
    extended = schedule.extended_closes.isoformat() if schedule.extended_closes else "none"
    return (
        f"opens {schedule.opens.isoformat()}, closes {schedule.closes.isoformat()}, later deadline {extended}, "
        f"nominations deadline {deadline}, results from {results}"
    )


class KEEP:
    """Marker: leave this date as it is."""


def update(
    db: Session,
    settings: Settings,
    actor: str,
    *,
    opens: datetime,
    closes: datetime,
    deadline: datetime | None,
    results_from: datetime | type[KEEP] | None = KEEP,
    extended_closes: datetime | type[KEEP] | None = KEEP,
) -> Schedule:
    """Sets the dates. The caller must be a super admin. Without `results_from` or `extended_closes` the current one is kept."""
    before = load(db, settings, lock=False)
    results = before.results_from if results_from is KEEP else results_from
    extended = before.extended_closes if extended_closes is KEEP else extended_closes
    # A results date that is kept is not re-checked; publishing still waits for the nominations deadline too.
    _check(opens, closes, deadline, None if results_from is KEEP else results, extended)  # type: ignore[arg-type]
    schedule = _write(db, settings, actor, opens=opens, closes=closes, extended_closes=extended, deadline=deadline, results_from=results)  # type: ignore[arg-type]
    audit.record(db, actor, "schedule.updated", detail=f"{_describe(schedule)} (was: {_describe(before)})")
    db.commit()
    return schedule


def open_now(db: Session, settings: Settings, actor: str, *, closes: datetime | None = None) -> Schedule:
    """Opens registration immediately. If the closing date has already passed, a new one is required."""
    current = load(db, settings)
    if current.registration_state() == "open":
        raise ApiError("Registration is already open.", 409)
    now = utcnow().replace(microsecond=0)
    new_closes = closes or current.closes
    if new_closes <= now:
        raise ApiError("The closing date has passed. Choose a new closing date to open registration again.", 422)
    extended = current.extended_closes if current.extended_closes and current.extended_closes >= new_closes else None
    _check(now, new_closes, current.nominations_deadline, None, extended)
    schedule = _write(
        db,
        settings,
        actor,
        opens=now,
        closes=new_closes,
        extended_closes=extended,
        deadline=current.nominations_deadline,
        results_from=current.results_from,
    )
    audit.record(db, actor, "schedule.opened", detail=f"Registration opened by an organiser; closes {new_closes.isoformat()}")
    db.commit()
    return schedule


def close_now(db: Session, settings: Settings, actor: str) -> Schedule:
    """Closes registration immediately. Teams already submitted stay as they are."""
    current = load(db, settings)
    if current.registration_state() == "closed":
        raise ApiError("Registration is already closed.", 409)
    # Closed one second ago, so the very next request already sees "closed". If registration had not opened yet,
    # it is treated as having opened (and closed) just now.
    closes = utcnow().replace(microsecond=0) - timedelta(seconds=1)
    opens = min(current.opens, closes - timedelta(seconds=1))
    _check(opens, closes, current.nominations_deadline)
    # "Close now" stops everyone, so the later deadline goes too.
    schedule = _write(
        db,
        settings,
        actor,
        opens=opens,
        closes=closes,
        extended_closes=None,
        deadline=current.nominations_deadline,
        results_from=current.results_from,
    )
    audit.record(db, actor, "schedule.closed", detail="Registration closed by an organiser")
    db.commit()
    return schedule


def to_out(window: Schedule, settings: Settings, now: datetime | None = None) -> ScheduleOut:
    now = now or utcnow()
    return ScheduleOut(
        registration=RegistrationOut(state=window.registration_state(now), opens=window.opens, closes=window.closes),
        extended_closes=window.extended_closes,
        nominations_deadline=window.nominations_deadline,
        nominations_open=not window.nominations_closed(now),
        results_publish_from=window.results_from,
        results_due=window.results_due(now),
        customised=window.customised,
        updated_by=window.updated_by,
        updated_at=window.updated_at,
        server_time=now,
        planned=ScheduleDatesOut(
            registration_opens=settings.registration_opens,
            registration_closes=settings.registration_closes,
            registration_extended_closes=settings.registration_extended_closes,
            nominations_deadline=settings.nominations_deadline,
            results_publish_from=settings.results_publish_from,
        ),
    )


def is_extended(subject) -> bool:
    """Whether a profile or team (anything with participant_type and department) gets the later deadline: not a KIET department."""
    return subject is not None and rules.has_extended_deadline(subject.participant_type, subject.department)


def registration_for(window: Schedule, subject=None, now: datetime | None = None, *, email: str = "") -> RegistrationOut:
    """
    The registration window as one student sees it. Other colleges and schools get the later deadline. Someone without a
    profile who signed in with a non-KIET email may turn out to be one of them, so once the general deadline has passed
    they are shown the later window; saving a profile of another kind is still refused.
    """
    general = window.registration_state(now)
    may_be_outside = subject is None and not rules.is_kiet_email(email)
    extended = is_extended(subject) or (may_be_outside and general == "closed")
    extended = extended and window.extended_closes is not None and window.extended_closes > window.closes
    return RegistrationOut(
        state=window.registration_state(now, extended),
        opens=window.opens,
        closes=window.closes_for(extended),
        extended=extended,
    )
