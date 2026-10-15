"""
Admin panel logic. Scoping is applied inside every query: a department admin (COE KIET is one of the departments)
only ever reads or changes KIET teams and students of their own department; an outside admin only teams and
students from other colleges and schools; a startup admin only startups; a super admin sees everything.
"""

import json
import logging
import random
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field
from sqlalchemy import ColumnElement, String, and_, cast, delete, exists, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from .. import rules
from ..config import Settings
from ..db import violated_constraint
from ..errors import ApiError
from ..models import (
    Admin,
    AppState,
    Attendance,
    AuditEntry,
    FinalistNomination,
    FinalTent,
    Invitation,
    PanelTeam,
    Profile,
    Score,
    Team,
    TeamMember,
    User,
    utcnow,
)
from ..schemas import (
    AdminInput,
    AdminMemberOut,
    AdminOut,
    AdminStudentInput,
    AdminStudentOut,
    AdminTeamInput,
    AdminTeamOut,
    AuditOut,
    CategoryStats,
    DepartmentStats,
    DomainStats,
    FinalistBoardOut,
    FinalistCategoryOut,
    FinalistSummaryOut,
    InstitutionStats,
    MatrixCell,
    MatrixRow,
    NominationsInput,
    PublishInput,
    PublishOut,
    QuotasInput,
    SizeStats,
    StatsOut,
    StatusCounts,
    StudentTeamRef,
    TeamSummaryOut,
    TimelinePoint,
    TypeStats,
    UnpublishInput,
    YearStats,
)
from . import audit, schedule
from .serializers import invitation_out, profile_out

logger = logging.getLogger(__name__)

RESULTS_KEY = "results_published"
STATUSES = ("draft", "submitted", "withdrawn", "disqualified")


def _is_super(admin: Admin) -> bool:
    return admin.role == "super_admin"


OUTSIDE = ("college", "school")
STARTUPS = ("startup",)
# Admins limited to participant types rather than a KIET department, and the types each one sees.
ROLE_TYPES: dict[str, tuple[str, ...]] = {
    "outside_admin": OUTSIDE,
    "college_admin": ("college",),
    "school_admin": ("school",),
    "startup_admin": STARTUPS,
}
ROLE_SCOPE_LABELS = {
    "outside_admin": "other colleges and schools",
    "college_admin": "other colleges",
    "school_admin": "schools",
    "startup_admin": "startups",
}


def _is_outside(admin: Admin) -> bool:
    """Admins for other colleges and/or schools."""
    return admin.role in ("outside_admin", "college_admin", "school_admin")


def type_scope(admin: Admin) -> tuple[str, ...] | None:
    """The participant types an outside, college, school or startup admin is limited to; None for super and department admins."""
    return ROLE_TYPES.get(admin.role)


def is_type_admin(admin: Admin) -> bool:
    return type_scope(admin) is not None


def scope_label(admin: Admin) -> str:
    return ROLE_SCOPE_LABELS.get(admin.role, str(admin.department))


def _escape_like(text: str) -> str:
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def check_department(admin: Admin, department: str | None) -> None:
    if department is None:
        return
    if department not in rules.DEPARTMENTS:
        raise ApiError(f'Unknown department "{department}".', 422)
    if not _is_super(admin) and department != admin.department:
        raise ApiError(f"You can only view {scope_label(admin)} data.", 403)


# ---------- Scope ----------


def team_scope(admin: Admin) -> ColumnElement[bool]:
    if _is_super(admin):
        return Team.id.is_not(None)
    if types := type_scope(admin):
        return Team.participant_type.in_(types)
    return and_(Team.participant_type == "kiet", Team.department == admin.department)


def student_scope(admin: Admin) -> ColumnElement[bool]:
    if _is_super(admin):
        return Profile.user_id.is_not(None)
    if types := type_scope(admin):
        return Profile.participant_type.in_(types)
    return and_(Profile.participant_type == "kiet", Profile.department == admin.department)


def can_see_team(admin: Admin, team: Team) -> bool:
    if _is_super(admin):
        return True
    if types := type_scope(admin):
        return team.participant_type in types
    return team.participant_type == "kiet" and team.department == admin.department


def can_see_profile(admin: Admin, profile: Profile) -> bool:
    if _is_super(admin):
        return True
    if types := type_scope(admin):
        return profile.participant_type in types
    return profile.participant_type == "kiet" and profile.department == admin.department


def _visible_team(db: Session, admin: Admin, team_id: uuid.UUID, lock: bool = False) -> Team:
    statement = select(Team).where(Team.id == team_id)
    if lock:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    team = db.scalar(statement)
    if team is None:
        raise ApiError("Team not found.", 404)
    if not can_see_team(admin, team):
        raise ApiError(
            f"This team is not one of the {scope_label(admin)}." if is_type_admin(admin) else f"This team is not in {admin.department}.",
            403,
        )
    return team


# ---------- Serialising many teams at once ----------


def _leader_names(db: Session, teams: list[Team]) -> dict[uuid.UUID, str]:
    ids = {t.leader_id for t in teams}
    if not ids:
        return {}
    return dict(db.execute(select(Profile.user_id, Profile.full_name).where(Profile.user_id.in_(ids))).tuples().all())


def _member_counts(db: Session, team_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not team_ids:
        return {}
    rows = db.execute(select(TeamMember.team_id, func.count()).where(TeamMember.team_id.in_(team_ids)).group_by(TeamMember.team_id))
    return dict(rows.tuples().all())


def _member_years(db: Session, team_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[tuple[str, int]]]:
    """Each team's members as (role, year), leader first."""
    years: dict[uuid.UUID, list[tuple[str, int]]] = defaultdict(list)
    if not team_ids:
        return years
    rows = db.execute(
        select(TeamMember.team_id, TeamMember.role, Profile.year)
        .join(Profile, Profile.user_id == TeamMember.user_id)
        .where(TeamMember.team_id.in_(team_ids))
        .order_by(TeamMember.team_id, TeamMember.role != "leader", Profile.year)
    )
    for team_id, role, year in rows:
        years[team_id].append((role, year))
    return years


def summaries(db: Session, teams: list[Team]) -> list[TeamSummaryOut]:
    leaders = _leader_names(db, teams)
    counts = _member_counts(db, [t.id for t in teams])
    years = _member_years(db, [t.id for t in teams])
    return [
        TeamSummaryOut(
            id=t.id,
            code=t.code,
            name=t.name,
            category=t.category,
            participant_type=t.participant_type,
            institution=t.institution,
            department=t.department,
            route=t.route,
            status=t.status,
            result=t.result,
            leader_name=leaders.get(t.leader_id, ""),
            member_count=counts.get(t.id, 0),
            project_title=t.project_title,
            submitted_at=t.submitted_at,
            approval_required=t.approval_required,
            approved_at=t.approved_at,
            leader_year=next((year for role, year in years[t.id] if role == "leader"), None),
            member_years=[year for _, year in years[t.id]],
        )
        for t in teams
    ]


def admin_teams(db: Session, teams: list[Team]) -> list[AdminTeamOut]:
    """Full team details for a list of teams, in three queries however long the list is."""
    ids = [t.id for t in teams]
    if not ids:
        return []
    members: dict[uuid.UUID, list[AdminMemberOut]] = defaultdict(list)
    rows = db.execute(
        select(TeamMember, Profile, User.email, User.banned_at)
        .join(Profile, Profile.user_id == TeamMember.user_id)
        .join(User, User.id == TeamMember.user_id)
        .where(TeamMember.team_id.in_(ids))
        .order_by(TeamMember.joined_at)
    ).all()
    for member, profile, email, banned_at in rows:
        members[member.team_id].append(
            AdminMemberOut(
                user_id=member.user_id,
                full_name=profile.full_name,
                email=email,
                department=profile.department,
                course=profile.course,
                year=profile.year,
                role=member.role,
                joined_at=member.joined_at,
                club=profile.club,
                phone=profile.phone,
                roll_number=profile.roll_number,
                institution=profile.institution,
                banned=banned_at is not None,
            )
        )
    pending: dict[uuid.UUID, list[Invitation]] = defaultdict(list)
    for invitation in db.scalars(
        select(Invitation).where(Invitation.team_id.in_(ids), Invitation.status == "pending").order_by(Invitation.created_at)
    ):
        pending[invitation.team_id].append(invitation)
    leaders = _leader_names(db, teams)

    return [
        AdminTeamOut(
            id=t.id,
            code=t.code,
            join_code=t.join_code,
            name=t.name,
            category=t.category,
            domain=t.domain,
            project_title=t.project_title,
            abstract=t.abstract,
            participant_type=t.participant_type,
            institution=t.institution,
            department=t.department,
            route=t.route,
            leader_id=t.leader_id,
            members=sorted(members[t.id], key=lambda m: m.role != "leader"),
            invitations=[invitation_out(i, t, leaders.get(t.leader_id, "")) for i in pending[t.id]],
            status=t.status,
            result=t.result,
            created_at=t.created_at,
            submitted_at=t.submitted_at,
            approval_required=t.approval_required,
            approved_at=t.approved_at,
        )
        for t in teams
    ]


# ---------- Teams ----------


class Paging(BaseModel):
    page: int = Field(default=1, ge=1, le=10_000)
    page_size: int = Field(default=25, ge=1, le=100)


class TeamFilters(Paging):
    department: str | None = None
    category: int | None = Field(default=None, ge=1, le=8)
    status: Literal["draft", "submitted", "withdrawn", "disqualified"] | None = None
    type: rules.ParticipantType | None = None
    route: Literal["department", "finale"] | None = None
    # Startup and COE KIET entries: waiting for an admin to accept them, or already accepted.
    approval: Literal["pending", "approved"] | None = None
    # Teams with at least one member in this year (college) or class (school).
    year: int | None = Field(default=None, ge=1, le=12)
    # Teams whose leader is in this year or class.
    leader_year: int | None = Field(default=None, ge=1, le=12)
    q: str | None = Field(default=None, max_length=100)
    sort: Literal["code", "name", "category", "department", "status", "members", "submitted_at", "leader_year"] = "code"
    order: Literal["asc", "desc"] = "asc"


def _team_query(admin: Admin, f: TeamFilters):
    check_department(admin, f.department)
    conditions = [team_scope(admin)]
    if f.department:
        conditions.append(Team.department == f.department)
    if f.category:
        conditions.append(Team.category == f.category)
    if f.status:
        conditions.append(Team.status == f.status)
    if f.type:
        conditions.append(Team.participant_type == f.type)
    if f.route:
        conditions.append(Team.route == f.route)
    if f.approval == "pending":
        conditions.append(and_(Team.approval_required.is_(True), Team.approved_at.is_(None)))
    elif f.approval == "approved":
        conditions.append(and_(Team.approval_required.is_(True), Team.approved_at.is_not(None)))
    if f.year:
        member, member_profile = aliased(TeamMember), aliased(Profile)
        conditions.append(
            exists(
                select(member.user_id)
                .join(member_profile, member_profile.user_id == member.user_id)
                .where(member.team_id == Team.id, member_profile.year == f.year)
            )
        )
    leader_year = select(Profile.year).where(Profile.user_id == Team.leader_id).correlate(Team).scalar_subquery()
    if f.leader_year:
        conditions.append(leader_year == f.leader_year)
    if f.q and f.q.strip():
        pattern = _escape_like(f.q.strip())
        digits = cast(Team.number, String)
        # Same format as Team.code: at least four digits, never truncated.
        code = func.concat("IT26-", func.lpad(digits, func.greatest(4, func.length(digits)), "0"))
        member_match = exists(
            select(TeamMember.user_id)
            .join(Profile, Profile.user_id == TeamMember.user_id)
            .join(User, User.id == TeamMember.user_id)
            .where(
                TeamMember.team_id == Team.id,
                or_(Profile.full_name.ilike(pattern, escape="\\"), User.email.ilike(pattern, escape="\\")),
            )
        )
        conditions.append(
            or_(
                Team.name.ilike(pattern, escape="\\"),
                code.ilike(pattern, escape="\\"),
                Team.institution.ilike(pattern, escape="\\"),
                member_match,
            )
        )

    member_count = select(func.count()).where(TeamMember.team_id == Team.id).scalar_subquery()
    sort_column = {
        "code": Team.number,
        "name": Team.name_key,
        "category": Team.category,
        "department": func.coalesce(Team.department, Team.institution),
        "status": Team.status,
        "members": member_count,
        "submitted_at": Team.submitted_at,
        "leader_year": leader_year,
    }[f.sort]
    ordered = sort_column.desc().nulls_last() if f.order == "desc" else sort_column.asc().nulls_last()
    tie = Team.number.desc() if f.order == "desc" else Team.number.asc()
    return select(Team).where(*conditions).order_by(ordered, tie), conditions


def list_teams(db: Session, admin: Admin, f: TeamFilters) -> tuple[list[AdminTeamOut], int]:
    statement, conditions = _team_query(admin, f)
    total = db.scalar(select(func.count()).select_from(Team).where(*conditions)) or 0
    teams = list(db.scalars(statement.offset((f.page - 1) * f.page_size).limit(f.page_size)))
    return admin_teams(db, teams), total


def export_teams(db: Session, admin: Admin, f: TeamFilters) -> list[AdminTeamOut]:
    statement, _ = _team_query(admin, f)
    return admin_teams(db, list(db.scalars(statement)))


def get_team(db: Session, admin: Admin, team_id: uuid.UUID) -> AdminTeamOut:
    return admin_teams(db, [_visible_team(db, admin, team_id)])[0]


def _require_super(admin: Admin, what: str) -> None:
    if not _is_super(admin):
        raise ApiError(f"Only a super admin can {what}.", 403)


def _results_published(db: Session) -> AppState | None:
    return db.get(AppState, RESULTS_KEY)


def change_status(
    db: Session,
    admin: Admin,
    team_id: uuid.UUID,
    action: Literal["withdraw", "disqualify", "restore"],
    reason: str,
    *,
    unban_members: bool = False,
) -> AdminTeamOut:
    if action in ("disqualify", "restore"):
        _require_super(admin, f"{action} teams")
    team = _visible_team(db, admin, team_id, lock=True)

    published = _results_published(db) is not None
    if action == "restore":
        if team.status not in ("withdrawn", "disqualified"):
            raise ApiError("Only withdrawn or disqualified teams can be restored.", 409)
        # Members of a withdrawn team may have left to join other teams.
        leader_still_in = db.scalar(select(TeamMember.user_id).where(TeamMember.team_id == team.id, TeamMember.user_id == team.leader_id))
        member_count = _member_counts(db, [team.id]).get(team.id, 0)
        if leader_still_in is None or (team.submitted_at and member_count < rules.team_size_limits(team.participant_type)[0]):
            raise ApiError("Members have left this team since it was withdrawn, so it cannot be restored.", 409)
        team.status = "submitted" if team.submitted_at else "draft"
        team.status_reason = None
        if published and team.route == "department" and team.status == "submitted":
            nominated = db.get(FinalistNomination, team.id) is not None
            team.result = "finalist" if nominated else "not_selected"
        audit.record(db, admin.email, "team.restored", team, reason)
        if unban_members:
            lifted = db.scalars(
                select(User)
                .join(TeamMember, TeamMember.user_id == User.id)
                .where(TeamMember.team_id == team.id, User.banned_at.is_not(None))
                .with_for_update(of=User)
            ).all()
            for member in lifted:
                member.banned_at = member.banned_reason = member.banned_by = None
            if lifted:
                audit.record(
                    db, admin.email, "student.unbanned", team, f"With the restored team {team.code}: {', '.join(m.email for m in lifted)}"
                )
    else:
        if team.status not in ("draft", "submitted"):
            raise ApiError(f"This team is already {team.status}.", 409)
        team.status = "withdrawn" if action == "withdraw" else "disqualified"
        team.status_reason = reason
        db.execute(
            update(Invitation)
            .where(Invitation.team_id == team.id, Invitation.status == "pending")
            .values(status="cancelled", responded_at=utcnow())
        )
        if published:
            # Nominations are locked after publishing; keep the record so a restore brings the result back.
            if team.route == "department" and team.result == "finalist":
                team.result = "not_selected"
        else:
            # Frees the nomination so the department can pick another team.
            db.execute(delete(FinalistNomination).where(FinalistNomination.team_id == team.id))
        audit.record(db, admin.email, f"team.{team.status}", team, reason)
    db.commit()
    return admin_teams(db, [team])[0]


# ---------- Creating a team for students ----------


def create_team(db: Session, admin: Admin, data: AdminTeamInput, settings: Settings) -> AdminTeamOut:
    """
    An organiser builds a team from registered students, whether or not registration is open (e.g. for help-desk
    cases). The team rules still apply: same college or school, category eligibility, team size, unique name.
    """
    from .students import ALREADY_IN_TEAM, CODE_TAKEN, NAME_TAKEN, _commit, _decline_pending_invitations

    emails = [data.leader_email, *data.member_emails]
    if len(set(emails)) != len(emails):
        raise ApiError("A student is listed more than once.", 422)
    if len(emails) > rules.TEAM_MAX_SIZE:
        raise ApiError(f"A team can have at most {rules.TEAM_MAX_SIZE} members.", 422)

    # Lock the students' profiles (in a fixed order) so none of them joins another team meanwhile.
    rows = db.execute(
        select(User, Profile)
        .join(Profile, Profile.user_id == User.id)
        .where(User.email.in_(emails))
        .order_by(User.id)
        .with_for_update(of=Profile)
        .execution_options(populate_existing=True)
    ).all()
    found = {user.email: (user, profile) for user, profile in rows}
    for email in emails:
        if email not in found:
            raise ApiError(f"No registered student uses {email}. They must sign in and complete their profile first.", 422)
        if found[email][0].banned_at is not None:
            raise ApiError(f"{email} is banned, so they cannot be in a team.", 422)
    leader_user, leader = found[data.leader_email]
    if not can_see_profile(admin, leader):
        raise ApiError(
            f"You can only create teams led by {scope_label(admin)} students."
            if _is_outside(admin)
            else "You can only create startup entries."
            if admin.role == "startup_admin"
            else f"You can only create teams led by {admin.department} students.",
            403,
        )
    low, high = rules.team_size_limits(leader.participant_type)
    if len(emails) > high:
        raise ApiError(
            "A startup registers as a single entry, so it has no teammates." if high == 1 else f"A team can have at most {high} members.",
            422,
        )
    if data.submit and len(emails) < low:
        raise ApiError(f"A team needs {low} to {high} members to be submitted.", 422)
    for email in data.member_emails:
        _, profile = found[email]
        same = profile.participant_type == leader.participant_type and (
            leader.participant_type == "kiet" or profile.institution_key == leader.institution_key
        )
        if not same:
            raise ApiError(f"{email} is not from the same college or school as the leader.", 422)
    taken = db.execute(
        select(User.email, Team.number)
        .join(TeamMember, TeamMember.user_id == User.id)
        .join(Team, Team.id == TeamMember.team_id)
        .where(User.email.in_(emails))
    ).first()
    if taken:
        raise ApiError(f"{taken[0]} is already in team IT26-{taken[1]:04d}.", 409)
    if error := rules.category_error(data.category, leader.participant_type, [found[e][1].year for e in emails]):
        raise ApiError(error, 422)
    route = rules.route_for(leader.participant_type, leader.department)
    needs_approval = rules.needs_approval(leader.participant_type, leader.department)
    if data.submit and route == "department" and _results_published(db):
        raise ApiError("Results have been published, so new KIET teams can be created as drafts only.", 409)

    now = utcnow()
    team = Team(
        name=data.name,
        name_key=rules.normalise_team_name(data.name),
        category=data.category,
        domain=data.domain,
        project_title=data.project_title,
        abstract=data.abstract,
        participant_type=leader.participant_type,
        institution=leader.institution,
        institution_key=leader.institution_key,
        department=leader.department,
        route=route,
        approval_required=needs_approval,
        # An entry an organiser creates is accepted by that organiser.
        approved_at=now if needs_approval else None,
        approved_by=admin.email if needs_approval else None,
        leader_id=leader_user.id,
        status="submitted" if data.submit else "draft",
        submitted_at=now if data.submit else None,
    )
    db.add(team)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        if NAME_TAKEN[0] in violated_constraint(exc):
            raise ApiError(*NAME_TAKEN[1]) from exc
        raise
    for email in emails:
        user, _ = found[email]
        db.add(TeamMember(team_id=team.id, user_id=user.id, role="leader" if email == data.leader_email else "member", joined_at=now))
        # One team per student: their invitations to other teams can no longer be accepted.
        _decline_pending_invitations(db, email)
    audit.record(db, admin.email, "team.created", team, f"Created by an organiser with {len(emails)} members: {', '.join(emails)}")
    if data.submit:
        audit.record(db, admin.email, "team.submitted", team, "Submitted by an organiser")
    _commit(db, dict([ALREADY_IN_TEAM, NAME_TAKEN, CODE_TAKEN]))
    return admin_teams(db, [team])[0]


# ---------- Accepting startup and COE KIET entries ----------


def _require_approver(admin: Admin) -> None:
    """Super admins, the startup admin and the COE KIET admin accept the entries they are responsible for."""
    if _is_super(admin) or admin.role == "startup_admin" or (admin.role == "admin" and admin.department == rules.CLUB_DEPARTMENT):
        return
    raise ApiError("Only a super admin, the startups admin or the COE KIET admin can accept entries.", 403)


def approve_team(db: Session, admin: Admin, team_id: uuid.UUID) -> AdminTeamOut:
    """Accepts a submitted startup or COE KIET entry as a legal entry, so it qualifies for the Grand Finale."""
    _require_approver(admin)
    team = _visible_team(db, admin, team_id, lock=True)
    if not team.approval_required:
        raise ApiError("This team does not need approval.", 409)
    if team.status != "submitted":
        raise ApiError("Only a submitted entry can be accepted." if team.status == "draft" else f"This entry is {team.status}.", 409)
    if team.approved_at is not None:
        raise ApiError("This entry has already been accepted.", 409)
    team.approved_at, team.approved_by = utcnow(), admin.email
    audit.record(db, admin.email, "team.approved", team, "Accepted as a legal entry for the Grand Finale")
    db.commit()
    return admin_teams(db, [team])[0]


def revoke_approval(db: Session, admin: Admin, team_id: uuid.UUID, reason: str) -> AdminTeamOut:
    """Takes the acceptance back, so the entry no longer qualifies. Not possible once judging has begun for it."""
    _require_approver(admin)
    team = _visible_team(db, admin, team_id, lock=True)
    if not team.approval_required or team.approved_at is None:
        raise ApiError("This entry has not been accepted.", 409)
    if blocked := _judging_blocker(db, team):
        raise ApiError(blocked, 409)
    team.approved_at = team.approved_by = None
    audit.record(db, admin.email, "team.approval_revoked", team, f"Acceptance withdrawn. Reason: {reason}")
    db.commit()
    return admin_teams(db, [team])[0]


# ---------- Reopening and dissolving teams ----------


def _judging_blocker(db: Session, team: Team) -> str | None:
    """Why a team cannot be reopened or dissolved because judging has started for it, or None."""
    if db.scalar(select(func.count()).select_from(Score).where(Score.team_id == team.id)):
        return "This team has already been scored by judges."
    if db.scalar(select(func.count()).select_from(PanelTeam).where(PanelTeam.team_id == team.id)):
        return "This team is allotted to a judging room or panel. Remove it from there on the Judging page first."
    if db.get(FinalTent, team.id) is not None:
        return "This team has a Grand Finale stall. Clear the stall on the Judging page first."
    return None


def reopen_team(db: Session, admin: Admin, settings: Settings, team_id: uuid.UUID, reason: str) -> AdminTeamOut:
    """Sends a submitted team back to draft so its leader can fix it and submit again. Super admins only."""
    _require_super(admin, "reopen teams")
    team = _visible_team(db, admin, team_id, lock=True)
    if team.status != "submitted":
        raise ApiError(
            "Only a submitted team can be reopened. Use Restore for a withdrawn or disqualified team."
            if team.status != "draft"
            else "This team is already a draft.",
            409,
        )
    # The leader can only edit and submit while registration is open, so reopening outside it would strand the team.
    if schedule.load(db, settings).registration_state(extended=schedule.is_extended(team)) != "open":
        raise ApiError(
            "Registration is closed, so the leader could not edit or submit the team again. Reopen it on the Schedule page first.",
            409,
        )
    if team.route == "department" and _results_published(db) is not None:
        raise ApiError("Department results have been published, so KIET teams can no longer be reopened.", 409)
    if blocked := _judging_blocker(db, team):
        raise ApiError(blocked, 409)

    team.status, team.submitted_at, team.status_reason, team.result = "draft", None, None, "pending"
    # An entry that is edited and submitted again is accepted again.
    team.approved_at = team.approved_by = None
    # A draft cannot be nominated; this frees the place for another team.
    db.execute(delete(FinalistNomination).where(FinalistNomination.team_id == team.id))
    audit.record(db, admin.email, "team.reopened", team, f"Sent back to draft. Reason: {reason}")
    db.commit()
    return admin_teams(db, [team])[0]


def submit_team(db: Session, admin: Admin, team_id: uuid.UUID, reason: str) -> AdminTeamOut:
    """
    Submits a draft team for its students, e.g. after the deadline when they reach out to the organisers. Super admins
    only. The registration window does not apply, but the team rules do; pending invitations are cancelled.
    """
    from .students import submission_problem

    _require_super(admin, "submit teams")
    team = _visible_team(db, admin, team_id, lock=True)
    if team.status != "draft":
        raise ApiError(f"Only a draft team can be submitted; this team is {team.status}.", 409)
    if team.route == "department" and _results_published(db) is not None:
        raise ApiError("Department results have been published, so a KIET team can no longer join the department round.", 409)
    cancelled = db.execute(
        update(Invitation)
        .where(Invitation.team_id == team.id, Invitation.status == "pending")
        .values(status="cancelled", responded_at=utcnow())
    ).rowcount
    db.flush()
    if problem := submission_problem(db, team):
        db.rollback()
        raise ApiError(f"This team cannot be submitted: {problem}.", 422)
    team.status, team.submitted_at = "submitted", utcnow()
    note = f" {cancelled} pending invitation(s) cancelled." if cancelled else ""
    audit.record(db, admin.email, "team.submitted", team, f"Submitted by an organiser. Reason: {reason}.{note}")
    db.commit()
    return admin_teams(db, [team])[0]


def dissolve_team(db: Session, admin: Admin, team_id: uuid.UUID, reason: str) -> None:
    """Deletes a team and frees all its members to join or create another. The history stays in the audit log."""
    _require_super(admin, "dissolve teams")
    team = _visible_team(db, admin, team_id, lock=True)
    if team.result == "finalist":
        raise ApiError("This team is a published finalist, so it cannot be dissolved. Disqualify it instead.", 409)
    if blocked := _judging_blocker(db, team):
        raise ApiError(blocked, 409)
    members = db.scalars(select(User.email).join(TeamMember, TeamMember.user_id == User.id).where(TeamMember.team_id == team.id)).all()
    audit.record(
        db,
        admin.email,
        "team.dissolved",
        team,
        f"{team.name} dissolved; {len(members)} members freed ({', '.join(members)}). Reason: {reason}",
    )
    db.delete(team)
    db.commit()


# ---------- Banning ----------


def _ban(db: Session, admin: Admin, user: User, reason: str) -> str:
    """Bans one student; returns what happened to their team, for the audit entry."""
    from .students import _decline_pending_invitations

    user.banned_at, user.banned_reason, user.banned_by = utcnow(), reason, admin.email
    _decline_pending_invitations(db, user.email)
    membership = db.scalar(select(TeamMember).where(TeamMember.user_id == user.id))
    if membership is None:
        return ""
    team = db.scalar(select(Team).where(Team.id == membership.team_id).with_for_update())
    assert team is not None
    if membership.role == "member" and team.status == "draft":
        # A member of a team still being built leaves it, so the rest of the team can carry on.
        db.delete(membership)
        audit.record(db, admin.email, "member.removed", team, f"{user.email} was banned")
        return f" Removed from draft team {team.code}."
    return f" Still in team {team.code} ({team.status}); withdraw or ban the team if it should not take part."


def ban_student(db: Session, admin: Admin, user_id: uuid.UUID, reason: str) -> AdminStudentOut:
    _require_super(admin, "ban students")
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    profile = db.get(Profile, user_id)
    if user is None or profile is None:
        raise ApiError("Student not found.", 404)
    if user.banned_at is not None:
        raise ApiError("This student is already banned.", 409)
    note = _ban(db, admin, user, reason)
    audit.record(
        db,
        admin.email,
        "student.banned",
        detail=f"{user.email}: {reason}.{note}",
        department=profile.department,
        participant_type=profile.participant_type,
    )
    db.commit()
    return _one_student(db, admin, user_id)


def delete_student(db: Session, admin: Admin, user_id: uuid.UUID, reason: str) -> str:
    """
    Deletes a student's profile so they can register afresh (their sign-in and any ban stay). In a team, a leader
    hands over to a random team mate; a leader with no team mates takes the team with them. Returns what happened.
    """
    from .students import _decline_pending_invitations, submission_problem

    _require_super(admin, "delete student profiles")
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    profile = db.get(Profile, user_id)
    if user is None or profile is None:
        raise ApiError("Student not found.", 404)

    note = ""
    membership = db.scalar(select(TeamMember).where(TeamMember.user_id == user.id))
    if membership is not None:
        team = db.scalar(select(Team).where(Team.id == membership.team_id).with_for_update())
        assert team is not None
        mates = db.scalars(select(TeamMember).where(TeamMember.team_id == team.id, TeamMember.user_id != user.id)).all()
        if team.leader_id == user.id and not mates:
            if team.result == "finalist":
                raise ApiError("This student's team is a published finalist, so it cannot be deleted. Disqualify it.", 409)
            if blocked := _judging_blocker(db, team):
                raise ApiError(blocked, 409)
            audit.record(db, admin.email, "team.dissolved", team, f"{team.name} deleted with its only member {user.email}. {reason}")
            db.delete(team)
            note = f" Their team {team.code} was deleted too."
        else:
            if team.leader_id == user.id:
                heir = random.choice(mates)  # noqa: S311 (a fair pick, not a secret)
                team.leader_id, heir.role = heir.user_id, "leader"
                heir_email = db.scalar(select(User.email).where(User.id == heir.user_id))
                audit.record(db, admin.email, "team.leader_changed", team, f"{user.email} deleted; {heir_email} is the new leader")
                note = f" {heir_email} is now leader of team {team.code}."
            else:
                note = f" Removed from team {team.code}."
            db.delete(membership)
            db.flush()
            if team.status == "submitted" and (problem := submission_problem(db, team)):
                db.rollback()
                raise ApiError(
                    f"Team {team.code} is submitted and could not stay valid without this student ({problem}). "
                    "Reopen the team first, or dissolve it.",
                    409,
                )
    db.execute(delete(Attendance).where(Attendance.user_id == user.id))
    _decline_pending_invitations(db, user.email)
    db.delete(profile)
    audit.record(
        db,
        admin.email,
        "student.deleted",
        detail=f"{user.email} ({profile.full_name}, roll {profile.roll_number or 'none'}): profile deleted. Reason: {reason}.{note}",
        department=profile.department,
        participant_type=profile.participant_type,
    )
    db.commit()
    return f"{profile.full_name}'s profile is deleted.{note}"


def unban_student(db: Session, admin: Admin, user_id: uuid.UUID, reason: str) -> AdminStudentOut:
    _require_super(admin, "lift bans")
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    profile = db.get(Profile, user_id)
    if user is None or profile is None:
        raise ApiError("Student not found.", 404)
    if user.banned_at is None:
        raise ApiError("This student is not banned.", 409)
    user.banned_at = user.banned_reason = user.banned_by = None
    audit.record(
        db,
        admin.email,
        "student.unbanned",
        detail=f"{user.email}: {reason}",
        department=profile.department,
        participant_type=profile.participant_type,
    )
    db.commit()
    return _one_student(db, admin, user_id)


def ban_team(db: Session, admin: Admin, team_id: uuid.UUID, reason: str, ban_members: bool) -> AdminTeamOut:
    """Disqualifies a team (it leaves the competition) and, if asked, bans every member from the portal."""
    _require_super(admin, "ban teams")
    team = _visible_team(db, admin, team_id)
    if team.status in ("draft", "submitted"):
        change_status(db, admin, team_id, "disqualify", f"Banned: {reason}")
    elif not ban_members:
        raise ApiError(f"This team is already {team.status}.", 409)
    if ban_members:
        members = db.scalars(
            select(User).join(TeamMember, TeamMember.user_id == User.id).where(TeamMember.team_id == team_id).with_for_update(of=User)
        ).all()
        banned = [m.email for m in members if m.banned_at is None]
        for member in members:
            if member.banned_at is None:
                member.banned_at, member.banned_reason, member.banned_by = utcnow(), reason, admin.email
        if banned:
            audit.record(db, admin.email, "student.banned", team, f"With team {team.code}: {', '.join(banned)}. {reason}")
        db.commit()
    return admin_teams(db, [team])[0]


# ---------- Registering a student ----------


def create_student(db: Session, admin: Admin, data: AdminStudentInput) -> AdminStudentOut:
    """An organiser registers a student (help desk), whatever the registration window says. Same rules as the portal."""
    from .students import _commit

    if data.participant_type not in rules.allowed_participant_types(data.email):
        raise ApiError(
            "A @kiet.edu email registers as a KIET student."
            if rules.is_kiet_email(data.email)
            else "KIET students are registered with their official @kiet.edu email.",
            422,
        )
    if _is_outside(admin) and data.participant_type not in ROLE_TYPES[admin.role]:
        raise ApiError(f"You can only register students from {scope_label(admin)}.", 403)
    if admin.role == "startup_admin" and data.participant_type != "startup":
        raise ApiError("You can only register startups.", 403)
    if admin.role == "admin" and (data.participant_type != "kiet" or data.department != admin.department):
        raise ApiError(f"You can only register {admin.department} students.", 403)

    user = db.scalar(select(User).where(User.email == data.email).with_for_update())
    if user is None:
        user = User(email=data.email, name=data.full_name)
        db.add(user)
        db.flush()
    elif user.banned_at is not None:
        raise ApiError("This email belongs to a banned student. Lift the ban first.", 409)
    if db.get(Profile, user.id) is not None:
        raise ApiError("This student is already registered.", 409)
    db.add(
        Profile(
            user_id=user.id,
            full_name=data.full_name,
            phone=data.phone,
            participant_type=data.participant_type,
            institution=data.institution,
            institution_key=rules.institution_key(data.participant_type, data.institution, data.city),
            city=data.city,
            department=data.department,
            course=data.course,
            year=data.year,
            roll_number=data.roll_number,
            club=data.club,
        )
    )
    audit.record(
        db,
        admin.email,
        "student.created",
        detail=f"{data.email} ({data.full_name}), registered by an organiser",
        department=data.department,
        participant_type=data.participant_type,
    )
    _commit(
        db,
        {
            "uq_profiles_kiet_roll_number": ("This roll number is already registered to another student.", 409),
            "uq_users_email": ("This student was registered a moment ago. Reload the list.", 409),
        },
    )
    return _one_student(db, admin, user.id)


def _one_student(db: Session, admin: Admin, user_id: uuid.UUID) -> AdminStudentOut:
    statement, _ = _student_query(admin, StudentFilters())
    rows = db.execute(statement.where(Profile.user_id == user_id).execution_options(populate_existing=True)).all()
    if not rows:
        raise ApiError("This student is outside your scope.", 403)
    return _student_rows(rows)[0]


# ---------- Students ----------


class StudentFilters(Paging):
    department: str | None = None
    type: rules.ParticipantType | None = None
    year: int | None = Field(default=None, ge=1, le=12)
    in_team: Literal["yes", "no"] | None = None
    banned: Literal["yes", "no"] | None = None
    q: str | None = Field(default=None, max_length=100)
    sort: Literal["name", "email", "department", "year", "institution", "created_at"] = "name"
    order: Literal["asc", "desc"] = "asc"


def _student_query(admin: Admin, f: StudentFilters):
    check_department(admin, f.department)
    conditions = [student_scope(admin)]
    if f.department:
        conditions.append(Profile.department == f.department)
    if f.type:
        conditions.append(Profile.participant_type == f.type)
    if f.year:
        conditions.append(Profile.year == f.year)
    # An alias: the student list also joins team_members itself, and a subquery on the same table would be
    # merged into that join ("no FROM clauses due to auto-correlation").
    member = aliased(TeamMember)
    in_team = exists(select(member.user_id).where(member.user_id == Profile.user_id))
    if f.in_team == "yes":
        conditions.append(in_team)
    elif f.in_team == "no":
        conditions.append(~in_team)
    if f.banned == "yes":
        conditions.append(User.banned_at.is_not(None))
    elif f.banned == "no":
        conditions.append(User.banned_at.is_(None))
    if f.q and f.q.strip():
        pattern = _escape_like(f.q.strip())
        conditions.append(
            or_(
                *(
                    column.ilike(pattern, escape="\\")
                    for column in (Profile.full_name, User.email, Profile.roll_number, Profile.institution, Profile.phone)
                )
            )
        )
    sort_column = {
        "name": func.lower(Profile.full_name),
        "email": User.email,
        "department": func.coalesce(Profile.department, Profile.institution),
        "year": Profile.year,
        "institution": Profile.institution,
        "created_at": Profile.created_at,
    }[f.sort]
    ordered = sort_column.desc() if f.order == "desc" else sort_column.asc()
    statement = (
        select(Profile, User.email, TeamMember, Team, User.banned_at, User.banned_reason, User.banned_by)
        .join(User, User.id == Profile.user_id)
        .outerjoin(TeamMember, TeamMember.user_id == Profile.user_id)
        .outerjoin(Team, Team.id == TeamMember.team_id)
        .where(*conditions)
        .order_by(ordered, Profile.user_id)
    )
    count = select(func.count()).select_from(Profile).join(User, User.id == Profile.user_id).where(*conditions)
    return statement, count


def _student_rows(rows) -> list[AdminStudentOut]:
    result = []
    for profile, email, membership, team, banned_at, banned_reason, banned_by in rows:
        base = profile_out(profile, email).model_dump()
        ref = (
            StudentTeamRef(id=team.id, code=team.code, name=team.name, status=team.status, department=team.department, role=membership.role)
            if team is not None
            else None
        )
        result.append(AdminStudentOut(**base, team=ref, banned_at=banned_at, banned_reason=banned_reason, banned_by=banned_by))
    return result


def list_students(db: Session, admin: Admin, f: StudentFilters) -> tuple[list[AdminStudentOut], int]:
    statement, count = _student_query(admin, f)
    total = db.scalar(count) or 0
    return _student_rows(db.execute(statement.offset((f.page - 1) * f.page_size).limit(f.page_size)).all()), total


def export_students(db: Session, admin: Admin, f: StudentFilters) -> list[AdminStudentOut]:
    statement, _ = _student_query(admin, f)
    return _student_rows(db.execute(statement).all())


# ---------- Stats ----------


def _counts(statuses: list[str]) -> dict[str, int]:
    tally = Counter(statuses)
    return {"total": len(statuses), **{status: tally.get(status, 0) for status in STATUSES}}


IST = ZoneInfo("Asia/Kolkata")
ACTIVE = ("draft", "submitted")
# A guard on the timeline length, should the registration dates ever be misconfigured.
TIMELINE_MAX_DAYS = 120


def _ist_day(moment: datetime) -> date:
    return moment.astimezone(IST).date()


def _timeline(
    window: schedule.Schedule, profile_times: list[datetime], team_times: list[datetime], submit_times: list[datetime]
) -> list[TimelinePoint]:
    """Daily counts in IST, from registration opening (or the first record) to today, with empty days filled in."""
    students = Counter(_ist_day(t) for t in profile_times)
    teams = Counter(_ist_day(t) for t in team_times)
    submitted = Counter(_ist_day(t) for t in submit_times)
    days = set(students) | set(teams) | set(submitted)
    start = min([_ist_day(window.opens), *days])
    end = max([min(_ist_day(utcnow()), _ist_day(window.closes)), *days])
    if end < start:
        return []
    start = max(start, end - timedelta(days=TIMELINE_MAX_DAYS - 1))
    return [
        TimelinePoint(date=day, students=students[day], teams=teams[day], submitted=submitted[day])
        for day in (start + timedelta(days=offset) for offset in range((end - start).days + 1))
    ]


def stats(db: Session, admin: Admin, settings: Settings) -> StatsOut:
    window = schedule.load(db, settings)
    teams = db.execute(
        select(
            Team.id,
            Team.status,
            Team.category,
            Team.participant_type,
            Team.department,
            Team.domain,
            Team.institution_key,
            Team.created_at,
            Team.submitted_at,
        ).where(team_scope(admin))
    ).all()
    students = db.execute(
        select(
            Profile.participant_type,
            Profile.department,
            exists(select(TeamMember.user_id).where(TeamMember.user_id == Profile.user_id)).label("in_team"),
            Profile.year,
            Profile.institution,
            Profile.institution_key,
            Profile.city,
            Profile.created_at,
        ).where(student_scope(admin))
    ).all()
    sizes = dict(
        db.execute(
            select(TeamMember.team_id, func.count())
            .join(Team, Team.id == TeamMember.team_id)
            .where(team_scope(admin))
            .group_by(TeamMember.team_id)
        ).all()
    )
    pending = db.scalar(
        select(func.count())
        .select_from(Invitation)
        .join(Team, Team.id == Invitation.team_id)
        .where(Invitation.status == "pending", team_scope(admin))
    )
    recent = list(db.scalars(select(Team).where(team_scope(admin), Team.status == "submitted").order_by(Team.submitted_at.desc()).limit(8)))
    published = _results_published(db)
    is_super = _is_super(admin)
    sees_outside = is_super or _is_outside(admin)
    active = [t for t in teams if t.status in ACTIVE]
    # Years in active teams: who leads them, and which years they include.
    team_years = _member_years(db, [t.id for t in active])
    led_by = Counter((t.participant_type, year) for t in active for role, year in team_years[t.id] if role == "leader")
    including = Counter((t.participant_type, year) for t in active for year in {y for _, y in team_years[t.id]})
    student_years = Counter((s.participant_type, s.year) for s in students)

    awaiting = db.scalar(
        select(func.count())
        .select_from(Team)
        .where(team_scope(admin), Team.status == "submitted", Team.approval_required.is_(True), Team.approved_at.is_(None))
    )
    return StatsOut(
        department=admin.department if admin.role == "admin" else None,
        awaiting_approval=awaiting or 0,
        students=len(students),
        students_in_teams=sum(1 for s in students if s.in_team),
        pending_invitations=pending or 0,
        teams=StatusCounts(**_counts([t.status for t in teams])),
        by_type=[
            TypeStats(
                type=kind,
                students=sum(1 for s in students if s.participant_type == kind),
                teams=sum(1 for t in teams if t.participant_type == kind),
                submitted=sum(1 for t in teams if t.participant_type == kind and t.status == "submitted"),
            )
            for kind in (("kiet", "college", "school", "startup") if is_super else ROLE_TYPES[admin.role])
        ]
        if sees_outside
        else None,
        by_category=[
            CategoryStats(category=number, **_counts([t.status for t in teams if t.category == number])) for number in rules.CATEGORIES
        ],
        by_department=[
            DepartmentStats(
                department=department,
                students=sum(1 for s in students if s.participant_type == "kiet" and s.department == department),
                **_counts([t.status for t in teams if t.participant_type == "kiet" and t.department == department]),
            )
            for department in rules.DEPARTMENTS
        ]
        if is_super
        else None,
        recent_submissions=summaries(db, recent),
        results_published_at=published.updated_at if published else None,
        timeline=_timeline(
            window, [s.created_at for s in students], [t.created_at for t in teams], [t.submitted_at for t in teams if t.submitted_at]
        ),
        schedule=schedule.to_out(window, settings),
        by_year=[
            YearStats(
                participant_type=kind,
                year=year,
                students=student_years[(kind, year)],
                teams_led=led_by[(kind, year)],
                teams_with=including[(kind, year)],
            )
            for kind, year in sorted(set(student_years) | set(led_by) | set(including))
        ],
        team_sizes=[
            SizeStats(size=size, teams=sum(1 for t in active if sizes.get(t.id, 0) == size)) for size in range(1, rules.TEAM_MAX_SIZE + 1)
        ],
        by_domain=[
            DomainStats(domain=domain, teams=count)
            for domain, count in sorted(Counter(t.domain for t in active).items(), key=lambda item: (-item[1], item[0]))
        ],
        top_institutions=_top_institutions(students, teams) if sees_outside else None,
    )


def _top_institutions(students: list, teams: list, limit: int = 10) -> list[InstitutionStats]:
    """Other colleges and schools with the most students. Spellings vary, so they are grouped by the matching key."""
    groups: dict[tuple[str, str], list] = defaultdict(list)
    for student in students:
        if student.participant_type in OUTSIDE and student.institution_key:
            groups[(student.participant_type, student.institution_key)].append(student)
    team_counts = Counter((t.participant_type, t.institution_key) for t in teams if t.status in ACTIVE)
    rows = [
        InstitutionStats(
            # The spelling most of its students used.
            institution=Counter(s.institution for s in members).most_common(1)[0][0],
            participant_type=kind,
            city=Counter(s.city for s in members).most_common(1)[0][0],
            students=len(members),
            teams=team_counts[(kind, key)],
        )
        for (kind, key), members in groups.items()
    ]
    rows.sort(key=lambda row: (-row.students, -row.teams, row.institution.lower()))
    return rows[:limit]


# ---------- Finalists ----------


def _eligible(db: Session, department: str | None = None, lock: bool = False) -> list[Team]:
    statement = select(Team).where(Team.route == "department", Team.status == "submitted").order_by(Team.number)
    if department:
        statement = statement.where(Team.department == department)
    if lock:
        # Waits for a concurrent withdrawal, then re-checks the status, so a withdrawn team is never nominated.
        statement = statement.with_for_update().execution_options(populate_existing=True)
    return list(db.scalars(statement))


def _board_access(admin: Admin, department: str) -> None:
    if department == rules.CLUB_DEPARTMENT:
        raise ApiError("COE KIET teams go straight to the Grand Finale, so they are not nominated.", 404)
    if department not in rules.NOMINATING_DEPARTMENTS:
        raise ApiError(f'Unknown department "{department}".', 404)
    if not _is_super(admin) and department != admin.department:
        raise ApiError(f"You can only nominate finalists for {admin.department}.", 403)


QUOTAS_KEY = "finalist_quotas"


def quotas(db: Session) -> dict[tuple[str, int], int]:
    """How many teams each department may nominate per category: the event document's numbers, as a super admin changed them."""
    out = {(d, c): rules.finalist_quota(d, c) for d in rules.NOMINATING_DEPARTMENTS for c in rules.CATEGORIES}
    row = db.get(AppState, QUOTAS_KEY)
    try:
        stored = json.loads(row.value) if row and row.value else {}
    except ValueError:
        logger.error("Ignoring an unreadable finalist quota row")
        stored = {}
    for department, cells in (stored if isinstance(stored, dict) else {}).items():
        for category, quota in (cells if isinstance(cells, dict) else {}).items():
            key = (rules.canonical_department(department), int(category) if str(category).isdigit() else 0)
            if key in out and isinstance(quota, int) and 0 <= quota <= 10:
                out[key] = quota
    return out


def save_quotas(db: Session, admin: Admin, data: QuotasInput, settings: Settings) -> FinalistSummaryOut:
    _require_super(admin, "change the finalist quotas")
    # Same lock as nominating and publishing.
    _lock_state(db, f"{RESULTS_KEY}_lock")
    if _results_published(db):
        raise ApiError("Results have been published, so the quotas can no longer change.", 409)
    current = quotas(db)
    eligible_ids = {t.id for t in _eligible(db)}
    nominated = Counter((n.department, n.category) for n in db.scalars(select(FinalistNomination)) if n.team_id in eligible_ids)
    changes = []
    for cell in data.quotas:
        key = (cell.department, cell.category)
        if key not in current:
            raise ApiError(f'Unknown department "{cell.department}" or category {cell.category}.', 422)
        if cell.quota < nominated[key]:
            raise ApiError(
                f"{cell.department} has already nominated {nominated[key]} teams in Category {cell.category}. "
                "Ask them to remove a nomination first, or keep the quota.",
                409,
            )
        if current[key] != cell.quota:
            changes.append(f"{cell.department} Cat {cell.category}: {current[key]} to {cell.quota}")
            current[key] = cell.quota
    if changes:
        stored: dict[str, dict[str, int]] = defaultdict(dict)
        for (department, category), quota in current.items():
            stored[department][str(category)] = quota
        state = _lock_state(db, QUOTAS_KEY)
        state.value = json.dumps(stored)
        state.updated_at = utcnow()
        audit.record(db, admin.email, "finalists.quotas_updated", detail="; ".join(changes))
    db.commit()
    return finalist_summary(db, admin, settings)


def finalist_board(db: Session, admin: Admin, department: str, settings: Settings) -> FinalistBoardOut:
    _board_access(admin, department)
    limits_ = quotas(db)
    window = schedule.load(db, settings)
    eligible = _eligible(db, department)
    eligible_ids = {t.id for t in eligible}
    nominated = [
        n for n in db.scalars(select(FinalistNomination).where(FinalistNomination.department == department)) if n.team_id in eligible_ids
    ]
    updated = db.get(AppState, f"finalists:{department}")
    published = _results_published(db)
    return FinalistBoardOut(
        department=department,
        nominations_deadline=window.nominations_deadline,
        nominations_locked=window.nominations_closed() and not _is_super(admin),
        published_at=published.updated_at if published else None,
        updated_at=updated.updated_at if updated else None,
        updated_by=updated.value if updated else None,
        categories=[
            FinalistCategoryOut(
                category=number,
                quota=limits_[(department, number)],
                teams=summaries(db, [t for t in eligible if t.category == number]),
                nominated=[n.team_id for n in nominated if n.category == number],
            )
            for number in rules.CATEGORIES
        ],
    )


def _lock_state(db: Session, key: str, default: str = "") -> AppState:
    """Creates the row if needed, then locks it. Serialises nomination edits and publishing."""
    db.execute(insert(AppState).values(key=key, value=default, updated_at=utcnow()).on_conflict_do_nothing(index_elements=["key"]))
    return db.scalar(select(AppState).where(AppState.key == key).with_for_update().execution_options(populate_existing=True))  # type: ignore[return-value]


def save_finalists(db: Session, admin: Admin, department: str, data: NominationsInput, settings: Settings) -> FinalistBoardOut:
    _board_access(admin, department)
    window = schedule.load(db, settings)
    # Same lock as publishing, so nominations cannot change while results are being published.
    _lock_state(db, f"{RESULTS_KEY}_lock")
    if _results_published(db):
        raise ApiError("Results have been published, so nominations can no longer change.", 409)
    if window.nominations_closed() and not _is_super(admin):
        raise ApiError(
            f"The nomination deadline passed on {window.nominations_deadline.astimezone(rules.IST):%d %B %Y, %I:%M %p} IST. "  # type: ignore[union-attr]
            "Ask a super admin to change the nominations.",
            403,
        )
    state = _lock_state(db, f"finalists:{department}")

    eligible = {t.id: t for t in _eligible(db, department, lock=True)}
    limits_ = quotas(db)
    seen_categories: set[int] = set()
    for entry in data.nominations:
        if entry.category not in rules.CATEGORIES:
            raise ApiError(f"Unknown category {entry.category}.", 422)
        if entry.category in seen_categories:
            raise ApiError(f"Category {entry.category} is listed twice.", 422)
        seen_categories.add(entry.category)
        team_ids = list(dict.fromkeys(entry.team_ids))
        quota = limits_[(department, entry.category)]
        if len(team_ids) > quota:
            raise ApiError(
                f"{department} can nominate at most {quota} {'team' if quota == 1 else 'teams'} in Category {entry.category}.", 422
            )
        for team_id in team_ids:
            team = eligible.get(team_id)
            if team is None or team.category != entry.category:
                raise ApiError(f"A nominated team is not a submitted {department} team in Category {entry.category}.", 422)

        db.execute(
            delete(FinalistNomination).where(FinalistNomination.department == department, FinalistNomination.category == entry.category)
        )
        for team_id in team_ids:
            db.add(FinalistNomination(team_id=team_id, department=department, category=entry.category, nominated_by=admin.email))

    state.value = admin.email
    state.updated_at = utcnow()
    audit.record(db, admin.email, "finalists.updated", detail=f"{department}: categories {sorted(seen_categories)}", department=department)
    db.commit()
    return finalist_board(db, admin, department, settings)


def finalist_summary(db: Session, admin: Admin, settings: Settings) -> FinalistSummaryOut:
    _require_super(admin, "see every department's finalists")
    limits_ = quotas(db)
    eligible = _eligible(db)
    eligible_count = Counter((t.department, t.category) for t in eligible)
    eligible_ids = {t.id for t in eligible}
    nominated_count = Counter((n.department, n.category) for n in db.scalars(select(FinalistNomination)) if n.team_id in eligible_ids)
    published = _results_published(db)
    direct = list(db.scalars(select(Team).where(Team.route == "finale", Team.status == "submitted").order_by(Team.number)))
    return FinalistSummaryOut(
        published_at=published.updated_at if published else None,
        published_by=published.value if published else None,
        nominations_deadline=schedule.load(db, settings).nominations_deadline,
        publish_blocked=None if published else publish_blocker(db, settings),
        results_publish_from=schedule.load(db, settings).results_from,
        unpublish_blocked=unpublish_blocker(db) if published else None,
        matrix=[
            MatrixRow(
                department=department,
                categories=[
                    MatrixCell(
                        category=number,
                        quota=limits_[(department, number)],
                        nominated=nominated_count[(department, number)],
                        eligible=eligible_count[(department, number)],
                    )
                    for number in rules.CATEGORIES
                ],
            )
            for department in rules.NOMINATING_DEPARTMENTS
        ],
        direct_teams=summaries(db, direct),
    )


PUBLISH_PHRASE = "PUBLISH"


def publish_blocker(db: Session, settings: Settings) -> str | None:
    """Why results cannot be published right now, or None. Publishing is one-way and locks every department's nominations."""
    window = schedule.load(db, settings)
    if not window.results_due():
        due = window.results_from.astimezone(rules.IST)  # type: ignore[union-attr]
        return (
            f"Results can be published from {due:%d %B %Y, %I:%M %p} IST (the finalists declaration date). "
            "Change the results date on the Schedule page only if the event plan has changed."
        )
    if window.nominations_deadline is not None and not window.nominations_closed():
        due = window.nominations_deadline.astimezone(rules.IST)
        return (
            f"Department admins can nominate finalists until {due:%d %B %Y, %I:%M %p} IST, so results cannot be published yet. "
            "Move or clear the nominations deadline on the Schedule page if you really need to publish earlier."
        )
    eligible_ids = {t.id for t in _eligible(db)}
    if not any(n.team_id in eligible_ids for n in db.scalars(select(FinalistNomination))):
        return "No finalists have been nominated yet, so there is nothing to publish."
    return None


def publish_results(db: Session, admin: Admin, settings: Settings, data: PublishInput) -> PublishOut:
    _require_super(admin, "publish results")
    if data.confirm.strip() != PUBLISH_PHRASE:
        raise ApiError(f"Type {PUBLISH_PHRASE} to confirm. Publishing cannot be undone from the panel.", 422)
    _lock_state(db, f"{RESULTS_KEY}_lock")
    if _results_published(db):
        raise ApiError("Results have already been published.", 409)
    if blocked := publish_blocker(db, settings):
        raise ApiError(blocked, 409)

    nominated = set(db.scalars(select(FinalistNomination.team_id)))
    finalists = not_selected = 0
    for team in db.scalars(select(Team).where(Team.route == "department", Team.status == "submitted").with_for_update()):
        if team.id in nominated:
            team.result = "finalist"
            finalists += 1
        else:
            team.result = "not_selected"
            not_selected += 1

    now = utcnow()
    db.add(AppState(key=RESULTS_KEY, value=admin.email, updated_at=now))
    audit.record(db, admin.email, "results.published", detail=f"{finalists} finalists, {not_selected} not selected")
    db.commit()
    return PublishOut(published_at=now, finalists=finalists, not_selected=not_selected)


UNPUBLISH_PHRASE = "UNPUBLISH"


def unpublish_blocker(db: Session) -> str | None:
    """Why published results can no longer be withdrawn, or None. Once the finale is being prepared, they stay."""
    from . import judging  # judging builds on this module

    if judging.round_open(db, "final"):
        return "Final-round judging is open, so the published results can no longer be withdrawn."
    if db.scalar(select(func.count()).select_from(Score).where(Score.round == "final")):
        return "Final-round scores have been recorded, so the published results can no longer be withdrawn."
    finalist_ids = select(Team.id).where(Team.route == "department", Team.result == "finalist")
    if db.scalar(select(func.count()).select_from(FinalTent).where(FinalTent.team_id.in_(finalist_ids))):
        return "Stalls have been allotted to department finalists. Clear those stalls on the Judging page first."
    if db.scalar(select(func.count()).select_from(PanelTeam).where(PanelTeam.round == "final", PanelTeam.team_id.in_(finalist_ids))):
        return "Department finalists have been allotted to finale panels. Remove them from the panels on the Judging page first."
    return None


def unpublish_results(db: Session, admin: Admin, data: UnpublishInput) -> None:
    """Withdraws published results, e.g. published by mistake: every department team's result goes back to pending
    and nominations can be changed again. Not possible once the finale is being prepared (see unpublish_blocker)."""
    _require_super(admin, "withdraw published results")
    if data.confirm.strip() != UNPUBLISH_PHRASE:
        raise ApiError(f"Type {UNPUBLISH_PHRASE} to confirm.", 422)
    _lock_state(db, f"{RESULTS_KEY}_lock")
    published = _results_published(db)
    if published is None:
        raise ApiError("Results are not published.", 409)
    if blocked := unpublish_blocker(db):
        raise ApiError(blocked, 409)
    reverted = db.execute(update(Team).where(Team.route == "department", Team.result != "pending").values(result="pending")).rowcount
    db.delete(published)
    audit.record(db, admin.email, "results.unpublished", detail=f"{reverted} team results back to pending. Reason: {data.reason}")
    db.commit()


# ---------- Admins ----------


def admin_out(admin: Admin) -> AdminOut:
    return AdminOut(
        email=admin.email,
        name=admin.name,
        role=admin.role,
        department=admin.department,
        added_at=admin.created_at,
        added_by=admin.created_by,
    )


def list_admins(db: Session, admin: Admin, settings: Settings) -> list[AdminOut]:
    _require_super(admin, "manage admins")
    stored = list(db.scalars(select(Admin).order_by(Admin.role.desc(), Admin.email)))
    known = {a.email for a in stored}
    configured = [
        AdminOut(email=email, name=email.split("@")[0], role="super_admin", department=None, added_by="server configuration")
        for email in settings.super_admin_emails
        if email not in known
    ]
    return configured + [admin_out(a) for a in stored]


def add_admin(db: Session, admin: Admin, data: AdminInput, settings: Settings) -> AdminOut:
    _require_super(admin, "manage admins")
    if db.get(Admin, data.email) or data.email in settings.super_admin_emails:
        raise ApiError("This email is already an admin.", 409)
    new = Admin(email=data.email, name=data.name, role=data.role, department=data.department, created_by=admin.email)
    db.add(new)
    audit.record(
        db,
        admin.email,
        "admin.added",
        detail=f"{data.email} ({data.role}{', ' + data.department if data.department else ''})",
        department=data.department,
    )
    try:
        db.commit()
    except IntegrityError as exc:
        # Another super admin added the same email a moment earlier.
        db.rollback()
        raise ApiError("This email is already an admin.", 409) from exc
    return admin_out(new)


def remove_admin(db: Session, admin: Admin, email: str, settings: Settings) -> None:
    _require_super(admin, "manage admins")
    email = email.strip().lower()
    if email == admin.email:
        raise ApiError("You cannot remove your own admin access.", 409)
    if email in settings.super_admin_emails:
        raise ApiError("This super admin is set in the server configuration and cannot be removed here.", 409)
    # Lock every super admin, not just the target, so two super admins removing each other cannot both succeed.
    db.execute(select(Admin.email).where(Admin.role == "super_admin").with_for_update())
    target = db.scalar(select(Admin).where(Admin.email == email).with_for_update())
    if target is None:
        raise ApiError("No admin with this email exists.", 404)
    if target.role == "super_admin" and not settings.super_admin_emails:
        others = db.scalar(select(func.count()).select_from(Admin).where(Admin.role == "super_admin", Admin.email != email))
        if not others:
            raise ApiError("At least one super admin must remain.", 409)
    db.delete(target)
    audit.record(db, admin.email, "admin.removed", detail=email, department=target.department)
    db.commit()


# ---------- Audit ----------


def _audit_scope(admin: Admin) -> ColumnElement[bool]:
    if _is_super(admin):
        return AuditEntry.id.is_not(None)
    if types := type_scope(admin):
        return AuditEntry.participant_type.in_(types)
    return AuditEntry.department == admin.department


def _audit_out(entry: AuditEntry) -> AuditOut:
    return AuditOut(
        id=str(entry.id),
        at=entry.at,
        actor_email=entry.actor_email,
        action=entry.action,
        team_id=entry.team_id,
        team_code=entry.team_code,
        department=entry.department,
        detail=entry.detail,
    )


def audit_log(db: Session, admin: Admin, team_id: uuid.UUID | None, limit: int) -> list[AuditOut]:
    statement = select(AuditEntry).where(_audit_scope(admin)).order_by(AuditEntry.at.desc(), AuditEntry.id.desc()).limit(limit)
    if team_id:
        if db.get(Team, team_id) is not None:
            _visible_team(db, admin, team_id)
        statement = statement.where(AuditEntry.team_id == team_id)
    return [_audit_out(entry) for entry in db.scalars(statement)]


ActivityKind = Literal["team", "member", "invitation", "finalists", "results", "admin", "schedule", "judging", "attendance", "student"]


class ActivityFilters(Paging):
    kind: ActivityKind | None = None
    department: str | None = None
    q: str | None = Field(default=None, max_length=100)


def activity(db: Session, admin: Admin, f: ActivityFilters) -> tuple[list[AuditOut], int]:
    """The full audit log, newest first, a page at a time."""
    check_department(admin, f.department)
    conditions = [_audit_scope(admin)]
    if f.kind:
        conditions.append(AuditEntry.action.startswith(f"{f.kind}.", autoescape=True))
    if f.department:
        conditions.append(AuditEntry.department == f.department)
    if f.q and f.q.strip():
        pattern = _escape_like(f.q.strip())
        conditions.append(
            or_(*(column.ilike(pattern, escape="\\") for column in (AuditEntry.actor_email, AuditEntry.team_code, AuditEntry.detail)))
        )
    total = db.scalar(select(func.count()).select_from(AuditEntry).where(*conditions)) or 0
    statement = (
        select(AuditEntry)
        .where(*conditions)
        .order_by(AuditEntry.at.desc(), AuditEntry.id.desc())
        .offset((f.page - 1) * f.page_size)
        .limit(f.page_size)
    )
    return [_audit_out(entry) for entry in db.scalars(statement)], total
