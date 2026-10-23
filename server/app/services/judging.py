"""
Judging, following the event document:

- Department round (22-24 October): KIET teams are judged in rooms, one department's teams per room, by faculty
  of another department. Each room has its own panel of judges.
- Grand Finale (30 October): finalists and teams from other colleges and schools exhibit in numbered tents and are
  judged by panels of external judges.
- Every category is scored out of 50 on its common rubric (rules.RUBRIC_PARTS). Ties are broken by the
  innovation/originality criterion, then Query Addressing, then the department admin or a super admin decides (the
  organisers at the Grand Finale). No shared positions.

Super admins set up everything and open or lock each round; judging is locked until they open it. Department admins
set up their own department's rooms (building, room and time slot), appoint judges for them and allot their teams.
A judge sees and scores only the teams of their own rooms, only while the round is open. A department room's judges
can save marks from the slot's start to its end plus the room's buffer (15 minutes by default, at most 60; the
department's admin sets it). Saved marks can be changed with a clear reason until the judge locks all their marks in
the room, or the time runs out, which locks them. After that only a super admin, or the department's own admin during
the slot and buffer, can change them (the latter with a clear reason). Every change is logged with the old marks.
"""

import json
import logging
import re
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from statistics import mean

from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import rules
from ..config import Settings
from ..db import violated_constraint
from ..errors import ApiError
from ..models import (
    Admin,
    AppState,
    Attendance,
    Award,
    FinalistNomination,
    FinalTent,
    Juror,
    Panel,
    PanelJuror,
    PanelTeam,
    Profile,
    Score,
    Team,
    TeamMember,
    utcnow,
)
from ..schemas import (
    AdminScoreInput,
    AttendanceMember,
    AttendanceSheet,
    AttendanceTeam,
    AwardInput,
    AwardOut,
    BufferInput,
    JudgeMemberOut,
    JudgeOut,
    JudgePanelOut,
    JudgeScoreInput,
    JudgeTeamOut,
    JudgingOut,
    JurorInput,
    JurorOut,
    JurorPanelRef,
    LeaderboardCategory,
    LeaderboardDepartment,
    LeaderboardOut,
    LeaderboardTeam,
    LockOut,
    PanelInput,
    PanelJurorOut,
    PanelJurorsInput,
    PanelOut,
    PanelPlace,
    PanelScoreOut,
    PanelTeamOut,
    PanelTeamsInput,
    PanelUpdateInput,
    PresentInput,
    PrizeOut,
    RankedTeam,
    RankingGroup,
    RankingsOut,
    ReadinessOut,
    ReadinessRow,
    RoundOut,
    ScoreOut,
    TentRowOut,
    TentsInput,
    TimetableInput,
    TimetableOut,
    TimetableSlot,
    UnlockInput,
)
from . import admin as admin_service
from . import audit, presence, schedule

logger = logging.getLogger(__name__)

ROUND_LABELS = {"department": "department round", "final": "Grand Finale"}


def _round_key(round_: str) -> str:
    return f"judging_open:{round_}"


def _check_round(round_: str) -> None:
    if round_ not in rules.JUDGING_ROUNDS:
        raise ApiError(f'Unknown round "{round_}".', 404)


def round_open(db: Session, round_: str) -> bool:
    """A round is open while its app_state row exists."""
    return db.get(AppState, _round_key(round_)) is not None


# ---------- Who can see what ----------


def _require_super(admin: Admin) -> None:
    if admin.role != "super_admin":
        raise ApiError("Only a super admin can manage judging.", 403)


def _manages_rooms(admin: Admin) -> bool:
    """Super admins, and department admins of departments that take part in the department round."""
    return admin.role == "super_admin" or (admin.role == "admin" and admin.department != rules.CLUB_DEPARTMENT)


def _can_edit(admin: Admin, panel: Panel) -> bool:
    if admin.role == "super_admin":
        return True
    return admin.role == "admin" and panel.round == "department" and panel.department == admin.department


def _may_edit_marks(admin: Admin, panel: Panel, now: datetime) -> bool:
    """Super admins can always change a judge's marks; a department's own admin only during its room's slot and buffer."""
    if admin.role == "super_admin":
        return True
    if not _can_edit(admin, panel):
        return False
    opens, closes = scoring_window(panel)
    return opens is not None and closes is not None and opens <= now <= closes


def _is_parent(panel: Panel, juror: Juror) -> bool:
    """A department room's parent department judge: the judge from the room's own department."""
    return panel.round == "department" and juror.department is not None and juror.department == panel.department


def _require_editor(admin: Admin, panel: Panel) -> None:
    if not _can_edit(admin, panel):
        raise ApiError("Only a super admin or this department's admin can change this room.", 403)


def _require_creator(admin: Admin, round_: str, department: str | None) -> None:
    if admin.role == "super_admin":
        return
    if round_ != "department":
        raise ApiError("Only a super admin can set up Grand Finale panels.", 403)
    if not _manages_rooms(admin) or department != admin.department:
        raise ApiError(f"You can set up rooms for {admin.department} teams only.", 403)


def room_label(panel: Panel) -> str:
    """ "G Block · 112", or a finale panel's name."""
    return f"{panel.building} · {panel.name}" if panel.building else panel.name


def slot_label(start: datetime | None, end: datetime | None) -> str:
    """ "22 Oct, 10:00 AM - 1:00 PM" in IST."""
    if start is None or end is None:
        return ""
    s, e = start.astimezone(rules.IST), end.astimezone(rules.IST)
    return f"{s.day} {s:%b}, {s:%I:%M %p} - {e:%I:%M %p}".replace(" 0", " ")


# A judge is free for another room from this long after their last room's slot ends.
JUDGE_GAP = timedelta(minutes=1)


def _rooms_clash(a: tuple[datetime | None, datetime | None], b: tuple[datetime | None, datetime | None]) -> bool:
    """
    Whether one judge cannot sit in both rooms: their time slots overlap, or the second starts less than a minute after the
    first ends. Rooms without a time (finale panels) cannot be shown to be apart, so they clash.
    """
    if None in (*a, *b):
        return True
    return a[0] < b[1] + JUDGE_GAP and b[0] < a[1] + JUDGE_GAP  # type: ignore[operator]


def _check_judges_free(
    db: Session, panel: Panel, emails: list[str], start: datetime | None, end: datetime | None, *, moving: bool = False
) -> None:
    """
    Raises 409 when one of these judges is already in another room of the round whose time clashes with [start, end].
    A judge can be in many rooms, one at a time: different days, or the same day one after the other.
    """
    if not emails:
        return
    rows = db.execute(
        select(Juror.name, Panel)
        .join(PanelJuror, PanelJuror.juror_email == Juror.email)
        .join(Panel, Panel.id == PanelJuror.panel_id)
        .where(Juror.email.in_(emails), Panel.round == panel.round, Panel.id != panel.id)
        .order_by(Panel.slot_start, Juror.name)
    ).all()
    for name, other in rows:
        if not _rooms_clash((start, end), (other.slot_start, other.slot_end)):
            continue
        where = ", ".join(p for p in (other.department and f"{other.department} teams", slot_label(other.slot_start, other.slot_end)) if p)
        free_at = (other.slot_end + JUDGE_GAP).astimezone(rules.IST) if other.slot_end is not None else None
        free = f" {name} is free again from {free_at.day} {free_at:%b}, {free_at:%I:%M %p}.".replace(" 0", " ") if free_at else ""
        what = "so its new time would clash" if moving else "which is at the same time"
        raise ApiError(
            f"{name} already judges in {room_label(other)}{f' ({where})' if where else ''}, {what}. "
            f"A judge can be in one room at a time.{free}",
            409,
        )


# ---------- Timetable ----------

TIMETABLE_KEY = "judging_timetable"


@dataclass(frozen=True)
class Timetable:
    slots: dict[str, tuple[datetime, datetime]]
    customised: bool
    updated_by: str | None


def timetable(db: Session) -> Timetable:
    """Each department's slot for the department round: the event schedule, as changed."""
    slots = {
        d: (datetime.fromisoformat(start), datetime.fromisoformat(end))
        for start, end, departments in rules.DEFAULT_TIMETABLE
        for d in departments
    }
    by = None
    row = db.get(AppState, TIMETABLE_KEY)
    if row is not None and row.value:
        try:
            stored = json.loads(row.value)
            slots = {
                d: (datetime.fromisoformat(s), datetime.fromisoformat(e))
                for d, (s, e) in stored["slots"].items()
                if d in rules.NOMINATING_DEPARTMENTS
            }
            by = stored.get("by")
        except (ValueError, KeyError, TypeError):
            logger.error("Ignoring an unreadable judging timetable row")
    return Timetable(slots=slots, customised=row is not None, updated_by=by)


def timetable_out(table: Timetable) -> TimetableOut:
    return TimetableOut(
        slots=[
            TimetableSlot(
                department=d,
                slot_start=table.slots[d][0] if d in table.slots else None,
                slot_end=table.slots[d][1] if d in table.slots else None,
            )
            for d in rules.NOMINATING_DEPARTMENTS
        ],
        customised=table.customised,
        updated_by=table.updated_by,
    )


def scoring_window(panel: Panel) -> tuple[datetime | None, datetime | None]:
    """When a department room's judges can submit marks: its slot, plus the room's buffer after it."""
    if panel.round != "department" or panel.slot_start is None or panel.slot_end is None:
        return None, None
    return panel.slot_start, panel.slot_end + timedelta(minutes=panel.buffer_minutes)


def _locked(panel: Panel, link: PanelJuror, open_rounds: set[str], now: datetime) -> bool:
    """A judge's marks in a room are locked once they locked them, the round is shut or the room's time is over."""
    closes = scoring_window(panel)[1]
    return link.locked_at is not None or panel.round not in open_rounds or (closes is not None and now > closes)


def attendance_open(panel: Panel, open_rounds: set[str], now: datetime) -> bool:
    """A room's judges can mark or change students' attendance while judging is open, during the room's slot and buffer."""
    if panel.round != "department" or panel.round not in open_rounds:
        return False
    opens, closes = scoring_window(panel)
    return (opens is None or now >= opens) and (closes is None or now <= closes)


def save_timetable(db: Session, admin: Admin, data: TimetableInput) -> TimetableOut:
    """Super admin: changes department slots; rooms still at a department's old time move with it."""
    _require_super(admin)
    state = admin_service._lock_state(db, TIMETABLE_KEY)
    before = timetable(db)
    after = dict(before.slots)
    for slot in data.slots:
        if slot.slot_start and slot.slot_end:
            after[slot.department] = (slot.slot_start, slot.slot_end)
        else:
            after.pop(slot.department, None)
    changes, moved = [], 0
    for department in rules.NOMINATING_DEPARTMENTS:
        old, new = before.slots.get(department), after.get(department)
        if old == new:
            continue
        changes.append(f"{department}: {slot_label(*old) if old else 'no slot'} to {slot_label(*new) if new else 'no slot'}")
        if data.move_rooms and old and new:
            rooms = db.scalars(
                select(Panel).where(
                    Panel.round == "department", Panel.department == department, Panel.slot_start == old[0], Panel.slot_end == old[1]
                )
            )
            for room in rooms:
                _check_free(
                    db,
                    "department",
                    PanelUpdateInput(building=room.building, name=room.name, slot_start=new[0], slot_end=new[1]),
                    exclude=room.id,
                )
                _check_judges_free(
                    db,
                    room,
                    list(db.scalars(select(PanelJuror.juror_email).where(PanelJuror.panel_id == room.id))),
                    new[0],
                    new[1],
                    moving=True,
                )
                room.slot_start, room.slot_end = new
                moved += 1
    state.value = json.dumps({"slots": {d: [s.isoformat(), e.isoformat()] for d, (s, e) in after.items()}, "by": admin.email})
    state.updated_at = utcnow()
    if changes:
        audit.record(db, admin.email, "judging.timetable_updated", detail="; ".join(changes) + (f" ({moved} rooms moved)" if moved else ""))
    db.commit()
    return timetable_out(timetable(db))


def _check_view(admin: Admin, round_: str) -> None:
    """
    Super admins see both rounds; department admins their department's rooms; outside admins, startup admins and the
    COE KIET admin (whose teams skip the department round) the finale.
    """
    _check_round(round_)
    if admin.role == "admin" and admin.department == rules.CLUB_DEPARTMENT:
        if round_ != "final":
            raise ApiError("COE KIET teams skip the department round and are judged at the Grand Finale.", 403)
    elif admin.role == "admin" and round_ != "department":
        raise ApiError("Department admins can see the department round only.", 403)
    if admin_service.is_type_admin(admin) and round_ != "final":
        raise ApiError("The department round is for KIET teams only.", 403)


def _panel_scope(admin: Admin, round_: str):
    conditions = [Panel.round == round_]
    if admin.role == "admin" and round_ == "department":
        conditions.append(Panel.department == admin.department)
    return conditions


# ---------- Eligibility ----------


def _eligible_condition(round_: str, department: str | None = None):
    """Teams that take part in a round: submitted department teams, or the Grand Finale's teams."""
    if round_ == "department":
        condition = (Team.route == "department") & (Team.status == "submitted")
        return condition & (Team.department == department) if department else condition
    # Startups and COE KIET teams qualify once an admin has accepted the entry as a legal one.
    accepted = or_(Team.approval_required.is_(False), Team.approved_at.is_not(None))
    return (Team.status == "submitted") & or_(
        (Team.route == "finale") & accepted, (Team.route == "department") & (Team.result == "finalist")
    )


def _lock_panel(db: Session, panel_id: uuid.UUID) -> Panel:
    panel = db.scalar(select(Panel).where(Panel.id == panel_id).with_for_update().execution_options(populate_existing=True))
    if panel is None:
        raise ApiError("Room or panel not found.", 404)
    return panel


def _visible_panel(db: Session, admin: Admin, panel_id: uuid.UUID) -> Panel:
    panel = db.get(Panel, panel_id)
    if panel is None:
        raise ApiError("Room or panel not found.", 404)
    _check_view(admin, panel.round)
    if admin.role == "admin" and panel.round == "department" and panel.department != admin.department:
        raise ApiError(f"This room judges {panel.department} teams, not {admin.department}.", 403)
    return panel


# ---------- Overview ----------


def _tents(db: Session, team_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not team_ids:
        return {}
    return dict(db.execute(select(FinalTent.team_id, FinalTent.tent).where(FinalTent.team_id.in_(team_ids))).tuples().all())


def _panels_out(db: Session, panels: list[Panel], viewer: Admin | None = None) -> list[PanelOut]:
    ids = [p.id for p in panels]
    if not ids:
        return []
    jurors: dict[uuid.UUID, list[PanelJurorOut]] = defaultdict(list)
    panel_of = {p.id: p for p in panels}
    open_rounds = {r for r in rules.JUDGING_ROUNDS if round_open(db, r)}
    now = utcnow()
    for link, juror in db.execute(
        select(PanelJuror, Juror)
        .join(Juror, Juror.email == PanelJuror.juror_email)
        .where(PanelJuror.panel_id.in_(ids))
        .order_by(Juror.name)
    ).tuples():
        jurors[link.panel_id].append(
            PanelJurorOut(
                email=juror.email,
                name=juror.name,
                kind=juror.kind,
                department=juror.department,
                organisation=juror.organisation,
                parent_department=_is_parent(panel_of[link.panel_id], juror),
                locked=_locked(panel_of[link.panel_id], link, open_rounds, now),
                present_at=link.present_at,
                present_by=link.present_by,
            )
        )
    links = (
        db.execute(
            select(PanelTeam.panel_id, Team)
            .join(Team, Team.id == PanelTeam.team_id)
            .where(PanelTeam.panel_id.in_(ids))
            .order_by(Team.number)
        )
        .tuples()
        .all()
    )
    if viewer is not None and viewer.role in ("startup_admin", "admin"):
        # Finale panels hold every kind of team; these admins see only their own.
        links = [(panel_id, team) for panel_id, team in links if admin_service.can_see_team(viewer, team)]
    teams = [team for _, team in links]
    summaries = {s.id: s for s in admin_service.summaries(db, teams)}
    tents = _tents(db, [t.id for t in teams])
    names = {j.email: j.name for js in jurors.values() for j in js}

    def shows_marks(panel: Panel) -> bool:
        """Super admins see every judge's marks; a department's own admin sees those of its rooms (to correct them)."""
        return viewer is not None and (viewer.role == "super_admin" or (viewer.role == "admin" and panel.department == viewer.department))

    link_of = {(link.panel_id, link.juror_email): link for link in db.scalars(select(PanelJuror).where(PanelJuror.panel_id.in_(ids)))}
    # Scores by the panel's own judges only.
    scores: dict[tuple[uuid.UUID, uuid.UUID], list[Score]] = defaultdict(list)
    for panel_id, score in db.execute(
        select(PanelTeam.panel_id, Score)
        .join(Panel, Panel.id == PanelTeam.panel_id)
        .join(Score, (Score.team_id == PanelTeam.team_id) & (Score.round == Panel.round))
        .join(PanelJuror, (PanelJuror.panel_id == PanelTeam.panel_id) & (PanelJuror.juror_email == Score.juror_email))
        .where(PanelTeam.panel_id.in_(ids))
        .order_by(Score.created_at)
    ).tuples():
        scores[(panel_id, score.team_id)].append(score)
    round_of = {p.id: p.round for p in panels}
    present: dict[tuple[str, uuid.UUID], int] = {}
    if teams:
        present = {
            (round_, team_id): count
            for round_, team_id, count in db.execute(
                select(Attendance.round, Attendance.team_id, func.count())
                .where(Attendance.team_id.in_([t.id for t in teams]), Attendance.status == "present")
                .group_by(Attendance.round, Attendance.team_id)
            ).tuples()
        }
    # Department rooms: each student's attendance. A team whose members are all absent scores 0.
    room_teams = [team.id for panel_id, team in links if round_of[panel_id] == "department"]
    states = presence.member_states(db, room_teams)
    by_panel: dict[uuid.UUID, list[PanelTeamOut]] = defaultdict(list)
    for panel_id, team in links:
        mine = scores[(panel_id, team.id)]
        members = states.get(team.id, []) if round_of[panel_id] == "department" else []
        absent_all = presence.is_all_absent(members)
        by_panel[panel_id].append(
            PanelTeamOut(
                **summaries[team.id].model_dump(),
                tent=tents.get(team.id),
                scores=len(mine),
                average=0.0 if absent_all else (round(mean(s.total for s in mine), 2) if mine else None),
                members=members,
                absent=sum(1 for m in members if m.state == "absent"),
                all_absent=absent_all,
                judge_scores=[
                    PanelScoreOut(
                        juror_email=s.juror_email,
                        juror_name=names.get(s.juror_email, s.juror_email),
                        marks=list(s.marks),
                        total=s.total,
                        remarks=s.remarks,
                        updated_at=s.updated_at,
                        # Nothing about changes shows on a room, whoever made them; the record stays in the database and the log.
                        edited_by=None,
                        edit_count=0,
                        edit_reason=None,
                        locked=_locked(panel_of[panel_id], link_of[(panel_id, s.juror_email)], open_rounds, now),
                    )
                    for s in mine
                ]
                if shows_marks(panel_of[panel_id])
                else None,
                present=present.get((round_of[panel_id], team.id), 0),
            )
        )
    return [
        PanelOut(
            id=p.id,
            round=p.round,
            building=p.building,
            name=p.name,
            location=p.location,
            slot_start=p.slot_start,
            slot_end=p.slot_end,
            department=p.department,
            jurors=sorted(jurors[p.id], key=lambda j: not j.parent_department),
            teams=by_panel[p.id],
            can_edit=viewer is not None and _can_edit(viewer, p),
            scoring_until=scoring_window(p)[1],
            buffer_minutes=p.buffer_minutes,
            can_edit_marks=viewer is not None and _may_edit_marks(viewer, p, now),
        )
        for p in panels
    ]


def open_blocker(db: Session, settings: Settings, round_: str) -> str | None:
    """Why a round cannot be opened for scoring now, or None."""
    if round_ == "department":
        if schedule.load(db, settings).registration_state() != "closed":
            return "The department round can open once registration has closed, so every team is final."
    elif db.get(AppState, admin_service.RESULTS_KEY) is None:
        return "The Grand Finale round can open once results (the finalists) are published."
    panels = list(db.scalars(select(Panel).where(Panel.round == round_)))
    if not panels:
        return "Create the rooms or panels for this round first."
    team_counts = dict(
        db.execute(select(PanelTeam.panel_id, func.count()).where(PanelTeam.round == round_).group_by(PanelTeam.panel_id)).tuples().all()
    )
    juror_counts = dict(
        db.execute(
            select(PanelJuror.panel_id, func.count())
            .join(Panel, Panel.id == PanelJuror.panel_id)
            .where(Panel.round == round_)
            .group_by(PanelJuror.panel_id)
        )
        .tuples()
        .all()
    )
    if not any(team_counts.values()):
        return "Allot teams to the rooms or panels first."
    for panel in panels:
        if team_counts.get(panel.id) and not juror_counts.get(panel.id):
            return f"{room_label(panel)} has teams but no judges. Appoint its judges first."
    if round_ == "department":
        departments = defaultdict(list)
        for panel_id, department in db.execute(
            select(PanelJuror.panel_id, Juror.department).join(Juror, Juror.email == PanelJuror.juror_email)
        ).tuples():
            departments[panel_id].append(department)
        for panel in panels:
            if team_counts.get(panel.id) and _missing_judges(panel, departments[panel.id]):
                return f"{room_label(panel)} needs {_missing_judges(panel, departments[panel.id])}."
    return None


def _missing_judges(panel: Panel, departments: list[str | None]) -> str | None:
    """A department room has two judges: one from its own department and one from another. What is missing, if anything."""
    own = sum(1 for d in departments if d == panel.department)
    other = len(departments) - own
    missing = [f"a judge from {panel.department}"] * (own == 0) + ["a judge from another department"] * (other == 0)
    return " and ".join(missing) or None


def round_out(db: Session, settings: Settings, round_: str) -> RoundOut:
    state = db.get(AppState, _round_key(round_))
    closed_state = db.get(AppState, f"judging_closed:{round_}")
    last = state or closed_state
    return RoundOut(
        round=round_,
        open=state is not None,
        changed_at=last.updated_at if last else None,
        changed_by=last.value if last else None,
        open_blocked=None if state else open_blocker(db, settings, round_),
    )


def overview(db: Session, admin: Admin, settings: Settings, round_: str) -> JudgingOut:
    _check_view(admin, round_)
    panels = list(
        db.scalars(
            select(Panel)
            .where(*_panel_scope(admin, round_))
            .order_by(Panel.department.nullsfirst(), Panel.slot_start.nullsfirst(), Panel.building, Panel.name_key)
        )
    )
    allotted = select(PanelTeam.team_id).where(PanelTeam.round == round_)
    eligible = _eligible_condition(round_, admin.department if admin.role == "admin" and round_ == "department" else None)
    unallotted = list(
        db.scalars(select(Team).where(eligible, admin_service.team_scope(admin), Team.id.not_in(allotted)).order_by(Team.number))
    )
    tents = None
    if round_ == "final":
        finalists = list(db.scalars(select(Team).where(eligible, admin_service.team_scope(admin)).order_by(Team.category, Team.number)))
        assigned = _tents(db, [t.id for t in finalists])
        tents = [TentRowOut(team=s, tent=assigned.get(s.id)) for s in admin_service.summaries(db, finalists)]
    return JudgingOut(
        round=round_out(db, settings, round_),
        can_manage=admin.role == "super_admin",
        can_create=admin.role == "super_admin" or (round_ == "department" and _manages_rooms(admin)),
        panels=_panels_out(db, panels, admin),
        unallotted=admin_service.summaries(db, unallotted),
        tents=tents,
        timetable=timetable_out(timetable(db)) if round_ == "department" else None,
        server_time=utcnow(),
    )


# ---------- Opening and locking a round ----------


def _set_round(db: Session, admin: Admin, settings: Settings, round_: str, open_: bool) -> RoundOut:
    _require_super(admin)
    _check_round(round_)
    # Serialise with publishing, which the final round depends on.
    admin_service._lock_state(db, f"{admin_service.RESULTS_KEY}_lock")
    key = _round_key(round_)
    state = db.get(AppState, key)
    if open_:
        if state is not None:
            raise ApiError("Judging is already open for this round.", 409)
        if blocked := open_blocker(db, settings, round_):
            raise ApiError(blocked, 409)
        db.add(AppState(key=key, value=admin.email, updated_at=utcnow()))
        db.execute(delete(AppState).where(AppState.key == f"judging_closed:{round_}"))
        audit.record(db, admin.email, "judging.opened", detail=f"Scoring opened for the {ROUND_LABELS[round_]}")
    else:
        if state is None:
            raise ApiError("Judging is already locked for this round.", 409)
        db.delete(state)
        db.merge(AppState(key=f"judging_closed:{round_}", value=admin.email, updated_at=utcnow()))
        audit.record(db, admin.email, "judging.locked", detail=f"Scoring locked for the {ROUND_LABELS[round_]}")
    db.commit()
    return round_out(db, settings, round_)


def open_round(db: Session, admin: Admin, settings: Settings, round_: str) -> RoundOut:
    return _set_round(db, admin, settings, round_, True)


def lock_round(db: Session, admin: Admin, settings: Settings, round_: str) -> RoundOut:
    return _set_round(db, admin, settings, round_, False)


# ---------- Judges ----------


def _juror_out(db: Session, jurors: list[Juror]) -> list[JurorOut]:
    emails = [j.email for j in jurors]
    panels: dict[str, list[JurorPanelRef]] = defaultdict(list)
    scores: dict[str, int] = {}
    if emails:
        by_email = {j.email: j for j in jurors}
        for link, panel in db.execute(
            select(PanelJuror, Panel)
            .join(Panel, Panel.id == PanelJuror.panel_id)
            .where(PanelJuror.juror_email.in_(emails))
            .order_by(Panel.round, Panel.name_key)
        ).tuples():
            panels[link.juror_email].append(
                JurorPanelRef(
                    id=panel.id,
                    round=panel.round,
                    building=panel.building,
                    name=panel.name,
                    department=panel.department,
                    slot_start=panel.slot_start,
                    slot_end=panel.slot_end,
                    parent_department=_is_parent(panel, by_email[link.juror_email]),
                )
            )
        scores = dict(
            db.execute(select(Score.juror_email, func.count()).where(Score.juror_email.in_(emails)).group_by(Score.juror_email))
            .tuples()
            .all()
        )
    return [
        JurorOut(
            email=j.email,
            name=j.name,
            kind=j.kind,
            department=j.department,
            organisation=j.organisation,
            phone=j.phone,
            panels=panels[j.email],
            scores=scores.get(j.email, 0),
            added_at=j.created_at,
            added_by=j.created_by,
        )
        for j in jurors
    ]


def _require_room_manager(admin: Admin) -> None:
    if not _manages_rooms(admin):
        raise ApiError("Only super admins and department admins manage judges.", 403)


def list_jurors(db: Session, admin: Admin) -> list[JurorOut]:
    _require_room_manager(admin)
    return _juror_out(db, list(db.scalars(select(Juror).order_by(Juror.kind, Juror.name))))


def add_juror(db: Session, admin: Admin, data: JurorInput) -> JurorOut:
    _require_room_manager(admin)
    # Department admins appoint KIET faculty only; outside experts (given a KIET account) are appointed by super admins.
    if admin.role == "admin" and data.kind != "faculty":
        raise ApiError("Department admins add KIET faculty as judges. Ask a super admin to appoint an outside expert.", 403)
    if db.get(Juror, data.email) is not None:
        raise ApiError("This email is already a judge.", 409)
    juror = Juror(
        email=data.email,
        name=data.name,
        kind=data.kind,
        department=data.department,
        organisation=data.organisation,
        phone=data.phone,
        created_by=admin.email,
    )
    db.add(juror)
    where = data.department if data.kind == "faculty" else data.organisation
    audit.record(db, admin.email, "judging.judge_added", detail=f"{data.email} ({data.name}, {where})")
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError("This email is already a judge.", 409) from exc
    return _juror_out(db, [juror])[0]


def remove_juror(db: Session, admin: Admin, email: str) -> None:
    _require_room_manager(admin)
    juror = db.scalar(select(Juror).where(Juror.email == email.strip().lower()).with_for_update())
    if juror is None:
        raise ApiError("No judge with this email exists.", 404)
    if admin.role != "super_admin" and juror.created_by != admin.email:
        raise ApiError("You can remove only the judges you added. Ask a super admin for the others.", 403)
    if db.scalar(select(func.count()).select_from(Score).where(Score.juror_email == juror.email)):
        raise ApiError("This judge has already scored teams, so they cannot be removed.", 409)
    if db.scalar(select(func.count()).select_from(PanelJuror).where(PanelJuror.juror_email == juror.email)):
        raise ApiError("Remove this judge from their rooms and panels first.", 409)
    db.delete(juror)
    audit.record(db, admin.email, "judging.judge_removed", detail=juror.email)
    db.commit()


# ---------- Rooms and panels ----------


def _check_free(db: Session, round_: str, place: PanelPlace, exclude: uuid.UUID | None = None) -> None:
    """The same room (building and name) cannot hold two panels of a round at overlapping times."""
    # Serialises room bookings, so two admins saving the same room at once cannot both succeed.
    admin_service._lock_state(db, "panels_lock")
    same_room = select(Panel).where(
        Panel.round == round_, func.lower(Panel.building) == place.building.lower(), Panel.name_key == place.name.lower()
    )
    for other in db.scalars(same_room):
        if other.id == exclude:
            continue
        # A room without a slot is booked for the whole round.
        if (
            place.slot_start is None
            or other.slot_start is None
            or (place.slot_start < other.slot_end and other.slot_start < place.slot_end)
        ):  # type: ignore[operator]
            when = slot_label(other.slot_start, other.slot_end) or "for this round"
            whose = f" ({other.department} teams)" if other.department else ""
            raise ApiError(f"{room_label(other)} is already booked {when}{whose}. Choose another room or time.", 409)


def _describe_room(panel: Panel) -> str:
    buffer = f"{panel.buffer_minutes} min buffer" if panel.round == "department" else ""
    parts = [room_label(panel), slot_label(panel.slot_start, panel.slot_end), buffer, panel.location]
    return ", ".join(p for p in parts if p)


def create_panel(db: Session, admin: Admin, data: PanelInput) -> PanelOut:
    _require_creator(admin, data.round, data.department)
    if data.round == "department" and data.slot_start is None:
        # A room without a time takes its department's slot from the timetable.
        slot = timetable(db).slots.get(data.department or "")
        if slot is None:
            raise ApiError(f"{data.department} has no slot in the timetable yet. Give the room's date and time.", 422)
        data = data.model_copy(update={"slot_start": slot[0], "slot_end": slot[1]})
    _check_free(db, data.round, data)
    panel = Panel(
        round=data.round,
        building=data.building,
        name=data.name,
        name_key=data.name.lower(),
        location=data.location,
        slot_start=data.slot_start,
        slot_end=data.slot_end,
        buffer_minutes=data.buffer_minutes,
        department=data.department,
        created_by=admin.email,
    )
    db.add(panel)
    kind = f"Room for {data.department}" if data.round == "department" else "Finale panel"
    audit.record(db, admin.email, "judging.panel_created", detail=f"{kind}: {_describe_room(panel)}", department=data.department)
    db.commit()
    return _panels_out(db, [panel], admin)[0]


def update_panel(db: Session, admin: Admin, panel_id: uuid.UUID, data: PanelUpdateInput) -> PanelOut:
    panel = _lock_panel(db, panel_id)
    _require_editor(admin, panel)
    if panel.round == "department" and (not data.building or data.slot_start is None):
        raise ApiError("A department room needs its building and time slot.", 422)
    _check_free(db, panel.round, data, exclude=panel.id)
    if (data.slot_start, data.slot_end) != (panel.slot_start, panel.slot_end):
        # Moving the room must not put its judges in two rooms at once.
        _check_judges_free(
            db,
            panel,
            list(db.scalars(select(PanelJuror.juror_email).where(PanelJuror.panel_id == panel.id))),
            data.slot_start,
            data.slot_end,
            moving=True,
        )
    before = _describe_room(panel)
    panel.building, panel.name, panel.name_key, panel.location = data.building, data.name, data.name.lower(), data.location
    panel.slot_start, panel.slot_end = data.slot_start, data.slot_end
    panel.buffer_minutes = data.buffer_minutes
    audit.record(db, admin.email, "judging.panel_updated", detail=f"{_describe_room(panel)} (was: {before})", department=panel.department)
    db.commit()
    return _panels_out(db, [panel], admin)[0]


def set_buffer(db: Session, admin: Admin, panel_id: uuid.UUID, data: BufferInput) -> PanelOut:
    """The extra minutes after a department room's slot in which its judges can still submit marks."""
    panel = _lock_panel(db, panel_id)
    _require_editor(admin, panel)
    if panel.round != "department":
        raise ApiError("Only department rooms have a buffer.", 422)
    if panel.buffer_minutes != data.buffer_minutes:
        audit.record(
            db,
            admin.email,
            "judging.buffer_changed",
            detail=f"{room_label(panel)}: {panel.buffer_minutes} to {data.buffer_minutes} minutes",
            department=panel.department,
        )
        panel.buffer_minutes = data.buffer_minutes
        db.commit()
    return _panels_out(db, [panel], admin)[0]


def _scored(db: Session, panel: Panel, *, team_ids: list[uuid.UUID] | None = None, juror_emails: list[str] | None = None) -> bool:
    """Whether this panel's judges have scored any of these teams (or these judges any of its teams) in its round."""
    panel_teams = select(PanelTeam.team_id).where(PanelTeam.panel_id == panel.id)
    panel_jurors = select(PanelJuror.juror_email).where(PanelJuror.panel_id == panel.id)
    statement = (
        select(func.count())
        .select_from(Score)
        .where(
            Score.round == panel.round,
            Score.team_id.in_(team_ids if team_ids is not None else panel_teams),
            Score.juror_email.in_(juror_emails if juror_emails is not None else panel_jurors),
        )
    )
    return bool(db.scalar(statement))


def delete_panel(db: Session, admin: Admin, panel_id: uuid.UUID) -> None:
    panel = _lock_panel(db, panel_id)
    _require_editor(admin, panel)
    if _scored(db, panel):
        raise ApiError("Teams in this room have already been scored, so it cannot be deleted.", 409)
    db.delete(panel)
    audit.record(db, admin.email, "judging.panel_deleted", detail=_describe_room(panel), department=panel.department)
    db.commit()


def set_panel_teams(db: Session, admin: Admin, panel_id: uuid.UUID, data: PanelTeamsInput) -> PanelOut:
    """Replaces the teams allotted to a room or panel."""
    panel = _lock_panel(db, panel_id)
    _require_editor(admin, panel)
    wanted = list(dict.fromkeys(data.team_ids))
    current = set(db.scalars(select(PanelTeam.team_id).where(PanelTeam.panel_id == panel.id)))
    removed = [t for t in current if t not in wanted]
    if removed and _scored(db, panel, team_ids=removed):
        raise ApiError("A team you removed has already been scored in this room, so it must stay here.", 409)

    added = [t for t in wanted if t not in current]
    if added:
        teams = {t.id: t for t in db.scalars(select(Team).where(Team.id.in_(added), _eligible_condition(panel.round, panel.department)))}
        for team_id in added:
            if team_id not in teams:
                raise ApiError(
                    f"Only submitted {panel.department} teams can be allotted to this room."
                    if panel.round == "department"
                    else "Only finalists and submitted teams from other colleges and schools take part in the Grand Finale.",
                    422,
                )
        elsewhere = db.execute(
            select(Team.number, Panel)
            .join(PanelTeam, PanelTeam.team_id == Team.id)
            .join(Panel, Panel.id == PanelTeam.panel_id)
            .where(PanelTeam.round == panel.round, PanelTeam.team_id.in_(added), PanelTeam.panel_id != panel.id)
        ).first()
        if elsewhere:
            raise ApiError(f"IT26-{elsewhere[0]:04d} is already allotted to {room_label(elsewhere[1])}. Remove it there first.", 409)

    db.execute(delete(PanelTeam).where(PanelTeam.panel_id == panel.id, PanelTeam.team_id.in_(removed)))
    for team_id in added:
        db.add(PanelTeam(panel_id=panel.id, team_id=team_id, round=panel.round))
    audit.record(
        db,
        admin.email,
        "judging.teams_allotted",
        detail=f"{room_label(panel)}: {len(wanted)} teams ({len(added)} added, {len(removed)} removed)",
        department=panel.department,
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if "uq_panel_teams_round_team" in violated_constraint(exc):
            raise ApiError("One of these teams was just allotted to another room. Reload and try again.", 409) from exc
        raise
    return _panels_out(db, [panel], admin)[0]


def set_panel_jurors(db: Session, admin: Admin, panel_id: uuid.UUID, data: PanelJurorsInput) -> PanelOut:
    """Replaces a room's or panel's judges. Judges who stay keep their lock and attendance."""
    panel = _lock_panel(db, panel_id)
    _require_editor(admin, panel)
    emails = [j.email for j in data.jurors]
    if len(set(emails)) != len(emails):
        raise ApiError("A judge is listed more than once.", 422)
    # Locks these judges (in a fixed order), so two rooms saved at once cannot both take the same judge.
    jurors = {j.email: j for j in db.scalars(select(Juror).where(Juror.email.in_(emails)).order_by(Juror.email).with_for_update())}
    for email in emails:
        if email not in jurors:
            raise ApiError(f"{email} is not an appointed judge. Add them under Judges first.", 422)
    if panel.round == "department":
        # Two judges per room: the parent department judge (from the room's own department) and one from another department.
        own = [jurors[e] for e in emails if jurors[e].department == panel.department]
        if len(emails) > 2:
            raise ApiError(
                f"A room has two judges: the parent department judge from {panel.department} and one from another department.", 422
            )
        if len(own) > 1:
            raise ApiError(f"Only one of the two judges can be from {panel.department}; the other comes from another department.", 422)
        if len(emails) - len(own) > 1:
            raise ApiError(f"Only one judge can come from another department; the other is from {panel.department}.", 422)
    # A judge can be in several rooms, but one at a time: the rooms' time slots must not overlap.
    _check_judges_free(db, panel, emails, panel.slot_start, panel.slot_end)
    current = set(db.scalars(select(PanelJuror.juror_email).where(PanelJuror.panel_id == panel.id).with_for_update()))
    removed = [e for e in current if e not in emails]
    if removed and _scored(db, panel, juror_emails=removed):
        raise ApiError("A judge you removed has already scored teams in this room, so they must stay.", 409)

    # Only the changes: a judge who stays keeps their lock and attendance (saving the same list is harmless).
    if removed:
        db.execute(delete(PanelJuror).where(PanelJuror.panel_id == panel.id, PanelJuror.juror_email.in_(removed)))
        db.flush()
    for email in emails:
        if email not in current:
            db.add(PanelJuror(panel_id=panel.id, juror_email=email))
    audit.record(
        db,
        admin.email,
        "judging.judges_assigned",
        detail=f"{room_label(panel)}: {', '.join(emails) or 'no judges'}",
        department=panel.department,
    )
    db.commit()
    return _panels_out(db, [panel], admin)[0]


def set_juror_present(db: Session, admin: Admin, panel_id: uuid.UUID, juror_email: str, data: PresentInput) -> PanelOut:
    """
    Marks a judge present in their room, or takes the mark back. A super admin for any room; a department's admin for
    their own department's rooms. Any time, and the same request twice changes nothing.
    """
    panel = _lock_panel(db, panel_id)
    _require_editor(admin, panel)
    link = db.scalar(
        select(PanelJuror)
        .where(PanelJuror.panel_id == panel.id, PanelJuror.juror_email == juror_email.strip().lower())
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if link is None:
        raise ApiError("This judge is not in this room.", 404)
    if data.present and link.present_at is None:
        link.present_at, link.present_by = utcnow(), admin.email
        audit.record(
            db, admin.email, "judging.judge_present", detail=f"{link.juror_email} in {room_label(panel)}", department=panel.department
        )
        db.commit()
    elif not data.present and link.present_at is not None:
        link.present_at = link.present_by = None
        audit.record(
            db, admin.email, "judging.judge_unmarked", detail=f"{link.juror_email} in {room_label(panel)}", department=panel.department
        )
        db.commit()
    return _panels_out(db, [panel], admin)[0]


# ---------- Tents ----------


def _tent_label(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    label = "".join(value.split()).upper()
    if not all(c.isalnum() or c in "-/" for c in label):
        raise ApiError(f'"{value}" is not a stall number. Use letters, digits and dashes, e.g. S-12.', 422)
    return label


def set_tents(db: Session, admin: Admin, settings: Settings, data: TentsInput) -> JudgingOut:
    """Allots (or clears) Grand Finale tents for the listed teams; other teams keep theirs."""
    _require_super(admin)
    admin_service._lock_state(db, "tents_lock")
    wanted = {a.team_id: _tent_label(a.tent) for a in data.tents}
    labels = [t for t in wanted.values() if t]
    if len(set(labels)) != len(labels):
        duplicate = next(t for t in labels if labels.count(t) > 1)
        raise ApiError(f"Stall {duplicate} is given to more than one team.", 422)
    eligible = set(db.scalars(select(Team.id).where(Team.id.in_(list(wanted)), _eligible_condition("final"))))
    for team_id, tent in wanted.items():
        if tent and team_id not in eligible:
            raise ApiError("Stalls are only for finalists and submitted teams from other colleges and schools.", 422)
    clash = db.execute(
        select(FinalTent.tent, Team.number)
        .join(Team, Team.id == FinalTent.team_id)
        .where(FinalTent.tent.in_(labels), FinalTent.team_id.not_in(list(wanted)))
    ).first()
    if clash:
        raise ApiError(f"Stall {clash[0]} is already allotted to IT26-{clash[1]:04d}.", 409)

    db.execute(delete(FinalTent).where(FinalTent.team_id.in_(list(wanted))))
    db.flush()
    for team_id, tent in wanted.items():
        if tent:
            db.add(FinalTent(team_id=team_id, tent=tent, assigned_by=admin.email))
    audit.record(db, admin.email, "judging.tents_allotted", detail=f"{len(labels)} stalls allotted, {len(wanted) - len(labels)} cleared")
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError("Another organiser changed the stalls at the same time. Reload and try again.", 409) from exc
    return overview(db, admin, settings, "final")


# ---------- Attendance sheets ----------


def attendance(db: Session, admin: Admin, round_: str, panel_id: uuid.UUID | None, department: str | None = None) -> AttendanceSheet:
    """
    Every member of a room's (or panel's) teams with their attendance, for the screen and the printed sheet; or a
    whole department's teams (department round), or every finale team in stall order.
    """
    _check_view(admin, round_)
    if panel_id:
        panel = _visible_panel(db, admin, panel_id)
        if panel.round != round_:
            raise ApiError("This room belongs to the other round.", 422)
        statement = select(Team).join(PanelTeam, PanelTeam.team_id == Team.id).where(PanelTeam.panel_id == panel.id)
        if admin.role in ("startup_admin", "admin"):
            statement = statement.where(admin_service.team_scope(admin))
        return _sheet(db, round_, list(db.scalars(statement.order_by(Team.number))), panel=panel)
    if round_ == "department":
        department = admin.department if admin.role == "admin" else department
        if not department:
            raise ApiError("Choose a room or a department.", 422)
        if department not in rules.NOMINATING_DEPARTMENTS:
            raise ApiError(f'Unknown department "{department}".', 422)
        teams = list(db.scalars(select(Team).where(_eligible_condition("department", department)).order_by(Team.number)))
        return _sheet(db, round_, teams, title=f"{department} teams · department round")
    teams = list(db.scalars(select(Team).where(_eligible_condition("final"), admin_service.team_scope(admin)).order_by(Team.number)))
    return _sheet(db, round_, teams, title="Grand Finale · all teams")


def judge_attendance(db: Session, juror: Juror, panel_id: uuid.UUID) -> AttendanceSheet:
    """A judge's own room: its teams and who is present (judges may mark attendance there). No phone numbers."""
    panel = db.get(Panel, panel_id)
    if panel is None or db.get(PanelJuror, (panel_id, juror.email)) is None:
        raise ApiError("You are not a judge in this room.", 403)
    teams = list(
        db.scalars(select(Team).join(PanelTeam, PanelTeam.team_id == Team.id).where(PanelTeam.panel_id == panel.id).order_by(Team.number))
    )
    sheet = _sheet(db, panel.round, teams, panel=panel)
    for team in sheet.teams:
        for member in team.members:
            member.phone = ""
    return sheet


def _sheet(db: Session, round_: str, teams: list[Team], *, panel: Panel | None = None, title: str = "") -> AttendanceSheet:
    team_ids = [t.id for t in teams]
    jurors: list[str] = []
    if panel is not None:
        members = db.scalars(
            select(Juror)
            .join(PanelJuror, PanelJuror.juror_email == Juror.email)
            .where(PanelJuror.panel_id == panel.id)
            .order_by(Juror.name)
        ).all()
        # The parent department judge first.
        members = sorted(members, key=lambda j: not _is_parent(panel, j))
        jurors = [f"{j.name}{' (parent department)' if _is_parent(panel, j) else ''}" for j in members]
        title = f"{room_label(panel)}{' · ' + panel.department + ' teams' if panel.department else ''}"
    tents = _tents(db, team_ids)
    rooms: dict[uuid.UUID, Panel] = {}
    if team_ids:
        rooms = dict(
            db.execute(
                select(PanelTeam.team_id, Panel)
                .join(Panel, Panel.id == PanelTeam.panel_id)
                .where(PanelTeam.round == round_, PanelTeam.team_id.in_(team_ids))
            )
            .tuples()
            .all()
        )
    if round_ == "final":
        # Stall order, as organisers walk the stalls; teams without a stall last.
        teams.sort(key=lambda t: (tents.get(t.id) is None, _natural(tents.get(t.id) or ""), t.number))
    elif panel is None:
        # A department's sheet, grouped by room and time slot; teams without a room last.
        def order(t: Team) -> tuple:
            room = rooms.get(t.id)
            start = room.slot_start.timestamp() if room and room.slot_start else 0
            return (room is None, start, _natural(room_label(room)) if room else (), t.number)

        teams.sort(key=order)
    present: dict[uuid.UUID, Attendance] = {}
    members: dict[uuid.UUID, list[AttendanceMember]] = defaultdict(list)
    if teams:
        marks = {a.user_id: a for a in db.scalars(select(Attendance).where(Attendance.round == round_, Attendance.team_id.in_(team_ids)))}
        present = {user_id: a for user_id, a in marks.items() if a.status == "present"}
        for member, profile in db.execute(
            select(TeamMember, Profile)
            .join(Profile, Profile.user_id == TeamMember.user_id)
            .where(TeamMember.team_id.in_(team_ids))
            .order_by(TeamMember.role != "leader", Profile.full_name)
        ).tuples():
            mark = present.get(member.user_id)
            members[member.team_id].append(
                AttendanceMember(
                    user_id=member.user_id,
                    full_name=profile.full_name,
                    role=member.role,
                    year=profile.year,
                    course=profile.course,
                    department=profile.department,
                    institution=profile.institution,
                    roll_number=profile.roll_number,
                    phone=profile.phone,
                    present_at=mark.marked_at if mark else None,
                    marked_by=mark.marked_by if mark else (marks[member.user_id].marked_by if member.user_id in marks else None),
                    method=mark.method if mark else None,
                    state="present" if mark else ("absent" if member.user_id in marks else "not_marked"),
                )
            )
    return AttendanceSheet(
        round=round_,
        title=title,
        building=panel.building if panel else "",
        room=panel.name if panel else "",
        location=panel.location if panel else "",
        slot_start=panel.slot_start if panel else None,
        slot_end=panel.slot_end if panel else None,
        jurors=jurors,
        teams=[
            AttendanceTeam(
                code=t.code,
                name=t.name,
                category=t.category,
                project_title=t.project_title,
                status=t.status,
                tent=tents.get(t.id),
                institution=t.institution,
                department=t.department,
                members=members[t.id],
                room=room_label(rooms[t.id]) if t.id in rooms else None,
            )
            for t in teams
        ],
    )


def _natural(label: str) -> tuple:
    """ "T-2" before "T-10"."""
    return tuple(int(part) if part.isdigit() else part for part in re.split(r"(\d+)", label))


# ---------- Rankings ----------


def _group_key(round_: str, team: Team) -> str:
    """The rankings group a team competes in: department and category (department round), or category / school (finale)."""
    if round_ == "department":
        return f"{team.department}-{team.category}"
    return "school-0" if team.participant_type == "school" else f"category-{team.category}"


def _awards_key(round_: str) -> str:
    return f"awards_published:{round_}"


def _can_award(admin: Admin, round_: str) -> bool:
    return admin.role == "super_admin" or (round_ == "department" and _manages_rooms(admin))


def rankings(db: Session, admin: Admin, round_: str, department: str | None) -> RankingsOut:
    """
    The average of both judges' totals, ranked with the tie-breakers (innovation, then Query Addressing, then the
    department admin or a super admin). A team gets a place only once every judge of its room has scored it.
    """
    _check_round(round_)
    if admin_service.is_type_admin(admin):
        raise ApiError("Rankings are for super admins and department admins.", 403)
    _check_view(admin, round_)
    if admin.role == "admin":
        department = admin.department
    elif department is not None and department not in rules.DEPARTMENTS:
        raise ApiError(f'Unknown department "{department}".', 422)

    statement = (
        select(Team, Panel)
        .join(PanelTeam, PanelTeam.team_id == Team.id)
        .join(Panel, Panel.id == PanelTeam.panel_id)
        .where(PanelTeam.round == round_)
    )
    if department:
        statement = statement.where(Panel.department == department if round_ == "department" else Team.department == department)
    rows = db.execute(statement.order_by(Team.number)).tuples().all()
    teams = [team for team, _ in rows]
    panel_of = {team.id: panel for team, panel in rows}
    summaries = {s.id: s for s in admin_service.summaries(db, teams)}
    judges = (
        dict(
            db.execute(
                select(PanelJuror.panel_id, func.count())
                .where(PanelJuror.panel_id.in_({p.id for p in panel_of.values()}))
                .group_by(PanelJuror.panel_id)
            )
            .tuples()
            .all()
        )
        if panel_of
        else {}
    )
    marks: dict[uuid.UUID, list[list[int]]] = defaultdict(list)
    awards: dict[uuid.UUID, Award] = {}
    if teams:
        for team_id, team_marks in db.execute(
            select(Score.team_id, Score.marks)
            .join(PanelTeam, (PanelTeam.team_id == Score.team_id) & (PanelTeam.round == Score.round))
            .join(PanelJuror, (PanelJuror.panel_id == PanelTeam.panel_id) & (PanelJuror.juror_email == Score.juror_email))
            .where(Score.round == round_, Score.team_id.in_([t.id for t in teams]))
        ).tuples():
            marks[team_id].append(team_marks)
        awards = {a.team_id: a for a in db.scalars(select(Award).where(Award.round == round_, Award.team_id.in_([t.id for t in teams])))}

    groups: dict[str, list[Team]] = defaultdict(list)
    for team in teams:
        groups[_group_key(round_, team)].append(team)
    # Teams whose members are all absent (department round) score 0 whatever the judges gave, and get no place.
    absent = presence.absent_teams(db, [t.id for t in teams]) if round_ == "department" else set()

    def ranked(group: list[Team]) -> list[RankedTeam]:
        entries = []
        for team in group:
            scores = marks[team.id]
            needed = judges.get(panel_of[team.id].id, 0)
            if team.id in absent:
                entries.append((team, True, 0.0, 0.0, 0.0))
                continue
            entries.append(
                (
                    team,
                    needed > 0 and len(scores) >= needed,
                    round(mean(sum(m) for m in scores), 2) if scores else None,
                    round(mean(rules.innovation_marks(team.category, m) for m in scores), 2) if scores else None,
                    round(mean(rules.query_marks(m) for m in scores), 2) if scores else None,
                )
            )
        # Complete teams first, in order; teams still waiting for a judge after them, without a place; absent teams last.
        entries.sort(key=lambda e: (e[0].id in absent, not e[1], e[2] is None, -(e[2] or 0), -(e[3] or 0), -(e[4] or 0), e[0].number))
        out: list[RankedTeam] = []
        previous = None
        place = 0
        for team, complete, average, innovation, query in entries:
            key = (average, innovation, query)
            panel = panel_of[team.id]
            is_absent = team.id in absent
            if complete and not is_absent:
                place += 1
            award = awards.get(team.id)
            out.append(
                RankedTeam(
                    position=place if complete and not is_absent else None,
                    team=summaries[team.id],
                    panel=room_label(panel),
                    scores=len(marks[team.id]),
                    judges=judges.get(panel.id, 0),
                    average=average,
                    innovation=innovation,
                    query=query,
                    tied=complete and not is_absent and key == previous,
                    complete=complete,
                    all_absent=is_absent,
                    award=AwardOut(place=award.place, amount=award.amount, declared_by=award.declared_by, declared_at=award.declared_at)
                    if award
                    else None,
                )
            )
            previous = key if complete and not is_absent else previous
        return out

    def order(key: str) -> tuple:
        first, second = key.rsplit("-", 1)
        return (first == "school", first, int(second))

    result = []
    for key in sorted(groups, key=order):
        first, second = key.rsplit("-", 1)
        number = int(second)
        school = first == "school"
        if round_ == "department":
            label, dep, category = f"{first} · Category {number}: {rules.CATEGORIES[number].title}", first, number
        elif school:
            label, dep, category = "Best School Project", None, None
        else:
            label, dep, category = f"Category {number}: {rules.CATEGORIES[number].title}", None, number
        prizes = [PrizeOut(place=p, amount=a) for p in (1, 2) if (a := rules.prize(round_, school, number, p))]
        result.append(RankingGroup(key=key, label=label, department=dep, category=category, teams=ranked(groups[key]), prizes=prizes))
    return RankingsOut(
        round=round_,
        groups=result,
        awards_published=db.get(AppState, _awards_key(round_)) is not None,
        can_award=_can_award(admin, round_),
        can_publish_awards=admin.role == "super_admin",
    )


def leaderboard(db: Session, admin: Admin, settings: Settings, department: str | None) -> LeaderboardOut:
    """
    The department round's leaderboard, department by department and problem statement by problem statement, from the same
    rankings (average of both judges, then innovation, then query addressing). The first teams up to the department's
    finalist quota for that problem statement are in line for the Grand Finale; departments still nominate their finalists.
    """
    if admin.role == "admin" and admin.department == rules.CLUB_DEPARTMENT:
        raise ApiError("COE KIET teams go straight to the Grand Finale, so they have no department leaderboard.", 403)
    ranked = rankings(db, admin, "department", department)
    quota = admin_service.quotas(db)
    nominated = set(db.scalars(select(FinalistNomination.team_id)))
    by_department: dict[str, list[LeaderboardCategory]] = defaultdict(list)
    for group in ranked.groups:
        if group.department is None or group.category is None:
            continue
        places = quota.get((group.department, group.category), rules.finalist_quota(group.department, group.category))
        teams = [
            LeaderboardTeam(
                position=t.position,
                team=t.team,
                room=t.panel,
                average=t.average,
                innovation=t.innovation,
                query=t.query,
                scores=t.scores,
                judges=t.judges,
                tied=t.tied,
                complete=t.complete,
                all_absent=t.all_absent,
                in_line=t.position is not None and t.position <= places,
                nominated=t.team.id in nominated,
                award=t.award,
            )
            for t in group.teams
        ]
        placed = [t for t in teams if t.position is not None]
        after_cut = next((t for t in placed if t.position == places + 1), None)
        by_department[group.department].append(
            LeaderboardCategory(
                category=group.category,
                title=rules.CATEGORIES[group.category].title,
                quota=places,
                prize=rules.prize("department", False, group.category, 1),
                teams=teams,
                scored=len(placed),
                tie_at_cut=after_cut is not None and after_cut.tied,
            )
        )
    departments = [
        LeaderboardDepartment(
            department=name,
            categories=sorted(categories, key=lambda c: c.category),
            teams=sum(len(c.teams) for c in categories),
            scored=sum(c.scored for c in categories),
            finalist_places=sum(c.quota for c in categories),
            nominated=sum(1 for c in categories for t in c.teams if t.nominated),
        )
        for name, categories in sorted(by_department.items())
    ]
    window = schedule.load(db, settings)
    return LeaderboardOut(
        departments=departments,
        results_published=admin_service._results_published(db) is not None,
        nominations_deadline=window.nominations_deadline,
        generated_at=utcnow(),
    )


def declare_award(db: Session, admin: Admin, round_: str, data: AwardInput) -> None:
    """Gives a team a prize place from the rankings. The team must have been scored by all its judges."""
    _check_round(round_)
    if not _can_award(admin, round_):
        raise ApiError(
            "Only a super admin declares Grand Finale winners." if round_ == "final" else "Only organisers declare winners.", 403
        )
    admin_service._lock_state(db, f"awards_lock:{round_}")
    if db.get(AppState, _awards_key(round_)) is not None:
        raise ApiError("The winners are already published to students. A super admin must withdraw them before changing winners.", 409)
    team = db.get(Team, data.team_id)
    link = db.scalar(select(PanelTeam).where(PanelTeam.team_id == data.team_id, PanelTeam.round == round_))
    if team is None or link is None:
        raise ApiError("This team was not judged in this round.", 404)
    if admin.role == "admin" and not (team.participant_type == "kiet" and team.department == admin.department):
        raise ApiError(f"You can declare winners for {admin.department} only.", 403)
    if team.status != "submitted":
        raise ApiError(f"This team has been {team.status}, so it cannot win.", 409)
    if round_ == "department" and presence.absent_teams(db, [team.id]):
        raise ApiError("Every member of this team is absent, so it scores 0 and cannot win.", 409)
    needed = db.scalar(select(func.count()).select_from(PanelJuror).where(PanelJuror.panel_id == link.panel_id)) or 0
    scored = db.scalar(
        select(func.count())
        .select_from(Score)
        .join(PanelJuror, (PanelJuror.panel_id == link.panel_id) & (PanelJuror.juror_email == Score.juror_email))
        .where(Score.round == round_, Score.team_id == team.id)
    )
    if needed == 0 or (scored or 0) < needed:
        raise ApiError("Both judges must score this team before it can be declared a winner.", 409)
    school = team.participant_type == "school"
    amount = rules.prize(round_, school, team.category, data.place)
    if amount is None:
        raise ApiError(
            "The department round has one prize per category: 1st place."
            if round_ == "department"
            else "There is no prize for this place.",
            422,
        )
    key = _group_key(round_, team)
    holder = db.scalar(
        select(Award).where(Award.round == round_, Award.group_key == key, Award.place == data.place, Award.team_id != team.id)
    )
    if holder is not None:
        other = db.get(Team, holder.team_id)
        raise ApiError(f"{other.name if other else 'Another team'} already holds this place. Remove it there first.", 409)
    db.execute(delete(Award).where(Award.round == round_, Award.team_id == team.id))
    db.add(Award(round=round_, team_id=team.id, group_key=key, place=data.place, amount=amount, declared_by=admin.email))
    place = "1st" if data.place == 1 else "2nd"
    audit.record(db, admin.email, "judging.award_declared", team, f"{place} place, Rs {amount}, {ROUND_LABELS[round_]}")
    db.commit()


def remove_award(db: Session, admin: Admin, round_: str, team_id: uuid.UUID) -> None:
    _check_round(round_)
    if not _can_award(admin, round_):
        raise ApiError("Only organisers change winners.", 403)
    admin_service._lock_state(db, f"awards_lock:{round_}")
    if db.get(AppState, _awards_key(round_)) is not None:
        raise ApiError("The winners are already published to students. A super admin must withdraw them before changing winners.", 409)
    award = db.scalar(select(Award).where(Award.round == round_, Award.team_id == team_id))
    team = db.get(Team, team_id)
    if award is None or team is None:
        raise ApiError("This team has no prize in this round.", 404)
    if admin.role == "admin" and team.department != admin.department:
        raise ApiError(f"You can change winners for {admin.department} only.", 403)
    db.delete(award)
    audit.record(db, admin.email, "judging.award_removed", team, f"{'1st' if award.place == 1 else '2nd'} place, {ROUND_LABELS[round_]}")
    db.commit()


def publish_awards(db: Session, admin: Admin, round_: str, publish: bool) -> None:
    """Super admin: shows (or hides) the round's winners and prize money to students."""
    _require_super(admin)
    _check_round(round_)
    admin_service._lock_state(db, f"awards_lock:{round_}")
    state = db.get(AppState, _awards_key(round_))
    if publish:
        if state is not None:
            raise ApiError("The winners are already published.", 409)
        if not db.scalar(select(func.count()).select_from(Award).where(Award.round == round_)):
            raise ApiError("Declare at least one winner first.", 409)
        db.add(AppState(key=_awards_key(round_), value=admin.email, updated_at=utcnow()))
        audit.record(db, admin.email, "judging.awards_published", detail=f"Winners of the {ROUND_LABELS[round_]} shown to students")
    else:
        if state is None:
            raise ApiError("The winners are not published.", 409)
        db.delete(state)
        audit.record(db, admin.email, "judging.awards_withdrawn", detail=f"Winners of the {ROUND_LABELS[round_]} hidden from students")
    db.commit()


# ---------- Judges' own view ----------


def find_juror(db: Session, email: str) -> Juror | None:
    return db.get(Juror, email)


def require_juror(db: Session, email: str) -> Juror:
    juror = find_juror(db, email)
    if juror is None:
        raise ApiError("This account is not an appointed InnoTech26 judge.", 403)
    return juror


def judge_view(db: Session, juror: Juror) -> JudgeOut:
    links = (
        db.execute(
            select(PanelJuror, Panel)
            .join(Panel, Panel.id == PanelJuror.panel_id)
            .where(PanelJuror.juror_email == juror.email)
            .order_by(Panel.round, Panel.slot_start, Panel.name_key)
        )
        .tuples()
        .all()
    )
    panel_ids = [panel.id for _, panel in links]
    rows = (
        db.execute(
            select(PanelTeam.panel_id, Team)
            .join(Team, Team.id == PanelTeam.team_id)
            .where(PanelTeam.panel_id.in_(panel_ids))
            .order_by(Team.number)
        )
        .tuples()
        .all()
        if panel_ids
        else []
    )
    teams = [team for _, team in rows]
    team_ids = [t.id for t in teams]
    tents = _tents(db, team_ids)
    members: dict[uuid.UUID, list[JudgeMemberOut]] = defaultdict(list)
    mine: dict[tuple[str, uuid.UUID], Score] = {}
    states = presence.member_states(db, team_ids)
    if team_ids:
        for member, profile in db.execute(
            select(TeamMember, Profile)
            .join(Profile, Profile.user_id == TeamMember.user_id)
            .where(TeamMember.team_id.in_(team_ids))
            .order_by(TeamMember.role != "leader", Profile.full_name)
        ).tuples():
            state = next((m.state for m in states.get(member.team_id, []) if m.user_id == member.user_id), "not_marked")
            members[member.team_id].append(
                JudgeMemberOut(
                    user_id=member.user_id,
                    attendance=state,
                    full_name=profile.full_name,
                    role=member.role,
                    year=profile.year,
                    course=profile.course,
                    department=profile.department,
                )
            )
        for score in db.scalars(select(Score).where(Score.juror_email == juror.email, Score.team_id.in_(team_ids))):
            mine[(score.round, score.team_id)] = score
    open_rounds = {r for r in rules.JUDGING_ROUNDS if round_open(db, r)}
    now = utcnow()
    by_panel: dict[uuid.UUID, list[JudgeTeamOut]] = defaultdict(list)
    round_of = {panel.id: panel.round for _, panel in links}
    locked_of = {panel.id: _locked(panel, link, open_rounds, now) for link, panel in links}
    for panel_id, team in rows:
        score = mine.get((round_of[panel_id], team.id))
        by_panel[panel_id].append(
            JudgeTeamOut(
                id=team.id,
                code=team.code,
                name=team.name,
                category=team.category,
                domain=team.domain,
                project_title=team.project_title,
                abstract=team.abstract,
                participant_type=team.participant_type,
                institution=team.institution,
                department=team.department,
                status=team.status,
                tent=tents.get(team.id),
                members=members[team.id],
                all_absent=round_of[panel_id] == "department" and presence.is_all_absent(states.get(team.id, [])),
                my_score=_judge_score_out(score, locked_of[panel_id]) if score else None,
            )
        )
    return JudgeOut(
        email=juror.email,
        name=juror.name,
        panels=[
            JudgePanelOut(
                id=panel.id,
                round=panel.round,
                building=panel.building,
                name=panel.name,
                location=panel.location,
                slot_start=panel.slot_start,
                slot_end=panel.slot_end,
                department=panel.department,
                parent_department=_is_parent(panel, juror),
                present_at=link.present_at,
                can_mark_attendance=attendance_open(panel, open_rounds, now),
                locked=locked_of[panel.id],
                buffer_minutes=panel.buffer_minutes,
                open=panel.round in open_rounds,
                scoring_from=scoring_window(panel)[0],
                scoring_until=scoring_window(panel)[1],
                teams=by_panel[panel.id],
            )
            for link, panel in links
        ],
        server_time=now,
    )


def _score_out(score: Score, locked: bool = False) -> ScoreOut:
    return ScoreOut(
        marks=list(score.marks),
        total=score.total,
        remarks=score.remarks,
        updated_at=score.updated_at,
        edited_by=score.edited_by,
        locked=locked,
        edit_count=score.edit_count,
    )


def _judge_score_out(score: Score, locked: bool = False) -> ScoreOut:
    """A judge's own marks as the judge sees them: nothing about changes. The record stays (edit_count, edited_by, activity log)."""
    return _score_out(score, locked).model_copy(update={"edited_by": None, "edit_count": 0})


FINAL_SCORE = "Your marks in this room are locked. Only a super admin or this department's admin can change them."


def _strong_reason(reason: str) -> str:
    """A reason for changing saved marks: real words, not filler."""
    reason = " ".join(reason.split())
    if len(reason) < rules.MIN_REASON_LENGTH or len(set(reason.lower())) < 5:
        raise ApiError(f"Give a clear reason for changing saved marks (at least {rules.MIN_REASON_LENGTH} characters).", 422)
    return reason


def _own_room(db: Session, juror: Juror, panel_id: uuid.UUID, *, shared: bool) -> tuple[Panel, PanelJuror]:
    """A judge's room and their link to it, locked: a shared lock on the room (so its judges or teams cannot change meanwhile)
    and an exclusive one on the judge's own link, which orders this judge's saves and their bulk lock."""
    panel = db.scalar(select(Panel).where(Panel.id == panel_id).with_for_update(read=shared).execution_options(populate_existing=True))
    link = db.scalar(
        select(PanelJuror)
        .where(PanelJuror.panel_id == panel_id, PanelJuror.juror_email == juror.email)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if link is None or panel is None:
        raise ApiError("You are not a judge on this panel.", 403)
    return panel, link


def _require_scoring_time(db: Session, panel: Panel) -> None:
    """The round must be open and, for a department room, the room's slot started and its buffer not run out."""
    # Locks the round state for the length of the save, so a lock by the organisers is never overtaken.
    if db.scalar(select(AppState).where(AppState.key == _round_key(panel.round)).with_for_update(read=True)) is None:
        raise ApiError("Judging is locked. Scores can be saved once the organisers open this round.", 423)
    opens, closes = scoring_window(panel)
    now = utcnow()
    if opens is not None and now < opens:
        at = opens.astimezone(rules.IST)
        raise ApiError(f"Scoring for this room opens {at.day} {at:%b} at {at:%I:%M %p}.".replace(" 0", " "), 423)
    if closes is not None and now > closes:
        raise ApiError(
            "Scoring for this room has closed, and your marks are locked. Contact the organisers if a team still needs marks.", 423
        )


def save_score(db: Session, juror: Juror, panel_id: uuid.UUID, team_id: uuid.UUID, data: JudgeScoreInput) -> ScoreOut:
    """
    A judge saves marks for a team of their own room while the round is open and the room's time has not run out.
    Saved marks can be changed, with a clear reason, until the judge locks all their marks in the room (or the time
    runs out, which locks them).
    """
    panel, link = _own_room(db, juror, panel_id, shared=True)
    if db.scalar(select(PanelTeam.team_id).where(PanelTeam.panel_id == panel_id, PanelTeam.team_id == team_id)) is None:
        raise ApiError("This team is not allotted to your panel.", 403)
    _require_scoring_time(db, panel)
    if link.locked_at is not None:
        raise ApiError(FINAL_SCORE, 409)
    team = db.get(Team, team_id)
    if team is None or team.status != "submitted":
        raise ApiError("This team has been withdrawn or disqualified, so it is not scored.", 409)
    if panel.round == "department" and presence.absent_teams(db, [team_id]):
        raise ApiError("Every member of this team is marked absent, so it scores 0. Mark at least one student present to give marks.", 409)

    current = db.scalar(
        select(Score)
        .where(Score.round == panel.round, Score.team_id == team_id, Score.juror_email == juror.email)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    total = sum(data.marks)
    if current is None:
        current = Score(round=panel.round, team_id=team_id, juror_email=juror.email, marks=data.marks, total=total, remarks=data.remarks)
        db.add(current)
        audit.record(db, juror.email, "judging.scored", team, f"{total}/{rules.RUBRIC_TOTAL} in {room_label(panel)}")
    elif list(current.marks) == data.marks and current.remarks == data.remarks:
        return _judge_score_out(current)
    else:
        reason = _strong_reason(data.edit_reason)
        was = f"{current.total}/{rules.RUBRIC_TOTAL} {list(current.marks)}"
        current.marks, current.total, current.remarks = data.marks, total, data.remarks
        current.updated_at = utcnow()
        current.edit_count += 1
        current.edit_reason = reason
        audit.record(
            db,
            juror.email,
            "judging.score_edited",
            team,
            f"{juror.email} in {room_label(panel)}: {total}/{rules.RUBRIC_TOTAL} {data.marks} (was: {was}). Reason: {reason}",
        )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        # Two saves for a new team raced (another tab, a double tap): the first one stands.
        raise ApiError("These marks were just saved from another window. Reload the page to see them.", 409) from exc
    db.refresh(current)
    return _judge_score_out(current)


def lock_scores(db: Session, juror: Juror, panel_id: uuid.UUID) -> LockOut:
    """
    A judge locks all their saved marks in a room in one go. Teams they have not marked stay unscored. Marks are also
    locked by themselves when the room's time runs out. Locking twice does nothing.
    """
    panel, link = _own_room(db, juror, panel_id, shared=True)
    scored = db.scalar(
        select(func.count())
        .select_from(Score)
        .where(
            Score.round == panel.round,
            Score.juror_email == juror.email,
            Score.team_id.in_(select(PanelTeam.team_id).where(PanelTeam.panel_id == panel.id)),
        )
    )
    total = db.scalar(select(func.count()).select_from(PanelTeam).where(PanelTeam.panel_id == panel.id)) or 0
    closes = scoring_window(panel)[1]
    now = utcnow()
    already = link.locked_at is not None or (closes is not None and now > closes)
    if not already:
        _require_scoring_time(db, panel)
        link.locked_at = now
        audit.record(
            db,
            juror.email,
            "judging.marks_locked",
            detail=f"{juror.email} locked {scored or 0} of {total} teams' marks in {room_label(panel)}",
        )
        db.commit()
    return LockOut(locked=scored or 0, unscored=max(total - (scored or 0), 0))


def unlock_judge(db: Session, admin: Admin, panel_id: uuid.UUID, juror_email: str, data: UnlockInput) -> PanelOut:
    """
    Lets a judge change their marks again after locking them by mistake. A super admin any time; a department's own
    admin during the room's slot and buffer. The judge's time still has to be running to save anything.
    """
    panel = _lock_panel(db, panel_id)
    if not _may_edit_marks(admin, panel, utcnow()):
        raise ApiError("Only a super admin, or this department's admin during the room's time slot, can unlock a judge.", 403)
    link = db.scalar(
        select(PanelJuror)
        .where(PanelJuror.panel_id == panel.id, PanelJuror.juror_email == juror_email.strip().lower())
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if link is None:
        raise ApiError("This judge is not in this room.", 404)
    if link.locked_at is None:
        raise ApiError("This judge has not locked their marks.", 409)
    reason = _strong_reason(data.reason) if admin.role != "super_admin" else " ".join(data.reason.split()) or "no reason given"
    link.locked_at = None
    audit.record(
        db,
        admin.email,
        "judging.marks_unlocked",
        detail=f"{link.juror_email} in {room_label(panel)} unlocked. Reason: {reason}",
        department=panel.department,
    )
    db.commit()
    return _panels_out(db, [panel], admin)[0]


def edit_score(db: Session, admin: Admin, panel_id: uuid.UUID, team_id: uuid.UUID, juror_email: str, data: AdminScoreInput) -> ScoreOut:
    """
    An organiser changes a judge's saved marks, or enters them for the judge (e.g. from a paper sheet). A super admin
    can do it any time and need not give a reason; a department's own admin only during the room's slot and buffer,
    and with a clear reason. Both are recorded.
    """
    panel = _lock_panel(db, panel_id)
    if not _may_edit_marks(admin, panel, utcnow()):
        raise ApiError("Only a super admin, or this department's admin during the room's time slot, can change submitted marks.", 403)
    reason = _strong_reason(data.reason) if admin.role != "super_admin" else " ".join(data.reason.split()) or "no reason given"
    juror_email = juror_email.strip().lower()
    if db.get(PanelJuror, (panel.id, juror_email)) is None:
        raise ApiError("This judge is not in this room.", 422)
    if db.get(PanelTeam, (panel.id, team_id)) is None:
        raise ApiError("This team is not allotted to this room.", 422)
    team = db.get(Team, team_id)
    assert team is not None
    current = db.scalar(
        select(Score).where(Score.round == panel.round, Score.team_id == team_id, Score.juror_email == juror_email).with_for_update()
    )
    total = sum(data.marks)
    if current is None:
        current = Score(round=panel.round, team_id=team_id, juror_email=juror_email, marks=data.marks, total=total, remarks=data.remarks)
        db.add(current)
        was = "no marks"
    else:
        was = f"{current.total}/{rules.RUBRIC_TOTAL} {list(current.marks)}"
        current.marks, current.total, current.remarks = data.marks, total, data.remarks
        current.updated_at = utcnow()
        current.edit_count += 1
        current.edit_reason = reason
    current.edited_by = admin.email
    audit.record(
        db,
        admin.email,
        "judging.score_edited",
        team,
        f"{juror_email} in {room_label(panel)}: {total}/{rules.RUBRIC_TOTAL} {data.marks} (was: {was}). Reason: {reason}",
        department=panel.department,
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError("The judge saved marks for this team just now. Reload to see them, then change them if needed.", 409) from exc
    db.refresh(current)
    return _score_out(current, True)


# ---------- Readiness board ----------


def readiness(db: Session, admin: Admin) -> ReadinessOut:
    """
    How far each department has got with its department-round rooms, ranked. Every organiser who runs the round
    (super admins and all department admins) can see everyone's, so departments can see where they stand. Only counts
    are shown: no team names, rooms or judges of other departments.
    """
    if admin.role not in ("super_admin", "admin"):
        raise ApiError("The readiness board is for super admins and department admins.", 403)
    teams = dict(
        db.execute(
            select(Team.department, func.count())
            .where(_eligible_condition("department"), Team.department.is_not(None))
            .group_by(Team.department)
        ).all()
    )
    allotted = dict(
        db.execute(
            select(Panel.department, func.count(func.distinct(PanelTeam.team_id)))
            .join(PanelTeam, PanelTeam.panel_id == Panel.id)
            .where(Panel.round == "department")
            .group_by(Panel.department)
        ).all()
    )
    rooms = dict(db.execute(select(Panel.department, func.count()).where(Panel.round == "department").group_by(Panel.department)).all())
    judges_per_room = (
        select(Panel.department.label("department"), Panel.id.label("id"), func.count(PanelJuror.juror_email).label("judges"))
        .outerjoin(PanelJuror, PanelJuror.panel_id == Panel.id)
        .where(Panel.round == "department")
        .group_by(Panel.department, Panel.id)
        .subquery()
    )
    staffed = dict(
        db.execute(
            select(judges_per_room.c.department, func.count()).where(judges_per_room.c.judges >= 2).group_by(judges_per_room.c.department)
        ).all()
    )
    rows = []
    for department, total in teams.items():
        done, room_count, full = min(allotted.get(department, 0), total), rooms.get(department, 0), staffed.get(department, 0)
        percent = round((100 * done / total + (100 * full / room_count if room_count else 0)) / 2)
        rows.append(
            (department, total, done, room_count, full, percent, total > 0 and done == total and room_count > 0 and full == room_count)
        )
    rows.sort(key=lambda r: (-r[5], -r[1], r[0]))
    ranked = []
    for index, (department, total, done, room_count, full, percent, ready) in enumerate(rows):
        # Equal progress shares a rank.
        rank = ranked[-1].rank if ranked and ranked[-1].percent == percent else index + 1
        ranked.append(
            ReadinessRow(
                department=department, teams=total, allotted=done, rooms=room_count, staffed=full, percent=percent, ready=ready, rank=rank
            )
        )
    return ReadinessOut(rows=ranked, mine=admin.department if admin.role == "admin" else None)
