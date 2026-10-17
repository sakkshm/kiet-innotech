"""a buffer per room, a judge's bulk lock, and a count of edits on a score

Additive: new columns with defaults (rooms get a 15 minute buffer, no judge is locked, no score has been edited).
Nothing existing is rewritten.

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("panels", sa.Column("buffer_minutes", sa.Integer(), nullable=False, server_default="15"))
    op.create_check_constraint(op.f("ck_panels_buffer"), "panels", "buffer_minutes BETWEEN 0 AND 60")
    op.add_column("panel_jurors", sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("scores", sa.Column("edit_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("scores", sa.Column("edit_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("scores", "edit_reason")
    op.drop_column("scores", "edit_count")
    op.drop_column("panel_jurors", "locked_at")
    op.drop_constraint(op.f("ck_panels_buffer"), "panels", type_="check")
    op.drop_column("panels", "buffer_minutes")
