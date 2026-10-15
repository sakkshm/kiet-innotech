"""archived teams: draft teams that were not submitted before their registration closed

Additive: the teams status check constraint is widened to allow "archived". Existing rows already satisfy it, so
nothing is rewritten. Archived teams keep their members; an organiser can restore or submit them later.

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-15
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STATUSES = "status IN ('draft', 'submitted', 'withdrawn', 'disqualified', 'archived')"
OLD_STATUSES = "status IN ('draft', 'submitted', 'withdrawn', 'disqualified')"


def upgrade() -> None:
    op.drop_constraint(op.f("ck_teams_status"), "teams", type_="check")
    op.create_check_constraint(op.f("ck_teams_status"), "teams", STATUSES)


def downgrade() -> None:
    # Archived teams would violate the old constraint: they go back to draft first.
    op.execute("UPDATE teams SET status = 'draft' WHERE status = 'archived'")
    op.drop_constraint(op.f("ck_teams_status"), "teams", type_="check")
    op.create_check_constraint(op.f("ck_teams_status"), "teams", OLD_STATUSES)
