"""Request and response bodies. JSON is snake_case; the frontends convert to camelCase."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, EmailStr, Field, TypeAdapter, ValidationError, field_validator, model_validator

from . import rules


class Input(BaseModel):
    """Base for request bodies: unknown fields are rejected and strings are trimmed."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator("*", mode="after")
    @classmethod
    def no_nul_characters(cls, value: object) -> object:
        # PostgreSQL cannot store NUL in text; reject it here instead of failing at the database.
        if isinstance(value, str) and "\x00" in value:
            raise ValueError("Text cannot contain NUL characters.")
        return value


# ---------- Students ----------


class ProfileInput(Input):
    full_name: str = Field(max_length=120)
    phone: str = Field(max_length=20)
    participant_type: rules.ParticipantType
    institution: str = Field(default="", max_length=200)
    city: str = Field(default="", max_length=100)
    department: str | None = Field(default=None, max_length=20)
    course: str = Field(default="", max_length=40)
    year: int
    roll_number: str = Field(default="", max_length=40)
    # COE KIET / technical clubs: the club's name.
    club: str = Field(default="", max_length=80)

    @field_validator("department", mode="before")
    @classmethod
    def legacy_department(cls, value):
        return rules.canonical_department(value)

    @field_validator("full_name")
    @classmethod
    def check_name(cls, value: str) -> str:
        if len(value) < 3:
            raise ValueError("Enter your full name.")
        return " ".join(value.split())

    @field_validator("phone")
    @classmethod
    def check_phone(cls, value: str) -> str:
        if not rules.is_valid_phone(value):
            raise ValueError("Enter a 10-digit Indian mobile number.")
        return rules.normalise_phone(value)

    @model_validator(mode="after")
    def check_by_type(self) -> "ProfileInput":
        if self.participant_type == "startup":
            # Just the startup's name, the founder's name and phone; none of the college or school details apply.
            self.institution = rules.normalise_club_name(self.institution)
            if len(self.institution) < 2:
                raise ValueError("Enter the name of your startup.")
            if not rules.normalise_institution(self.institution):
                raise ValueError("Enter the name of your startup in English letters.")
            self.city, self.department, self.club, self.roll_number = "", None, "", ""
            self.course, self.year = rules.STARTUP_COURSE, 0
            return self
        if self.participant_type == "kiet":
            if self.department not in rules.DEPARTMENTS:
                raise ValueError("Choose your department.")
            if self.course not in rules.KIET_COURSES:
                raise ValueError("Choose your course.")
            if self.year not in rules.COLLEGE_YEARS:
                raise ValueError("Choose your year of study.")
            # Any format (MCA and MBA numbers differ from B.Tech ones); still required and unique.
            self.roll_number = rules.normalise_roll_number(self.roll_number)
            if not self.roll_number:
                raise ValueError("Enter your university roll number.")
            self.institution, self.city = rules.KIET_INSTITUTION, rules.KIET_CITY
            self.club = rules.normalise_club_name(self.club)
            if self.department == rules.CLUB_DEPARTMENT:
                low, high = rules.CLUB_NAME_LENGTH
                if not low <= len(self.club) <= high:
                    raise ValueError("Enter the name of your technical club.")
            else:
                self.club = ""
            return self

        label = "school" if self.participant_type == "school" else "college"
        if len(self.institution) < 3:
            raise ValueError(f"Enter the full name of your {label}.")
        if not rules.normalise_institution(self.institution):
            # Teams are matched on this name, so it needs letters or digits we can compare.
            raise ValueError(f"Enter the name of your {label} in English letters.")
        if len(self.city) < 2:
            raise ValueError("Enter the city.")
        self.department, self.club = None, ""
        if self.participant_type == "college":
            if self.course not in rules.COLLEGE_COURSES:
                raise ValueError("Choose your course.")
            if self.year not in rules.COLLEGE_YEARS:
                raise ValueError("Choose your year of study.")
            if len(self.roll_number) < 3:
                raise ValueError("Enter your college enrolment or roll number.")
        else:
            if self.year not in rules.SCHOOL_CLASSES:
                raise ValueError("Choose your class.")
            self.course = "School"
        return self


class ProfileOut(BaseModel):
    user_id: uuid.UUID
    email: str
    full_name: str
    phone: str
    participant_type: str
    institution: str
    city: str
    department: str | None
    course: str
    year: int
    roll_number: str
    created_at: datetime
    club: str = ""


class RegistrationOut(BaseModel):
    """The registration window as the server enforces it; the portal follows this, not the device clock."""

    state: rules.RegistrationState
    opens: datetime
    closes: datetime
    # True when `closes` is the later deadline of startups and COE KIET entries rather than the general one.
    extended: bool = False


class PublicConfigOut(BaseModel):
    """What the public pages need before anyone signs in: the registration window, from the server's clock."""

    registration: RegistrationOut
    server_time: datetime


class ScheduleDatesOut(BaseModel):
    registration_opens: datetime
    registration_closes: datetime
    registration_extended_closes: datetime | None = None
    nominations_deadline: datetime | None
    results_publish_from: datetime | None = None


class ScheduleOut(BaseModel):
    """The event schedule an organiser can change (see services/schedule.py)."""

    registration: RegistrationOut
    # Startups and COE KIET entries can register until this (later than `registration.closes`); None = no extension.
    extended_closes: datetime | None = None
    nominations_deadline: datetime | None
    # False once the deadline has passed: department admins can no longer change nominations, super admins still can.
    nominations_open: bool
    # Results cannot be published before this; None = no restriction.
    results_publish_from: datetime | None = None
    # True once that moment has passed (or there is none).
    results_due: bool = True
    # True once an organiser saved a change; False while the planned dates from the settings apply.
    customised: bool
    updated_by: str | None
    updated_at: datetime | None
    server_time: datetime
    planned: ScheduleDatesOut


class ScheduleInput(Input):
    registration_opens: AwareDatetime
    registration_closes: AwareDatetime
    nominations_deadline: AwareDatetime | None = None
    # Leave it out to keep the current extended deadline for startups and COE KIET; null removes the extension.
    registration_extended_closes: AwareDatetime | None = None
    # Leave it out to keep the current results date; null removes the restriction.
    results_publish_from: AwareDatetime | None = None


class OpenNowInput(Input):
    # Needed only when the old closing date has already passed.
    registration_closes: AwareDatetime | None = None


class MeOut(BaseModel):
    email: str
    name: str
    profile: ProfileOut | None
    registration: RegistrationOut


class SessionOut(BaseModel):
    token: str
    expires_at: datetime
    email: str
    name: str


class TeamInput(Input):
    name: str = Field(max_length=rules.TEAM_NAME_LENGTH[1])
    category: int
    domain: str = Field(max_length=80)
    project_title: str = Field(max_length=rules.PROJECT_TITLE_LENGTH[1])
    abstract: str = Field(max_length=rules.ABSTRACT_LENGTH[1])

    @field_validator("name")
    @classmethod
    def check_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < rules.TEAM_NAME_LENGTH[0]:
            raise ValueError(f"Team name must be at least {rules.TEAM_NAME_LENGTH[0]} characters.")
        # Lower-casing can lengthen some letters (e.g. "İ"); the uniqueness key must still fit its column.
        if len(rules.normalise_team_name(value)) > rules.TEAM_NAME_LENGTH[1]:
            raise ValueError("Team name contains characters we cannot use. Please choose another name.")
        return value

    @field_validator("category")
    @classmethod
    def check_category(cls, value: int) -> int:
        if value not in rules.CATEGORIES:
            raise ValueError("Choose a category.")
        return value

    @field_validator("domain")
    @classmethod
    def check_domain(cls, value: str) -> str:
        if value not in rules.DOMAINS:
            raise ValueError("Choose a domain from the list.")
        return value

    @field_validator("project_title")
    @classmethod
    def check_title(cls, value: str) -> str:
        if len(value) < rules.PROJECT_TITLE_LENGTH[0]:
            raise ValueError(f"Project title must be at least {rules.PROJECT_TITLE_LENGTH[0]} characters.")
        return value

    @field_validator("abstract")
    @classmethod
    def check_abstract(cls, value: str) -> str:
        if len(value) < rules.ABSTRACT_LENGTH[0]:
            raise ValueError(f"Abstract must be at least {rules.ABSTRACT_LENGTH[0]} characters.")
        return value


class InviteInput(Input):
    email: str = Field(max_length=320)

    @field_validator("email")
    @classmethod
    def check_email(cls, value: str) -> str:
        try:
            return str(TypeAdapter(EmailStr).validate_python(value)).lower()
        except ValidationError:
            raise ValueError("Enter a valid email address.") from None


class JoinInput(Input):
    code: str = Field(max_length=20)


class MemberOut(BaseModel):
    user_id: uuid.UUID
    full_name: str
    email: str
    department: str | None
    course: str
    year: int
    role: str
    joined_at: datetime
    # COE KIET / technical-club members: the club's name.
    club: str = ""


class InvitationOut(BaseModel):
    id: uuid.UUID
    team_id: uuid.UUID
    team_code: str
    team_name: str
    category: int
    leader_name: str
    email: str
    status: str
    created_at: datetime


class TeamOut(BaseModel):
    id: uuid.UUID
    code: str
    # Only ever sent to the team's own members (and admins).
    join_code: str
    name: str
    category: int
    domain: str
    project_title: str
    abstract: str
    participant_type: str
    institution: str
    department: str | None
    route: str
    leader_id: uuid.UUID
    members: list[MemberOut]
    invitations: list[InvitationOut]
    status: str
    result: str
    created_at: datetime
    submitted_at: datetime | None
    # Startups and COE KIET teams: True until an admin has accepted the entry for the Grand Finale.
    approval_required: bool = False
    approved_at: datetime | None = None


# ---------- Admin ----------


class ReasonInput(Input):
    reason: str = Field(min_length=5, max_length=500)


AdminRole = Literal["super_admin", "admin", "outside_admin", "startup_admin"]


class AdminInput(Input):
    email: EmailStr
    name: str = Field(min_length=2, max_length=120)
    role: AdminRole
    department: str | None = None

    @field_validator("email")
    @classmethod
    def lower(cls, value: str) -> str:
        return value.lower()

    @field_validator("department", mode="before")
    @classmethod
    def legacy_department(cls, value):
        return rules.canonical_department(value)

    @model_validator(mode="after")
    def check_department(self) -> "AdminInput":
        if self.role == "admin" and self.department not in rules.DEPARTMENTS:
            raise ValueError("Choose the department this admin manages.")
        if self.role != "admin":
            self.department = None
        return self


def _email(value: str) -> str:
    try:
        return str(TypeAdapter(EmailStr).validate_python(value.strip())).lower()
    except ValidationError:
        raise ValueError(f"{value} is not a valid email address.") from None


class AdminTeamInput(TeamInput):
    """An organiser creates a team for registered students (see services/admin.create_team)."""

    leader_email: str = Field(max_length=320)
    member_emails: list[str] = Field(default_factory=list, max_length=rules.TEAM_MAX_SIZE - 1)
    # Submit (lock) it straight away; it needs 2 to 5 members.
    submit: bool = False

    @field_validator("leader_email")
    @classmethod
    def check_leader(cls, value: str) -> str:
        return _email(value)

    @field_validator("member_emails")
    @classmethod
    def check_members(cls, value: list[str]) -> list[str]:
        return [_email(email) for email in value if email.strip()]


class NominationInput(Input):
    category: int
    team_ids: list[uuid.UUID] = Field(max_length=10)


class NominationsInput(Input):
    nominations: list[NominationInput] = Field(max_length=8)


class AdminOut(BaseModel):
    email: str
    name: str
    # super_admin | admin | outside_admin | startup_admin, or "judge" for a juror who is not an organiser.
    role: str
    department: str | None
    added_at: datetime | None = None
    added_by: str | None = None
    # True when this account is also an appointed juror (it then has a "My judging" page).
    judge: bool = False


class AdminMemberOut(MemberOut):
    phone: str
    roll_number: str
    institution: str
    # Set when an organiser has banned this student from the portal.
    banned: bool = False


class AdminTeamOut(TeamOut):
    members: list[AdminMemberOut]  # type: ignore[assignment]


class TeamSummaryOut(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    category: int
    participant_type: str
    institution: str
    department: str | None
    route: str
    status: str
    result: str
    leader_name: str
    member_count: int
    project_title: str
    submitted_at: datetime | None
    approval_required: bool = False
    approved_at: datetime | None = None
    leader_year: int | None = None
    # Year (or class) of every member, the leader's first.
    member_years: list[int] = []


class StudentTeamRef(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    status: str
    department: str | None
    role: str


class AdminStudentOut(ProfileOut):
    team: StudentTeamRef | None
    banned_at: datetime | None = None
    banned_reason: str | None = None
    banned_by: str | None = None


class AdminStudentInput(ProfileInput):
    """An organiser registers a student (help desk): the same profile rules, plus the student's Google email."""

    email: str = Field(max_length=320)

    @field_validator("email")
    @classmethod
    def check_email(cls, value: str) -> str:
        return _email(value)


class RestoreInput(ReasonInput):
    # Also lift the ban on every banned member (e.g. after the team was banned together with its members).
    unban_members: bool = False


class TeamBanInput(Input):
    reason: str = Field(min_length=5, max_length=500)
    # Also ban every member from the portal.
    ban_members: bool = False


class TeamPage(BaseModel):
    items: list[AdminTeamOut]
    total: int
    page: int
    page_size: int


class StudentPage(BaseModel):
    items: list[AdminStudentOut]
    total: int
    page: int
    page_size: int


class StatusCounts(BaseModel):
    total: int = 0
    draft: int = 0
    submitted: int = 0
    withdrawn: int = 0
    disqualified: int = 0


class TypeStats(BaseModel):
    type: str
    students: int
    teams: int
    submitted: int


class CategoryStats(StatusCounts):
    category: int


class DepartmentStats(StatusCounts):
    department: str
    students: int


class TimelinePoint(BaseModel):
    """One day (IST): profiles completed, teams created and teams submitted that day."""

    date: date
    students: int
    teams: int
    submitted: int


class YearStats(BaseModel):
    participant_type: str
    year: int
    students: int
    # Active teams led by a student of this year, and active teams with at least one member of this year.
    teams_led: int = 0
    teams_with: int = 0


class SizeStats(BaseModel):
    size: int
    teams: int


class DomainStats(BaseModel):
    domain: str
    teams: int


class InstitutionStats(BaseModel):
    institution: str
    participant_type: str
    city: str
    students: int
    teams: int


class StatsOut(BaseModel):
    department: str | None
    # Submitted startup and COE KIET entries waiting for an admin to accept them (0 for everyone else).
    awaiting_approval: int = 0
    students: int
    students_in_teams: int
    pending_invitations: int
    teams: StatusCounts
    by_type: list[TypeStats] | None
    by_category: list[CategoryStats]
    by_department: list[DepartmentStats] | None
    recent_submissions: list[TeamSummaryOut]
    results_published_at: datetime | None
    timeline: list[TimelinePoint]
    by_year: list[YearStats]
    # Active teams (draft or submitted) by number of members.
    team_sizes: list[SizeStats]
    # Active teams by project domain, most popular first.
    by_domain: list[DomainStats]
    # Super admin only: other colleges and schools with the most registered students.
    top_institutions: list[InstitutionStats] | None
    schedule: ScheduleOut


class FinalistCategoryOut(BaseModel):
    category: int
    quota: int
    teams: list[TeamSummaryOut]
    nominated: list[uuid.UUID]


class FinalistBoardOut(BaseModel):
    department: str
    nominations_deadline: datetime | None = None
    # True when the deadline has passed and the signed-in admin can no longer change this board.
    nominations_locked: bool = False
    published_at: datetime | None
    updated_at: datetime | None
    updated_by: str | None
    categories: list[FinalistCategoryOut]


class MatrixCell(BaseModel):
    category: int
    quota: int
    nominated: int
    eligible: int


class MatrixRow(BaseModel):
    department: str
    categories: list[MatrixCell]


class FinalistSummaryOut(BaseModel):
    published_at: datetime | None
    published_by: str | None
    nominations_deadline: datetime | None = None
    # Why results cannot be published right now (None = they can). The server decides, the panel only shows it.
    publish_blocked: str | None = None
    results_publish_from: datetime | None = None
    # Once published: why the results can no longer be withdrawn (None = a super admin can still withdraw them).
    unpublish_blocked: str | None = None
    matrix: list[MatrixRow]
    direct_teams: list[TeamSummaryOut]


class PublishInput(Input):
    # The panel asks the organiser to type this; requiring it here too stops a stray click or script from publishing.
    confirm: str = Field(max_length=20)


class UnpublishInput(Input):
    confirm: str = Field(max_length=20)
    reason: str = Field(min_length=5, max_length=500)


class PublishOut(BaseModel):
    published_at: datetime
    finalists: int
    not_selected: int


class AuditPage(BaseModel):
    items: list["AuditOut"]
    total: int
    page: int
    page_size: int


class AuditOut(BaseModel):
    id: str
    at: datetime
    actor_email: str
    action: str
    team_id: uuid.UUID | None
    team_code: str | None
    department: str | None
    detail: str


# ---------- Judging ----------


class JurorInput(Input):
    email: str = Field(max_length=320)
    name: str = Field(min_length=2, max_length=120)
    # KIET faculty (from a department) or an external judge (industry, another institution).
    kind: Literal["faculty", "external"]
    department: str | None = None
    organisation: str = Field(default="", max_length=200)
    phone: str = Field(default="", max_length=20)

    @field_validator("email")
    @classmethod
    def check_email(cls, value: str) -> str:
        return _email(value)

    @field_validator("department", mode="before")
    @classmethod
    def legacy_department(cls, value):
        return rules.canonical_department(value)

    @field_validator("phone")
    @classmethod
    def check_phone(cls, value: str) -> str:
        if not value:
            return ""
        if not rules.is_valid_phone(value):
            raise ValueError("Enter a 10-digit Indian mobile number, or leave the phone empty.")
        return rules.normalise_phone(value)

    @model_validator(mode="after")
    def check_kind(self) -> "JurorInput":
        # Judges sign in with their KIET Google account, which Google itself confirms belongs to KIET's workspace.
        if not rules.is_kiet_email(self.email):
            raise ValueError("Judges need a @kiet.edu email: they sign in with their KIET Google account.")
        if self.kind == "faculty":
            if self.department not in rules.DEPARTMENTS:
                raise ValueError("Choose the KIET department this faculty member belongs to.")
            self.organisation = self.organisation or rules.KIET_INSTITUTION
        else:
            self.department = None
            if len(self.organisation) < 2:
                raise ValueError("Enter the organisation an external judge comes from.")
        return self


class JurorPanelRef(BaseModel):
    id: uuid.UUID
    round: str
    building: str = ""
    name: str
    department: str | None = None
    slot_start: datetime | None = None
    chair: bool


class JurorOut(BaseModel):
    email: str
    name: str
    kind: str
    department: str | None
    organisation: str
    phone: str
    panels: list[JurorPanelRef]
    scores: int
    added_at: datetime | None
    added_by: str | None


class PanelPlace(Input):
    """Where and when a room sits: a building, the room in it, optional directions, and its time slot."""

    building: str = Field(default="", max_length=60)
    # The room's name or number in its building (a finale panel's name).
    name: str = Field(min_length=1, max_length=60)
    location: str = Field(default="", max_length=120)
    slot_start: AwareDatetime | None = None
    slot_end: AwareDatetime | None = None

    @model_validator(mode="after")
    def check_place(self) -> "PanelPlace":
        self.building = " ".join(self.building.split())
        self.name = " ".join(self.name.split())
        self.location = " ".join(self.location.split())
        if not self.name:
            raise ValueError("Enter the room's name or number.")
        if (self.slot_start is None) != (self.slot_end is None):
            raise ValueError("Give the time slot's start and end.")
        if self.slot_start and self.slot_end:
            if self.slot_end <= self.slot_start:
                raise ValueError("The time slot must end after it starts.")
            if self.slot_end - self.slot_start > rules.MAX_SLOT:
                raise ValueError("A time slot can be at most 12 hours long.")
        return self


class PanelInput(PanelPlace):
    round: rules.JudgingRound
    # Department round: whose teams are judged in this room.
    department: str | None = None

    @field_validator("department", mode="before")
    @classmethod
    def legacy_department(cls, value):
        return rules.canonical_department(value)

    @model_validator(mode="after")
    def check_department(self) -> "PanelInput":
        if self.round == "department":
            if self.department not in rules.DEPARTMENTS or self.department == rules.CLUB_DEPARTMENT:
                raise ValueError("Choose the department whose teams are judged in this room.")
            if not self.building:
                raise ValueError("Enter the building the room is in.")
        else:
            self.department = None
        return self


class PanelUpdateInput(PanelPlace):
    pass


class TimetableSlot(Input):
    department: str
    # Null: no slot for this department.
    slot_start: AwareDatetime | None = None
    slot_end: AwareDatetime | None = None

    @field_validator("department", mode="before")
    @classmethod
    def legacy_department(cls, value):
        return rules.canonical_department(value)

    @model_validator(mode="after")
    def check_slot(self) -> "TimetableSlot":
        if self.department not in rules.NOMINATING_DEPARTMENTS:
            raise ValueError(f'"{self.department}" has no department round.')
        if (self.slot_start is None) != (self.slot_end is None):
            raise ValueError(f"Give both the start and the end of {self.department}'s slot.")
        if self.slot_start and self.slot_end:
            if self.slot_end <= self.slot_start:
                raise ValueError(f"{self.department}'s slot must end after it starts.")
            if self.slot_end - self.slot_start > rules.MAX_SLOT:
                raise ValueError(f"{self.department}'s slot can be at most 12 hours long.")
        return self


class TimetableInput(Input):
    slots: list[TimetableSlot] = Field(max_length=40)
    grace_minutes: int = Field(ge=0, le=rules.MAX_GRACE_MINUTES)
    # Also move the department's rooms that still sit at the old time.
    move_rooms: bool = True


class TimetableOut(BaseModel):
    slots: list[TimetableSlot]
    grace_minutes: int
    customised: bool
    updated_by: str | None = None


class PanelTeamsInput(Input):
    team_ids: list[uuid.UUID] = Field(max_length=300)


class PanelJurorInput(Input):
    email: str = Field(max_length=320)
    chair: bool = False

    @field_validator("email")
    @classmethod
    def lower(cls, value: str) -> str:
        return value.strip().lower()


class PanelJurorsInput(Input):
    jurors: list[PanelJurorInput] = Field(max_length=20)


class PanelJurorOut(BaseModel):
    email: str
    name: str
    kind: str
    department: str | None
    organisation: str
    chair: bool


class PanelScoreOut(BaseModel):
    juror_email: str
    juror_name: str
    marks: list[int]
    total: int
    remarks: str
    updated_at: datetime
    # A super admin who changed the judge's submitted marks.
    edited_by: str | None


class PanelTeamOut(TeamSummaryOut):
    tent: str | None = None
    # Scores recorded by this panel's judges, and their average total (out of 50).
    scores: int = 0
    average: float | None = None
    # Each judge's marks: super admins only (they alone can change a submitted score).
    judge_scores: list[PanelScoreOut] | None = None
    # Members marked present for this round.
    present: int = 0


class PanelOut(BaseModel):
    id: uuid.UUID
    round: str
    building: str
    name: str
    location: str
    slot_start: datetime | None
    slot_end: datetime | None
    department: str | None
    jurors: list[PanelJurorOut]
    teams: list[PanelTeamOut]
    # Whether the caller can change this room (super admins, and department admins for their own rooms).
    can_edit: bool = False
    # Department rooms: judges submit marks from the slot's start until this moment (slot end + extra minutes).
    scoring_until: datetime | None = None


class RoundOut(BaseModel):
    round: str
    open: bool
    changed_at: datetime | None
    changed_by: str | None
    # Why the round cannot be opened now (None = it can, or it is already open).
    open_blocked: str | None


class TentRowOut(BaseModel):
    team: TeamSummaryOut
    tent: str | None


class JudgingOut(BaseModel):
    round: RoundOut
    # True for super admins, who open and lock rounds, allot stalls and see every judge's marks.
    can_manage: bool
    # Whether the caller can create rooms in this round (super admins; department admins for their department).
    can_create: bool = False
    panels: list[PanelOut]
    # Eligible teams of this round (in the caller's scope) not yet allotted to a panel.
    unallotted: list[TeamSummaryOut]
    # Final round: every team going to the Grand Finale and its tent.
    tents: list[TentRowOut] | None
    # Department round: the timetable (each department's slot and the extra minutes for scoring).
    timetable: TimetableOut | None = None
    server_time: datetime | None = None


class TentAssignment(Input):
    team_id: uuid.UUID
    # e.g. "S-12"; null or empty clears the stall.
    tent: str | None = Field(default=None, max_length=12)


class TentsInput(Input):
    tents: list[TentAssignment] = Field(max_length=500)


class AttendanceMember(BaseModel):
    user_id: uuid.UUID
    full_name: str
    role: str
    year: int
    course: str
    department: str | None
    institution: str
    roll_number: str
    phone: str
    # Marked present for this round: when, by whom, and how ("qr" or "manual").
    present_at: datetime | None = None
    marked_by: str | None = None
    method: str | None = None


class AttendanceTeam(BaseModel):
    code: str
    name: str
    category: int
    project_title: str
    status: str
    tent: str | None
    institution: str
    department: str | None
    members: list[AttendanceMember]
    # The room (department round) or panel the team is allotted to, if any.
    room: str | None = None


class AttendanceSheet(BaseModel):
    round: str
    title: str
    building: str = ""
    room: str = ""
    location: str
    slot_start: datetime | None = None
    slot_end: datetime | None = None
    jurors: list[str]
    teams: list[AttendanceTeam]


class ScanInput(Input):
    code: str = Field(min_length=1, max_length=200)
    round: rules.JudgingRound
    # The room the scanner stands in, so a team from another room is flagged.
    panel_id: uuid.UUID | None = None


class ScanStudent(BaseModel):
    user_id: uuid.UUID
    full_name: str
    roll_number: str
    course: str
    year: int
    department: str | None
    institution: str
    participant_type: str
    role: str


class ScanOut(BaseModel):
    # "marked" now, or "already" marked earlier.
    result: Literal["marked", "already"]
    student: ScanStudent
    team: TeamSummaryOut
    room: str | None
    marked_at: datetime
    marked_by: str
    method: str
    # Something the scanner should check, e.g. the team is allotted to another room.
    warning: str | None = None


class ManualAttendanceInput(Input):
    user_id: uuid.UUID
    round: rules.JudgingRound
    # Why it is done by hand (no phone, pass not loading) or undone.
    note: str = Field(min_length=3, max_length=300)


class PassRound(BaseModel):
    round: str
    team_code: str
    team_name: str
    building: str | None = None
    room: str | None = None
    location: str | None = None
    slot_start: datetime | None = None
    slot_end: datetime | None = None
    # Before a room is allotted: when the team's department is judged, from the timetable.
    planned_start: datetime | None = None
    planned_end: datetime | None = None
    tent: str | None = None
    present_at: datetime | None = None


class PassOut(BaseModel):
    # Null until the student is in a submitted team.
    seed: str | None
    # The IST day the seed is valid for; the portal fetches a new one each day.
    day: date | None
    period_seconds: int
    server_time: datetime
    user_id: uuid.UUID
    rounds: list[PassRound]


class AwardOut(BaseModel):
    place: int
    amount: int
    declared_by: str
    declared_at: datetime


class RankedTeam(BaseModel):
    position: int | None
    team: TeamSummaryOut
    panel: str | None
    scores: int
    judges: int
    average: float | None
    innovation: float | None
    query: float | None
    # Level with the team ranked just above on total, innovation and query addressing: the panel chair decides.
    tied: bool
    # Every judge of the team's room has scored it; only complete teams get a place.
    complete: bool = True
    award: AwardOut | None = None


class PrizeOut(BaseModel):
    place: int
    amount: int


class RankingGroup(BaseModel):
    key: str
    label: str
    department: str | None
    category: int | None
    teams: list[RankedTeam]
    # The places with a cash prize in this group, e.g. 1st only (department round) or 1st and 2nd (finale).
    prizes: list[PrizeOut] = []


class RankingsOut(BaseModel):
    round: str
    groups: list[RankingGroup]
    # Students see the round's winners only once a super admin publishes them.
    awards_published: bool = False
    can_award: bool = False
    can_publish_awards: bool = False


class AwardInput(Input):
    team_id: uuid.UUID
    place: int = Field(ge=1, le=2)


class ResultCard(BaseModel):
    round: str
    # awaiting: not announced yet; finalist / not_selected: department round outcome; winner: a cash prize;
    # participated: took part in the finale without a prize.
    status: Literal["awaiting", "finalist", "not_selected", "winner", "participated"]
    title: str
    message: str
    place: int | None = None
    amount: int | None = None


class ResultsOut(BaseModel):
    cards: list[ResultCard]


class ScoreInput(Input):
    marks: list[int] = Field(min_length=len(rules.RUBRIC_PARTS), max_length=len(rules.RUBRIC_PARTS))
    remarks: str = Field(default="", max_length=1000)

    @field_validator("marks")
    @classmethod
    def check_marks(cls, value: list[int]) -> list[int]:
        if error := rules.marks_error(value):
            raise ValueError(error)
        return value


class ScoreOut(BaseModel):
    marks: list[int]
    total: int
    remarks: str
    updated_at: datetime
    edited_by: str | None = None


class AdminScoreInput(ScoreInput):
    # Why a super admin changes (or enters) a judge's marks; kept in the activity log.
    reason: str = Field(min_length=5, max_length=300)


class QuotaCell(Input):
    department: str
    category: int = Field(ge=1, le=8)
    quota: int = Field(ge=0, le=10)

    @field_validator("department", mode="before")
    @classmethod
    def legacy_department(cls, value):
        return rules.canonical_department(value)


class QuotasInput(Input):
    quotas: list[QuotaCell] = Field(max_length=500)


class JudgeMemberOut(BaseModel):
    full_name: str
    role: str
    year: int
    course: str
    department: str | None = None


class JudgeTeamOut(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    category: int
    domain: str
    project_title: str
    abstract: str
    participant_type: str
    institution: str
    department: str | None
    status: str
    tent: str | None
    members: list[JudgeMemberOut]
    my_score: ScoreOut | None


class JudgePanelOut(BaseModel):
    id: uuid.UUID
    round: str
    building: str
    name: str
    location: str
    slot_start: datetime | None
    slot_end: datetime | None
    department: str | None
    chair: bool
    # Scores can be saved only while the organisers keep this round open...
    open: bool
    # ...and, for a department room, from its slot's start until the slot's end plus the extra minutes.
    scoring_from: datetime | None = None
    scoring_until: datetime | None = None
    teams: list[JudgeTeamOut]


class JudgeOut(BaseModel):
    email: str
    name: str
    panels: list[JudgePanelOut]
    # So the page counts down by the server's clock, not the phone's.
    server_time: datetime
