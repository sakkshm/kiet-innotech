"""
Tests run against a real PostgreSQL database (TEST_DATABASE_URL, default: local innotech_test),
because row locks and partial unique indexes are part of what is being tested.
Requests carry real session tokens issued by app.auth; Google sign-in has its own tests.
"""

import itertools
import os
from collections.abc import Iterator

os.environ.update(
    ENVIRONMENT="test",
    DATABASE_URL=os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg:///innotech_test"),
    SESSION_SECRET="test-session-secret-that-is-long-enough-for-hs256",
    GOOGLE_CLIENT_IDS="test-client.apps.googleusercontent.com",
    DEV_SIGN_IN="false",
    SUPER_ADMIN_EMAILS="root@kiet.edu",
    FORCE_REGISTRATION_OPEN="true",
    # Far away, so tests do not start failing when the real deadline passes.
    NOMINATIONS_DEADLINE="2099-01-01T00:00:00+00:00",
    # Long past, so publishing is not blocked by the results date unless a test sets one.
    RESULTS_PUBLISH_FROM="2020-01-01T00:00:00+00:00",
    EMAIL_BACKEND="log",
    # Attendance by event pass is off in production for now; the tests switch it on where they exercise it.
    ATTENDANCE_ENABLED="true",
    CORS_ORIGINS="http://localhost:3000",
)

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.auth import Identity, issue_session
from app.config import get_settings
from app.db import Base, get_engine
from app.main import create_app


@pytest.fixture(scope="session", autouse=True)
def schema() -> Iterator[None]:
    engine = get_engine()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture(autouse=True)
def clean_tables() -> Iterator[None]:
    yield
    names = ", ".join(table.name for table in Base.metadata.sorted_tables)
    with get_engine().begin() as connection:
        connection.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))


@pytest.fixture
def settings():
    """The live settings object; tests may change registration fields and must not leak them."""
    current = get_settings()
    saved = current.model_dump()
    yield current
    for key, value in saved.items():
        setattr(current, key, value)


@pytest.fixture(scope="session")
def app():
    return create_app()


def token(email: str, name: str | None = None, app: str = "portal") -> str:
    name = name or email.split("@")[0].replace(".", " ").title()
    return issue_session(Identity(email=email.strip().lower(), name=name), app, get_settings())["token"]


class Api:
    """A TestClient signed in as one person."""

    def __init__(self, client: TestClient, email: str):
        self.client = client
        self.email = email
        # Like the real frontends: the admin panel holds an admin session, the portal a portal session.
        self.portal = {"Authorization": f"Bearer {token(email)}"}
        self.admin = {"Authorization": f"Bearer {token(email, app='admin')}"}

    def headers(self, path: str) -> dict[str, str]:
        # The judge page lives in the admin panel too.
        return self.admin if path.startswith(("/admin", "/judge")) else self.portal

    def get(self, path: str, **kwargs):
        return self.client.get(path, headers=self.headers(path), **kwargs)

    def post(self, path: str, json: object = None):
        return self.client.post(path, headers=self.headers(path), json=json)

    def put(self, path: str, json: object = None):
        return self.client.put(path, headers=self.headers(path), json=json)

    def patch(self, path: str, json: object = None):
        return self.client.patch(path, headers=self.headers(path), json=json)

    def delete(self, path: str):
        return self.client.delete(path, headers=self.headers(path))


@pytest.fixture
def client(app) -> Iterator[TestClient]:
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture
def as_user(client: TestClient):
    return lambda email: Api(client, email)


_ROLL_NUMBERS = itertools.count(1)


def kiet_profile(department: str = "CSE", year: int = 3, roll: str | None = None, **overrides: object) -> dict:
    return {
        "full_name": "Test Student",
        "phone": "9876543210",
        "participant_type": "kiet",
        "department": department,
        "course": "B.Tech",
        "year": year,
        # Unique within the test run: a random number sometimes collided and failed a test for no reason.
        "roll_number": roll or str(2300290100000 + next(_ROLL_NUMBERS)),
        **overrides,
    }


def college_profile(institution: str = "ABES Engineering College", year: int = 2, **overrides: object) -> dict:
    return {
        "full_name": "College Student",
        "phone": "9812345678",
        "participant_type": "college",
        "institution": institution,
        "city": "Ghaziabad",
        "course": "B.Tech / B.E.",
        "year": year,
        "roll_number": "ABES123",
        **overrides,
    }


def school_profile(institution: str = "Delhi Public School", year: int = 11) -> dict:
    return {
        "full_name": "School Student",
        "phone": "9811122233",
        "participant_type": "school",
        "institution": institution,
        "city": "Ghaziabad",
        "year": year,
    }


def team_input(name: str = "Code Crafters", category: int = 2, **overrides: object) -> dict:
    return {
        "name": name,
        "category": category,
        "domain": "Agentic AI & Generative AI",
        "project_title": "CampusMate: an AI assistant",
        "abstract": "Students waste hours finding forms, notices and office timings. " * 3,
        **overrides,
    }


@pytest.fixture
def student(as_user):
    """Signs in a student and saves their profile."""

    def make(email: str, profile: dict | None = None) -> Api:
        api = as_user(email)
        response = api.put("/me/profile", profile or kiet_profile())
        assert response.status_code == 200, response.text
        return api

    return make


@pytest.fixture
def team_of(student):
    """Creates a team led by `leader` with the given members (all accept their invitations)."""

    def make(leader: Api, members: list[Api] = (), **team: object) -> dict:
        response = leader.post("/teams", team_input(**team))
        assert response.status_code == 201, response.text
        team_id = response.json()["id"]
        for member in members:
            assert leader.post(f"/teams/{team_id}/invitations", {"email": member.email}).status_code == 201
            invitation = member.get("/me/invitations").json()[0]
            assert member.post(f"/invitations/{invitation['id']}/accept").status_code == 204
        return leader.get("/me/team").json()

    return make
