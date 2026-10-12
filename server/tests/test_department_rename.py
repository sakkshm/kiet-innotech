"""AM was renamed AMIA: the new name is the one that works, and the old code is still understood."""

from conftest import kiet_profile, team_input


def test_amia_is_a_department_and_am_is_read_as_amia(as_user):
    api = as_user("a@kiet.edu")
    saved = api.put("/me/profile", kiet_profile(department="AMIA"))
    assert saved.status_code == 200 and saved.json()["department"] == "AMIA"
    # A page opened before the rename still sends AM: it is stored as AMIA.
    legacy = as_user("b@kiet.edu").put("/me/profile", kiet_profile(department="AM"))
    assert legacy.status_code == 200 and legacy.json()["department"] == "AMIA"


def test_amia_admin_sees_amia_teams_and_am_is_read_as_amia(as_user, student, team_of):
    root = as_user("root@kiet.edu")
    team = team_of(student("lead@kiet.edu", kiet_profile(department="AMIA")), [student("m@kiet.edu")], name="AMIA Crew")
    assert team["department"] == "AMIA"
    admin = root.post("/admin/admins", {"email": "amia.admin@kiet.edu", "name": "AMIA Desk", "role": "admin", "department": "AM"})
    assert admin.status_code == 201 and admin.json()["department"] == "AMIA"
    desk = as_user("amia.admin@kiet.edu")
    assert [t["name"] for t in desk.get("/admin/teams").json()["items"]] == ["AMIA Crew"]
    stats = root.get("/admin/stats").json()
    assert "AMIA" in {row["department"] for row in stats["by_department"]}
    assert "AM" not in {row["department"] for row in stats["by_department"]}


def test_amia_has_its_own_finalist_board(as_user):
    root = as_user("root@kiet.edu")
    assert root.get("/admin/finalists", params={"department": "AMIA"}).status_code == 200
