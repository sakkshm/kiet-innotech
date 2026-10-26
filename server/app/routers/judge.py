"""A judge's own page: the teams of their panels and their scores. Uses admin-panel sessions."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from ..auth import CurrentJuror
from ..config import Settings, get_settings
from ..db import get_db
from ..schemas import AttendanceSheet, CertificatesOut, JudgeOut, JudgeScoreInput, LockOut, PresenceInput, ScoreOut, TeamPresenceOut
from ..services import attendance, certificates, judging

router = APIRouter(prefix="/judge", tags=["judge"])

Db = Annotated[Session, Depends(get_db)]
AppSettings = Annotated[Settings, Depends(get_settings)]


@router.get("")
def my_panels(juror: CurrentJuror, db: Db) -> JudgeOut:
    return judging.judge_view(db, juror)


@router.put("/panels/{panel_id}/teams/{team_id}/score")
def save_score(panel_id: uuid.UUID, team_id: uuid.UUID, data: JudgeScoreInput, juror: CurrentJuror, db: Db) -> ScoreOut:
    return judging.save_score(db, juror, panel_id, team_id, data)


@router.post("/panels/{panel_id}/lock")
def lock_scores(panel_id: uuid.UUID, juror: CurrentJuror, db: Db) -> LockOut:
    return judging.lock_scores(db, juror, panel_id)


@router.put("/panels/{panel_id}/teams/{team_id}/attendance/{user_id}")
def set_student_presence(
    panel_id: uuid.UUID, team_id: uuid.UUID, user_id: uuid.UUID, data: PresenceInput, juror: CurrentJuror, db: Db
) -> TeamPresenceOut:
    """Marks a student of one of the room's teams present or absent, during the room's time."""
    return attendance.set_presence_as_judge(db, juror, panel_id, team_id, user_id, data)


@router.get("/panels/{panel_id}/attendance")
def room_attendance(panel_id: uuid.UUID, juror: CurrentJuror, db: Db, settings: AppSettings) -> AttendanceSheet:
    attendance.require_enabled(settings)
    return judging.judge_attendance(db, juror, panel_id)


@router.get("/certificates")
def my_certificates(juror: CurrentJuror, db: Db) -> CertificatesOut:
    return CertificatesOut(certificates=certificates.get_judge_certificates(db, juror))


@router.get("/certificates/{cert_type}.pdf")
def my_certificate_pdf(cert_type: str, juror: CurrentJuror, db: Db) -> Response:
    data = certificates.judge_certificate_data(db, juror, cert_type)
    pdf = certificates.render_certificate(db, cert_type, data)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{cert_type}.pdf"'},
    )
