"""
Attendance by student, for super admins and department admins: every student of the department round with their department,
year and slot, no teams. A student is present or absent; nobody is present until an admin or judge marks them, so a student
nobody has marked yet shows as "not marked" and counts as absent in these lists and downloads.

This only reads and sets marks in the attendance table that the judges' screens use too. Nothing is deleted and no mark
changes unless an admin asks, so what judges and admins have already marked stays exactly as it is. A team still scores 0
only when all its members are marked absent (presence.py); that guard does not read these lists.
"""

import uuid
from datetime import datetime

from sqlalchemy import and_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .. import rules
from ..errors import ApiError
from ..models import Admin, Attendance, Panel, PanelTeam, Profile, Team, TeamMember, utcnow
from ..schemas import MarkStudentsOut, RollCallOut, RollCallRow, RollCallSlot, SkippedStudent
from . import audit, judging, presence

NO_SLOT = "none"


def _scope(admin: Admin) -> str | None:
    """The department an admin is limited to; None for a super admin. Everyone else has no attendance list."""
    if admin.role == "super_admin":
        return None
    if admin.role == "admin" and admin.department and admin.department != rules.CLUB_DEPARTMENT:
        return admin.department
    raise ApiError("Attendance is for super admins and department admins.", 403)


def _slot_key(start: datetime | None, end: datetime | None) -> str:
    return f"{start.isoformat()}|{end.isoformat()}" if start and end else NO_SLOT


def roll_call(
    db: Session,
    admin: Admin,
    *,
    department: str | None = None,
    year: int | None = None,
    slot: str | None = None,
    state: str | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int | None = 25,
) -> RollCallOut:
    """The students with their attendance; `page_size=None` returns everything the filters match (for the downloads)."""
    scope = _scope(admin)
    if scope is not None:
        department = scope
    elif department is not None and department not in rules.DEPARTMENTS:
        raise ApiError(f'Unknown department "{department}".', 422)

    statement = (
        select(Profile, Team, Panel, Attendance)
        .join(TeamMember, TeamMember.user_id == Profile.user_id)
        .join(Team, Team.id == TeamMember.team_id)
        .outerjoin(PanelTeam, and_(PanelTeam.team_id == Team.id, PanelTeam.round == presence.ROUND))
        .outerjoin(Panel, Panel.id == PanelTeam.panel_id)
        .outerjoin(Attendance, and_(Attendance.user_id == Profile.user_id, Attendance.round == presence.ROUND))
        .where(judging._eligible_condition(presence.ROUND), Profile.participant_type == "kiet")
    )
    if department:
        statement = statement.where(Profile.department == department)
    needle = q.strip().lower() if q and q.strip() else None

    planned = judging.timetable(db).slots
    rows: list[tuple[RollCallRow, str]] = []
    for profile, team, room, mark in db.execute(statement).tuples():
        if needle and needle not in profile.full_name.lower() and needle not in (profile.roll_number or "").lower():
            continue
        fallback = planned.get(team.department or "") if room is None else None
        start = room.slot_start if room is not None and room.slot_start else (fallback[0] if fallback else None)
        end = room.slot_end if room is not None and room.slot_end else (fallback[1] if fallback else None)
        row = RollCallRow(
            user_id=profile.user_id,
            full_name=profile.full_name,
            roll_number=profile.roll_number or "",
            year=profile.year,
            course=profile.course,
            department=profile.department,
            slot_start=start,
            slot_end=end,
            state=mark.status if mark is not None else "not_marked",  # type: ignore[arg-type]
            marked_by=mark.marked_by if mark is not None else None,
            marked_at=mark.marked_at if mark is not None else None,
        )
        rows.append((row, _slot_key(start, end)))

    def keep(*, with_year: bool = True, with_slot: bool = True, with_state: bool = True) -> list[RollCallRow]:
        return [
            r
            for r, key in rows
            if (not with_year or year is None or r.year == year)
            and (not with_slot or slot is None or key == slot)
            and (not with_state or state is None or r.state == state)
        ]

    def order(r: RollCallRow):
        return (r.department or "", r.year, r.full_name.lower(), r.roll_number)

    counted = keep(with_state=False)
    filtered = sorted(keep(), key=order)
    years: dict[int, int] = {}
    for r in keep(with_year=False, with_state=False):
        years[r.year] = years.get(r.year, 0) + 1
    slots: dict[str, RollCallSlot] = {}
    for r, key in rows:
        if key not in slots and (year is None or r.year == year) and (state is None or r.state == state):
            slots[key] = RollCallSlot(key=key, start=r.slot_start, end=r.slot_end)
    total = len(filtered)
    shown = filtered if page_size is None else filtered[(page - 1) * page_size : page * page_size]
    return RollCallOut(
        items=shown,
        total=total,
        page=page,
        page_size=page_size or total,
        students=len(counted),
        present=sum(1 for r in counted if r.state == "present"),
        absent=sum(1 for r in counted if r.state == "absent"),
        not_marked=sum(1 for r in counted if r.state == "not_marked"),
        years=dict(sorted(years.items())),
        slots=sorted(slots.values(), key=lambda s: (s.start is None, s.start.timestamp() if s.start else 0, s.key)),
    )


def mark_students(db: Session, admin: Admin, user_ids: list[uuid.UUID], present: bool) -> MarkStudentsOut:
    """
    Marks the students present (or absent) in one go. A department's admin can mark only students of their own department.
    Students who are already in that state are left alone, and every change is logged. Marks are only added or changed.
    """
    scope = _scope(admin)
    ids = set(user_ids)
    found = {
        profile.user_id: (profile, team)
        for profile, team in db.execute(
            select(Profile, Team)
            .join(TeamMember, TeamMember.user_id == Profile.user_id)
            .join(Team, Team.id == TeamMember.team_id)
            .where(Profile.user_id.in_(ids), judging._eligible_condition(presence.ROUND), Profile.participant_type == "kiet")
        ).tuples()
    }
    skipped = [
        SkippedStudent(full_name=profile.full_name, roll_number=profile.roll_number or "", reason=f"not a student of {scope}")
        for profile, _ in found.values()
        if scope is not None and profile.department != scope
    ]
    allowed = {uid: pair for uid, pair in found.items() if scope is None or pair[0].department == scope}

    changed_ids: set[uuid.UUID] = set()
    if allowed:
        status = "present" if present else "absent"
        now = utcnow()
        values = [
            {
                "user_id": uid,
                "round": presence.ROUND,
                "team_id": team.id,
                "marked_at": now,
                "marked_by": admin.email,
                "method": "manual",
                "note": "",
                "status": status,
            }
            for uid, (_profile, team) in sorted(allowed.items(), key=lambda pair: str(pair[0]))
        ]
        statement = insert(Attendance).values(values)
        statement = statement.on_conflict_do_update(
            index_elements=["user_id", "round"],
            set_={
                "status": status,
                "marked_at": now,
                "marked_by": admin.email,
                "method": "manual",
                "team_id": statement.excluded.team_id,
            },
            where=Attendance.status != status,
        ).returning(Attendance.user_id)
        changed_ids = set(db.execute(statement).scalars())
        for uid in changed_ids:
            profile, team = allowed[uid]
            audit.record(
                db,
                admin.email,
                "attendance.marked" if present else "attendance.absent",
                team,
                f"{profile.full_name} marked {status} for the {judging.ROUND_LABELS[presence.ROUND]}",
            )
    db.commit()
    return MarkStudentsOut(
        changed=len(changed_ids), unchanged=len(allowed) - len(changed_ids), skipped=skipped, not_found=len(ids) - len(found)
    )
