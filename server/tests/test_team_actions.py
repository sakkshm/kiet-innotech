"""Super admins reopening a submitted team as a draft, and dissolving a team."""

from datetime import UTC, datetime, timedelta

from test_admin import publish, world  # noqa: F401  (fixture)

from conftest import team_input

REASON = {"reason": "Wrong member was added"}


def test_only_a_super_admin_can_reopen_or_dissolve(world):  # noqa: F811
    team = world["teams"]["cse_a"]
    for admin in (world["cse"], world["it"]):
        assert admin.post(f"/admin/teams/{team['id']}/reopen", REASON).status_code == 403
        assert admin.post(f"/admin/teams/{team['id']}/dissolve", REASON).status_code == 403
    assert world["root"].get(f"/admin/teams/{team['id']}").json()["status"] == "submitted"


def test_reopening_sends_a_team_back_to_draft_and_it_can_be_submitted_again(world, as_user):  # noqa: F811
    root, team = world["root"], world["teams"]["cse_a"]
    root.put("/admin/finalists/CSE", {"nominations": [{"category": 1, "team_ids": [team["id"]]}]})
    assert root.post(f"/admin/teams/{team['id']}/reopen", {"reason": "x"}).status_code == 422

    reopened = root.post(f"/admin/teams/{team['id']}/reopen", REASON)
    assert reopened.status_code == 200, reopened.text
    assert (reopened.json()["status"], reopened.json()["submitted_at"], reopened.json()["result"]) == ("draft", None, "pending")
    # The nomination went with it, and the history records who and why.
    assert root.get("/admin/finalists", params={"department": "CSE"}).json()["categories"][0]["nominated"] == []
    entry = root.get("/admin/audit", params={"team_id": team["id"], "limit": 5}).json()[0]
    assert entry["action"] == "team.reopened" and "Wrong member" in entry["detail"]

    # The leader can change it and submit again.
    leader = as_user("a@kiet.edu")
    assert leader.patch(f"/teams/{team['id']}", team_input(name="CSE Alpha Fixed", category=1)).status_code == 200
    assert leader.post(f"/teams/{team['id']}/submit").status_code == 200
    # Reopening a draft, or a withdrawn team, is a conflict.
    other = world["teams"]["cse_b"]
    root.post(f"/admin/teams/{other['id']}/withdraw", REASON)
    assert root.post(f"/admin/teams/{other['id']}/reopen", REASON).status_code == 409
    root.post(f"/admin/teams/{team['id']}/reopen", REASON)
    assert root.post(f"/admin/teams/{team['id']}/reopen", REASON).status_code == 409


def test_reopening_needs_registration_to_be_open(world, settings):  # noqa: F811
    team = world["teams"]["cse_a"]
    settings.force_registration_open = False
    settings.registration_opens = datetime.now(UTC) - timedelta(days=10)
    settings.registration_closes = datetime.now(UTC) - timedelta(days=1)
    refused = world["root"].post(f"/admin/teams/{team['id']}/reopen", REASON)
    assert refused.status_code == 409 and "Registration is closed" in refused.json()["detail"]
    assert world["root"].get(f"/admin/teams/{team['id']}").json()["status"] == "submitted"


def setup_room(world, team):  # noqa: F811
    root = world["root"]
    room = root.post(
        "/admin/panels",
        {
            "round": "department",
            "department": "CSE",
            "building": "CSIT Block",
            "name": "Room 1",
            "slot_start": "2026-10-22T10:00:00+05:30",
            "slot_end": "2026-10-22T13:00:00+05:30",
        },
    ).json()
    assert root.put(f"/admin/panels/{room['id']}/teams", {"team_ids": [team["id"]]}).status_code == 200


def test_judging_blocks_reopening_and_dissolving(world):  # noqa: F811
    root, team = world["root"], world["teams"]["cse_a"]
    setup_room(world, team)
    for action in ("reopen", "dissolve"):
        refused = root.post(f"/admin/teams/{team['id']}/{action}", REASON)
        assert refused.status_code == 409 and "allotted" in refused.json()["detail"], action
    assert root.get(f"/admin/teams/{team['id']}").json()["status"] == "submitted"
    # A finale team with a tent is blocked too.
    college = world["teams"]["college"]
    assert root.put("/admin/judging/final/tents", {"tents": [{"team_id": college["id"], "tent": "T-1"}]}).status_code == 200
    assert "stall" in root.post(f"/admin/teams/{college['id']}/dissolve", REASON).json()["detail"]


def test_published_results_block_reopening_kiet_teams(world, settings):  # noqa: F811
    root = world["root"]
    cse = world["teams"]["cse_a"]
    root.put("/admin/finalists/CSE", {"nominations": [{"category": 1, "team_ids": [cse["id"]]}]})
    assert publish(root, settings).status_code == 200
    refused = root.post(f"/admin/teams/{world['teams']['cse_b']['id']}/reopen", REASON)
    assert refused.status_code == 409 and "published" in refused.json()["detail"]
    # A published finalist cannot be dissolved; a team that was not selected can.
    assert "finalist" in root.post(f"/admin/teams/{cse['id']}/dissolve", REASON).json()["detail"]
    assert root.post(f"/admin/teams/{world['teams']['cse_b']['id']}/dissolve", REASON).status_code == 204
    # A team from another college is not part of the department results, so it can still be reopened.
    assert root.post(f"/admin/teams/{world['teams']['college']['id']}/reopen", REASON).status_code == 200


def test_dissolving_frees_the_members(world, as_user, student):  # noqa: F811
    root, team = world["root"], world["teams"]["cse_b"]
    assert root.post(f"/admin/teams/{team['id']}/dissolve", {"reason": "x"}).status_code == 422
    assert root.post(f"/admin/teams/{team['id']}/dissolve", REASON).status_code == 204
    assert root.get(f"/admin/teams/{team['id']}").status_code == 404
    assert root.post(f"/admin/teams/{team['id']}/dissolve", REASON).status_code == 404
    # Both former members have no team and can start again.
    for email in ("c@kiet.edu", "d@kiet.edu"):
        assert as_user(email).get("/me/team").status_code in (200, 404) and not as_user(email).get("/me/team").json()
    assert as_user("c@kiet.edu").post("/teams", team_input(name="Fresh Start", category=2)).status_code == 201
    # The record stays in the activity log, with the team code and the members.
    entries = root.get("/admin/activity", params={"q": team["code"], "page_size": 50}).json()["items"]
    dissolved = next(e for e in entries if e["action"] == "team.dissolved")
    assert "c@kiet.edu" in dissolved["detail"] and "Wrong member" in dissolved["detail"]
    # A withdrawn team can be dissolved too.
    other = world["teams"]["cse_c"]
    root.post(f"/admin/teams/{other['id']}/withdraw", REASON)
    assert root.post(f"/admin/teams/{other['id']}/dissolve", REASON).status_code == 204
