"""a student can be marked absent as well as present

Additive: attendance.status, 'present' for every existing row (so nothing changes for what is recorded now) or 'absent'.
A student with no row is "not marked", which counts as present.

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("attendance", sa.Column("status", sa.String(length=10), nullable=False, server_default="present"))
    op.create_check_constraint(op.f("ck_attendance_status"), "attendance", "status IN ('present', 'absent')")


def downgrade() -> None:
    op.execute("DELETE FROM attendance WHERE status = 'absent'")
    op.drop_constraint(op.f("ck_attendance_status"), "attendance", type_="check")
    op.drop_column("attendance", "status")
