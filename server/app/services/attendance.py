"""
Attendance by event pass.

Department round: a judge of the room (either of the two, during the room's time) or an admin sets each student of a
team present, absent or not marked. Everybody counts as present until marked absent, and a team whose members are all absent scores 0
(presence.py, judging.py). An admin can change it at any time; super admins for every team, a department's admin for their own.

By event pass: a student in a submitted team shows a QR code on their phone; an organiser (or a judge of the team's room)
scans it and the student is marked present for that round. The code changes every minute and is made on the phone itself, so
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

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .. import rules
from ..auth import Staff
from ..config import Settings
from ..errors import ApiError
from ..models import Admin, Attendance, FinalTent, Juror, Panel, PanelJuror, PanelTeam, Profile, Team, TeamMember, User, utcnow
from ..schemas import (
    AttendanceReportOut,
    AttendanceReportRow,
    ManualAttendanceInput,
    PassOut,
    PassRound,
    PresenceInput,
    ScanInput,
    ScanOut,
    ScanStudent,
    TeamPresenceOut,
)
from . import admin as admin_service
from . import audit, judging, limits, presence

CODE = re.compile(r"^IT26P:([0-9A-F]{32})\.(\d{1,12})\.([A-Z2-7]{16})$")
NOT_A_PASS = "This is not an InnoTech26 event pass."


# ---------- Switch ----------


def require_enabled(settings: Settings) -> None:
    """Attendance by event pass is off until organisers switch it on (ATTENDANCE_ENABLED)."""
    if not settings.attendance_enabled:
        raise ApiError("Attendance is not in use yet.", 404)


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
    planned = judging.timetable(db).slots.get(team.department or "")
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
                planned_start=planned[0] if planned and round_ == "department" and room is None else None,
                planned_end=planned[1] if planned and round_ == "department" and room is None else None,
                tent=tent.tent if tent and round_ == "final" else None,
                present_at=marks[round_].marked_at if round_ in marks and marks[round_].status == "present" else None,
                # Only KIET students in the department round are told whether they were marked present or absent.
                attendance=(marks[round_].status if round_ in marks else "not_marked")  # type: ignore[arg-type]
                if round_ == "department" and team.participant_type == "kiet"
                else None,
            )
        )
    # With attendance switched off the student still sees where to go, but no QR seed is issued.
    seed = base64.urlsafe_b64encode(pass_seed(settings, user.id, day)).decode().rstrip("=") if settings.attendance_enabled else None
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
        # A judge marks the teams of their own room, on the day: from two hours before its slot until scoring closes.
        room = db.scalar(
            select(Panel)
            .join(PanelTeam, PanelTeam.panel_id == Panel.id)
            .join(PanelJuror, PanelJuror.panel_id == Panel.id)
            .where(PanelTeam.team_id == team.id, PanelTeam.round == round_, PanelJuror.juror_email == staff.juror.email)
        )
        if room is not None:
            opens, closes = judging.scoring_window(room)
            return opens is None or closes is None or opens - timedelta(hours=2) <= judging.utcnow() <= closes
    return False


def _student(db: Session, staff: Staff, user_id: uuid.UUID, round_: str) -> tuple[User, Profile, TeamMember, Team]:
    user = db.get(User, user_id)
    profile = db.get(Profile, user_id)
    member = db.scalar(select(TeamMember).where(TeamMember.user_id == user_id))
    if user is None or profile is None or member is None:
        raise ApiError("This student is not in a team.", 404)
    team = db.get(Team, member.team_id)
    assert team is not None
    # Scope first, so nothing about a student outside the caller's rooms or department is revealed.
    if not _may_mark(db, staff, team, round_):
        raise ApiError("This student is not in your room or department. Send them to their own room's desk.", 403)
    if user.banned_at is not None:
        raise ApiError(f"{profile.full_name}'s account is suspended by the organisers. Do not mark them present.", 409)
    label = judging.ROUND_LABELS[round_]
    if not db.scalar(select(Team.id).where(Team.id == team.id, judging._eligible_condition(round_))):
        raise ApiError(f"{profile.full_name}'s team {team.code} is not taking part in the {label} (status: {team.status}).", 409)
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
    # A scan or a hand mark means the student is here: it also turns an "absent" into present.
    now = utcnow()
    statement = (
        insert(Attendance)
        .values(
            user_id=user_id, round=round_, team_id=team.id, marked_at=now, marked_by=staff.email, method=method, note=note, status="present"
        )
        .on_conflict_do_update(
            index_elements=["user_id", "round"],
            set_={"status": "present", "marked_at": now, "marked_by": staff.email, "method": method, "note": note},
            where=Attendance.status != "present",
        )
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
    require_enabled(settings)
    limits.hit(f"scan:{staff.email}", 240, timedelta(minutes=1), "Too many scans in a minute. Wait a moment and scan again.")
    user_id = read_code(settings, data.code)
    return _mark(db, staff, user_id, data.round, "qr", "", data.panel_id)


def mark_by_hand(db: Session, staff: Staff, settings: Settings, data: ManualAttendanceInput) -> ScanOut:
    require_enabled(settings)
    return _mark(db, staff, data.user_id, data.round, "manual", data.note, None)


def unmark(db: Session, staff: Staff, settings: Settings, data: ManualAttendanceInput) -> None:
    require_enabled(settings)
    _, profile, _, team = _student(db, staff, data.user_id, data.round)
    mark = db.get(Attendance, (data.user_id, data.round), with_for_update=True)
    if mark is None or mark.status != "present":
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


# ---------- Department round: present or absent, by a judge or an admin ----------


def _presence_team(db: Session, team_id: uuid.UUID, user_id: uuid.UUID) -> tuple[Team, TeamMember]:
    team = db.get(Team, team_id)
    if team is None:
        raise ApiError("Team not found.", 404)
    if not db.scalar(select(Team.id).where(Team.id == team.id, judging._eligible_condition("department"))):
        raise ApiError(f"{team.code} is not taking part in the department round (status: {team.status}).", 409)
    member = db.get(TeamMember, (team_id, user_id))
    if member is None:
        raise ApiError("This student is not in this team.", 404)
    return team, member


def _apply_presence(db: Session, actor: str, team: Team, user_id: uuid.UUID, target: str) -> TeamPresenceOut:
    """
    Sets one student present, absent or not marked (the mark is taken back). Setting what is already set changes nothing
    and is not logged again.
    """
    profile = db.get(Profile, user_id)
    assert profile is not None
    label = judging.ROUND_LABELS[presence.ROUND]
    if target == "not_marked":
        removed = db.execute(
            delete(Attendance).where(Attendance.user_id == user_id, Attendance.round == presence.ROUND).returning(Attendance.user_id)
        ).first()
        if removed is not None:
            audit.record(db, actor, "attendance.unmarked", team, f"{profile.full_name} set back to not marked for the {label}")
    else:
        now = utcnow()
        statement = (
            insert(Attendance)
            .values(
                user_id=user_id,
                round=presence.ROUND,
                team_id=team.id,
                marked_at=now,
                marked_by=actor,
                method="manual",
                note="",
                status=target,
            )
            .on_conflict_do_update(
                index_elements=["user_id", "round"],
                set_={"status": target, "marked_at": now, "marked_by": actor, "method": "manual", "team_id": team.id},
                where=Attendance.status != target,
            )
            .returning(Attendance.user_id)
        )
        if db.execute(statement).first() is not None:
            audit.record(
                db,
                actor,
                "attendance.marked" if target == "present" else "attendance.absent",
                team,
                f"{profile.full_name} marked {target} for the {label}",
            )
    db.commit()
    members = presence.member_states(db, [team.id])[team.id]
    return TeamPresenceOut(team_id=team.id, members=members, all_absent=presence.is_all_absent(members))


def set_presence_as_admin(db: Session, admin: Admin, team_id: uuid.UUID, user_id: uuid.UUID, data: PresenceInput) -> TeamPresenceOut:
    """An admin changes a student's attendance at any time: a super admin for any team, a department's admin for their own."""
    team, _ = _presence_team(db, team_id, user_id)
    own = admin.role == "admin" and team.participant_type == "kiet" and team.department == admin.department
    if not (admin.role == "super_admin" or own):
        raise ApiError("Only a super admin or this team's department admin can change attendance.", 403)
    return _apply_presence(db, admin.email, team, user_id, data.target)


def set_presence_as_judge(
    db: Session, juror: Juror, panel_id: uuid.UUID, team_id: uuid.UUID, user_id: uuid.UUID, data: PresenceInput
) -> TeamPresenceOut:
    """
    Either judge of a room marks or changes a student's attendance while judging is open, during the room's slot and its
    buffer. Both judges can change it, whoever marked it first.
    """
    panel = db.get(Panel, panel_id)
    link = db.get(PanelJuror, (panel_id, juror.email))
    if panel is None or link is None:
        raise ApiError("You are not a judge on this panel.", 403)
    if panel.round != presence.ROUND:
        raise ApiError("Attendance is taken in the department round.", 422)
    if db.get(PanelTeam, (panel_id, team_id)) is None:
        raise ApiError("This team is not allotted to your room.", 403)
    team, _ = _presence_team(db, team_id, user_id)
    if not judging.round_open(db, presence.ROUND):
        raise ApiError("Judging has not been opened yet, so attendance cannot be taken. Ask the organisers.", 423)
    opens, closes = judging.scoring_window(panel)
    now = judging.utcnow()
    if opens is not None and now < opens:
        raise ApiError("Your room's slot has not started yet. Attendance can be taken once it does.", 423)
    if closes is not None and now > closes:
        raise ApiError("Your room's time is over. Ask your department admin to change attendance.", 423)
    return _apply_presence(db, juror.email, team, user_id, data.target)


# ---------- The report ----------


def presence_report(
    db: Session,
    admin: Admin,
    *,
    department: str | None = None,
    day: date | None = None,
    state: str | None = None,
    panel_id: uuid.UUID | None = None,
    q: str | None = None,
    team_zero: bool = False,
    page: int = 1,
    page_size: int | None = 25,
) -> AttendanceReportOut:
    """
    Every student of the department round with their attendance: present, absent or not marked. A super admin sees all
    departments (and can pick one); a department's admin sees only their own students. `page_size=None` returns everything
    the filters match (for the PDF and CSV downloads).
    """
    if admin.role == "admin" and admin.department != rules.CLUB_DEPARTMENT:
        department = admin.department
    elif admin.role != "super_admin":
        raise ApiError("The attendance report is for super admins and department admins.", 403)
    elif department is not None and department not in rules.DEPARTMENTS:
        raise ApiError(f'Unknown department "{department}".', 422)

    statement = (
        select(Team, Panel)
        .outerjoin(PanelTeam, (PanelTeam.team_id == Team.id) & (PanelTeam.round == presence.ROUND))
        .outerjoin(Panel, Panel.id == PanelTeam.panel_id)
        .where(judging._eligible_condition(presence.ROUND, department))
        .order_by(Team.number)
    )
    if panel_id is not None:
        statement = statement.where(Panel.id == panel_id)
    rows = db.execute(statement).tuples().all()
    teams = [team for team, _ in rows]
    states = presence.member_states(db, [t.id for t in teams])
    details = {
        user_id: (profile, member)
        for member, profile in db.execute(
            select(TeamMember, Profile)
            .join(Profile, Profile.user_id == TeamMember.user_id)
            .where(TeamMember.team_id.in_([t.id for t in teams]))
        ).tuples()
        for user_id in [member.user_id]
    }
    table = judging.timetable(db).slots
    needle = q.strip().lower() if q and q.strip() else None
    items: list[tuple[tuple, AttendanceReportRow]] = []
    for team, room in rows:
        members = states.get(team.id, [])
        zero = presence.is_all_absent(members)
        planned = table.get(team.department or "") if room is None else None
        start = room.slot_start if room is not None and room.slot_start else (planned[0] if planned else None)
        end = room.slot_end if room is not None and room.slot_end else (planned[1] if planned else None)
        team_day = start.astimezone(rules.IST).date() if start else None
        if day is not None and team_day != day:
            continue
        if team_zero and not zero:
            continue
        for m in members:
            profile, _member = details[m.user_id]
            if state is not None and m.state != state:
                continue
            if needle and not any(needle in v.lower() for v in (m.full_name, profile.roll_number, team.code, team.name)):
                continue
            row = AttendanceReportRow(
                user_id=m.user_id,
                team_id=team.id,
                team_code=team.code,
                team_name=team.name,
                category=team.category,
                department=team.department,
                room=judging.room_label(room) if room is not None else None,
                slot_start=start,
                slot_end=end,
                day=team_day,
                full_name=m.full_name,
                role=m.role,
                roll_number=profile.roll_number,
                year=profile.year,
                course=profile.course,
                student_department=profile.department,
                phone=profile.phone,
                state=m.state,
                marked_by=m.marked_by,
                marked_at=m.marked_at,
                team_all_absent=zero,
            )
            order = (
                team.department or "",
                start.timestamp() if start else 0,
                room.name_key if room is not None else "",
                team.number,
                m.role != "leader",
                m.full_name.lower(),
            )
            items.append((order, row))
    items.sort(key=lambda pair: pair[0])
    ordered = [row for _, row in items]
    total = len(ordered)
    shown = ordered if page_size is None else ordered[(page - 1) * page_size : page * page_size]
    return AttendanceReportOut(
        items=shown,
        total=total,
        page=page,
        page_size=page_size or total,
        present=sum(1 for r in ordered if r.state == "present"),
        absent=sum(1 for r in ordered if r.state == "absent"),
        not_marked=sum(1 for r in ordered if r.state == "not_marked"),
        teams=len({r.team_id for r in ordered}),
        teams_all_absent=len({r.team_id for r in ordered if r.team_all_absent}),
    )
