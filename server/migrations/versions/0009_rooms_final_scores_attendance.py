"""judging rooms get a building and a time slot, submitted scores record who edited them, attendance by event pass

Additive except for one index: a room's name no longer has to be unique in a round (the same room can host
different departments at different times); the clash check moved to the code, which compares building, room and slot.

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("panels", sa.Column("building", sa.String(length=60), nullable=False, server_default=""))
    op.add_column("panels", sa.Column("slot_start", sa.DateTime(timezone=True), nullable=True))
    op.add_column("panels", sa.Column("slot_end", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint(op.f("ck_panels_slot"), "panels", "slot_end IS NULL OR slot_end > slot_start")
    op.drop_index("uq_panels_round_name_key", table_name="panels")
    op.add_column("scores", sa.Column("edited_by", sa.String(length=320), nullable=True))
    op.create_table(
        "attendance",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("round", sa.String(length=10), nullable=False),
        sa.Column("team_id", sa.Uuid(), nullable=False),
        sa.Column("marked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("marked_by", sa.String(length=320), nullable=False),
        sa.Column("method", sa.String(length=10), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.CheckConstraint("round IN ('department', 'final')", name=op.f("ck_attendance_round")),
        sa.CheckConstraint("method IN ('qr', 'manual')", name=op.f("ck_attendance_method")),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"], name=op.f("fk_attendance_team_id_teams"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_attendance_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "round", name=op.f("pk_attendance")),
    )
    op.create_index(op.f("ix_attendance_team_id"), "attendance", ["team_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_attendance_team_id"), table_name="attendance")
    op.drop_table("attendance")
    op.drop_column("scores", "edited_by")
    # Fails if two rooms of a round now share a name; rename one first.
    op.create_index("uq_panels_round_name_key", "panels", ["round", "name_key"], unique=True)
    op.drop_constraint(op.f("ck_panels_slot"), "panels", type_="check")
    op.drop_column("panels", "slot_end")
    op.drop_column("panels", "slot_start")
    op.drop_column("panels", "building")
