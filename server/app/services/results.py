"""
What a student sees about their team's results, round by round, only once the organisers have announced them:

- Department round (KIET teams): awaiting until the finalists are published; then "finalist" or "better luck next
  time". A department prize (1st place in the category) shows once that round's winners are published.
- Grand Finale (finalists, and teams that go straight to the finale): awaiting until the finale's winners are
  published; then the prize and amount, or "better luck next time".
- Teams from other colleges and schools: in the queue to be accepted until the organisers allot them a stall (they
  are not told they are accepted before that); a disqualified college team is told so.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import rules
from ..models import AppState, Award, FinalTent, Team, TeamMember, User
from ..schemas import ResultCard, ResultsOut
from . import admin as admin_service
from . import judging


def _rupees(amount: int) -> str:
    return f"₹{amount:,}"


def _place(place: int) -> str:
    return "1st" if place == 1 else "2nd"


def my_results(db: Session, user: User) -> ResultsOut:
    team = db.scalar(select(Team).join(TeamMember, TeamMember.team_id == Team.id).where(TeamMember.user_id == user.id))
    if team is not None and team.status == "disqualified" and team.participant_type == "college":
        return ResultsOut(
            cards=[
                ResultCard(
                    round="final",
                    status="disqualified",
                    title="Your team is disqualified",
                    message="Your team can no longer take part in InnoTech'26. Please contact the organisers if you have any questions.",
                )
            ]
        )
    if team is None or team.status != "submitted":
        return ResultsOut(cards=[])
    awards = {a.round: a for a in db.scalars(select(Award).where(Award.team_id == team.id))}
    published = {r: db.get(AppState, f"awards_published:{r}") is not None for r in rules.JUDGING_ROUNDS}
    cards: list[ResultCard] = []

    in_final = db.scalar(select(Team.id).where(Team.id == team.id, judging._eligible_condition("final"))) is not None
    if in_final:
        award = awards.get("final") if published["final"] else None
        if award:
            cards.append(
                ResultCard(
                    round="final",
                    status="winner",
                    title=f"{_place(award.place)} place at the Grand Finale",
                    message=f"Congratulations! Your team wins {_rupees(award.amount)}. "
                    "The organisers will share how the prize is handed over.",
                    place=award.place,
                    amount=award.amount,
                )
            )
        elif published["final"]:
            cards.append(
                ResultCard(
                    round="final",
                    status="participated",
                    title="Grand Finale results are out",
                    message="Better luck next time! Thank you for taking part in the Grand Finale.",
                )
            )
        elif team.participant_type in ("college", "school"):
            tent = db.get(FinalTent, team.id)
            if tent is not None:
                cards.append(
                    ResultCard(
                        round="final",
                        status="qualified",
                        title="Your team is accepted for the Grand Finale",
                        message=f"Your stall is {tent.tent}. See you at KIET on 30 October.",
                    )
                )
            else:
                cards.append(
                    ResultCard(
                        round="final",
                        status="awaiting",
                        title="You are in the queue to be accepted",
                        message="No stall has been allotted yet. Your team will be accepted soon and stalls are allotted after that. "
                        "Your stall appears on this page once it is allotted.",
                    )
                )
        else:
            cards.append(
                ResultCard(
                    round="final",
                    status="awaiting",
                    title="Grand Finale results awaited",
                    message="The winners are announced after the Grand Finale on 30 October.",
                )
            )

    if team.route == "department":
        award = awards.get("department") if published["department"] else None
        if award:
            cards.append(
                ResultCard(
                    round="department",
                    status="winner",
                    title=f"Department winner · {team.department}",
                    message=f"Your team came {_place(award.place)} in Category {team.category} and wins {_rupees(award.amount)}.",
                    place=award.place,
                    amount=award.amount,
                )
            )
        if db.get(AppState, admin_service.RESULTS_KEY) is None:
            cards.append(
                ResultCard(
                    round="department",
                    status="awaiting",
                    title="Department round results awaited",
                    message="The finalists are declared on 26 October.",
                )
            )
        elif team.result == "finalist":
            cards.append(
                ResultCard(
                    round="department",
                    status="finalist",
                    title="You are a finalist!",
                    message="Your team goes to the Grand Finale on 30 October at KIET. Watch this page for your stall number.",
                )
            )
        else:
            cards.append(
                ResultCard(
                    round="department",
                    status="not_selected",
                    title="Not selected for the Grand Finale",
                    message="Better luck next time! Thank you for taking part in InnoTech'26.",
                )
            )
    return ResultsOut(cards=cards)
