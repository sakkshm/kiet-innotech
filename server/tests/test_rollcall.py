"""Attendance by student for admins: nobody is present until marked, filters by department, year and slot, bulk marking."""

from test_admin import world  # noqa: F401  (fixture)
from test_judging import judging, set_room  # noqa: F401  (fixture)

from conftest import Api


def uid(as_user, email):
    return as_user(email).get("/me/pass").json()["user_id"]


def listed(admin, **params):
    response = admin.get("/admin/attendance/students", params={"page_size": 100, **params})
    assert response.status_code == 200, response.text
    return response.json()


def mark(admin, ids, present):
    return admin.post("/admin/attendance/students/mark", {"user_ids": ids, "present": present})


def test_nobody_is_present_until_marked_and_marks_are_added_not_replaced(judging, as_user):  # noqa: F811
    root, cse, it = judging["root"], judging["cse"], judging["it"]
    set_room(judging)
    ua, ub, uc = (uid(as_user, e) for e in ("a@kiet.edu", "b@kiet.edu", "c@kiet.edu"))
    # A judge-style absent mark that exists already (team based endpoint) must survive untouched.
    assert cse.put(f"/admin/teams/{judging['teams']['cse_a']['id']}/attendance/{ua}", {"present": False}).status_code == 200

    first = listed(root)
    # Every student of the department round, with no team in the answer; the unmarked count as absent.
    assert (first["students"], first["present"], first["absent"], first["not_marked"]) == (8, 0, 1, 7)
    assert all("team_code" not in row and "team_name" not in row for row in first["items"])
    states = {row["user_id"]: row["state"] for row in first["items"]}
    assert states[ua] == "absent" and states[ub] == "not_marked"

    # Marking present changes the marked ones only; marking the same again changes nothing.
    done = mark(root, [ua, ub], True).json()
    assert (done["changed"], done["unchanged"], done["skipped"], done["not_found"]) == (2, 0, [], 0)
    after = listed(root)
    assert (after["present"], after["absent"], after["not_marked"]) == (2, 0, 6)
    assert {r["user_id"]: r["state"] for r in after["items"]}[ub] == "present"
    again = mark(root, [ua, ub], True).json()
    assert (again["changed"], again["unchanged"]) == (0, 2)
    # And absent: an explicit mark, no longer "not marked".
    assert mark(root, [uc], False).json()["changed"] == 1
    assert {r["user_id"]: r["state"] for r in listed(root)["items"]}[uc] == "absent"
    log = root.get("/admin/activity", params={"kind": "attendance", "page_size": 100}).json()["items"]
    assert [e["action"] for e in log].count("attendance.marked") == 2

    # The judges' side is unchanged: nobody marked absent in a team means it can still be scored; the room still lists everyone.
    room = judging["it_prof"].get("/judge").json()["panels"][0]
    assert all(t["all_absent"] is False for t in room["teams"])
    assert it.get("/admin/attendance/students").status_code == 200


def test_filters_by_department_year_slot_status_and_search(judging, as_user):  # noqa: F811
    root = judging["root"]
    set_room(judging)
    ua, ug = uid(as_user, "a@kiet.edu"), uid(as_user, "g@kiet.edu")
    mark(root, [ua], True)

    everyone = listed(root)
    assert everyone["years"] == {"3": 8} and everyone["students"] == 8
    # Department is the student's own: b@kiet.edu is an IT student in a CSE team.
    assert listed(root, department="IT")["total"] == 3 and listed(root, department="CSE")["total"] == 5
    assert listed(root, year=3)["total"] == 8 and listed(root, year=2)["total"] == 0
    # Two slots, by the team's room: the CSE room (b@kiet.edu sits there) and IT's planned slot from the timetable.
    keys = [s["key"] for s in everyone["slots"]]
    assert len(keys) == 2
    by_slot = {key: listed(root, slot=key)["total"] for key in keys}
    assert sorted(by_slot.values()) == [2, 6]
    # Status: the tiles keep their numbers, the list follows the status.
    present = listed(root, state="present")
    assert (present["total"], present["students"], present["present"], present["not_marked"]) == (1, 8, 1, 7)
    assert listed(root, state="not_marked")["total"] == 7
    # Search by name or roll number, and a department then year order.
    row = next(r for r in everyone["items"] if r["user_id"] == ug)
    assert listed(root, q=row["roll_number"][-6:])["total"] >= 1
    assert listed(root, q="zzzz")["total"] == 0
    assert [(r["department"], r["year"]) for r in everyone["items"]] == sorted((r["department"], r["year"]) for r in everyone["items"])
    assert root.get("/admin/attendance/students", params={"department": "XX"}).status_code == 422


def test_a_department_admin_sees_and_marks_only_their_department(judging, as_user):  # noqa: F811
    root, cse, it = judging["root"], judging["cse"], judging["it"]
    set_room(judging)
    ua, ub, ug = (uid(as_user, e) for e in ("a@kiet.edu", "b@kiet.edu", "g@kiet.edu"))
    mine = listed(cse, department="IT")  # asking for another department changes nothing
    assert mine["total"] == 5 and {r["department"] for r in mine["items"]} == {"CSE"}
    skipped = mark(cse, [ua, ub], True).json()
    assert skipped["changed"] == 1 and [s["reason"] for s in skipped["skipped"]] == ["not a student of CSE"]
    assert {r["user_id"]: r["state"] for r in listed(root)["items"]}[ub] == "not_marked"
    assert mark(it, [ug], True).json()["changed"] == 1
    assert mark(root, [ub], True).json()["changed"] == 1
    # Ids that are not students of the round are reported, not guessed.
    import uuid

    assert mark(root, [str(uuid.uuid4())], True).json()["not_found"] == 1


def test_only_super_admins_and_department_admins_use_it(judging, client):  # noqa: F811
    assert judging["it_prof"].get("/admin/attendance/students").status_code == 403
    assert Api(client, "a@kiet.edu").get("/admin/attendance/students").status_code == 403
    assert judging["it_prof"].post("/admin/attendance/students/mark", {"user_ids": [], "present": True}).status_code in (403, 422)
    export = judging["root"].get("/admin/attendance/students/export").json()
    assert export["total"] == len(export["items"])


def test_a_student_can_be_set_back_to_not_marked(judging, as_user):  # noqa: F811
    root, cse = judging["root"], judging["cse"]
    set_room(judging)
    ua, ub, ug = (uid(as_user, e) for e in ("a@kiet.edu", "b@kiet.edu", "g@kiet.edu"))
    state = lambda who, user: {r["user_id"]: r["state"] for r in listed(who)["items"]}[user]  # noqa: E731

    def set_state(who, ids, value):
        return who.post("/admin/attendance/students/mark", {"user_ids": ids, "state": value})

    assert set_state(root, [ua, ub], "present").json()["changed"] == 2
    assert set_state(root, [ub], "absent").json()["changed"] == 1
    assert (state(root, ua), state(root, ub)) == ("present", "absent")
    # The middle position of the slider: the mark is taken back, so the student is "not marked" again.
    back = set_state(root, [ua, ub, ug], "not_marked").json()
    assert (back["changed"], back["unchanged"]) == (2, 1)
    assert (state(root, ua), state(root, ub)) == ("not_marked", "not_marked")
    assert set_state(root, [ua], "not_marked").json()["changed"] == 0
    # A department admin can do it for their own department only.
    set_state(root, [ua], "present")
    assert set_state(cse, [ua, ug], "not_marked").json()["changed"] == 1
    assert [s["reason"] for s in set_state(cse, [ug], "not_marked").json()["skipped"]] == ["not a student of CSE"]
    log = root.get("/admin/activity", params={"kind": "attendance", "page_size": 100}).json()["items"]
    assert [e["action"] for e in log].count("attendance.unmarked") == 3
    # The older form still works, and one of the two is required.
    assert root.post("/admin/attendance/students/mark", {"user_ids": [ua], "present": True}).json()["changed"] == 1
    assert root.post("/admin/attendance/students/mark", {"user_ids": [ua]}).status_code == 422
