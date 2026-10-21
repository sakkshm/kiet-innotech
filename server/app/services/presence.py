"""
Students' attendance in the department round, as the judges and admins see it.

A student is present, absent, or not marked. Everybody is counted present until somebody marks them absent, so a
team only scores 0 when every one of its members has been marked absent. This module only reads; marking is in
attendance.py.
"""

import uuid
from collections import defaultdict
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Attendance, Profile, TeamMember
from ..schemas import PresenceMemberOut

ROUND = "department"


def member_states(db: Session, team_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, list[PresenceMemberOut]]:
    """Every member of each team with their attendance, the leader first."""
    ids = list(team_ids)
    out: dict[uuid.UUID, list[PresenceMemberOut]] = defaultdict(list)
    if not ids:
        return out
    rows = db.execute(
        select(TeamMember.team_id, TeamMember.user_id, TeamMember.role, Profile.full_name, Attendance)
        .join(Profile, Profile.user_id == TeamMember.user_id)
        .outerjoin(Attendance, (Attendance.user_id == TeamMember.user_id) & (Attendance.round == ROUND))
        .where(TeamMember.team_id.in_(ids))
        .order_by(TeamMember.role != "leader", Profile.full_name)
    ).tuples()
    for team_id, user_id, role, name, mark in rows:
        out[team_id].append(
            PresenceMemberOut(
                user_id=user_id,
                full_name=name,
                role=role,
                state=mark.status if mark is not None else "not_marked",  # type: ignore[arg-type]
                marked_by=mark.marked_by if mark is not None else None,
                marked_at=mark.marked_at if mark is not None else None,
            )
        )
    return out


def is_all_absent(members: list[PresenceMemberOut]) -> bool:
    """A team with members, all of whom are marked absent. Someone not marked still counts as present."""
    return bool(members) and all(m.state == "absent" for m in members)


def absent_teams(db: Session, team_ids: Iterable[uuid.UUID]) -> set[uuid.UUID]:
    """The teams whose members are all absent."""
    return {team_id for team_id, members in member_states(db, team_ids).items() if is_all_absent(members)}
