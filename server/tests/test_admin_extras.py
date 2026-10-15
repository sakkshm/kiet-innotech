"""Outside admins, organiser-created teams, the results date, withdrawing results, the activity log and year filters."""

from datetime import UTC, datetime, timedelta

import pytest
from test_admin import publish, world  # noqa: F401  (fixture)

from conftest import Api, college_profile, kiet_profile, school_profile, team_input


@pytest.fixture
def outside(world):  # noqa: F811
    response = world["root"].post(
        "/admin/admins", {"email": "outside@gmail.com", "name": "Outside Desk", "role": "outside_admin", "department": "CSE"}
    )
    assert response.status_code == 201, response.text
    # A department makes no sense for this role and is dropped.
    assert response.json()["department"] is None
    return world | {"outside": Api(world["root"].client, "outside@gmail.com")}


# ---------- Outside admins ----------


def test_outside_admin_sees_only_other_colleges_and_schools(outside):
    api = outside["outside"]
    me = api.get("/admin/me").json()
    assert (me["role"], me["department"], me["judge"]) == ("outside_admin", None, False)
    names = {t["name"] for t in api.get("/admin/teams").json()["items"]}
    assert names == {"ABES Team", "DPS Team"}
    assert api.get(f"/admin/teams/{outside['teams']['cse_a']['id']}").status_code == 403
    assert api.get(f"/admin/teams/{outside['teams']['college']['id']}").status_code == 200
    assert api.get("/admin/teams", params={"department": "CSE"}).status_code == 403
    students = api.get("/admin/students", params={"page_size": 100}).json()["items"]
    assert {s["participant_type"] for s in students} == {"college", "school"}
    assert api.get("/admin/finalists/summary").status_code == 403
    assert api.get("/admin/admins").status_code == 403


def test_outside_admin_stats_and_activity(outside):
    api = outside["outside"]
    stats = api.get("/admin/stats").json()
    assert stats["teams"]["total"] == 2 and stats["by_department"] is None
    assert {t["type"] for t in stats["by_type"]} == {"college", "school"}
    assert stats["top_institutions"]
    entries = api.get("/admin/activity", params={"page_size": 100}).json()["items"]
    assert entries and all(e["department"] is None for e in entries)
    codes = {e["team_code"] for e in entries if e["team_code"]}
    assert codes == {outside["teams"]["college"]["code"], outside["teams"]["school"]["code"]}


def test_outside_admin_can_withdraw_their_teams_only(outside):
    api = outside["outside"]
    assert api.post(f"/admin/teams/{outside['teams']['college']['id']}/withdraw", {"reason": "Asked to withdraw"}).status_code == 200
    assert api.post(f"/admin/teams/{outside['teams']['cse_a']['id']}/withdraw", {"reason": "Asked to withdraw"}).status_code == 403


# ---------- Organiser-created teams ----------


def create(api, leader, members=(), **overrides):
    body = {
        **team_input(name=overrides.pop("name", "Desk Team"), category=overrides.pop("category", 2)),
        "leader_email": leader,
        "member_emails": list(members),
        **overrides,
    }
    return api.post("/admin/teams", body)


def test_admin_creates_a_team_while_registration_is_closed(world, student, settings):  # noqa: F811
    for email in ("n1@kiet.edu", "n2@kiet.edu", "n3@kiet.edu"):
        student(email)
    settings.force_registration_open = False
    settings.registration_closes = datetime.now(UTC) - timedelta(days=1)
    settings.registration_opens = datetime.now(UTC) - timedelta(days=10)
    response = create(world["cse"], "n1@kiet.edu", ["n2@kiet.edu", "n3@kiet.edu"], submit=True)
    assert response.status_code == 201, response.text
    team = response.json()
    assert (team["status"], team["department"], team["route"], len(team["members"])) == ("submitted", "CSE", "department", 3)
    assert team["members"][0]["email"] == "n1@kiet.edu" and team["members"][0]["role"] == "leader"
    actions = [e["action"] for e in world["cse"].get("/admin/audit", params={"team_id": team["id"]}).json()]
    assert set(actions) == {"team.created", "team.submitted"}


def test_admin_team_rules(world, student):  # noqa: F811
    student("n1@kiet.edu")
    student("n2@kiet.edu", kiet_profile(department="IT"))
    student("first@kiet.edu", kiet_profile(year=1))
    student("x@gmail.com", college_profile())
    student("y@gmail.com", college_profile(institution="Galgotias University"))
    cse = world["cse"]
    # Leader outside the admin's department.
    assert create(cse, "n2@kiet.edu").status_code == 403
    # Unknown student, duplicates, already in a team.
    assert create(cse, "n1@kiet.edu", ["nobody@kiet.edu"]).status_code == 422
    assert create(cse, "n1@kiet.edu", ["n1@kiet.edu"]).status_code == 422
    assert create(cse, "n1@kiet.edu", ["a@kiet.edu"]).status_code == 409
    # Another institution, category eligibility, too small to submit, name taken.
    assert create(world["root"], "x@gmail.com", ["y@gmail.com"]).status_code == 422
    assert create(cse, "n1@kiet.edu", ["first@kiet.edu"], category=6).status_code == 422
    assert create(cse, "n1@kiet.edu", submit=True).status_code == 422
    assert create(cse, "n1@kiet.edu", name="CSE Alpha").status_code == 409
    # Mixed branches are fine, as for students; a draft of one is fine.
    ok = create(cse, "n1@kiet.edu", ["n2@kiet.edu"])
    assert ok.status_code == 201 and ok.json()["status"] == "draft"


def test_outside_admin_creates_college_teams_only(outside, student):
    student("x@gmail.com", college_profile())
    student("y@gmail.com", college_profile())
    student("n1@kiet.edu")
    api = outside["outside"]
    assert create(api, "n1@kiet.edu").status_code == 403
    response = create(api, "x@gmail.com", ["y@gmail.com"], category=8, submit=True)
    assert response.status_code == 201 and response.json()["route"] == "finale"


def test_created_team_frees_pending_invitations(world, student, as_user):  # noqa: F811
    student("n1@kiet.edu")
    student("n2@kiet.edu")
    student("lead@kiet.edu")
    draft = as_user("lead@kiet.edu").post("/teams", team_input(name="Draft Team")).json()
    assert as_user("lead@kiet.edu").post(f"/teams/{draft['id']}/invitations", {"email": "n2@kiet.edu"}).status_code == 201
    assert create(world["cse"], "n1@kiet.edu", ["n2@kiet.edu"]).status_code == 201
    assert as_user("n2@kiet.edu").get("/me/invitations").json() == []


# ---------- Results date and withdrawing results ----------


def nominate_cse(world):  # noqa: F811
    team = world["teams"]["cse_a"]
    response = world["root"].put("/admin/finalists/CSE", {"nominations": [{"category": 1, "team_ids": [team["id"]]}]})
    assert response.status_code == 200, response.text
    return team


def test_results_wait_for_the_results_date(world, settings):  # noqa: F811
    nominate_cse(world)
    settings.results_publish_from = datetime.now(UTC) + timedelta(days=2)
    summary = world["root"].get("/admin/finalists/summary").json()
    assert "Results can be published from" in summary["publish_blocked"]
    assert publish(world["root"], settings).status_code == 409
    settings.results_publish_from = datetime.now(UTC) - timedelta(minutes=1)
    assert publish(world["root"], settings).status_code == 200


def test_results_date_on_the_schedule(world, settings):  # noqa: F811
    root = world["root"]
    now = datetime.now(UTC)
    base = {
        "registration_opens": (now - timedelta(days=3)).isoformat(),
        "registration_closes": (now + timedelta(days=3)).isoformat(),
        "nominations_deadline": (now + timedelta(days=5)).isoformat(),
    }
    # Before the nominations deadline, or before registration closes: refused.
    assert root.put("/admin/schedule", {**base, "results_publish_from": (now + timedelta(days=4)).isoformat()}).status_code == 422
    good = root.put("/admin/schedule", {**base, "results_publish_from": (now + timedelta(days=6)).isoformat()})
    assert good.status_code == 200 and good.json()["results_due"] is False
    # Leaving the field out keeps it.
    kept = root.put("/admin/schedule", base).json()
    assert kept["results_publish_from"] == good.json()["results_publish_from"]
    cleared = root.put("/admin/schedule", {**base, "results_publish_from": None}).json()
    assert cleared["results_publish_from"] is None and cleared["results_due"] is True


def test_withdrawing_published_results(world, settings):  # noqa: F811
    team = nominate_cse(world)
    root = world["root"]
    assert root.post("/admin/results/unpublish", {"confirm": "UNPUBLISH", "reason": "Not published yet"}).status_code == 409
    assert publish(root, settings).status_code == 200
    assert world["root"].get(f"/admin/teams/{team['id']}").json()["result"] == "finalist"
    assert world["cse"].post("/admin/results/unpublish", {"confirm": "UNPUBLISH", "reason": "Published by mistake"}).status_code == 403
    assert root.post("/admin/results/unpublish", {"confirm": "yes", "reason": "Published by mistake"}).status_code == 422
    assert root.post("/admin/results/unpublish", {"confirm": "UNPUBLISH", "reason": "x"}).status_code == 422
    assert root.post("/admin/results/unpublish", {"confirm": "UNPUBLISH", "reason": "Published by mistake"}).status_code == 204
    results = {t["result"] for t in root.get("/admin/teams", params={"route": "department"}).json()["items"]}
    assert results == {"pending"}
    summary = root.get("/admin/finalists/summary").json()
    assert summary["published_at"] is None
    # Nominations can change again, and it is all in the log.
    assert root.put("/admin/finalists/CSE", {"nominations": [{"category": 1, "team_ids": []}]}).status_code == 200
    assert root.get("/admin/activity", params={"kind": "results"}).json()["items"][0]["action"] == "results.unpublished"


def test_published_results_stay_once_the_finale_is_prepared(world, settings):  # noqa: F811
    team = nominate_cse(world)
    root = world["root"]
    assert publish(root, settings).status_code == 200
    assert root.put("/admin/judging/final/tents", {"tents": [{"team_id": team["id"], "tent": "T-1"}]}).status_code == 200
    summary = root.get("/admin/finalists/summary").json()
    assert "Stalls have been allotted" in summary["unpublish_blocked"]
    assert root.post("/admin/results/unpublish", {"confirm": "UNPUBLISH", "reason": "Published by mistake"}).status_code == 409


# ---------- Activity ----------


def test_activity_pages_filters_and_scope(world):  # noqa: F811
    root, cse = world["root"], world["cse"]
    page = root.get("/admin/activity", params={"page_size": 5}).json()
    assert page["total"] > 5 and len(page["items"]) == 5 and page["page"] == 1
    second = root.get("/admin/activity", params={"page_size": 5, "page": 2}).json()
    assert not {e["id"] for e in page["items"]} & {e["id"] for e in second["items"]}
    assert {e["action"].split(".")[0] for e in root.get("/admin/activity", params={"kind": "admin"}).json()["items"]} == {"admin"}
    found = root.get("/admin/activity", params={"q": world["teams"]["it_a"]["code"]}).json()["items"]
    assert found and all(e["team_code"] == world["teams"]["it_a"]["code"] for e in found)
    assert {e["department"] for e in cse.get("/admin/activity", params={"page_size": 100}).json()["items"]} == {"CSE"}
    assert cse.get("/admin/activity", params={"department": "IT"}).status_code == 403
    assert root.get("/admin/activity", params={"kind": "nope"}).status_code == 422


# ---------- Years ----------


def test_year_filters_and_breakdown(as_user, student, team_of):
    root = as_user("root@kiet.edu")
    team_of(student("f1@kiet.edu", kiet_profile(year=1)), [student("f2@kiet.edu", kiet_profile(year=1))], name="Freshers", category=6)
    team_of(student("m3@kiet.edu", kiet_profile(year=3)), [student("m1@kiet.edu", kiet_profile(year=1))], name="Mixed Years", category=1)
    school = team_of(
        student("s@gmail.com", school_profile(year=11)), [student("t@gmail.com", school_profile(year=12))], name="School Kids", category=7
    )
    names = lambda params: {t["name"] for t in root.get("/admin/teams", params=params).json()["items"]}  # noqa: E731
    assert names({"year": 1}) == {"Freshers", "Mixed Years"}
    assert names({"leader_year": 1}) == {"Freshers"}
    assert names({"leader_year": 3}) == {"Mixed Years"}
    assert names({"year": 12}) == {"School Kids"}
    ordered = [t["name"] for t in root.get("/admin/teams", params={"sort": "leader_year", "order": "desc"}).json()["items"]]
    assert ordered == ["School Kids", "Mixed Years", "Freshers"]
    assert root.get("/admin/teams", params={"year": 13}).status_code == 422

    years = {(r["participant_type"], r["year"]): r for r in root.get("/admin/stats").json()["by_year"]}
    assert (years[("kiet", 1)]["students"], years[("kiet", 1)]["teams_led"], years[("kiet", 1)]["teams_with"]) == (3, 1, 2)
    assert (years[("kiet", 3)]["teams_led"], years[("kiet", 3)]["teams_with"]) == (1, 1)
    assert years[("school", 12)]["teams_with"] == 1 and years[("school", 12)]["teams_led"] == 0

    # Team summaries carry the leader's year and every member's, the leader's first.
    assert as_user("s@gmail.com").post(f"/teams/{school['id']}/submit").status_code == 200
    direct = root.get("/admin/finalists/summary").json()["direct_teams"]
    assert [(t["leader_year"], t["member_years"]) for t in direct] == [(11, [11, 12])]


def test_college_and_school_admins_see_only_their_own_type(world, as_user):  # noqa: F811
    root = world["root"]
    for email, role in (("college.desk@kiet.edu", "college_admin"), ("school.desk@kiet.edu", "school_admin")):
        made = root.post("/admin/admins", {"email": email, "name": "Desk", "role": role, "department": "CSE"})
        assert made.status_code == 201 and made.json()["department"] is None
    college, school = Api(root.client, "college.desk@kiet.edu"), Api(root.client, "school.desk@kiet.edu")
    assert {t["participant_type"] for t in college.get("/admin/teams").json()["items"]} == {"college"}
    assert {t["participant_type"] for t in school.get("/admin/teams").json()["items"]} == {"school"}
    assert {s["participant_type"] for s in school.get("/admin/students", params={"page_size": 100}).json()["items"]} == {"school"}
    assert college.get(f"/admin/teams/{world['teams']['school']['id']}").status_code == 403
    assert school.get(f"/admin/teams/{world['teams']['college']['id']}").status_code == 403
    assert school.get(f"/admin/teams/{world['teams']['cse_a']['id']}").status_code == 403
    assert [t["type"] for t in school.get("/admin/stats").json()["by_type"]] == ["school"]
    body = {**college_profile(), "email": "new.college@gmail.com"}
    assert school.post("/admin/students", body).status_code == 403
    assert college.post("/admin/students", body).status_code == 201
