"""college admins and school admins: organisers for other colleges only, or for schools only

Additive: the admins role check constraint is widened to allow the two new roles. Existing rows already satisfy it,
so nothing is rewritten; "outside_admin" (colleges and schools together) stays valid.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-15
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ROLES = "role IN ('super_admin', 'admin', 'outside_admin', 'startup_admin', 'college_admin', 'school_admin')"
OLD_ROLES = "role IN ('super_admin', 'admin', 'outside_admin', 'startup_admin')"


def upgrade() -> None:
    op.drop_constraint(op.f("ck_admins_role"), "admins", type_="check")
    op.create_check_constraint(op.f("ck_admins_role"), "admins", ROLES)


def downgrade() -> None:
    # College and school admins would violate the old constraint, so a downgrade needs them removed first.
    op.drop_constraint(op.f("ck_admins_role"), "admins", type_="check")
    op.create_check_constraint(op.f("ck_admins_role"), "admins", OLD_ROLES)
