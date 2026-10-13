"""
InnoTech26 registration rules. The server is the authority; client/lib/rules.ts mirrors these
for guidance in the browser, so keep the two in step.
"""

import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

ParticipantType = Literal["kiet", "college", "school", "startup"]

IST = ZoneInfo("Asia/Kolkata")

KIET_EMAIL_DOMAIN = "kiet.edu"
KIET_INSTITUTION = "KIET Deemed to be University"
KIET_CITY = "Ghaziabad"

TEAM_MIN_SIZE = 2
TEAM_MAX_SIZE = 5


def team_size_limits(participant_type: str) -> tuple[int, int]:
    """A startup registers as a single entry; every other team has 2 to 5 members."""
    return (1, 1) if participant_type == "startup" else (TEAM_MIN_SIZE, TEAM_MAX_SIZE)


# Departments allowed two finalist teams in Categories 1 to 4. CSE(CS) is deliberately not included.
DOUBLE_QUOTA_DEPARTMENTS = {"CSE", "CS", "CSE(AI)", "CSE(AIML)"}

DEPARTMENTS = [
    "CSE", "CS", "IT", "CSIT", "CSE(AI)", "CSE(AIML)", "CSE(DS)", "CSE(CS)",
    "EN", "EC", "ELCE", "ME", "VLSI", "AMIA", "MCA", "KSOM", "KSOP", "COE",
]  # fmt: skip

# COE KIET / technical clubs: a KIET "department" of its own (own admin) whose teams go straight to the Grand Finale,
# so it has no department round and nominates nobody. Its students also give the club's name.
CLUB_DEPARTMENT = "COE"
CLUB_NAME_LENGTH = (2, 80)
STARTUP_COURSE = "Startup"

# "AM" was renamed "AMIA". The old code is still accepted (and stored as AMIA), so a page opened before the rename keeps working.
LEGACY_DEPARTMENTS = {"AM": "AMIA"}


def canonical_department(value):
    return LEGACY_DEPARTMENTS.get(value, value) if isinstance(value, str) else value


# The departments that run a department round and nominate finalists.
NOMINATING_DEPARTMENTS = [d for d in DEPARTMENTS if d != CLUB_DEPARTMENT]


def needs_approval(participant_type: str, department: str | None) -> bool:
    """
    Startups and COE KIET teams go straight to the Grand Finale, but only once their admin has accepted the entry
    as a legal one. Everyone else qualifies as before.
    """
    return participant_type == "startup" or (participant_type == "kiet" and department == CLUB_DEPARTMENT)


def route_for(participant_type: str, department: str | None) -> str:
    """KIET teams take the department round, except COE KIET; everyone else goes straight to the Grand Finale."""
    return "department" if participant_type == "kiet" and department != CLUB_DEPARTMENT else "finale"


def normalise_club_name(value: str) -> str:
    return " ".join(value.split())


def normalise_roll_number(value: str) -> str:
    """Single spaces and upper case, so the same roll number typed twice is still caught as a duplicate."""
    return " ".join(value.split()).upper()


KIET_COURSES = ["B.Tech", "M.Tech", "MCA", "MBA", "B.Pharm", "M.Pharm", "Diploma", "Other"]
COLLEGE_COURSES = ["B.Tech / B.E.", "M.Tech", "BCA", "MCA", "B.Sc", "M.Sc", "BBA", "MBA", "B.Pharm", "Diploma", "Other"]
COLLEGE_YEARS = [1, 2, 3, 4]
SCHOOL_CLASSES = [6, 7, 8, 9, 10, 11, 12]

DOMAINS = [
    "Artificial Intelligence & Machine Learning",
    "Agentic AI & Generative AI",
    "Cyber Security, Privacy & Trustworthy AI",
    "IoT, Robotics & Automation",
    "Blockchain & Digital Transformation",
    "Renewable Energy & Sustainable Engineering",
    "Smart Cities, Infrastructure & Green Mobility",
    "Healthcare, Biomedical Devices & Biotechnology",
    "AR/VR, Digital Twins & Industry 4.0",
    "Big Data, Cloud, 5G/6G & Quantum Technologies",
    "Affordable Technology for Rural Development",
    "Disaster Management & Environmental Solutions",
    "Start-up & Revenue Generation Solutions",
    "Other / not listed",
]


@dataclass(frozen=True)
class Category:
    number: int
    title: str
    first_year_only: bool = False


CATEGORIES = {
    c.number: c
    for c in [
        Category(1, "Smart Solutions, Smarter Society"),
        Category(2, "AI Solutions for Automation"),
        Category(3, "Automation and Robotics"),
        Category(4, "From Concept to Reality"),
        Category(5, "Start Small, Scale Big, Sustain Always"),
        Category(6, "Gen Z to Budding Innovators", first_year_only=True),
        Category(7, "Creative Visions for a Sustainable Future"),
        Category(8, "CyberShield"),
    ]
}

TEAM_NAME_LENGTH = (3, 40)
PROJECT_TITLE_LENGTH = (5, 120)
ABSTRACT_LENGTH = (100, 1500)


def is_kiet_email(email: str) -> bool:
    return email.strip().lower().endswith(f"@{KIET_EMAIL_DOMAIN}")


def allowed_participant_types(email: str) -> list[ParticipantType]:
    """A @kiet.edu account registers as KIET; any other account as another college or a school. Anyone can be a startup."""
    return ["kiet", "startup"] if is_kiet_email(email) else ["college", "school", "startup"]


# Common short forms students type, so "ABES Engg. College" and "ABES Engineering College" compare equal.
INSTITUTION_ABBREVIATIONS = {
    "engg": "engineering",
    "engr": "engineering",
    "eng": "engineering",
    "coll": "college",
    "clg": "college",
    "univ": "university",
    "uni": "university",
    "inst": "institute",
    "instt": "institute",
    "tech": "technology",
    "mgmt": "management",
    "sr": "senior",
    "sec": "secondary",
    "sch": "school",
    "vidyalay": "vidyalaya",
    "and": "",
    "of": "",
    "the": "",
}


def normalise_institution(name: str) -> str:
    """So "K.I.E.T. Group", "kiet group" and "Kiet Grp" style variants compare equal. Empty if nothing comparable."""
    # Dots and apostrophes join letters ("K.I.E.T." is "kiet"); anything else separates words.
    words = re.sub(r"[^a-z0-9]+", " ", re.sub(r"[.'’]", "", name.lower())).split()
    return " ".join(w for w in (INSTITUTION_ABBREVIATIONS.get(word, word) for word in words) if w)[:200]


def institution_key(participant_type: str, institution: str, city: str) -> str:
    """Teams must share this key. Schools often share a name across cities (e.g. Delhi Public School), so add the city."""
    key = normalise_institution(institution)
    if participant_type == "school":
        key = f"{key} | {normalise_institution(city)}"
    elif participant_type == "startup":
        key = f"startup | {key}"
    return key[:200]


def normalise_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 12 and digits.startswith("91"):
        return digits[2:]
    if len(digits) == 11 and digits.startswith("0"):
        return digits[1:]
    return digits


def is_valid_phone(phone: str) -> bool:
    return re.fullmatch(r"[6-9]\d{9}", normalise_phone(phone)) is not None


def normalise_team_name(name: str) -> str:
    """Key used to keep team names unique regardless of case and spacing."""
    return re.sub(r"\s+", " ", name.strip()).lower()


def category_error(category: int, participant_type: str, years: list[int]) -> str | None:
    """Why a team with members of these years cannot compete in `category`, or None if it can."""
    info = CATEGORIES.get(category)
    if info is None:
        return "Unknown category."
    if info.first_year_only and any(year != 1 for year in years):
        return "Only teams where every member is a first-year student can enter this category."
    return None


def finalist_quota(department: str, category: int) -> int:
    return 2 if department in DOUBLE_QUOTA_DEPARTMENTS and category <= 4 else 1


RegistrationState = Literal["upcoming", "open", "closed"]


def window_state(opens: datetime, closes: datetime, now: datetime | None = None) -> RegistrationState:
    now = now or datetime.now(UTC)
    if now < opens:
        return "upcoming"
    if now > closes:
        return "closed"
    return "open"


# ---------- Team join codes ----------

# No 0/O or 1/I, so codes read out loud or copied by hand stay unambiguous. 32^8 codes make guessing impractical.
JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def new_join_code() -> str:
    code = "".join(secrets.choice(JOIN_CODE_ALPHABET) for _ in range(8))
    return f"{code[:4]}-{code[4:]}"


def normalise_join_code(code: str) -> str | None:
    """ "k7pq 3xm9" -> "K7PQ-3XM9"; None if it cannot be a join code."""
    chars = re.sub(r"[\s-]", "", code).upper()
    if len(chars) != 8 or any(c not in JOIN_CODE_ALPHABET for c in chars):
        return None
    return f"{chars[:4]}-{chars[4:]}"


# ---------- Judging ----------

JudgingRound = Literal["department", "final"]
JUDGING_ROUNDS: tuple[JudgingRound, ...] = ("department", "final")
# The longest time slot a judging room can have.
MAX_SLOT = timedelta(hours=12)
# Event passes: the QR code changes every minute and is accepted for two minutes after (one before, for clock drift).
PASS_PERIOD_SECONDS = 60
PASS_PAST_PERIODS = 2
PASS_FUTURE_PERIODS = 1

# Each category is judged with one of six common rubrics (event document: Evaluation Rubrics).
RUBRIC_GROUPS = {1: "software", 2: "software", 3: "hardware", 4: "hardware", 5: "startup", 6: "genz", 7: "poster", 8: "cybershield"}

# Every rubric has five criteria of 10 marks (out of 50). Criteria 1 to 4 have two sub-parts of 5 marks each;
# criterion 5, Query Addressing, is a single mark out of 10. A score is the nine marks in that order.
RUBRIC_PARTS = (5, 5, 5, 5, 5, 5, 5, 5, 10)
RUBRIC_TOTAL = sum(RUBRIC_PARTS)

# The criterion that measures innovation or originality in each rubric (0-based), the first tie-breaker.
INNOVATION_CRITERION = {"software": 1, "hardware": 1, "startup": 0, "genz": 0, "poster": 0, "cybershield": 1}
QUERY_CRITERION = 4


def criterion_marks(marks: list[int]) -> list[int]:
    """The five criterion scores (out of 10 each) from the nine sub-part marks."""
    return [marks[0] + marks[1], marks[2] + marks[3], marks[4] + marks[5], marks[6] + marks[7], marks[8]]


def marks_error(marks: list[int]) -> str | None:
    if len(marks) != len(RUBRIC_PARTS):
        return f"A score needs {len(RUBRIC_PARTS)} marks: two for each of the first four criteria and one for Query Addressing."
    for mark, top in zip(marks, RUBRIC_PARTS, strict=True):
        if not 0 <= mark <= top:
            return f"Each mark must be between 0 and {top}."
    return None


def innovation_marks(category: int, marks: list[int]) -> int:
    return criterion_marks(marks)[INNOVATION_CRITERION[RUBRIC_GROUPS[category]]]


def query_marks(marks: list[int]) -> int:
    return criterion_marks(marks)[QUERY_CRITERION]
