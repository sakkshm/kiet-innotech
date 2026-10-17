"""
Database tables.

Rules that must hold even under concurrent requests are also enforced by constraints:
one team per student (team_members.user_id is unique), unique team names, one pending
invitation per team and email, and at most one profile per KIET roll number.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from . import rules
from .db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


Timestamp = DateTime(timezone=True)


class User(Base):
    """Anyone who has signed in to the student portal. The email is the identity."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    # Google account id ("sub") of the last Google sign-in, for support; the email stays the identity.
    google_sub: Mapped[str | None] = mapped_column(String(128), unique=True)
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    # Set when an organiser bans the student: they can no longer use the portal or be added to a team.
    banned_at: Mapped[datetime | None] = mapped_column(Timestamp)
    banned_reason: Mapped[str | None] = mapped_column(Text)
    banned_by: Mapped[str | None] = mapped_column(String(320))

    profile: Mapped["Profile | None"] = relationship(back_populates="user", uselist=False)
    membership: Mapped["TeamMember | None"] = relationship(back_populates="user", uselist=False)


class Profile(Base):
    __tablename__ = "profiles"
    __table_args__ = (
        CheckConstraint("participant_type IN ('kiet', 'college', 'school', 'startup')", name="participant_type"),
        # A KIET roll number belongs to one student; duplicates mean a typo or a second account.
        Index(
            "uq_profiles_kiet_roll_number",
            "roll_number",
            unique=True,
            postgresql_where=text("participant_type = 'kiet'"),
            sqlite_where=text("participant_type = 'kiet'"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    full_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(10))
    participant_type: Mapped[str] = mapped_column(String(10))
    institution: Mapped[str] = mapped_column(String(200))
    institution_key: Mapped[str] = mapped_column(String(200), index=True)
    city: Mapped[str] = mapped_column(String(100))
    department: Mapped[str | None] = mapped_column(String(20), index=True)
    course: Mapped[str] = mapped_column(String(40))
    year: Mapped[int] = mapped_column(Integer)
    roll_number: Mapped[str] = mapped_column(String(40), default="")
    # COE KIET / technical-club students: the name of their club. Empty for everyone else.
    club: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow, onupdate=utcnow)

    user: Mapped[User] = relationship(back_populates="profile")


class Team(Base):
    __tablename__ = "teams"
    __table_args__ = (
        CheckConstraint("category BETWEEN 1 AND 8", name="category"),
        CheckConstraint("status IN ('draft', 'submitted', 'withdrawn', 'disqualified', 'archived')", name="status"),
        CheckConstraint("result IN ('pending', 'finalist', 'not_selected')", name="result"),
        CheckConstraint("route IN ('department', 'finale')", name="route"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # Sequential number behind the human-friendly code, e.g. 42 -> "IT26-0042".
    number: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), Identity(), unique=True)
    name: Mapped[str] = mapped_column(String(40))
    name_key: Mapped[str] = mapped_column(String(40), unique=True)
    # Private code the leader shares so registered students can join without an email invitation.
    join_code: Mapped[str] = mapped_column(String(9), unique=True, default=rules.new_join_code)
    category: Mapped[int] = mapped_column(Integer, index=True)
    domain: Mapped[str] = mapped_column(String(80))
    project_title: Mapped[str] = mapped_column(String(120))
    abstract: Mapped[str] = mapped_column(Text)
    participant_type: Mapped[str] = mapped_column(String(10), index=True)
    institution: Mapped[str] = mapped_column(String(200))
    institution_key: Mapped[str] = mapped_column(String(200))
    department: Mapped[str | None] = mapped_column(String(20), index=True)
    route: Mapped[str] = mapped_column(String(10))
    leader_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    status: Mapped[str] = mapped_column(String(15), default="draft", index=True)
    status_reason: Mapped[str | None] = mapped_column(Text)
    result: Mapped[str] = mapped_column(String(15), default="pending")
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow, onupdate=utcnow)
    submitted_at: Mapped[datetime | None] = mapped_column(Timestamp)
    # Startups and COE KIET teams count for the Grand Finale only once an admin has accepted the entry.
    approval_required: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    approved_at: Mapped[datetime | None] = mapped_column(Timestamp)
    approved_by: Mapped[str | None] = mapped_column(String(320))

    members: Mapped[list["TeamMember"]] = relationship(back_populates="team", cascade="all, delete-orphan", order_by="TeamMember.joined_at")
    invitations: Mapped[list["Invitation"]] = relationship(back_populates="team", cascade="all, delete-orphan")

    @property
    def code(self) -> str:
        return f"IT26-{self.number:04d}"


class TeamMember(Base):
    __tablename__ = "team_members"
    __table_args__ = (CheckConstraint("role IN ('leader', 'member')", name="role"),)

    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), primary_key=True)
    # Unique: a student can be in only one team.
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, unique=True)
    role: Mapped[str] = mapped_column(String(10))
    joined_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)

    team: Mapped[Team] = relationship(back_populates="members")
    user: Mapped[User] = relationship(back_populates="membership")


class Invitation(Base):
    __tablename__ = "invitations"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'accepted', 'declined', 'cancelled')", name="status"),
        Index(
            "uq_invitations_pending",
            "team_id",
            "email",
            unique=True,
            postgresql_where=text("status = 'pending'"),
            sqlite_where=text("status = 'pending'"),
        ),
        Index("ix_invitations_email_status", "email", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(320))
    invited_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(10), default="pending")
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    responded_at: Mapped[datetime | None] = mapped_column(Timestamp)

    team: Mapped[Team] = relationship(back_populates="invitations")
    inviter: Mapped[User] = relationship()


class Admin(Base):
    """
    Organisers. Super admins see everything; admins are scoped to one KIET department (COE KIET is one of them);
    outside admins see only teams and students from other colleges and schools; college admins only other colleges;
    school admins only schools; startup admins only startups.
    """

    __tablename__ = "admins"
    __table_args__ = (
        CheckConstraint("role IN ('super_admin', 'admin', 'outside_admin', 'startup_admin', 'college_admin', 'school_admin')", name="role"),
        CheckConstraint("role <> 'admin' OR department IS NOT NULL", name="department"),
    )

    email: Mapped[str] = mapped_column(String(320), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(15))
    department: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    created_by: Mapped[str | None] = mapped_column(String(320))


class FinalistNomination(Base):
    """A KIET team a department has nominated for the Grand Finale."""

    __tablename__ = "finalist_nominations"

    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), primary_key=True)
    department: Mapped[str] = mapped_column(String(20), index=True)
    category: Mapped[int] = mapped_column(Integer)
    nominated_by: Mapped[str] = mapped_column(String(320))
    nominated_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)


class AppState(Base):
    """Single-row flags, e.g. when results were published."""

    __tablename__ = "app_state"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow, onupdate=utcnow)


class AuditEntry(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), Identity(), primary_key=True)
    at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow, index=True)
    actor_email: Mapped[str] = mapped_column(String(320))
    action: Mapped[str] = mapped_column(String(50))
    # No foreign key: the history of a deleted team is kept, along with its code.
    team_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)
    team_code: Mapped[str | None] = mapped_column(String(12))
    # KIET department the entry belongs to, so department admins see only their own history. Null = institute-wide.
    department: Mapped[str | None] = mapped_column(String(20), index=True)
    # Participant type of the team, so outside admins see the history of other colleges' and schools' teams.
    participant_type: Mapped[str | None] = mapped_column(String(10))
    detail: Mapped[str] = mapped_column(Text, default="")


class RateLimit(Base):
    """Fixed-window counters shared by all API workers, e.g. join-code attempts per student."""

    __tablename__ = "rate_limits"

    key: Mapped[str] = mapped_column(String(200), primary_key=True)
    window_start: Mapped[datetime] = mapped_column(Timestamp)
    count: Mapped[int] = mapped_column(Integer)


# ---------- Judging ----------


class Juror(Base):
    """A judge appointed by the organisers. They sign in to the admin panel and see only their own panels' teams."""

    __tablename__ = "jurors"
    __table_args__ = (
        CheckConstraint("kind IN ('faculty', 'external')", name="kind"),
        # KIET faculty belong to a department, which may not judge its own teams.
        CheckConstraint("kind = 'external' OR department IS NOT NULL", name="department"),
    )

    email: Mapped[str] = mapped_column(String(320), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(10))
    department: Mapped[str | None] = mapped_column(String(20))
    organisation: Mapped[str] = mapped_column(String(200), default="")
    phone: Mapped[str] = mapped_column(String(10), default="")
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    created_by: Mapped[str | None] = mapped_column(String(320))


class Panel(Base):
    """
    A judging room (department round, one department's teams) or a finale panel.

    A room is a building and a room in it ("G Block", "112") with a time slot. The same room can host other
    departments at other times, so the clash check (services.judging) compares building, room and slot.
    """

    __tablename__ = "panels"
    __table_args__ = (
        CheckConstraint("round IN ('department', 'final')", name="round"),
        CheckConstraint("round = 'final' OR department IS NOT NULL", name="department"),
        CheckConstraint("slot_end IS NULL OR slot_end > slot_start", name="slot"),
        CheckConstraint("buffer_minutes BETWEEN 0 AND 60", name="buffer"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    round: Mapped[str] = mapped_column(String(10))
    building: Mapped[str] = mapped_column(String(60), default="")
    # The room's name or number in its building.
    name: Mapped[str] = mapped_column(String(60))
    name_key: Mapped[str] = mapped_column(String(60))
    # Optional directions, e.g. "2nd floor, next to the lift".
    location: Mapped[str] = mapped_column(String(120), default="")
    slot_start: Mapped[datetime | None] = mapped_column(Timestamp)
    slot_end: Mapped[datetime | None] = mapped_column(Timestamp)
    # Department round: judges can still submit marks this many minutes after the slot ends (0 to 60).
    buffer_minutes: Mapped[int] = mapped_column(Integer, default=15, server_default=text("15"))
    # Department round: the department whose teams are judged here.
    department: Mapped[str | None] = mapped_column(String(20), index=True)
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    created_by: Mapped[str | None] = mapped_column(String(320))


class PanelJuror(Base):
    __tablename__ = "panel_jurors"
    __table_args__ = (
        # One chair per panel; the chair settles ties (event document: tie-breaker rules).
        Index("uq_panel_jurors_chair", "panel_id", unique=True, postgresql_where=text("chair"), sqlite_where=text("chair")),
    )

    panel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("panels.id", ondelete="CASCADE"), primary_key=True)
    juror_email: Mapped[str] = mapped_column(ForeignKey("jurors.email", ondelete="RESTRICT"), primary_key=True, index=True)
    chair: Mapped[bool] = mapped_column(Boolean, default=False)
    # Set when the judge locks all their marks in this room; an organiser can unlock them.
    locked_at: Mapped[datetime | None] = mapped_column(Timestamp)


class PanelTeam(Base):
    __tablename__ = "panel_teams"
    __table_args__ = (
        # A team is judged by one panel in each round.
        Index("uq_panel_teams_round_team", "round", "team_id", unique=True),
    )

    panel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("panels.id", ondelete="CASCADE"), primary_key=True)
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), primary_key=True)
    round: Mapped[str] = mapped_column(String(10))


class FinalTent(Base):
    """Where a team exhibits at the Grand Finale."""

    __tablename__ = "final_tents"

    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), primary_key=True)
    tent: Mapped[str] = mapped_column(String(12), unique=True)
    assigned_by: Mapped[str] = mapped_column(String(320))
    assigned_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)


class Score(Base):
    """One juror's marks for one team in one round (nine marks, see rules.RUBRIC_PARTS)."""

    __tablename__ = "scores"
    __table_args__ = (
        CheckConstraint("round IN ('department', 'final')", name="round"),
        Index("uq_scores_round_team_juror", "round", "team_id", "juror_email", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    round: Mapped[str] = mapped_column(String(10))
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    juror_email: Mapped[str] = mapped_column(ForeignKey("jurors.email", ondelete="RESTRICT"), index=True)
    marks: Mapped[list[int]] = mapped_column(JSON)
    total: Mapped[int] = mapped_column(Integer)
    remarks: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow, onupdate=utcnow)
    # An organiser who changed or entered the marks (a judge's own edits only count in edit_count).
    edited_by: Mapped[str | None] = mapped_column(String(320))
    # How many times the saved marks were changed afterwards, and the reason given for the last change.
    edit_count: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    edit_reason: Mapped[str | None] = mapped_column(Text)


class Attendance(Base):
    """A student marked present for a round, by a scanned event pass (QR) or by hand. Deleting the row unmarks them."""

    __tablename__ = "attendance"
    __table_args__ = (
        CheckConstraint("round IN ('department', 'final')", name="round"),
        CheckConstraint("method IN ('qr', 'manual')", name="method"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    round: Mapped[str] = mapped_column(String(10), primary_key=True)
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    marked_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    marked_by: Mapped[str] = mapped_column(String(320))
    method: Mapped[str] = mapped_column(String(10))
    note: Mapped[str] = mapped_column(Text, default="")


class Award(Base):
    """A prize place (1st or 2nd) declared by the organisers from the rankings. Students see it once the round's awards are published."""

    __tablename__ = "awards"
    __table_args__ = (
        CheckConstraint("round IN ('department', 'final')", name="round"),
        CheckConstraint("place IN (1, 2)", name="place"),
        # A team wins once per round, and each place of a group (department + category, or finale category) once.
        Index("uq_awards_round_team", "round", "team_id", unique=True),
        Index("uq_awards_round_group_place", "round", "group_key", "place", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    round: Mapped[str] = mapped_column(String(10))
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"))
    # The rankings group, e.g. "CSE-1" (department round) or "category-3" / "school-0" (finale).
    group_key: Mapped[str] = mapped_column(String(40))
    place: Mapped[int] = mapped_column(Integer)
    amount: Mapped[int] = mapped_column(Integer)
    declared_by: Mapped[str] = mapped_column(String(320))
    declared_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
