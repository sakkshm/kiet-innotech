"""Super admins deleting a student's profile: team leaders hand over, lone leaders take their team with them."""

import uuid

from test_bans import students

from conftest import kiet_profile


def uid(root, email):
    return students(root)[email]["user_id"]


def delete(root, email):
    return root.post(f"/admin/students/{uid(root, email)}/delete", {"reason": "Duplicate account"})


def test_only_a_super_admin_can_delete_and_a_reason_is_needed(as_user, student):
    root, cse = as_user("root@kiet.edu"), as_user("cse@kiet.edu")
    root.post("/admin/admins", {"email": "cse@kiet.edu", "name": "CSE", "role": "admin", "department": "CSE"})
    student("a@kiet.edu")
    user_id = uid(root, "a@kiet.edu")
    assert cse.post(f"/admin/students/{user_id}/delete", {"reason": "Duplicate account"}).status_code == 403
    assert root.post(f"/admin/students/{user_id}/delete", {"reason": "x"}).status_code == 422
    assert root.post(f"/admin/students/{uuid.uuid4()}/delete", {"reason": "Duplicate account"}).status_code == 404
    assert root.post(f"/admin/students/{user_id}/delete", {"reason": "Duplicate account"}).status_code == 200
    assert "a@kiet.edu" not in students(root)
    assert root.post(f"/admin/students/{user_id}/delete", {"reason": "Duplicate account"}).status_code == 404
    # They can sign in again and register afresh.
    me = as_user("a@kiet.edu")
    assert me.get("/me").json()["profile"] is None
    assert me.put("/me/profile", kiet_profile()).status_code == 200


def test_a_leader_hands_the_team_to_a_team_mate(as_user, student, team_of):
    root = as_user("root@kiet.edu")
    leader, m1, m2 = student("lead@kiet.edu"), student("m1@kiet.edu"), student("m2@kiet.edu")
    team = team_of(leader, [m1, m2])
    response = delete(root, "lead@kiet.edu")
    assert response.status_code == 200 and "now leader" in response.json()["message"]
    seen = root.get(f"/admin/teams/{team['id']}").json()
    assert len(seen["members"]) == 2
    leaders = [m["email"] for m in seen["members"] if m["role"] == "leader"]
    assert len(leaders) == 1 and leaders[0] in {"m1@kiet.edu", "m2@kiet.edu"}
    assert root.get("/admin/activity", params={"kind": "student"}).json()["items"][0]["action"] == "student.deleted"
    new_leader = m1 if leaders[0] == "m1@kiet.edu" else m2
    assert new_leader.post(f"/teams/{team['id']}/invitations", {"email": "m1@kiet.edu"}).status_code != 403


def test_a_lone_leader_takes_the_team_and_a_member_just_leaves(as_user, student, team_of):
    root = as_user("root@kiet.edu")
    solo = student("solo@kiet.edu")
    team = team_of(solo)
    response = delete(root, "solo@kiet.edu")
    assert response.status_code == 200 and "deleted too" in response.json()["message"]
    assert root.get(f"/admin/teams/{team['id']}").status_code == 404

    leader, member = student("l2@kiet.edu"), student("mem@kiet.edu")
    team = team_of(leader, [member])
    assert delete(root, "mem@kiet.edu").status_code == 200
    seen = root.get(f"/admin/teams/{team['id']}").json()
    assert [m["email"] for m in seen["members"]] == ["l2@kiet.edu"]


def test_a_submitted_team_is_never_left_invalid(as_user, student, team_of):
    root = as_user("root@kiet.edu")
    leader, member = student("sl@kiet.edu"), student("sm@kiet.edu")
    team = team_of(leader, [member])
    assert leader.post(f"/teams/{team['id']}/submit").status_code == 200
    response = delete(root, "sm@kiet.edu")
    assert response.status_code == 409 and "submitted" in response.json()["detail"]
    # Nothing changed.
    assert len(root.get(f"/admin/teams/{team['id']}").json()["members"]) == 2
    assert "sm@kiet.edu" in students(root)
    # With a spare member, the same deletion is fine.
    spare = student("sp@kiet.edu")
    other = team_of(student("ol@kiet.edu"), [student("om@kiet.edu"), spare], name="Other Team")
    assert student("ol@kiet.edu").post(f"/teams/{other['id']}/submit").status_code == 200
    assert delete(root, "sp@kiet.edu").status_code == 200
