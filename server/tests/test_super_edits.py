"""Super admins editing student profiles and teams (details, members, leader)."""

from test_admin import world  # noqa: F401  (fixture)

from conftest import college_profile, kiet_profile, team_input

REASON = {"reason": "Corrected at the help desk"}


def student_id(root, email):
    items = root.get("/admin/students", params={"page_size": 100}).json()["items"]
    return next(s["user_id"] for s in items if s["email"] == email)


def profile_body(roll_number="2300290100999", **overrides):
    return {**kiet_profile(roll=roll_number, **overrides), "full_name": "Corrected Name", **REASON}


# ---------- Students ----------


def test_only_a_super_admin_edits_a_student(world, student):  # noqa: F811
    root = world["root"]
    uid = student_id(root, "a@kiet.edu")
    assert world["cse"].put(f"/admin/students/{uid}", profile_body()).status_code == 403
    assert root.put(f"/admin/students/{uid}", {**profile_body(), "reason": "x"}).status_code == 422
    done = root.put(f"/admin/students/{uid}", profile_body(phone="9811122233"))
    assert done.status_code == 200, done.json()
    assert (done.json()["full_name"], done.json()["phone"], done.json()["roll_number"]) == ("Corrected Name", "9811122233", "2300290100999")
    assert done.json()["email"] == "a@kiet.edu"
    # Same values again: nothing to change.
    assert root.put(f"/admin/students/{uid}", profile_body(phone="9811122233")).status_code == 409
    first = root.get("/admin/activity", params={"kind": "student"}).json()["items"][0]
    assert first["action"] == "student.edited" and "full_name" in first["detail"] and "Corrected Name" in first["detail"]
    assert "9811122233" not in first["detail"]


def test_a_roll_number_stays_unique(world):  # noqa: F811
    root = world["root"]
    first, second = student_id(root, "a@kiet.edu"), student_id(root, "b@kiet.edu")
    taken = root.get("/admin/students", params={"q": "b@kiet.edu"}).json()["items"][0]["roll_number"]
    refused = root.put(f"/admin/students/{first}", profile_body(roll_number=taken))
    assert refused.status_code == 409 and "roll number" in refused.json()["detail"].lower()
    assert second  # the other student is untouched
    assert root.get("/admin/students", params={"q": "a@kiet.edu"}).json()["items"][0]["full_name"] != "Corrected Name"


def test_a_student_in_a_team_cannot_change_college_or_break_the_team(root_and_team):
    root, team, lead = root_and_team
    uid = student_id(root, "lead@kiet.edu")
    # Year changes are fine while the category still allows them.
    ok = root.put(f"/admin/students/{uid}", profile_body(year=2, roll_number=lead["roll"]))
    assert ok.status_code == 200, ok.json()
    # A KIET student cannot become a startup or another college while in a team.
    assert root.put(f"/admin/students/{uid}", {**college_profile(), **REASON}).status_code == 422
    # The leader's department change moves the team.
    moved = root.put(f"/admin/students/{uid}", profile_body(department="IT", roll_number=lead["roll"]))
    assert moved.status_code == 200, moved.json()
    assert root.get(f"/admin/teams/{team['id']}").json()["department"] == "IT"
    # Moving between COE KIET and a department is refused while in a team.
    coe = root.put(f"/admin/students/{uid}", profile_body(department="COE", club="Robotics Club", roll_number=lead["roll"]))
    assert coe.status_code == 409


import pytest  # noqa: E402


@pytest.fixture
def root_and_team(as_user, student, team_of):
    root = as_user("root@kiet.edu")
    profile = kiet_profile(department="CSE", year=3, roll="2300290100111")
    lead = student("lead@kiet.edu", profile)
    mate = student("mate@kiet.edu")
    team = team_of(lead, [mate])
    return root, team, {"roll": "2300290100111"}


# ---------- Teams ----------


def test_a_super_admin_edits_team_details_even_when_submitted(world):  # noqa: F811
    root, team = world["root"], world["teams"]["cse_a"]
    status_before = root.get(f"/admin/teams/{team['id']}").json()["status"]
    assert world["cse"].put(f"/admin/teams/{team['id']}", {**team_input(name="X Team"), **REASON}).status_code == 403
    body = {**team_input(name="Renamed Team", category=team["category"]), "project_title": "A better title", **REASON}
    done = root.put(f"/admin/teams/{team['id']}", body)
    assert done.status_code == 200, done.json()
    assert (done.json()["name"], done.json()["project_title"], done.json()["status"]) == ("Renamed Team", "A better title", status_before)
    assert root.put(f"/admin/teams/{team['id']}", body).status_code == 409
    # A name another team uses is refused and nothing changes.
    other = world["teams"]["cse_b"]
    taken = {**team_input(name="Renamed Team", category=other["category"]), **REASON}
    assert root.put(f"/admin/teams/{other['id']}", taken).status_code == 409
    assert root.get(f"/admin/teams/{other['id']}").json()["name"] == other["name"]
    assert root.get("/admin/activity", params={"kind": "team"}).json()["items"][0]["action"] == "team.edited"


def test_members_can_be_added_removed_and_the_leader_changed(as_user, student, team_of):
    root = as_user("root@kiet.edu")
    lead, mate = student("lead@kiet.edu"), student("mate@kiet.edu")
    student("spare@kiet.edu")
    team = team_of(lead, [mate])
    path = f"/admin/teams/{team['id']}"
    assert root.post(f"{path}/members", {"email": "spare@kiet.edu", **REASON}).json()["members"][2]["email"] == "spare@kiet.edu"
    # Already in a team / unknown / twice.
    assert root.post(f"{path}/members", {"email": "spare@kiet.edu", **REASON}).status_code == 409
    assert root.post(f"{path}/members", {"email": "nobody@kiet.edu", **REASON}).status_code == 422
    # The leader cannot be removed; hand over first.
    leader_id = student_id(root, "lead@kiet.edu")
    assert root.post(f"{path}/members/{leader_id}/remove", REASON).status_code == 409
    spare_id = student_id(root, "spare@kiet.edu")
    changed = root.post(f"{path}/leader", {"user_id": spare_id, **REASON})
    assert changed.status_code == 200, changed.json()
    assert {m["email"]: m["role"] for m in changed.json()["members"]}["spare@kiet.edu"] == "leader"
    assert changed.json()["leader_id"] == spare_id
    removed = root.post(f"{path}/members/{leader_id}/remove", REASON)
    assert removed.status_code == 200 and [m["email"] for m in removed.json()["members"]].count("lead@kiet.edu") == 0
    # The removed student is free: they can start a team of their own.
    assert as_user("lead@kiet.edu").post("/teams", team_input(name="Second Chance")).status_code == 201
    actions = {e["action"] for e in root.get("/admin/activity", params={"kind": "team"}).json()["items"]}
    assert {"team.member_added", "team.member_removed", "team.leader_changed"} <= actions


def test_a_submitted_team_cannot_be_left_invalid(as_user, student, team_of):
    root = as_user("root@kiet.edu")
    lead, mate = student("lead@kiet.edu"), student("mate@kiet.edu")
    team = team_of(lead, [mate])
    assert lead.post(f"/teams/{team['id']}/submit").status_code == 200
    mate_id = student_id(root, "mate@kiet.edu")
    refused = root.post(f"/admin/teams/{team['id']}/members/{mate_id}/remove", REASON)
    assert refused.status_code == 409 and "no longer be valid" in refused.json()["detail"]
    assert len(root.get(f"/admin/teams/{team['id']}").json()["members"]) == 2


def test_member_rules_are_enforced(as_user, student, team_of):
    root = as_user("root@kiet.edu")
    lead, mate = student("lead@kiet.edu"), student("mate@kiet.edu")
    team = team_of(lead, [mate])
    outsider = as_user("someone@gmail.com")
    assert outsider.put("/me/profile", college_profile()).status_code == 200
    mismatch = root.post(f"/admin/teams/{team['id']}/members", {"email": "someone@gmail.com", **REASON})
    assert mismatch.status_code == 422 and "same college or school" in mismatch.json()["detail"]
    # A team holds five members at most.
    for i in range(3):
        student(f"extra{i}@kiet.edu")
        assert root.post(f"/admin/teams/{team['id']}/members", {"email": f"extra{i}@kiet.edu", **REASON}).status_code == 200
    student("sixth@kiet.edu")
    assert root.post(f"/admin/teams/{team['id']}/members", {"email": "sixth@kiet.edu", **REASON}).status_code == 422
