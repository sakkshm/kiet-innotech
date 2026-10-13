"""the department AM is now called AMIA

Only the value changes: every row that said AM now says AMIA, so teams, students, admins, judges, rooms,
nominations and the activity history stay exactly where they were. No row is added or removed, and
updated_at is left alone because these are plain SQL updates.

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-12
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every table that stores a department code.
TABLES = ("profiles", "teams", "admins", "finalist_nominations", "audit_log", "jurors", "panels")


def _rename(old: str, new: str) -> None:
    for table in TABLES:
        # Constants only (table names and the two codes above), never user input.
        op.execute(f"UPDATE {table} SET department = '{new}' WHERE department = '{old}'")  # noqa: S608


def upgrade() -> None:
    _rename("AM", "AMIA")


def downgrade() -> None:
    _rename("AMIA", "AM")
