"""a super admin can extend a room's judging time past its slot and buffer

Additive: panels.scoring_extended_until, empty for every existing room, so nothing changes until a super admin sets it. While
it is later than the slot's end plus the buffer, judges can save marks (and organisers mark attendance) until then.

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
    op.add_column("panels", sa.Column("scoring_extended_until", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("panels", "scoring_extended_until")
