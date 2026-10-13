"""
Attendance by event pass.

A student in a submitted team shows a QR code on their phone; an organiser (or a judge of the team's room) scans it
and the student is marked present for that round. The code changes every minute and is made on the phone itself, so
it works without mobile data once the portal has loaded that day:

  code = "IT26P:" + user id (32 hex) + "." + minute number + "." + base32(HMAC-SHA256(seed, minute)[:10])
  seed = HMAC-SHA256(SESSION_SECRET, "innotech-pass-v1|" + user id + "|" + IST day)   (sent to the student only)

So a code cannot be forged, says nothing about the student, and a forwarded screenshot stops working within two
minutes. The scanner shows the student's name and roll number to check against their college ID card. Scanning the
same student again only reports when and by whom they were marked. Every mark and unmark is in the activity log.
"""

import base64
import hashlib
import hmac
import re
import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .. import rules
from ..auth import Staff
from ..config import Settings
from ..errors import ApiError
from ..models import Attendance, FinalTent, Panel, PanelJuror, PanelTeam, Profile, Team, TeamMember, User, utcnow
from ..schemas import ManualAttendanceInput, PassOut, PassRound, ScanInput, ScanOut, ScanStudent
from . import admin as admin_service
from . import audit, judging, limits

CODE = re.compile(r"^IT26P:([0-9A-F]{32})\.(\d{1,12})\.([A-Z2-7]{16})$")
NOT_A_PASS = "This is not an InnoTech26 event pass."


# ---------- Codes ----------


def _period(moment: datetime) -> int:
    return int(moment.timestamp()) // rules.PASS_PERIOD_SECONDS


def _day_of(period: int) -> date:
    return datetime.fromtimestamp(period * rules.PASS_PERIOD_SECONDS, UTC).astimezone(rules.IST).date()


def pass_seed(settings: Settings, user_id: uuid.UUID, day: date) -> bytes:
    message = b"innotech-pass-v1|" + user_id.bytes + b"|" + day.isoformat().encode()
    return hmac.new(settings.session_secret.encode(), message, hashlib.sha256).digest()


def pass_code(seed: bytes, user_id: uuid.UUID, period: int) -> str:
    """The code a phone shows during one period (the portal computes the same with Web Crypto)."""
    mac = hmac.new(seed, period.to_bytes(8, "big"), hashlib.sha256).digest()[:10]
    return f"IT26P:{user_id.hex.upper()}.{period}.{base64.b32encode(mac).decode()}"


def read_code(settings: Settings, code: str, now: datetime | None = None) -> uuid.UUID:
    """The student behind a scanned code, if it is genuine and current."""
    match = CODE.match(code.strip().upper())
    if not match:
        raise ApiError(NOT_A_PASS, 422)
    user_id, period = uuid.UUID(hex=match.group(1)), int(match.group(2))
    current = _period(now or utcnow())
    if not current - rules.PASS_PAST_PERIODS <= period <= current + rules.PASS_FUTURE_PERIODS:
        raise ApiError("This pass code has expired. Ask the student to show the live pass on their phone (it changes every minute).", 422)
    expected = pass_code(pass_seed(settings, user_id, _day_of(period)), user_id, period)
    if not hmac.compare_digest(expected, f"IT26P:{match.group(1)}.{match.group(2)}.{match.group(3)}"):
        raise ApiError(NOT_A_PASS, 422)
    return user_id


# ---------- The student's pass ----------


def _rounds_for(db: Session, team: Team) -> list[str]:
    return [r for r in rules.JUDGING_ROUNDS if db.scalar(select(Team.id).where(Team.id == team.id, judging._eligible_condition(r)))]


def my_pass(db: Session, user: User, settings: Settings) -> PassOut:
    now = utcnow()
    team = db.scalar(select(Team).join(TeamMember, TeamMember.team_id == Team.id).where(TeamMember.user_id == user.id))
    rounds = _rounds_for(db, team) if team is not None and team.status == "submitted" else []
    if team is None or not rounds:
        return PassOut(seed=None, day=None, period_seconds=rules.PASS_PERIOD_SECONDS, server_time=now, user_id=user.id, rounds=[])
    day = now.astimezone(rules.IST).date()
    rooms = dict(
        db.execute(select(PanelTeam.round, Panel).join(Panel, Panel.id == PanelTeam.panel_id).where(PanelTeam.team_id == team.id))
        .tuples()
        .all()
    )
    marks = {a.round: a for a in db.scalars(select(Attendance).where(Attendance.user_id == user.id))}
    tent = db.get(FinalTent, team.id)
    out = []
    for round_ in rounds:
        room = rooms.get(round_)
        out.append(
            PassRound(
                round=round_,
                team_code=team.code,
                team_name=team.name,
                building=room.building if room else None,
                room=room.name if room else None,
                location=room.location if room else None,
                slot_start=room.slot_start if room else None,
                slot_end=room.slot_end if room else None,
                tent=tent.tent if tent and round_ == "final" else None,
                present_at=marks[round_].marked_at if round_ in marks else None,
            )
        )
    seed = base64.urlsafe_b64encode(pass_seed(settings, user.id, day)).decode().rstrip("=")
    return PassOut(seed=seed, day=day, period_seconds=rules.PASS_PERIOD_SECONDS, server_time=now, user_id=user.id, rounds=out)


# ---------- Marking ----------


def _may_mark(db: Session, staff: Staff, team: Team, round_: str) -> bool:
    admin = staff.admin
    if admin is not None:
        if admin.role == "super_admin":
            return True
        if round_ == "department":
            if admin.role == "admin" and team.participant_type == "kiet" and team.department == admin.department:
                return True
        elif admin_service.can_see_team(admin, team):
            return True
    if staff.juror is not None:
        # A judge marks the teams of their own rooms.
        judged_here = (
            select(func.count())
            .select_from(PanelTeam)
            .join(PanelJuror, PanelJuror.panel_id == PanelTeam.panel_id)
            .where(PanelTeam.team_id == team.id, PanelTeam.round == round_, PanelJuror.juror_email == staff.juror.email)
        )
        if db.scalar(judged_here):
            return True
    return False


def _student(db: Session, staff: Staff, user_id: uuid.UUID, round_: str) -> tuple[User, Profile, TeamMember, Team]:
    user = db.get(User, user_id)
    profile = db.get(Profile, user_id)
    member = db.scalar(select(TeamMember).where(TeamMember.user_id == user_id))
    if user is None or profile is None or member is None:
        raise ApiError("This student is not in a team.", 404)
    if user.banned_at is not None:
        raise ApiError(f"{profile.full_name}'s account is suspended by the organisers. Do not mark them present.", 409)
    team = db.get(Team, member.team_id)
    assert team is not None
    label = judging.ROUND_LABELS[round_]
    if not db.scalar(select(Team.id).where(Team.id == team.id, judging._eligible_condition(round_))):
        raise ApiError(f"{profile.full_name}'s team {team.code} is not taking part in the {label} (status: {team.status}).", 409)
    if not _may_mark(db, staff, team, round_):
        where = team.department if team.participant_type == "kiet" else team.institution
        raise ApiError(
            f"{profile.full_name} ({team.code}, {where}) is not a student you can mark. Send them to their own room's desk.", 403
        )
    return user, profile, member, team


def _room(db: Session, team: Team, round_: str) -> Panel | None:
    return db.scalar(
        select(Panel).join(PanelTeam, PanelTeam.panel_id == Panel.id).where(PanelTeam.team_id == team.id, PanelTeam.round == round_)
    )


def _out(db: Session, result: str, mark: Attendance, profile: Profile, member: TeamMember, team: Team, warning: str | None) -> ScanOut:
    room = _room(db, team, mark.round)
    return ScanOut(
        result=result,  # type: ignore[arg-type]
        student=ScanStudent(
            user_id=profile.user_id,
            full_name=profile.full_name,
            roll_number=profile.roll_number,
            course=profile.course,
            year=profile.year,
            department=profile.department,
            institution=profile.institution,
            participant_type=profile.participant_type,
            role=member.role,
        ),
        team=admin_service.summaries(db, [team])[0],
        room=judging.room_label(room) if room else None,
        marked_at=mark.marked_at,
        marked_by=mark.marked_by,
        method=mark.method,
        warning=warning,
    )


def _mark(db: Session, staff: Staff, user_id: uuid.UUID, round_: str, method: str, note: str, panel_id: uuid.UUID | None) -> ScanOut:
    _, profile, member, team = _student(db, staff, user_id, round_)
    warning = None
    room = _room(db, team, round_)
    if panel_id is not None and (room is None or room.id != panel_id):
        warning = f"{team.code} is allotted to {judging.room_label(room)}, not this room." if room else f"{team.code} has no room yet."
    statement = (
        insert(Attendance)
        .values(user_id=user_id, round=round_, team_id=team.id, marked_at=utcnow(), marked_by=staff.email, method=method, note=note)
        .on_conflict_do_nothing(index_elements=["user_id", "round"])
        .returning(Attendance.user_id)
    )
    marked_now = db.execute(statement).first() is not None
    if marked_now:
        how = "by event pass" if method == "qr" else f"by hand ({note})"
        audit.record(
            db, staff.email, "attendance.marked", team, f"{profile.full_name} present for the {judging.ROUND_LABELS[round_]}, {how}"
        )
    db.commit()
    mark = db.get(Attendance, (user_id, round_), populate_existing=True)
    assert mark is not None
    return _out(db, "marked" if marked_now else "already", mark, profile, member, team, warning)


def scan(db: Session, staff: Staff, settings: Settings, data: ScanInput) -> ScanOut:
    limits.hit(f"scan:{staff.email}", 240, timedelta(minutes=1), "Too many scans in a minute. Wait a moment and scan again.")
    user_id = read_code(settings, data.code)
    return _mark(db, staff, user_id, data.round, "qr", "", data.panel_id)


def mark_by_hand(db: Session, staff: Staff, data: ManualAttendanceInput) -> ScanOut:
    return _mark(db, staff, data.user_id, data.round, "manual", data.note, None)


def unmark(db: Session, staff: Staff, data: ManualAttendanceInput) -> None:
    _, profile, _, team = _student(db, staff, data.user_id, data.round)
    mark = db.get(Attendance, (data.user_id, data.round), with_for_update=True)
    if mark is None:
        raise ApiError(f"{profile.full_name} is not marked present.", 409)
    db.delete(mark)
    audit.record(
        db,
        staff.email,
        "attendance.unmarked",
        team,
        f"{profile.full_name} no longer present for the {judging.ROUND_LABELS[data.round]} "
        f"(was marked by {mark.marked_by}). Reason: {data.note}",
    )
    db.commit()
