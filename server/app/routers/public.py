"""Endpoints that need no sign-in: what the public pages need to know before anyone logs in."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db import get_db
from ..models import utcnow
from ..schemas import PublicConfigOut, RegistrationOut
from ..services import schedule

router = APIRouter(tags=["public"])


@router.get("/config")
def public_config(db: Annotated[Session, Depends(get_db)], settings: Annotated[Settings, Depends(get_settings)]) -> PublicConfigOut:
    """The registration window as the server enforces it, so the site never relies on a visitor's clock."""
    window = schedule.load(db, settings)
    now = utcnow()
    return PublicConfigOut(
        # Open while anyone can still register (other colleges and schools have a later deadline); the server decides per student.
        registration=RegistrationOut(state=window.latest_state(now), opens=window.opens, closes=window.closes_for(True)),
        server_time=now,
    )
