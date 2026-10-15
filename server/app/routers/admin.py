"""Admin panel endpoints. The list matches admin-panel/lib/api/live.ts."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Response, status
from sqlalchemy.orm import Session

from ..auth import CurrentAdmin, CurrentStaff, Identity, SuperAdmin, find_admin, get_admin_identity
from ..config import Settings, get_settings
from ..db import get_db
from ..errors import ApiError
from ..models import Juror
from ..rules import JudgingRound
from ..schemas import (
    AdminInput,
    AdminOut,
    AdminScoreInput,
    AdminStudentInput,
    AdminStudentOut,
    AdminTeamInput,
    AdminTeamOut,
    AttendanceSheet,
    AuditOut,
    AuditPage,
    AwardInput,
    FinalistBoardOut,
    FinalistSummaryOut,
    JudgingOut,
    JurorInput,
    JurorOut,
    ManualAttendanceInput,
    NominationsInput,
    OpenNowInput,
    PanelInput,
    PanelJurorsInput,
    PanelOut,
    PanelTeamsInput,
    PanelUpdateInput,
    PublishInput,
    PublishOut,
    QuotasInput,
    RankingsOut,
    ReasonInput,
    RestoreInput,
    RoundOut,
    ScanInput,
    ScanOut,
    ScheduleInput,
    ScheduleOut,
    ScoreOut,
    StatsOut,
    StudentPage,
    TeamBanInput,
    TeamPage,
    TentsInput,
    TimetableInput,
    TimetableOut,
    UnpublishInput,
)
from ..services import admin as service
from ..services import attendance, judging, schedule
from ..services.admin import ActivityFilters, StudentFilters, TeamFilters

router = APIRouter(prefix="/admin", tags=["admin"])

Db = Annotated[Session, Depends(get_db)]
AppSettings = Annotated[Settings, Depends(get_settings)]


@router.get("/me")
def me(identity: Annotated[Identity, Depends(get_admin_identity)], db: Db, settings: AppSettings) -> AdminOut:
    """The signed-in organiser, or a judge (role "judge") who is not an organiser."""
    juror = db.get(Juror, identity.email)
    admin = find_admin(db, identity.email, settings)
    if admin is not None:
        return service.admin_out(admin).model_copy(update={"judge": juror is not None})
    if juror is not None:
        return AdminOut(email=juror.email, name=juror.name, role="judge", department=juror.department, judge=True)
    raise ApiError("This account is not an InnoTech26 organiser or judge.", 403)


@router.get("/stats")
def stats(admin: CurrentAdmin, db: Db, settings: AppSettings) -> StatsOut:
    return service.stats(db, admin, settings)


@router.get("/teams")
def list_teams(admin: CurrentAdmin, db: Db, filters: Annotated[TeamFilters, Query()]) -> TeamPage:
    items, total = service.list_teams(db, admin, filters)
    return TeamPage(items=items, total=total, page=filters.page, page_size=filters.page_size)


@router.get("/teams/export")
def export_teams(admin: CurrentAdmin, db: Db, filters: Annotated[TeamFilters, Query()]) -> list[AdminTeamOut]:
    return service.export_teams(db, admin, filters)


@router.post("/teams", status_code=status.HTTP_201_CREATED)
def create_team(data: AdminTeamInput, admin: CurrentAdmin, db: Db, settings: AppSettings) -> AdminTeamOut:
    """Creates a team for registered students, whether or not registration is open."""
    return service.create_team(db, admin, data, settings)


@router.post("/teams/{team_id}/reopen")
def reopen_team(team_id: uuid.UUID, data: ReasonInput, admin: CurrentAdmin, db: Db, settings: AppSettings) -> AdminTeamOut:
    """Super admin: sends a submitted team back to draft (registration must be open)."""
    return service.reopen_team(db, admin, settings, team_id, data.reason)


@router.post("/teams/{team_id}/approve")
def approve_team(team_id: uuid.UUID, admin: CurrentAdmin, db: Db) -> AdminTeamOut:
    """Super admin, startups admin or COE KIET admin: accepts a submitted startup or COE KIET entry for the Grand Finale."""
    return service.approve_team(db, admin, team_id)


@router.post("/teams/{team_id}/approval/revoke")
def revoke_approval(team_id: uuid.UUID, data: ReasonInput, admin: CurrentAdmin, db: Db) -> AdminTeamOut:
    """Takes the acceptance of a startup or COE KIET entry back (not once judging has begun for it)."""
    return service.revoke_approval(db, admin, team_id, data.reason)


@router.post("/teams/{team_id}/dissolve", status_code=status.HTTP_204_NO_CONTENT)
def dissolve_team(team_id: uuid.UUID, data: ReasonInput, admin: CurrentAdmin, db: Db) -> Response:
    """Super admin: deletes a team and frees its members."""
    service.dissolve_team(db, admin, team_id, data.reason)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/teams/{team_id}")
def get_team(team_id: uuid.UUID, admin: CurrentAdmin, db: Db) -> AdminTeamOut:
    return service.get_team(db, admin, team_id)


@router.post("/teams/{team_id}/withdraw")
def withdraw_team(team_id: uuid.UUID, data: ReasonInput, admin: CurrentAdmin, db: Db) -> AdminTeamOut:
    return service.change_status(db, admin, team_id, "withdraw", data.reason)


@router.post("/teams/{team_id}/disqualify")
def disqualify_team(team_id: uuid.UUID, data: ReasonInput, admin: CurrentAdmin, db: Db) -> AdminTeamOut:
    return service.change_status(db, admin, team_id, "disqualify", data.reason)


@router.post("/teams/{team_id}/restore")
def restore_team(team_id: uuid.UUID, data: RestoreInput, admin: CurrentAdmin, db: Db) -> AdminTeamOut:
    return service.change_status(db, admin, team_id, "restore", data.reason, unban_members=data.unban_members)


@router.post("/students", status_code=status.HTTP_201_CREATED)
def create_student(data: AdminStudentInput, admin: CurrentAdmin, db: Db) -> AdminStudentOut:
    """Registers a student for them (help desk), whether or not registration is open."""
    return service.create_student(db, admin, data)


@router.post("/students/{user_id}/ban")
def ban_student(user_id: uuid.UUID, data: ReasonInput, admin: CurrentAdmin, db: Db) -> AdminStudentOut:
    return service.ban_student(db, admin, user_id, data.reason)


@router.post("/students/{user_id}/unban")
def unban_student(user_id: uuid.UUID, data: ReasonInput, admin: CurrentAdmin, db: Db) -> AdminStudentOut:
    return service.unban_student(db, admin, user_id, data.reason)


@router.post("/students/{user_id}/delete")
def delete_student(user_id: uuid.UUID, data: ReasonInput, admin: CurrentAdmin, db: Db) -> dict[str, str]:
    """Super admin: deletes a student's profile; a team leader hands over to a random team mate, a lone leader's team goes too."""
    return {"message": service.delete_student(db, admin, user_id, data.reason)}


@router.post("/teams/{team_id}/ban")
def ban_team(team_id: uuid.UUID, data: TeamBanInput, admin: CurrentAdmin, db: Db) -> AdminTeamOut:
    return service.ban_team(db, admin, team_id, data.reason, data.ban_members)


@router.get("/students")
def list_students(admin: CurrentAdmin, db: Db, filters: Annotated[StudentFilters, Query()]) -> StudentPage:
    items, total = service.list_students(db, admin, filters)
    return StudentPage(items=items, total=total, page=filters.page, page_size=filters.page_size)


@router.get("/students/export")
def export_students(admin: CurrentAdmin, db: Db, filters: Annotated[StudentFilters, Query()]) -> list[AdminStudentOut]:
    return service.export_students(db, admin, filters)


@router.get("/finalists/summary")
def finalist_summary(admin: CurrentAdmin, db: Db, settings: AppSettings) -> FinalistSummaryOut:
    return service.finalist_summary(db, admin, settings)


@router.get("/finalists")
def finalist_board(
    admin: CurrentAdmin, db: Db, settings: AppSettings, department: Annotated[str | None, Query(max_length=20)] = None
) -> FinalistBoardOut:
    # A department admin can omit the department and gets their own board.
    return service.finalist_board(db, admin, department or admin.department or "", settings)


@router.put("/finalists/quotas")
def save_quotas(data: QuotasInput, admin: CurrentAdmin, db: Db, settings: AppSettings) -> FinalistSummaryOut:
    return service.save_quotas(db, admin, data, settings)


@router.put("/finalists/{department}")
def save_finalists(
    department: Annotated[str, Path(max_length=20)], data: NominationsInput, admin: CurrentAdmin, db: Db, settings: AppSettings
) -> FinalistBoardOut:
    return service.save_finalists(db, admin, department, data, settings)


@router.post("/results/publish")
def publish_results(data: PublishInput, admin: CurrentAdmin, db: Db, settings: AppSettings) -> PublishOut:
    return service.publish_results(db, admin, settings, data)


@router.post("/results/unpublish", status_code=status.HTTP_204_NO_CONTENT)
def unpublish_results(data: UnpublishInput, admin: CurrentAdmin, db: Db) -> Response:
    service.unpublish_results(db, admin, data)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/schedule")
def get_schedule(admin: CurrentAdmin, db: Db, settings: AppSettings) -> ScheduleOut:
    """Every admin can see the schedule; only a super admin can change it."""
    return schedule.to_out(schedule.load(db, settings), settings)


@router.put("/schedule")
def set_schedule(data: ScheduleInput, admin: SuperAdmin, db: Db, settings: AppSettings) -> ScheduleOut:
    window = schedule.update(
        db,
        settings,
        admin.email,
        opens=data.registration_opens,
        closes=data.registration_closes,
        deadline=data.nominations_deadline,
        results_from=data.results_publish_from if "results_publish_from" in data.model_fields_set else schedule.KEEP,
        extended_closes=data.registration_extended_closes if "registration_extended_closes" in data.model_fields_set else schedule.KEEP,
    )
    return schedule.to_out(window, settings)


@router.post("/schedule/open-now")
def open_registration_now(admin: SuperAdmin, db: Db, settings: AppSettings, data: OpenNowInput | None = None) -> ScheduleOut:
    closes = data.registration_closes if data else None
    return schedule.to_out(schedule.open_now(db, settings, admin.email, closes=closes), settings)


@router.post("/schedule/close-now")
def close_registration_now(admin: SuperAdmin, db: Db, settings: AppSettings) -> ScheduleOut:
    return schedule.to_out(schedule.close_now(db, settings, admin.email), settings)


@router.get("/admins")
def list_admins(admin: CurrentAdmin, db: Db, settings: AppSettings) -> list[AdminOut]:
    return service.list_admins(db, admin, settings)


@router.post("/admins", status_code=status.HTTP_201_CREATED)
def add_admin(data: AdminInput, admin: CurrentAdmin, db: Db, settings: AppSettings) -> AdminOut:
    return service.add_admin(db, admin, data, settings)


@router.delete("/admins/{email}", status_code=status.HTTP_204_NO_CONTENT)
def remove_admin(email: Annotated[str, Path(max_length=320)], admin: CurrentAdmin, db: Db, settings: AppSettings) -> Response:
    service.remove_admin(db, admin, email, settings)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/audit")
def audit_log(
    admin: CurrentAdmin,
    db: Db,
    team_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[AuditOut]:
    return service.audit_log(db, admin, team_id, limit)


@router.get("/activity")
def activity(admin: CurrentAdmin, db: Db, filters: Annotated[ActivityFilters, Query()]) -> AuditPage:
    items, total = service.activity(db, admin, filters)
    return AuditPage(items=items, total=total, page=filters.page, page_size=filters.page_size)


# ---------- Judging ----------


@router.get("/judging/timetable")
def judging_timetable(admin: CurrentAdmin, db: Db) -> TimetableOut:
    """Each department's slot for the department round and the extra scoring minutes. Every organiser can read it."""
    return judging.timetable_out(judging.timetable(db))


@router.put("/judging/timetable")
def save_judging_timetable(data: TimetableInput, admin: CurrentAdmin, db: Db) -> TimetableOut:
    return judging.save_timetable(db, admin, data)


@router.get("/judging/{round_}")
def judging_overview(round_: JudgingRound, admin: CurrentAdmin, db: Db, settings: AppSettings) -> JudgingOut:
    return judging.overview(db, admin, settings, round_)


@router.post("/judging/{round_}/open")
def open_judging(round_: JudgingRound, admin: CurrentAdmin, db: Db, settings: AppSettings) -> RoundOut:
    return judging.open_round(db, admin, settings, round_)


@router.post("/judging/{round_}/lock")
def lock_judging(round_: JudgingRound, admin: CurrentAdmin, db: Db, settings: AppSettings) -> RoundOut:
    return judging.lock_round(db, admin, settings, round_)


@router.get("/judging/{round_}/rankings")
def judging_rankings(
    round_: JudgingRound, admin: CurrentAdmin, db: Db, department: Annotated[str | None, Query(max_length=20)] = None
) -> RankingsOut:
    return judging.rankings(db, admin, round_, department)


@router.post("/judging/{round_}/awards", status_code=status.HTTP_204_NO_CONTENT)
def declare_award(round_: JudgingRound, data: AwardInput, admin: CurrentAdmin, db: Db) -> Response:
    judging.declare_award(db, admin, round_, data)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/judging/{round_}/awards/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_award(round_: JudgingRound, team_id: uuid.UUID, admin: CurrentAdmin, db: Db) -> Response:
    judging.remove_award(db, admin, round_, team_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/judging/{round_}/awards/publish", status_code=status.HTTP_204_NO_CONTENT)
def publish_awards(round_: JudgingRound, admin: CurrentAdmin, db: Db) -> Response:
    judging.publish_awards(db, admin, round_, True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/judging/{round_}/awards/withdraw", status_code=status.HTTP_204_NO_CONTENT)
def withdraw_awards(round_: JudgingRound, admin: CurrentAdmin, db: Db) -> Response:
    judging.publish_awards(db, admin, round_, False)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/judging/{round_}/attendance")
def attendance_sheet(
    round_: JudgingRound,
    admin: CurrentAdmin,
    db: Db,
    panel_id: uuid.UUID | None = None,
    department: Annotated[str | None, Query(max_length=20)] = None,
) -> AttendanceSheet:
    return judging.attendance(db, admin, round_, panel_id, department)


@router.post("/attendance/scan")
def scan_pass(data: ScanInput, staff: CurrentStaff, db: Db, settings: AppSettings) -> ScanOut:
    return attendance.scan(db, staff, settings, data)


@router.post("/attendance/mark")
def mark_present(data: ManualAttendanceInput, staff: CurrentStaff, db: Db, settings: AppSettings) -> ScanOut:
    return attendance.mark_by_hand(db, staff, settings, data)


@router.post("/attendance/unmark", status_code=status.HTTP_204_NO_CONTENT)
def unmark_present(data: ManualAttendanceInput, staff: CurrentStaff, db: Db, settings: AppSettings) -> Response:
    attendance.unmark(db, staff, settings, data)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/judging/final/tents")
def set_tents(data: TentsInput, admin: CurrentAdmin, db: Db, settings: AppSettings) -> JudgingOut:
    return judging.set_tents(db, admin, settings, data)


@router.post("/panels", status_code=status.HTTP_201_CREATED)
def create_panel(data: PanelInput, admin: CurrentAdmin, db: Db) -> PanelOut:
    return judging.create_panel(db, admin, data)


@router.patch("/panels/{panel_id}")
def update_panel(panel_id: uuid.UUID, data: PanelUpdateInput, admin: CurrentAdmin, db: Db) -> PanelOut:
    return judging.update_panel(db, admin, panel_id, data)


@router.delete("/panels/{panel_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_panel(panel_id: uuid.UUID, admin: CurrentAdmin, db: Db) -> Response:
    judging.delete_panel(db, admin, panel_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/panels/{panel_id}/teams")
def set_panel_teams(panel_id: uuid.UUID, data: PanelTeamsInput, admin: CurrentAdmin, db: Db) -> PanelOut:
    return judging.set_panel_teams(db, admin, panel_id, data)


@router.put("/panels/{panel_id}/teams/{team_id}/scores/{juror_email}")
def edit_score(
    panel_id: uuid.UUID,
    team_id: uuid.UUID,
    juror_email: Annotated[str, Path(max_length=320)],
    data: AdminScoreInput,
    admin: CurrentAdmin,
    db: Db,
) -> ScoreOut:
    return judging.edit_score(db, admin, panel_id, team_id, juror_email, data)


@router.put("/panels/{panel_id}/jurors")
def set_panel_jurors(panel_id: uuid.UUID, data: PanelJurorsInput, admin: CurrentAdmin, db: Db) -> PanelOut:
    return judging.set_panel_jurors(db, admin, panel_id, data)


@router.get("/jurors")
def list_jurors(admin: CurrentAdmin, db: Db) -> list[JurorOut]:
    return judging.list_jurors(db, admin)


@router.post("/jurors", status_code=status.HTTP_201_CREATED)
def add_juror(data: JurorInput, admin: CurrentAdmin, db: Db) -> JurorOut:
    return judging.add_juror(db, admin, data)


@router.delete("/jurors/{email}", status_code=status.HTTP_204_NO_CONTENT)
def remove_juror(email: Annotated[str, Path(max_length=320)], admin: CurrentAdmin, db: Db) -> Response:
    judging.remove_juror(db, admin, email)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
