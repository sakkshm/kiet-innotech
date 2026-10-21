"""Department round attendance: judges and admins mark students present or absent; a team that is all absent scores 0."""

from datetime import datetime

from test_admin import publish, world  # noqa: F401  (fixture)
from test_judging import FULL, judging, score, set_room  # noqa: F401  (fixture)

from app import rules
from app.services import judging as judging_service

AT = lambda *t: datetime(*t, tzinfo=rules.IST)  # noqa: E731


def user_id(as_user, email):
    return as_user(email).get("/me/pass").json()["user_id"]


def toggle(judge, room, team, user, present):
    return judge.put(f"/judge/panels/{room['id']}/teams/{team['id']}/attendance/{user}", {"present": present})


def test_judges_mark_students_present_or_absent(judging, as_user, monkeypatch):  # noqa: F811
    root, cse, room = judging["root"], judging["cse"], judging["room"]
    set_room(judging)
    a = judging["teams"]["cse_a"]
    ua, ua2, ub = (user_id(as_user, e) for e in ("a@kiet.edu", "b@kiet.edu", "c@kiet.edu"))
    # Judging must be open first.
    assert toggle(judging["it_prof"], room, a, ua, False).status_code == 423
    root.post("/admin/judging/department/open")
    mine = judging["it_prof"].get("/judge").json()["panels"][0]
    assert mine["can_mark_attendance"] is True
    assert {m["attendance"] for t in mine["teams"] for m in t["members"]} == {"not_marked"}
    # Everybody counts as present until somebody switches them off.
    marked = toggle(judging["it_prof"], room, a, ua, False)
    assert marked.status_code == 200 and marked.json()["all_absent"] is False
    assert sorted(m["state"] for m in marked.json()["members"]) == ["absent", "not_marked"]
    # Either judge of the room can change it, whoever marked it.
    assert toggle(judging["cse_prof"], room, a, ua, True).json()["members"][0]["state"] == "present"
    assert toggle(judging["cse_prof"], room, a, ua, False).status_code == 200
    # Not a judge of this room, a team from another room, a student who is not in the team.
    assert toggle(judging["external"], room, a, ua, False).status_code == 403
    assert toggle(judging["it_prof"], room, judging["teams"]["it_a"], ua, False).status_code == 403
    assert toggle(judging["it_prof"], room, a, ub, False).status_code == 404
    # The student sees it on their pass; classmates are not marked; other types see nothing about it.
    assert as_user("a@kiet.edu").get("/me/pass").json()["rounds"][0]["attendance"] == "absent"
    assert as_user("b@kiet.edu").get("/me/pass").json()["rounds"][0]["attendance"] == "not_marked"
    # Admins: the department's admin and a super admin at any time; another department's admin never.
    assert judging["it"].put(f"/admin/teams/{a['id']}/attendance/{ua2}", {"present": False}).status_code == 403
    assert cse.put(f"/admin/teams/{a['id']}/attendance/{ua2}", {"present": False}).json()["all_absent"] is True
    assert root.put(f"/admin/teams/{a['id']}/attendance/{ua2}", {"present": True}).json()["all_absent"] is False
    # The same change twice is logged once.
    cse.put(f"/admin/teams/{a['id']}/attendance/{ua2}", {"present": True})
    log = root.get("/admin/activity", params={"kind": "attendance", "page_size": 100}).json()["items"]
    assert [e["action"] for e in log].count("attendance.absent") == 3 and [e["action"] for e in log].count("attendance.marked") == 2
    # Judges can change attendance only in their room's time; admins any time.
    monkeypatch.setattr(judging_service, "utcnow", lambda: AT(2026, 10, 22, 9, 0))
    early = toggle(judging["it_prof"], room, a, ua, True)
    assert early.status_code == 423 and "not started" in early.json()["detail"]
    monkeypatch.setattr(judging_service, "utcnow", lambda: AT(2026, 10, 22, 13, 10))
    assert toggle(judging["it_prof"], room, a, ua, True).status_code == 200  # in the buffer
    monkeypatch.setattr(judging_service, "utcnow", lambda: AT(2026, 10, 22, 17, 0))
    late = toggle(judging["it_prof"], room, a, ua, False)
    assert late.status_code == 423 and "time is over" in late.json()["detail"]
    assert judging["it_prof"].get("/judge").json()["panels"][0]["can_mark_attendance"] is False
    assert cse.put(f"/admin/teams/{a['id']}/attendance/{ua}", {"present": False}).status_code == 200
    assert root.put(f"/admin/teams/{a['id']}/attendance/{ua}", {"present": True}).status_code == 200


def test_a_team_with_everyone_absent_scores_zero(judging, as_user):  # noqa: F811
    root, cse, room = judging["root"], judging["cse"], judging["room"]
    set_room(judging)
    root.post("/admin/judging/department/open")
    a, b = judging["teams"]["cse_a"], judging["teams"]["cse_b"]
    ua, ua2 = user_id(as_user, "a@kiet.edu"), user_id(as_user, "b@kiet.edu")
    for team in (a, b):
        for judge in ("it_prof", "cse_prof"):
            assert score(judging[judge], room, team, FULL).status_code == 200
    ranking = lambda: {r["team"]["code"]: r for g in cse.get("/admin/judging/department/rankings").json()["groups"] for r in g["teams"]}  # noqa: E731
    assert ranking()[a["code"]]["average"] == 50 and ranking()[a["code"]]["position"] is not None
    # One student absent: nothing changes. Everyone absent: 0, no place, whatever the judges gave.
    toggle(judging["it_prof"], room, a, ua, False)
    assert ranking()[a["code"]]["average"] == 50
    toggle(judging["it_prof"], room, a, ua2, False)
    row = ranking()[a["code"]]
    assert (row["average"], row["position"], row["all_absent"], row["complete"]) == (0, None, True, True)
    assert ranking()[b["code"]]["position"] == 1
    team = next(t for t in cse.get("/admin/judging/department").json()["panels"][0]["teams"] if t["id"] == a["id"])
    assert team["all_absent"] is True and team["average"] == 0 and team["absent"] == 2
    # It cannot win, judges are told, and marks cannot be given.
    award = cse.post("/admin/judging/department/awards", {"team_id": a["id"], "place": 1})
    assert award.status_code == 409 and "absent" in award.json()["detail"]
    mine = next(t for t in judging["cse_prof"].get("/judge").json()["panels"][0]["teams"] if t["id"] == a["id"])
    assert mine["all_absent"] is True
    refused = score(judging["cse_prof"], room, a, [4] * 8 + [9])
    assert refused.status_code == 409 and "scores 0" in refused.json()["detail"]
    # The marks already given are kept: when one student is present again, they count again.
    assert cse.put(f"/admin/teams/{a['id']}/attendance/{ua}", {"present": True}).json()["all_absent"] is False
    back = ranking()[a["code"]]
    assert back["average"] == 50 and back["position"] is not None and back["all_absent"] is False


def test_the_attendance_report(judging, as_user):  # noqa: F811
    root, cse, it, room = judging["root"], judging["cse"], judging["it"], judging["room"]
    set_room(judging)
    root.post("/admin/judging/department/open")
    a, c = judging["teams"]["cse_a"], judging["teams"]["cse_c"]
    toggle(judging["it_prof"], room, a, user_id(as_user, "a@kiet.edu"), False)
    for email in ("e@kiet.edu", "f@kiet.edu"):
        cse.put(f"/admin/teams/{c['id']}/attendance/{user_id(as_user, email)}", {"present": False})
    report = lambda who, **params: who.get("/admin/attendance/report", params=params).json()  # noqa: E731
    everyone = report(root)
    assert everyone["total"] == everyone["present"] + everyone["absent"] + everyone["not_marked"] and everyone["absent"] == 3
    assert everyone["teams_all_absent"] == 1
    only = report(root, department="CSE")
    assert (only["total"], only["absent"], only["not_marked"], only["teams"]) == (6, 3, 3, 3)
    assert {r["department"] for r in only["items"]} == {"CSE"} and only["items"][0]["room"] == "CSIT Block · 304"
    # Filters: state, the team that scores 0, search, the day.
    assert {r["state"] for r in report(root, department="CSE", state="absent")["items"]} == {"absent"}
    zero = report(root, department="CSE", team_zero="true")
    assert {r["team_code"] for r in zero["items"]} == {c["code"]} and zero["total"] == 2
    assert report(root, department="CSE", q="alpha")["total"] == 2 and report(root, department="CSE", q="nobody")["total"] == 0
    assert (
        report(root, department="CSE", date="2026-10-22")["total"] == 6 and report(root, department="CSE", date="2026-10-23")["total"] == 0
    )
    assert report(root, panel_id=room["id"])["total"] == 6
    # A department admin sees only their own department, whatever they ask for.
    assert {r["department"] for r in report(cse, department="IT")["items"]} == {"CSE"} and report(cse)["total"] == 6
    assert {r["department"] for r in report(it)["items"]} == {"IT"}
    # Paging, and the export with everything the filters match.
    paged = report(root, department="CSE", page_size=4)
    assert (len(paged["items"]), paged["total"], paged["absent"]) == (4, 6, 3)
    export = root.get("/admin/attendance/report/export", params={"department": "CSE", "state": "absent"}).json()
    assert len(export["items"]) == 3 and export["total"] == 3
    # Only super admins and department admins. A judge cannot use the admin report.
    assert judging["it_prof"].get("/admin/attendance/report").status_code == 403
    assert report(root, department="CSE")["items"][0]["roll_number"] is not None
