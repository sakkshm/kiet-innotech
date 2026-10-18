"""judges' attendance in their rooms

Additive: when a judge was marked present in a room, and by whom. Nothing existing is rewritten.

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("panel_jurors", sa.Column("present_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("panel_jurors", sa.Column("present_by", sa.String(length=320), nullable=True))


def downgrade() -> None:
    op.drop_column("panel_jurors", "present_by")
    op.drop_column("panel_jurors", "present_at")
