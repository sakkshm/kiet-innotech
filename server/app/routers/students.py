"""Student portal endpoints. The list matches client/lib/api/live.ts."""

import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import emails
from ..auth import CurrentUser
from ..config import Settings, get_settings
from ..db import get_db
from ..models import Profile
from ..schemas import (
    CertificatesOut,
    InvitationOut,
    InviteInput,
    JoinInput,
    MeOut,
    PassOut,
    ProfileInput,
    ProfileOut,
    ResultsOut,
    TeamInput,
    TeamOut,
)
from ..services import attendance, certificates, results, schedule, students
from ..services.serializers import invitation_out, profile_out, team_out

router = APIRouter(tags=["students"])

Db = Annotated[Session, Depends(get_db)]
AppSettings = Annotated[Settings, Depends(get_settings)]


def no_content() -> Response:
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me")
def get_me(user: CurrentUser, db: Db, settings: AppSettings) -> MeOut:
    profile = db.get(Profile, user.id)
    window = schedule.load(db, settings)
    registration = schedule.registration_for(window, students.window_subject(db, user, profile), email=user.email)
    return MeOut(email=user.email, name=user.name, profile=profile_out(profile, user.email) if profile else None, registration=registration)


@router.get("/me/pass")
def get_my_pass(user: CurrentUser, db: Db, settings: AppSettings) -> PassOut:
    """The event pass: a seed the portal turns into a QR code that changes every minute, and where to go."""
    return attendance.my_pass(db, user, settings)


@router.get("/me/results")
def get_my_results(user: CurrentUser, db: Db) -> ResultsOut:
    """The team's results, once the organisers have announced them."""
    return results.my_results(db, user)


@router.put("/me/profile")
def save_profile(data: ProfileInput, user: CurrentUser, db: Db, settings: AppSettings) -> ProfileOut:
    return profile_out(students.save_profile(db, user, data, settings), user.email)


@router.get("/me/team")
def get_my_team(user: CurrentUser, db: Db) -> TeamOut | None:
    team = students.my_team(db, user)
    return team_out(db, team) if team else None


@router.get("/me/invitations")
def get_my_invitations(user: CurrentUser, db: Db) -> list[InvitationOut]:
    result = []
    for invitation, team in students.my_invitations(db, user):
        leader_name = db.scalar(select(Profile.full_name).where(Profile.user_id == team.leader_id)) or ""
        result.append(invitation_out(invitation, team, leader_name))
    return result


@router.post("/teams", status_code=status.HTTP_201_CREATED)
def create_team(data: TeamInput, user: CurrentUser, db: Db, settings: AppSettings) -> TeamOut:
    return team_out(db, students.create_team(db, user, data, settings))


@router.post("/teams/join")
def join_team(data: JoinInput, user: CurrentUser, db: Db, settings: AppSettings) -> TeamOut:
    return team_out(db, students.join_with_code(db, user, data.code, settings))


@router.post("/teams/{team_id}/join-code/reset")
def reset_join_code(team_id: uuid.UUID, user: CurrentUser, db: Db, settings: AppSettings) -> TeamOut:
    return team_out(db, students.reset_join_code(db, user, team_id, settings))


@router.patch("/teams/{team_id}")
def update_team(team_id: uuid.UUID, data: TeamInput, user: CurrentUser, db: Db, settings: AppSettings) -> TeamOut:
    return team_out(db, students.update_team(db, user, team_id, data, settings))


@router.delete("/teams/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_team(team_id: uuid.UUID, user: CurrentUser, db: Db, settings: AppSettings) -> Response:
    students.delete_team(db, user, team_id, settings)
    return no_content()


@router.post("/teams/{team_id}/submit")
def submit_team(team_id: uuid.UUID, user: CurrentUser, db: Db, settings: AppSettings, background: BackgroundTasks) -> TeamOut:
    team, notices = students.submit_team(db, user, team_id, settings)
    for notice in notices:
        background.add_task(emails.send, notice, settings)
    return team_out(db, team)


@router.post("/teams/{team_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
def leave_team(team_id: uuid.UUID, user: CurrentUser, db: Db, settings: AppSettings) -> Response:
    students.leave_team(db, user, team_id, settings)
    return no_content()


@router.delete("/teams/{team_id}/members/{member_id}")
def remove_member(team_id: uuid.UUID, member_id: uuid.UUID, user: CurrentUser, db: Db, settings: AppSettings) -> TeamOut:
    return team_out(db, students.remove_member(db, user, team_id, member_id, settings))


@router.post("/teams/{team_id}/invitations", status_code=status.HTTP_201_CREATED)
def invite(team_id: uuid.UUID, data: InviteInput, user: CurrentUser, db: Db, settings: AppSettings, background: BackgroundTasks) -> TeamOut:
    team, notice = students.invite(db, user, team_id, str(data.email), settings)
    background.add_task(emails.send, notice, settings)
    return team_out(db, team)


@router.delete("/invitations/{invitation_id}")
def cancel_invitation(invitation_id: uuid.UUID, user: CurrentUser, db: Db) -> TeamOut:
    return team_out(db, students.cancel_invitation(db, user, invitation_id))


@router.post("/invitations/{invitation_id}/accept", status_code=status.HTTP_204_NO_CONTENT)
def accept_invitation(invitation_id: uuid.UUID, user: CurrentUser, db: Db, settings: AppSettings) -> Response:
    students.respond(db, user, invitation_id, True, settings)
    return no_content()


@router.post("/invitations/{invitation_id}/decline", status_code=status.HTTP_204_NO_CONTENT)
def decline_invitation(invitation_id: uuid.UUID, user: CurrentUser, db: Db, settings: AppSettings) -> Response:
    students.respond(db, user, invitation_id, False, settings)
    return no_content()


# ---------- Certificates ----------


@router.get("/me/certificates")
def my_certificates(user: CurrentUser, db: Db) -> CertificatesOut:
    return CertificatesOut(certificates=certificates.get_student_certificates(db, user))


@router.get("/me/certificates/{cert_type}.pdf")
def my_certificate_pdf(cert_type: str, user: CurrentUser, db: Db) -> Response:
    data = certificates.student_certificate_data(db, user, cert_type)
    pdf = certificates.render_certificate(db, cert_type, data)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{cert_type}.pdf"'},
    )
