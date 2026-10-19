"""other colleges and schools are accepted by the organisers before they get a stall

Startups and COE KIET entries already wait for an admin to accept them (teams.approval_required / approved_at).
Teams from other colleges and schools now do too. Existing ones start in the queue (not accepted), except any team
that was already marked "qualified" or already has a stall, which is accepted so nothing allotted is undone.
The short-lived "qualified" mark (results.finalist on such a team) is cleared. No rows are added or removed.

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-19
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("UPDATE teams SET approval_required = true WHERE participant_type IN ('college', 'school') AND NOT approval_required")
    op.execute(
        "UPDATE teams SET approved_at = now(), approved_by = 'migration' "
        "WHERE participant_type IN ('college', 'school') AND approved_at IS NULL "
        "AND (result = 'finalist' OR id IN (SELECT team_id FROM final_tents))"
    )
    op.execute("UPDATE teams SET result = 'pending' WHERE participant_type IN ('college', 'school') AND result = 'finalist'")


def downgrade() -> None:
    op.execute(
        "UPDATE teams SET approval_required = false, approved_at = NULL, approved_by = NULL WHERE participant_type IN ('college', 'school')"
    )
