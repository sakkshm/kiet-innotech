"""other-college and school teams can be rejected

Additive: teams.rejected_at, rejected_by and rejected_reason, all empty for every existing team (nobody is rejected).
A rejected team is not accepted, so it gets no stall; "back to queue" or accepting it later clears the rejection.

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("teams", sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("teams", sa.Column("rejected_by", sa.String(length=320), nullable=True))
    op.add_column("teams", sa.Column("rejected_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("teams", "rejected_reason")
    op.drop_column("teams", "rejected_by")
    op.drop_column("teams", "rejected_at")
