"""Bulk actions on teams: who may use them, one team's refusal never stops the rest, and rejecting other-college and school teams."""

import uuid
from datetime import UTC, datetime, timedelta

from test_admin import world  # noqa: F401  (fixture)
from test_judging import judging  # noqa: F401  (fixture)


def bulk(admin, action, ids, reason="Because the organisers decided so", **extra):
    body = {"team_ids": ids, "action": action, **extra}
    if reason is not None:
        body["reason"] = reason
    return admin.post("/admin/teams/bulk", body)


def status_of(admin, team):
    return admin.get(f"/admin/teams/{team['id']}").json()["status"]


def test_bulk_withdraw_disqualify_and_restore(world):  # noqa: F811
    root, cse = world["root"], world["cse"]
    a, b, c, it_a, college = (world["teams"][k] for k in ("cse_a", "cse_b", "cse_c", "it_a", "college"))

    # A reason is required, and an unknown action is refused.
    assert bulk(root, "disqualify", [a["id"]], reason=None).status_code == 422
    assert bulk(root, "disqualify", [a["id"]], reason="no").status_code == 422
    assert bulk(root, "explode", [a["id"]]).status_code == 422

    # Disqualifying is for super admins; a department admin gets a refusal and nothing changes.
    assert bulk(cse, "disqualify", [a["id"]]).status_code == 403
    assert status_of(root, a) == "submitted"

    # A department admin may withdraw their own department's teams; another department's team is "not found".
    out = bulk(cse, "withdraw", [c["id"], it_a["id"]]).json()
    assert (out["changed"], out["not_found"], out["skipped"]) == (1, 1, [])
    assert (status_of(root, c), status_of(root, it_a)) == ("withdrawn", "submitted")

    out = bulk(root, "disqualify", [a["id"], b["id"], college["id"], str(uuid.uuid4())]).json()
    assert (out["action"], out["changed"], out["not_found"], out["skipped"]) == ("disqualify", 3, 1, [])
    assert [status_of(root, t) for t in (a, b, college)] == ["disqualified"] * 3

    # Teams that cannot change are skipped and listed.
    out = bulk(root, "disqualify", [a["id"], c["id"]]).json()
    assert out["changed"] == 0
    assert {s["code"] for s in out["skipped"]} == {a["code"], c["code"]}
    assert all("already" in s["reason"] for s in out["skipped"])

    # Restoring brings back withdrawn and disqualified teams; a submitted one is skipped.
    out = bulk(root, "restore", [a["id"], b["id"], c["id"], college["id"], it_a["id"]]).json()
    assert out["changed"] == 4
    assert [s["code"] for s in out["skipped"]] == [it_a["code"]]
    assert [status_of(root, t) for t in (a, b, c, college, it_a)] == ["submitted"] * 5

    # Every change is in the audit log, one entry per team.
    log = root.get("/admin/activity", params={"kind": "team", "page_size": 100}).json()["items"]
    actions = [e["action"] for e in log]
    assert (actions.count("team.disqualified"), actions.count("team.withdrawn"), actions.count("team.restored")) == (3, 1, 4)


def test_bulk_archive_and_submit_drafts(world, settings, student, team_of):  # noqa: F811
    root = world["root"]
    # Teams are built while registration is open; it closes afterwards.
    draft_1 = team_of(student("m@kiet.edu"), [student("n@kiet.edu")], name="Draft One", category=2)
    draft_2 = team_of(student("o@kiet.edu"), [student("p@kiet.edu")], name="Draft Two", category=2)
    settings.force_registration_open = False
    settings.registration_opens = datetime.now(UTC) - timedelta(days=10)
    settings.registration_closes = datetime.now(UTC) - timedelta(days=1)
    submitted = world["teams"]["cse_a"]
    ids = [draft_1["id"], draft_2["id"], submitted["id"]]

    assert bulk(world["cse"], "archive", ids).status_code == 403
    out = bulk(root, "archive", ids, reason="Never submitted").json()
    assert out["changed"] == 2
    assert [s["code"] for s in out["skipped"]] == [submitted["code"]] and "not a draft" in out["skipped"][0]["reason"]
    assert [status_of(root, t) for t in (draft_1, draft_2)] == ["archived", "archived"]

    # Late entries: archived drafts are submitted again in one go, even though registration is closed.
    out = bulk(root, "submit", [draft_1["id"], draft_2["id"], submitted["id"]], reason="Late entries approved by the dean").json()
    assert out["changed"] == 2
    assert "Only a draft or archived team" in out["skipped"][0]["reason"]
    assert [status_of(root, t) for t in (draft_1, draft_2)] == ["submitted", "submitted"]

    # The older archive endpoint still works and shares the same rules.
    old = root.post("/admin/teams/archive", {"team_ids": [submitted["id"]], "reason": "Test of the old endpoint"}).json()
    assert old["archived"] == 0 and "not a draft" in old["skipped"][0]["reason"]


def test_reject_other_college_and_school_teams(judging, as_user):  # noqa: F811
    root, cse = judging["root"], judging["cse"]
    college, school, cse_a = (judging["teams"][k] for k in ("college", "school", "cse_a"))
    leader, pupil = as_user("r@gmail.com"), as_user("k@gmail.com")
    cards = lambda who: [(c["round"], c["status"]) for c in who.get("/me/results").json()["cards"]]  # noqa: E731

    # Needs a reason, and only the people who accept teams can reject them.
    assert bulk(root, "reject", [college["id"]], reason=None).status_code == 422
    assert bulk(cse, "reject", [college["id"]]).status_code == 403

    out = bulk(root, "reject", [college["id"], school["id"], cse_a["id"]], reason="Not an original project").json()
    assert (out["changed"], out["not_found"]) == (2, 0)
    assert [s["code"] for s in out["skipped"]] == [cse_a["code"]] and "does not need acceptance" in out["skipped"][0]["reason"]
    # Rejecting again changes nothing.
    assert bulk(root, "reject", [college["id"]], reason="Not an original project").json()["changed"] == 0

    # What the students see, with the reason the organisers gave.
    assert cards(leader) == [("final", "rejected")] == cards(pupil)
    card = leader.get("/me/results").json()["cards"][0]
    assert "not accepted" in card["title"] and "Not an original project" in card["message"] and "no stall" in card["message"]
    mine = leader.get("/me/team").json()
    assert mine["rejected_at"] is not None and mine["rejected_reason"] == "Not an original project" and mine["approved_at"] is None

    # Admin side: the approval filter and the counts, and a rejected team gets no stall.
    rejected = root.get("/admin/teams", params={"approval": "rejected"}).json()
    assert {t["code"] for t in rejected["items"]} == {college["code"], school["code"]}
    assert root.get("/admin/teams", params={"approval": "pending"}).json()["total"] == 0
    assert root.get("/admin/stats").json()["awaiting_approval"] == 0
    assert root.get(f"/admin/teams/{college['id']}").json()["rejected_reason"] == "Not an original project"
    refused = root.put("/admin/judging/final/tents", {"tents": [{"team_id": college["id"], "tent": "S-1"}]})
    assert refused.status_code == 422

    # Accepting a rejected team clears the rejection.
    out = bulk(root, "accept", [college["id"]], reason=None).json()
    assert out["changed"] == 1
    assert cards(leader) == [("final", "qualified")]
    assert leader.get("/me/team").json()["rejected_at"] is None
    assert root.get("/admin/teams", params={"approval": "rejected"}).json()["total"] == 1

    # Rejecting an accepted team takes the acceptance away; with a stall it is refused and listed.
    assert root.put("/admin/judging/final/tents", {"tents": [{"team_id": college["id"], "tent": "S-1"}]}).status_code == 200
    out = bulk(root, "reject", [college["id"]], reason="Changed our mind").json()
    assert out["changed"] == 0 and "stall" in out["skipped"][0]["reason"].lower()
    assert cards(leader) == [("final", "qualified")]

    # Back to the queue clears a rejection; the team waits for a decision again.
    out = bulk(root, "unaccept", [school["id"]], reason=None).json()
    assert out["changed"] == 1
    assert cards(pupil) == [("final", "awaiting")]
    assert root.get("/admin/teams", params={"approval": "pending"}).json()["total"] == 1

    # The single-team accept also clears a rejection.
    assert bulk(root, "reject", [school["id"]], reason="Wrong category entered").json()["changed"] == 1
    assert root.post(f"/admin/teams/{school['id']}/approve").status_code == 200
    assert root.get(f"/admin/teams/{school['id']}").json()["rejected_at"] is None

    actions = {e["action"] for e in root.get("/admin/activity", params={"kind": "team", "page_size": 100}).json()["items"]}
    assert {"team.rejected", "team.rejection_revoked", "team.approved"} <= actions


def test_bulk_accept_and_queue_match_the_older_endpoint(world):  # noqa: F811
    root = world["root"]
    college, school, cse_a = (world["teams"][k] for k in ("college", "school", "cse_a"))
    ids = [college["id"], school["id"], cse_a["id"]]
    out = bulk(root, "accept", ids, reason=None).json()
    assert out["changed"] == 2 and "does not need acceptance" in out["skipped"][0]["reason"]
    assert bulk(root, "accept", ids, reason=None).json()["changed"] == 0
    out = bulk(root, "unaccept", ids, reason=None).json()
    assert out["changed"] == 2
    # Department admins cannot accept, reject or queue anything.
    for action in ("accept", "unaccept", "reject"):
        assert bulk(world["cse"], action, [cse_a["id"]]).status_code == 403
