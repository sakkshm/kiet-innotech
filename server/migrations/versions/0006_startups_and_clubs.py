"""startups register as a participant type; COE KIET students give a club name; startup admins

Additive: one new column with a default, and two check constraints widened to allow the new values.
Existing rows already satisfy the new constraints, so nothing is rewritten.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("profiles", sa.Column("club", sa.String(length=80), nullable=False, server_default=""))
    op.drop_constraint(op.f("ck_profiles_participant_type"), "profiles", type_="check")
    op.create_check_constraint(
        op.f("ck_profiles_participant_type"), "profiles", "participant_type IN ('kiet', 'college', 'school', 'startup')"
    )
    op.drop_constraint(op.f("ck_admins_role"), "admins", type_="check")
    op.create_check_constraint(op.f("ck_admins_role"), "admins", "role IN ('super_admin', 'admin', 'outside_admin', 'startup_admin')")


def downgrade() -> None:
    # Startups and startup admins would violate the old constraints, so a downgrade needs them gone first.
    op.drop_constraint(op.f("ck_admins_role"), "admins", type_="check")
    op.create_check_constraint(op.f("ck_admins_role"), "admins", "role IN ('super_admin', 'admin', 'outside_admin')")
    op.drop_constraint(op.f("ck_profiles_participant_type"), "profiles", type_="check")
    op.create_check_constraint(op.f("ck_profiles_participant_type"), "profiles", "participant_type IN ('kiet', 'college', 'school')")
    op.drop_column("profiles", "club")
