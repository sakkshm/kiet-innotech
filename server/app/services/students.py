"""
Everything a student can do: profile, team, invitations.

Every change to a team first locks the team row (SELECT ... FOR UPDATE), so concurrent requests on the
same team run one after another and the size and eligibility checks see current data. Unique
constraints back up the rules that span teams (one team per student, unique team names).
"""

import uuid
from datetime import timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import emails, rules
from ..config import Settings
from ..db import violated_constraint
from ..errors import ApiError
from ..models import Invitation, Profile, Team, TeamMember, User, utcnow
from ..schemas import ProfileInput, TeamInput
from . import audit, limits, schedule

# ---------- Shared checks ----------


def window_subject(db: Session, user: User, profile: Profile | None = None):
    """Whose registration window applies to this student: their team's (colleges and schools close later), else their profile's."""
    membership = db.scalar(select(TeamMember).where(TeamMember.user_id == user.id))
    if membership is not None:
        return db.get(Team, membership.team_id)
    return profile if profile is not None else db.get(Profile, user.id)


def require_open(db: Session, settings: Settings, user: User | None = None, *, subject=None) -> None:
    """
    Registration is a window an organiser can move, so it is read from the database on every change. It applies to
    `subject` (a profile or team) or, by default, to the user's team or profile.
    """
    current = schedule.load(db, settings)
    if subject is None and user is not None:
        subject = window_subject(db, user)
    extended = schedule.is_extended(subject) and current.extended_closes is not None
    state = current.registration_state(extended=extended)
    if state == "upcoming":
        raise ApiError(f"Registration opens on {schedule.day(current.opens)}.", 403)
    if state == "closed":
        closed_on = schedule.day(current.closes_for(extended))
        if current.extended_closes and current.extended_closes > current.closes and not extended:
            raise ApiError(
                f"Registration closed on {schedule.day(current.closes)}. Teams can no longer be changed. "
                f"Other colleges and schools can register until {schedule.day(current.extended_closes)}.",
                403,
            )
        raise ApiError(f"Registration closed on {closed_on}. Teams can no longer be changed.", 403)


def _locked(statement):
    """FOR UPDATE, re-reading the row even if this session already loaded it."""
    return statement.with_for_update().execution_options(populate_existing=True)


def require_profile(db: Session, user: User, lock: bool = False) -> Profile:
    statement = select(Profile).where(Profile.user_id == user.id)
    profile = db.scalar(_locked(statement) if lock else statement)
    if profile is None:
        raise ApiError("Complete your profile first.", 403)
    return profile


def _membership(db: Session, user_id: uuid.UUID) -> TeamMember | None:
    return db.scalar(select(TeamMember).where(TeamMember.user_id == user_id))


def _lock_team(db: Session, team_id: uuid.UUID) -> Team:
    team = db.scalar(_locked(select(Team).where(Team.id == team_id)))
    if team is None:
        raise ApiError("Team not found.", 404)
    return team


def _lock_own_team(db: Session, user: User, team_id: uuid.UUID, *, leader: bool) -> Team:
    team = _lock_team(db, team_id)
    membership = _membership(db, user.id)
    # Someone else's team looks the same as a missing one.
    if membership is None or membership.team_id != team.id:
        raise ApiError("Team not found.", 404)
    if leader and team.leader_id != user.id:
        raise ApiError("Only the team leader can do this.", 403)
    return team


LOCKED_MESSAGES = {
    "submitted": "This team has been submitted and is locked.",
    "withdrawn": "This team has been withdrawn. You can leave it and then join or create another team.",
    "disqualified": "This team has been disqualified. If you have questions, write to innotech@kiet.edu.",
}


def _require_draft(team: Team) -> None:
    if team.status != "draft":
        raise ApiError(LOCKED_MESSAGES[team.status], 409)


def _member_years(db: Session, team_id: uuid.UUID) -> list[int]:
    return list(
        db.scalars(select(Profile.year).join(TeamMember, TeamMember.user_id == Profile.user_id).where(TeamMember.team_id == team_id))
    )


def _pending_count(db: Session, team_id: uuid.UUID) -> int:
    return db.scalar(select(func.count()).where(Invitation.team_id == team_id, Invitation.status == "pending")) or 0


def _member_count(db: Session, team_id: uuid.UUID) -> int:
    return db.scalar(select(func.count()).where(TeamMember.team_id == team_id)) or 0


STARTUP_SOLO = "A startup registers as a single entry, so it has no teammates."


def _max_size(team: Team) -> int:
    return rules.team_size_limits(team.participant_type)[1]


def _same_institution(team: Team, profile: Profile) -> bool:
    if team.participant_type != profile.participant_type:
        return False
    return team.participant_type == "kiet" or team.institution_key == profile.institution_key


def _decline_pending_invitations(db: Session, email: str) -> None:
    db.execute(
        update(Invitation).where(Invitation.email == email, Invitation.status == "pending").values(status="declined", responded_at=utcnow())
    )


def _commit(db: Session, messages: dict[str, tuple[str, int]]) -> None:
    """Commits, turning a known constraint violation into a message for the student."""
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        constraint = violated_constraint(exc)
        for name, (message, status) in messages.items():
            if name in constraint:
                raise ApiError(message, status) from exc
        raise


ALREADY_IN_TEAM = ("uq_team_members_user_id", ("You are already part of a team.", 409))
NAME_TAKEN = ("uq_teams_name_key", ("Another team already uses this name.", 409))
# Two random codes colliding is astronomically unlikely, but it is a message rather than an error page.
CODE_TAKEN = ("uq_teams_join_code", ("Please try again.", 409))


# ---------- Profile ----------


def save_profile(db: Session, user: User, data: ProfileInput, settings: Settings) -> Profile:
    if data.participant_type not in rules.allowed_participant_types(user.email):
        raise ApiError(
            "Accounts with a @kiet.edu email register as KIET students."
            if rules.is_kiet_email(user.email)
            else "KIET students must sign in with their official @kiet.edu email.",
            422,
        )

    # Lock the account first: a first save has no profile row to lock yet, and a double click would otherwise race.
    db.scalar(_locked(select(User.id).where(User.id == user.id)))
    profile = db.scalar(_locked(select(Profile).where(Profile.user_id == user.id)))
    institution_key = rules.institution_key(data.participant_type, data.institution, data.city)

    if profile is None:
        require_open(db, settings, subject=data)
        profile = Profile(user_id=user.id)
        db.add(profile)
    else:
        if schedule.is_extended(data) and not schedule.is_extended(profile):
            # Changing to a participant type with a later deadline must not be a way round the earlier one.
            require_open(db, settings, subject=profile)
        if _membership(db, user.id) is not None:
            locked_changed = (
                profile.participant_type != data.participant_type
                or profile.institution_key != institution_key
                or profile.department != data.department
                or profile.year != data.year
            )
            if locked_changed:
                raise ApiError("You are in a team, so your college or school, department and year can no longer be changed.", 409)

    profile.full_name = data.full_name
    profile.phone = data.phone
    profile.participant_type = data.participant_type
    profile.institution = data.institution
    profile.institution_key = institution_key
    profile.city = data.city
    profile.department = data.department
    profile.course = data.course
    profile.year = data.year
    profile.roll_number = data.roll_number
    profile.club = data.club
    _commit(
        db,
        dict(
            [("uq_profiles_kiet_roll_number", ("This roll number is already registered. If it is yours, write to innotech@kiet.edu.", 409))]
        ),
    )
    return profile


# ---------- Team ----------


def my_team(db: Session, user: User) -> Team | None:
    require_profile(db, user)
    membership = _membership(db, user.id)
    return db.get(Team, membership.team_id) if membership else None


def create_team(db: Session, user: User, data: TeamInput, settings: Settings) -> Team:
    require_open(db, settings, user)
    # Locking the profile keeps it from changing while the team is built from it.
    leader = require_profile(db, user, lock=True)
    if _membership(db, user.id) is not None:
        raise ApiError("You are already part of a team.", 409)
    if error := rules.category_error(data.category, leader.participant_type, [leader.year]):
        raise ApiError(error, 422)

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
        route=rules.route_for(leader.participant_type, leader.department),
        approval_required=rules.needs_approval(leader.participant_type, leader.department),
        leader_id=user.id,
    )
    db.add(team)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        if NAME_TAKEN[0] in violated_constraint(exc):
            raise ApiError(*NAME_TAKEN[1]) from exc
        raise
    db.add(TeamMember(team_id=team.id, user_id=user.id, role="leader"))
    # One team per student: invitations to other teams can no longer be accepted, so free those teams' slots.
    _decline_pending_invitations(db, user.email)
    audit.record(db, user.email, "team.created", team, f"{team.name}, category {team.category}")
    _commit(db, dict([ALREADY_IN_TEAM, NAME_TAKEN, CODE_TAKEN]))
    return team


def update_team(db: Session, user: User, team_id: uuid.UUID, data: TeamInput, settings: Settings) -> Team:
    require_open(db, settings, user)
    team = _lock_own_team(db, user, team_id, leader=True)
    _require_draft(team)
    if error := rules.category_error(data.category, team.participant_type, _member_years(db, team.id)):
        raise ApiError(error, 422)

    team.name = data.name
    team.name_key = rules.normalise_team_name(data.name)
    team.category = data.category
    team.domain = data.domain
    team.project_title = data.project_title
    team.abstract = data.abstract
    audit.record(db, user.email, "team.updated", team, f"{team.name}, category {team.category}")
    _commit(db, dict([NAME_TAKEN]))
    return team


def delete_team(db: Session, user: User, team_id: uuid.UUID, settings: Settings) -> None:
    require_open(db, settings, user)
    team = _lock_own_team(db, user, team_id, leader=True)
    _require_draft(team)
    audit.record(db, user.email, "team.deleted", team, team.name)
    db.delete(team)
    db.commit()


def submission_problem(db: Session, team: Team) -> str | None:
    size = _member_count(db, team.id)
    low, high = rules.team_size_limits(team.participant_type)
    if not low <= size <= high:
        return "a startup entry has exactly one member" if high == 1 else f"a team needs {low} to {high} members"
    if _pending_count(db, team.id) > 0:
        return "cancel or wait for pending invitations first"
    if error := rules.category_error(team.category, team.participant_type, _member_years(db, team.id)):
        return error.rstrip(".").lower()
    if not team.project_title.strip() or not team.abstract.strip():
        return "fill in the project title and abstract"
    return None


def submit_team(db: Session, user: User, team_id: uuid.UUID, settings: Settings) -> tuple[Team, list[emails.Email]]:
    require_open(db, settings, user)
    team = _lock_own_team(db, user, team_id, leader=True)
    _require_draft(team)
    if problem := submission_problem(db, team):
        raise ApiError(f"Cannot submit yet: {problem}.", 422)

    team.status = "submitted"
    team.submitted_at = utcnow()
    audit.record(db, user.email, "team.submitted", team, team.name)
    db.commit()

    member_emails = db.scalars(select(User.email).join(TeamMember, TeamMember.user_id == User.id).where(TeamMember.team_id == team.id))
    return team, [emails.team_submitted(email, team.name, team.code, settings) for email in member_emails]


def leave_team(db: Session, user: User, team_id: uuid.UUID, settings: Settings) -> None:
    require_open(db, settings, user)
    team = _lock_own_team(db, user, team_id, leader=False)
    # A withdrawn team is out of the competition; anyone in it, leader included, may leave to join another team.
    if team.status != "withdrawn":
        if team.leader_id == user.id:
            raise ApiError("The leader cannot leave. Delete the team instead.", 409)
        _require_draft(team)
    db.execute(delete(TeamMember).where(TeamMember.user_id == user.id))
    audit.record(db, user.email, "member.left", team)
    db.commit()


def remove_member(db: Session, user: User, team_id: uuid.UUID, member_id: uuid.UUID, settings: Settings) -> Team:
    require_open(db, settings, user)
    team = _lock_own_team(db, user, team_id, leader=True)
    _require_draft(team)
    if member_id == user.id:
        raise ApiError("You cannot remove yourself. Delete the team instead.", 409)
    membership = db.scalar(select(TeamMember).where(TeamMember.team_id == team.id, TeamMember.user_id == member_id))
    if membership is None:
        raise ApiError("This student is not in your team.", 404)
    removed_email = db.scalar(select(User.email).where(User.id == member_id)) or ""
    db.delete(membership)
    audit.record(db, user.email, "member.removed", team, removed_email)
    db.commit()
    return team


# ---------- Invitations ----------


def invite(db: Session, user: User, team_id: uuid.UUID, email: str, settings: Settings) -> tuple[Team, emails.Email]:
    require_open(db, settings, user)
    team = _lock_own_team(db, user, team_id, leader=True)
    _require_draft(team)
    email = email.strip().lower()
    if email == user.email:
        raise ApiError("You are already in this team.", 409)
    if team.participant_type == "startup":
        raise ApiError(STARTUP_SOLO, 422)

    if _member_count(db, team.id) + _pending_count(db, team.id) >= rules.TEAM_MAX_SIZE:
        raise ApiError(f"A team can have at most {rules.TEAM_MAX_SIZE} members, including pending invitations.", 422)

    since = utcnow() - timedelta(days=1)
    sent_today = db.scalar(select(func.count()).where(Invitation.team_id == team.id, Invitation.created_at >= since)) or 0
    if sent_today >= settings.invitations_per_team_per_day:
        raise ApiError("Your team has sent too many invitations today. Please try again tomorrow.", 429)

    row = db.execute(select(User, Profile).join(Profile, Profile.user_id == User.id).where(User.email == email)).first()
    if row is None:
        raise ApiError("No registered student uses this email. Ask them to sign in and complete their profile first.", 422)
    invitee, invitee_profile = row
    if invitee.banned_at is not None:
        raise ApiError("This student cannot take part in InnoTech26.", 422)

    invitee_membership = _membership(db, invitee.id)
    if invitee_membership is not None:
        if invitee_membership.team_id == team.id:
            raise ApiError("This student is already in your team.", 409)
        raise ApiError("This student is already part of another team.", 409)
    already_invited = db.scalar(
        select(Invitation.id).where(Invitation.team_id == team.id, Invitation.email == email, Invitation.status == "pending")
    )
    if already_invited:
        raise ApiError("This student has already been invited.", 409)
    if not _same_institution(team, invitee_profile):
        raise ApiError("All members must be from the same college or school as the team leader.", 422)
    if error := rules.category_error(team.category, team.participant_type, [*_member_years(db, team.id), invitee_profile.year]):
        raise ApiError(error, 422)

    db.add(Invitation(team_id=team.id, email=email, invited_by=user.id))
    audit.record(db, user.email, "invitation.sent", team, email)
    _commit(db, {"uq_invitations_pending": ("This student has already been invited.", 409)})

    leader_name = db.scalar(select(Profile.full_name).where(Profile.user_id == user.id)) or user.name
    return team, emails.invitation(email, team.name, team.code, leader_name, settings)


def cancel_invitation(db: Session, user: User, invitation_id: uuid.UUID) -> Team:
    invitation = db.get(Invitation, invitation_id)
    if invitation is None:
        raise ApiError("Invitation not found.", 404)
    team = _lock_own_team(db, user, invitation.team_id, leader=True)
    db.refresh(invitation)
    if invitation.status != "pending":
        raise ApiError("This invitation has already been answered.", 409)
    invitation.status = "cancelled"
    invitation.responded_at = utcnow()
    audit.record(db, user.email, "invitation.cancelled", team, invitation.email)
    db.commit()
    return team


def my_invitations(db: Session, user: User) -> list[tuple[Invitation, Team]]:
    require_profile(db, user)
    rows = db.execute(
        select(Invitation, Team)
        .join(Team, Team.id == Invitation.team_id)
        .where(Invitation.email == user.email, Invitation.status == "pending", Team.status == "draft")
        .order_by(Invitation.created_at)
    ).all()
    return [(invitation, team) for invitation, team in rows]


def respond(db: Session, user: User, invitation_id: uuid.UUID, accept: bool, settings: Settings) -> None:
    profile = require_profile(db, user)
    invitation = db.scalar(
        select(Invitation).where(Invitation.id == invitation_id, Invitation.email == user.email, Invitation.status == "pending")
    )
    if invitation is None:
        raise ApiError("This invitation is no longer available.", 404)

    if not accept:
        invitation.status = "declined"
        invitation.responded_at = utcnow()
        audit.record(db, user.email, "invitation.declined", db.get(Team, invitation.team_id))
        db.commit()
        return

    require_open(db, settings, subject=db.get(Team, invitation.team_id))
    # Lock the team, then the profile. No other path locks a profile and then a team, so this cannot deadlock.
    team = _lock_team(db, invitation.team_id)
    profile = require_profile(db, user, lock=True)
    db.refresh(invitation)
    if invitation.status != "pending":
        raise ApiError("This invitation is no longer available.", 404)
    if _membership(db, user.id) is not None:
        raise ApiError("You are already part of a team.", 409)
    if team.status != "draft":
        raise ApiError("This team is no longer accepting members.", 409)
    if _member_count(db, team.id) >= _max_size(team):
        raise ApiError("This team is already full.", 409)
    if not _same_institution(team, profile):
        raise ApiError("You are not from the same college or school as this team.", 422)
    if error := rules.category_error(team.category, team.participant_type, [*_member_years(db, team.id), profile.year]):
        raise ApiError(error, 422)

    db.add(TeamMember(team_id=team.id, user_id=user.id, role="member"))
    invitation.status = "accepted"
    invitation.responded_at = utcnow()
    db.flush()  # write "accepted" first, so the bulk decline below cannot touch this invitation
    # One team per student: every other pending invitation is declined.
    _decline_pending_invitations(db, user.email)
    audit.record(db, user.email, "member.joined", team)
    _commit(db, dict([ALREADY_IN_TEAM]))


# ---------- Joining with a team code ----------


def join_with_code(db: Session, user: User, code: str, settings: Settings) -> Team:
    """Joins the team whose leader shared this code, under the same rules as accepting an invitation."""
    # 32^8 codes cannot be enumerated at this rate, and a real student needs only a couple of tries.
    limits.hit(f"join:{user.id}", 10, timedelta(minutes=15), "Too many attempts. Check the code with your leader and try again later.")
    join_code = rules.normalise_join_code(code)
    if join_code is None:
        raise ApiError("Enter the 8-character team code your leader shared, e.g. K7PQ-3XM9.", 422)
    team_id = db.scalar(select(Team.id).where(Team.join_code == join_code))
    if team_id is None:
        raise ApiError("No team uses this code. Check it with your team leader.", 404)
    require_open(db, settings, subject=db.get(Team, team_id))

    # Same lock order as accepting an invitation: team, then profile.
    team = _lock_team(db, team_id)
    if team.join_code != join_code:
        # The leader reset the code while this request was waiting for the lock.
        raise ApiError("No team uses this code. Check it with your team leader.", 404)
    profile = require_profile(db, user, lock=True)
    membership = _membership(db, user.id)
    if membership is not None:
        raise ApiError("You are already in this team." if membership.team_id == team.id else "You are already part of a team.", 409)
    if team.status != "draft":
        raise ApiError("This team is no longer accepting members.", 409)

    own_invitation = db.scalar(
        select(Invitation).where(Invitation.team_id == team.id, Invitation.email == user.email, Invitation.status == "pending")
    )
    # Pending invitations hold places in the team, except the one this student is using now.
    taken = _member_count(db, team.id) + _pending_count(db, team.id) - (1 if own_invitation else 0)
    if taken >= _max_size(team):
        raise ApiError(
            "This startup entry cannot take members." if team.participant_type == "startup" else "This team is already full.", 409
        )
    if not _same_institution(team, profile):
        raise ApiError("This team is from another college or school. All members must be from the same college or school.", 422)
    if error := rules.category_error(team.category, team.participant_type, [*_member_years(db, team.id), profile.year]):
        raise ApiError(error, 422)

    db.add(TeamMember(team_id=team.id, user_id=user.id, role="member"))
    if own_invitation:
        own_invitation.status = "accepted"
        own_invitation.responded_at = utcnow()
    db.flush()
    _decline_pending_invitations(db, user.email)
    audit.record(db, user.email, "member.joined", team, "Joined with the team code.")
    _commit(db, dict([ALREADY_IN_TEAM]))
    return team


def reset_join_code(db: Session, user: User, team_id: uuid.UUID, settings: Settings) -> Team:
    """A new code for the team; the old one stops working, e.g. after it was shared too widely."""
    require_open(db, settings, user)
    team = _lock_own_team(db, user, team_id, leader=True)
    _require_draft(team)
    team.join_code = rules.new_join_code()
    audit.record(db, user.email, "team.code_reset", team)
    _commit(db, dict([CODE_TAKEN]))
    return team
