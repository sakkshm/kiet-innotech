"""Attendance by event pass (rotating QR), by hand, and the finalist quotas a super admin sets."""

import base64
import uuid
from datetime import UTC, datetime, timedelta

from test_admin import publish, world  # noqa: F401  (fixture)
from test_judging import judging, room_body, set_room  # noqa: F401  (fixture)

from app import rules
from app.config import get_settings
from app.services import attendance
from conftest import Api


def code_for(pass_json: dict, minutes_from_now: int = 0) -> str:
    """What the student's phone shows (the portal computes the same with Web Crypto)."""
    seed = base64.urlsafe_b64decode(pass_json["seed"] + "=" * (-len(pass_json["seed"]) % 4))
    period = int((datetime.now(UTC) + timedelta(minutes=minutes_from_now)).timestamp()) // rules.PASS_PERIOD_SECONDS
    return attendance.pass_code(seed, uuid.UUID(pass_json["user_id"]), period)


def scan(staff: Api, code: str, round_: str = "department", panel_id: str | None = None):
    return staff.post("/admin/attendance/scan", {"code": code, "round": round_, "panel_id": panel_id})


def test_the_pass_shows_once_the_team_is_submitted(judging, as_user):  # noqa: F811
    assert as_user("lonely@kiet.edu").get("/me/pass").json()["seed"] is None
    mine = as_user("a@kiet.edu").get("/me/pass").json()
    assert mine["seed"] and mine["period_seconds"] == 60 and [r["round"] for r in mine["rounds"]] == ["department"]
    assert mine["rounds"][0]["room"] is None
    # Before a room is allotted, the pass says when the team's department is judged (the timetable's CSE slot).
    assert (
        mine["rounds"][0]["planned_start"] == "2026-10-23T13:30:00+05:30"
        and mine["rounds"][0]["planned_end"] == "2026-10-23T17:00:00+05:30"
    )
    set_room(judging)
    room = as_user("a@kiet.edu").get("/me/pass").json()["rounds"][0]
    assert (room["building"], room["room"], room["location"]) == ("CSIT Block", "304", "2nd floor")
    assert room["slot_start"].startswith("2026-10-22T04:30") and room["planned_start"] is None
    # Teams from other colleges have only the finale.
    assert [r["round"] for r in as_user("r@gmail.com").get("/me/pass").json()["rounds"]] == ["final"]


def test_codes_are_genuine_current_and_signed(judging, as_user):  # noqa: F811
    root = judging["root"]
    mine = as_user("a@kiet.edu").get("/me/pass").json()
    # Junk, a tampered code, another student's id with this code, a code too old or too far ahead.
    assert scan(root, "hello").status_code == 422
    good = code_for(mine)
    tampered = good[:-1] + ("A" if good[-1] != "A" else "B")
    assert scan(root, tampered).status_code == 422
    other = as_user("c@kiet.edu").get("/me/pass").json()
    swapped = good.replace(mine["user_id"].replace("-", "").upper(), other["user_id"].replace("-", "").upper())
    assert scan(root, swapped).status_code == 422
    expired = scan(root, code_for(mine, -3))
    assert expired.status_code == 422 and "expired" in expired.json()["detail"]
    assert scan(root, code_for(mine, 2)).status_code == 422
    # Last minute's code still works (the phone may lag), and a lower-case read too.
    marked = scan(root, code_for(mine, -1).lower())
    assert marked.status_code == 200 and marked.json()["result"] == "marked"
    assert marked.json()["student"]["full_name"] and marked.json()["team"]["name"] == "CSE Alpha"
    # A new day needs a new seed: yesterday's seed makes codes that no longer match.
    old_seed = attendance.pass_seed(get_settings(), uuid.UUID(mine["user_id"]), (datetime.now(rules.IST) - timedelta(days=1)).date())
    period = int(datetime.now(UTC).timestamp()) // 60
    assert scan(root, attendance.pass_code(old_seed, uuid.UUID(mine["user_id"]), period)).status_code == 422


def test_scanning_marks_once_and_only_in_scope(judging, as_user):  # noqa: F811
    set_room(judging)
    room = judging["room"]
    alpha = as_user("a@kiet.edu").get("/me/pass").json()
    # Another department's admin and a judge of another room cannot mark this student, and learn nothing about them.
    refused = scan(judging["it"], code_for(alpha))
    assert refused.status_code == 403 and "not in your room or department" in refused.json()["detail"]
    assert "CSE" not in refused.json()["detail"] and "Alpha" not in refused.json()["detail"]
    assert scan(judging["external"], code_for(alpha)).status_code == 403
    # The department's admin can; scanning again only reports the first mark.
    first = scan(judging["cse"], code_for(alpha))
    assert first.status_code == 200 and (first.json()["result"], first.json()["marked_by"]) == ("marked", "cse.admin@kiet.edu")
    again = scan(judging["root"], code_for(alpha))
    assert (again.json()["result"], again.json()["marked_by"], again.json()["method"]) == ("already", "cse.admin@kiet.edu", "qr")
    # A judge of the team's own room can mark its students, and is warned about a student from another room.
    beta = as_user("c@kiet.edu").get("/me/pass").json()
    by_judge = scan(judging["it_prof"], code_for(beta), panel_id=room["id"])
    assert by_judge.status_code == 200 and by_judge.json()["warning"] is None and by_judge.json()["room"] == "CSIT Block · 304"
    other_room = judging["root"].post("/admin/panels", room_body("CSE", name="305")).json()
    gamma = as_user("e@kiet.edu").get("/me/pass").json()
    warned = scan(judging["root"], code_for(gamma), panel_id=other_room["id"])
    assert warned.status_code == 200 and "allotted to CSIT Block · 304" in warned.json()["warning"]
    # The student's pass and the room show who is present.
    assert as_user("a@kiet.edu").get("/me/pass").json()["rounds"][0]["present_at"] is not None
    panel = next(p for p in judging["root"].get("/admin/judging/department").json()["panels"] if p["id"] == room["id"])
    assert {t["name"]: t["present"] for t in panel["teams"]} == {"CSE Alpha": 1, "CSE Beta": 1, "CSE Gamma": 1}
    sheet = judging["it_prof"].get(f"/judge/panels/{room['id']}/attendance").json()
    leader = sheet["teams"][0]["members"][0]
    assert (leader["role"], leader["method"], leader["marked_by"]) == ("leader", "qr", "cse.admin@kiet.edu")
    # Judges never get students' phone numbers; organisers do.
    assert {m["phone"] for t in sheet["teams"] for m in t["members"]} == {""}
    organiser = judging["cse"].get("/admin/judging/department/attendance", params={"panel_id": room["id"]}).json()
    assert all(m["phone"] for t in organiser["teams"] for m in t["members"])
    assert judging["external"].get(f"/judge/panels/{room['id']}/attendance").status_code == 403


def test_students_who_cannot_be_marked(judging, as_user):  # noqa: F811
    root = judging["root"]
    gamma = as_user("e@kiet.edu").get("/me/pass").json()
    root.post(f"/admin/teams/{judging['teams']['cse_c']['id']}/withdraw", {"reason": "Left the event"})
    withdrawn = scan(root, code_for(gamma))
    assert withdrawn.status_code == 409 and "withdrawn" in withdrawn.json()["detail"]
    # Not at the finale before results; a department admin never marks other colleges.
    college = as_user("r@gmail.com").get("/me/pass").json()
    assert scan(judging["cse"], code_for(college), "final").status_code == 403
    assert scan(root, code_for(college), "final").status_code == 200
    assert scan(root, code_for(as_user("a@kiet.edu").get("/me/pass").json()), "final").status_code == 409
    # A suspended student is refused.
    beta = as_user("c@kiet.edu").get("/me/pass").json()
    root.post(f"/admin/students/{beta['user_id']}/ban", {"reason": "Misconduct at the venue"})
    banned = scan(root, code_for(beta))
    assert banned.status_code == 409 and "suspended" in banned.json()["detail"]
    # Strangers and students cannot scan at all.
    assert as_user("a@kiet.edu").post("/admin/attendance/scan", {"code": "x", "round": "department"}).status_code == 403


def test_marking_by_hand_and_undoing(judging, as_user):  # noqa: F811
    root, cse = judging["root"], judging["cse"]
    alpha = as_user("a@kiet.edu").get("/me/pass").json()
    body = {"user_id": alpha["user_id"], "round": "department", "note": "Phone battery dead"}
    assert cse.post("/admin/attendance/mark", body | {"note": ""}).status_code == 422
    assert judging["it"].post("/admin/attendance/mark", body).status_code == 403
    marked = cse.post("/admin/attendance/mark", body)
    assert marked.status_code == 200 and (marked.json()["result"], marked.json()["method"]) == ("marked", "manual")
    assert cse.post("/admin/attendance/unmark", body | {"note": "Marked the wrong student"}).status_code == 204
    assert cse.post("/admin/attendance/unmark", body | {"note": "Again"}).status_code == 409
    assert scan(cse, code_for(alpha)).json()["result"] == "marked"
    log = root.get("/admin/activity", params={"kind": "attendance", "page_size": 100}).json()["items"]
    assert [e["action"] for e in log][:3] == ["attendance.marked", "attendance.unmarked", "attendance.marked"]
    assert "Phone battery dead" in log[2]["detail"] and "Marked the wrong student" in log[1]["detail"]
    # The CSE admin sees these entries; the IT admin does not.
    assert {e["action"] for e in cse.get("/admin/activity", params={"kind": "attendance"}).json()["items"]} == {
        "attendance.marked",
        "attendance.unmarked",
    }


# ---------- Finalist quotas ----------


def test_super_admins_set_the_finalist_quotas(judging, settings):  # noqa: F811
    root, cse = judging["root"], judging["cse"]
    matrix = {
        row["department"]: {c["category"]: c["quota"] for c in row["categories"]}
        for row in root.get("/admin/finalists/summary").json()["matrix"]
    }
    # The event document's numbers to begin with; COE KIET is not nominated.
    assert (matrix["CSE"][1], matrix["CSE"][5], matrix["IT"][1], matrix["AMIA"][1]) == (2, 1, 1, 1) and "COE" not in matrix
    assert cse.put("/admin/finalists/quotas", {"quotas": [{"department": "CSE", "category": 1, "quota": 3}]}).status_code == 403
    for bad in (
        {"department": "COE", "category": 1, "quota": 1},
        {"department": "XYZ", "category": 1, "quota": 1},
        {"department": "IT", "category": 9, "quota": 1},
        {"department": "IT", "category": 1, "quota": 11},
    ):
        assert root.put("/admin/finalists/quotas", {"quotas": [bad]}).status_code == 422, bad
    teams = judging["teams"]
    two = [teams["cse_a"]["id"], teams["cse_b"]["id"]]
    assert cse.put("/admin/finalists/CSE", {"nominations": [{"category": 1, "team_ids": two}]}).status_code == 200
    # Not below what a department already nominated.
    lowered = root.put("/admin/finalists/quotas", {"quotas": [{"department": "CSE", "category": 1, "quota": 1}]})
    assert lowered.status_code == 409 and "already nominated 2" in lowered.json()["detail"]
    raised = root.put(
        "/admin/finalists/quotas",
        {"quotas": [{"department": "CSE", "category": 1, "quota": 3}, {"department": "AM", "category": 2, "quota": 0}]},
    )
    assert raised.status_code == 200
    cells = {row["department"]: {c["category"]: c["quota"] for c in row["categories"]} for row in raised.json()["matrix"]}
    assert (cells["CSE"][1], cells["AMIA"][2]) == (3, 0)
    three = [*two, teams["cse_c"]["id"]]
    assert cse.put("/admin/finalists/CSE", {"nominations": [{"category": 1, "team_ids": three}]}).status_code == 200
    assert cse.get("/admin/finalists").json()["categories"][0]["quota"] == 3
    log = root.get("/admin/activity", params={"kind": "finalists", "page_size": 50}).json()["items"]
    assert any(e["action"] == "finalists.quotas_updated" and "CSE Cat 1: 2 to 3" in e["detail"] for e in log)
    # Fixed once results are out.
    assert publish(root, settings).status_code == 200
    assert root.put("/admin/finalists/quotas", {"quotas": [{"department": "IT", "category": 1, "quota": 2}]}).status_code == 409


# ---------- Races on the day ----------


def test_races_never_leave_a_score_or_mark_inconsistent(judging, as_user):  # noqa: F811
    from sqlalchemy import select

    from app.db import get_sessionmaker
    from app.models import Attendance, PanelJuror, Score
    from test_concurrency import parallel

    root, room = judging["root"], judging["room"]
    set_room(judging)
    root.post("/admin/judging/department/open")
    path = lambda key: f"/judge/panels/{room['id']}/teams/{judging['teams'][key]['id']}/score"  # noqa: E731
    full = {"marks": [5, 5, 5, 5, 5, 5, 5, 5, 10], "remarks": ""}
    # A double tap on "Submit": one score, the other refused as final.
    codes = parallel(lambda: judging["it_prof"].put(path("cse_a"), full), lambda: judging["it_prof"].put(path("cse_a"), full))
    assert sorted(codes) == [200, 409]
    # A judge submits while the room's admin removes them: the score is never left behind without its judge.
    keep_chair = {"jurors": [{"email": "it.prof@kiet.edu", "chair": True}]}
    codes = parallel(
        lambda: judging["cse_prof"].put(path("cse_b"), full), lambda: judging["cse"].put(f"/admin/panels/{room['id']}/jurors", keep_chair)
    )
    with get_sessionmaker()() as db:
        on_panel = set(db.scalars(select(PanelJuror.juror_email).where(PanelJuror.panel_id == room["id"])))
        scorers = set(db.scalars(select(Score.juror_email)))
        assert scorers <= on_panel, (codes, scorers, on_panel)
    # Two desks scan the same student at once: one mark.
    pass_json = as_user("a@kiet.edu").get("/me/pass").json()
    results = []
    parallel(
        *(
            lambda staff=staff: results.append(scan(staff, code_for(pass_json))) or results[-1]
            for staff in (judging["cse"], root, judging["it_prof"])
        )
    )
    assert sorted(r.json()["result"] for r in results) == ["already", "already", "marked"]
    with get_sessionmaker()() as db:
        assert len(list(db.scalars(select(Attendance)))) == 1


def test_attendance_is_off_unless_switched_on(judging, as_user, settings):  # noqa: F811
    set_room(judging)
    alpha = as_user("a@kiet.edu").get("/me/pass").json()
    assert alpha["seed"]
    settings.attendance_enabled = False
    # Students still see where to go, but no QR seed is issued.
    off = as_user("a@kiet.edu").get("/me/pass").json()
    assert off["seed"] is None and off["rounds"][0]["room"] == "304" and off["rounds"][0]["building"] == "CSIT Block"
    # Nothing can be recorded or read from the attendance desk.
    root, room = judging["root"], judging["room"]
    assert scan(root, code_for(alpha)).status_code == 404
    body = {"user_id": alpha["user_id"], "round": "department", "note": "Phone battery dead"}
    assert root.post("/admin/attendance/mark", body).status_code == 404
    assert root.post("/admin/attendance/unmark", body).status_code == 404
    assert judging["it_prof"].get(f"/judge/panels/{room['id']}/attendance").status_code == 404
    # The printable roster for manual attendance is untouched.
    assert root.get("/admin/judging/department/attendance", params={"panel_id": room["id"]}).status_code == 200
