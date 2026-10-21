"""Turns database rows into the response shapes the frontends expect."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Invitation, Profile, Team, TeamMember, User
from ..schemas import InvitationOut, MemberOut, ProfileOut, TeamOut


def profile_out(profile: Profile, email: str) -> ProfileOut:
    return ProfileOut(
        user_id=profile.user_id,
        email=email,
        full_name=profile.full_name,
        phone=profile.phone,
        participant_type=profile.participant_type,
        institution=profile.institution,
        city=profile.city,
        department=profile.department,
        course=profile.course,
        year=profile.year,
        roll_number=profile.roll_number,
        created_at=profile.created_at,
        club=profile.club,
    )


def _leader_name(db: Session, team: Team) -> str:
    return db.scalar(select(Profile.full_name).where(Profile.user_id == team.leader_id)) or ""


def invitation_out(invitation: Invitation, team: Team, leader_name: str) -> InvitationOut:
    return InvitationOut(
        id=invitation.id,
        team_id=team.id,
        team_code=team.code,
        team_name=team.name,
        category=team.category,
        leader_name=leader_name,
        email=invitation.email,
        status=invitation.status,
        created_at=invitation.created_at,
    )


def members_out(db: Session, team_id: uuid.UUID) -> list[MemberOut]:
    rows = db.execute(
        select(TeamMember, Profile, User.email)
        .join(Profile, Profile.user_id == TeamMember.user_id)
        .join(User, User.id == TeamMember.user_id)
        .where(TeamMember.team_id == team_id)
    ).all()
    members = [
        MemberOut(
            user_id=member.user_id,
            full_name=profile.full_name,
            email=email,
            department=profile.department,
            course=profile.course,
            year=profile.year,
            role=member.role,
            joined_at=member.joined_at,
            club=profile.club,
        )
        for member, profile, email in rows
    ]
    # Leader first, then members in the order they joined.
    return sorted(members, key=lambda m: (m.role != "leader", m.joined_at))


def team_out(db: Session, team: Team) -> TeamOut:
    leader_name = _leader_name(db, team)
    pending = db.scalars(
        select(Invitation).where(Invitation.team_id == team.id, Invitation.status == "pending").order_by(Invitation.created_at)
    ).all()
    return TeamOut(
        id=team.id,
        code=team.code,
        join_code=team.join_code,
        name=team.name,
        category=team.category,
        domain=team.domain,
        project_title=team.project_title,
        abstract=team.abstract,
        participant_type=team.participant_type,
        institution=team.institution,
        department=team.department,
        route=team.route,
        leader_id=team.leader_id,
        members=members_out(db, team.id),
        invitations=[invitation_out(i, team, leader_name) for i in pending],
        status=team.status,
        result=team.result,
        created_at=team.created_at,
        submitted_at=team.submitted_at,
        approval_required=team.approval_required,
        approved_at=team.approved_at,
        rejected_at=team.rejected_at,
        rejected_reason=team.rejected_reason,
    )
