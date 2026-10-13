"""A judge's own page: the teams of their panels and their scores. Uses admin-panel sessions."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import CurrentJuror
from ..db import get_db
from ..schemas import AttendanceSheet, JudgeOut, ScoreInput, ScoreOut
from ..services import judging

router = APIRouter(prefix="/judge", tags=["judge"])

Db = Annotated[Session, Depends(get_db)]


@router.get("")
def my_panels(juror: CurrentJuror, db: Db) -> JudgeOut:
    return judging.judge_view(db, juror)


@router.put("/panels/{panel_id}/teams/{team_id}/score")
def save_score(panel_id: uuid.UUID, team_id: uuid.UUID, data: ScoreInput, juror: CurrentJuror, db: Db) -> ScoreOut:
    return judging.save_score(db, juror, panel_id, team_id, data)


@router.get("/panels/{panel_id}/attendance")
def room_attendance(panel_id: uuid.UUID, juror: CurrentJuror, db: Db) -> AttendanceSheet:
    return judging.judge_attendance(db, juror, panel_id)
