"""certificate templates and uploaded fonts

Templates and fonts are BLOBs in Postgres; generated certificates are rendered on demand and never stored.

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "certificate_templates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(length=30), nullable=False),
        sa.Column("scope", sa.String(length=15), nullable=False),
        sa.Column("kind", sa.String(length=15), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("pdf_data", sa.LargeBinary(), nullable=False),
        sa.Column("preview_png", sa.LargeBinary(), nullable=True),
        sa.Column("page_width_pt", sa.Float(), nullable=False),
        sa.Column("page_height_pt", sa.Float(), nullable=False),
        sa.Column("fields_json", sa.Text(), nullable=False),
        sa.Column("is_published", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.String(length=320), nullable=True),
        sa.CheckConstraint(
            "type IN ('dept_judge','dept_participation','dept_winner','institute_judge','institute_participation','institute_winner')",
            name="cert_type",
        ),
        sa.CheckConstraint("scope IN ('department','institute')", name="cert_scope"),
        sa.CheckConstraint("kind IN ('judge','participation','winner')", name="cert_kind"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("type"),
    )
    op.create_table(
        "certificate_fonts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("is_builtin", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index("idx_attendance_user_round", "attendance", ["user_id", "round"])


def downgrade() -> None:
    op.drop_index("idx_attendance_user_round", table_name="attendance")
    op.drop_table("certificate_fonts")
    op.drop_table("certificate_templates")
