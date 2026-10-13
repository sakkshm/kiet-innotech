"""Judging: judges, rooms and panels, allotments, tents, the lock, scores, rankings and attendance sheets."""

from datetime import UTC, datetime, timedelta

import pytest
from test_admin import publish, world  # noqa: F401  (fixture)

from app import rules
from conftest import Api, token

FULL = [5, 5, 5, 5, 5, 5, 5, 5, 10]


def marks(total_parts: list[int]) -> dict:
    return {"marks": total_parts, "remarks": ""}


def room_body(department, building="CSIT Block", name="304", start="10:00", end="13:00", day="2026-10-22", **extra) -> dict:
    """A department-round room: a building, a room in it and a time slot (IST)."""
    return {
        "round": "department",
        "department": department,
        "building": building,
        "name": name,
        "slot_start": f"{day}T{start}:00+05:30",
        "slot_end": f"{day}T{end}:00+05:30",
        **extra,
    }


@pytest.fixture
def judging(world, settings):  # noqa: F811
    """Registration closed, three judges (IT faculty, CSE faculty, external) and a CSE room."""
    settings.force_registration_open = False
    settings.registration_opens = datetime.now(UTC) - timedelta(days=10)
    settings.registration_closes = datetime.now(UTC) - timedelta(days=1)
    root = world["root"]
    for body in (
        {"email": "it.prof@kiet.edu", "name": "IT Professor", "kind": "faculty", "department": "IT"},
        {"email": "cse.prof@kiet.edu", "name": "CSE Professor", "kind": "faculty", "department": "CSE"},
        {"email": "judge@industry.com", "name": "Industry Judge", "kind": "external", "organisation": "Acme Labs"},
    ):
        response = root.post("/admin/jurors", body)
        assert response.status_code == 201, response.text
    room = root.post("/admin/panels", room_body("CSE", location="2nd floor"))
    assert room.status_code == 201, room.text
    client = root.client
    return world | {
        "room": room.json(),
        "it_prof": Api(client, "it.prof@kiet.edu"),
        "cse_prof": Api(client, "cse.prof@kiet.edu"),
        "external": Api(client, "judge@industry.com"),
    }


def set_room(j, teams=("cse_a", "cse_b", "cse_c"), jurors=(("it.prof@kiet.edu", True), ("judge@industry.com", False))):
    root, room = j["root"], j["room"]
    response = root.put(f"/admin/panels/{room['id']}/teams", {"team_ids": [j["teams"][k]["id"] for k in teams]})
    assert response.status_code == 200, response.text
    response = root.put(f"/admin/panels/{room['id']}/jurors", {"jurors": [{"email": e, "chair": c} for e, c in jurors]})
    assert response.status_code == 200, response.text
    return response.json()


def score(judge, room, team, parts):
    return judge.put(f"/judge/panels/{room['id']}/teams/{team['id']}/score", marks(parts))


# ---------- Judges ----------


def test_judges_sign_in_and_see_only_their_page(judging, client):
    me = judging["it_prof"].get("/admin/me").json()
    assert (me["role"], me["judge"], me["department"]) == ("judge", True, "IT")
    # A judge is not an organiser: every admin endpoint refuses them.
    assert judging["it_prof"].get("/admin/teams").status_code == 403
    assert judging["it_prof"].get("/admin/stats").status_code == 403
    assert judging["it_prof"].get("/judge").json()["panels"] == []
    # Students and strangers are not judges.
    assert Api(client, "a@kiet.edu").get("/judge").status_code == 403
    # A portal token never opens the judge page.
    assert client.get("/judge", headers={"Authorization": f"Bearer {token('it.prof@kiet.edu')}"}).status_code == 401


def test_an_admin_who_is_also_a_judge(judging):
    judging["root"].post("/admin/jurors", {"email": "it.admin@kiet.edu", "name": "IT Admin", "kind": "faculty", "department": "IT"})
    me = judging["it"].get("/admin/me").json()
    assert (me["role"], me["judge"]) == ("admin", True)


def test_department_admins_manage_judges_and_their_own_rooms(judging, client):
    cse, it, root = judging["cse"], judging["it"], judging["root"]
    # Department admins add judges, but never faculty of their own department.
    added = cse.post("/admin/jurors", {"email": "x@labs.com", "name": "Xavier", "kind": "external", "organisation": "Y Labs"})
    assert added.status_code == 201 and added.json()["added_by"] == "cse.admin@kiet.edu"
    own = cse.post("/admin/jurors", {"email": "own@kiet.edu", "name": "Own Dept", "kind": "faculty", "department": "CSE"})
    assert own.status_code == 422 and "another department" in own.json()["detail"]
    assert {j["email"] for j in cse.get("/admin/jurors").json()} >= {"x@labs.com", "it.prof@kiet.edu"}
    # Rooms for their own department only, never the finale.
    mine = cse.post("/admin/panels", room_body("CSE", building="G Block", name="112"))
    assert mine.status_code == 201 and mine.json()["can_edit"] is True
    assert cse.post("/admin/panels", room_body("IT", building="G Block", name="113")).status_code == 403
    assert cse.post("/admin/panels", {"round": "final", "name": "Panel Z"}).status_code == 403
    assert cse.put(f"/admin/panels/{mine.json()['id']}/jurors", {"jurors": [{"email": "x@labs.com", "chair": True}]}).status_code == 200
    # Another department's admin cannot touch it.
    place = {"building": "G Block", "name": "114", "slot_start": "2026-10-22T10:00:00+05:30", "slot_end": "2026-10-22T11:00:00+05:30"}
    assert it.patch(f"/admin/panels/{mine.json()['id']}", place).status_code == 403
    assert it.put(f"/admin/panels/{mine.json()['id']}/teams", {"team_ids": []}).status_code == 403
    assert it.delete(f"/admin/panels/{mine.json()['id']}").status_code == 403
    assert cse.patch(f"/admin/panels/{mine.json()['id']}", place).json()["name"] == "114"
    # A department admin removes only judges they added (and only while unassigned).
    assert cse.delete("/admin/jurors/judge@industry.com").status_code == 403
    assert cse.delete("/admin/jurors/x@labs.com").status_code == 409
    cse.put(f"/admin/panels/{mine.json()['id']}/jurors", {"jurors": []})
    assert cse.delete("/admin/jurors/x@labs.com").status_code == 204
    # A department admin cannot sit on their own department's panel, even as an external judge.
    root.post("/admin/jurors", {"email": "cse.admin@kiet.edu", "name": "CSE Admin", "kind": "external", "organisation": "KIET"})
    refused = root.put(f"/admin/panels/{mine.json()['id']}/jurors", {"jurors": [{"email": "cse.admin@kiet.edu"}]})
    assert refused.status_code == 422 and "CSE admin" in refused.json()["detail"]
    # The COE KIET admin has no department round, so no rooms.
    root.post("/admin/admins", {"email": "coe.admin@kiet.edu", "name": "COE Admin", "role": "admin", "department": "COE"})
    assert Api(client, "coe.admin@kiet.edu").post("/admin/panels", room_body("COE")).status_code == 422
    assert Api(client, "coe.admin@kiet.edu").get("/admin/jurors").status_code == 403
    assert (
        root.post("/admin/jurors", {"email": "it.prof@kiet.edu", "name": "Again", "kind": "faculty", "department": "IT"}).status_code == 409
    )
    assert root.post("/admin/jurors", {"email": "f@kiet.edu", "name": "No Dept", "kind": "faculty"}).status_code == 422
    assert root.post("/admin/jurors", {"email": "e@x.com", "name": "No Org", "kind": "external"}).status_code == 422
    listed = {j["email"]: j for j in root.get("/admin/jurors").json()}
    assert listed["cse.prof@kiet.edu"]["organisation"] == rules.KIET_INSTITUTION


# ---------- Rooms ----------


def test_rooms_follow_the_rules(judging):
    root, room = judging["root"], judging["room"]
    assert (room["building"], room["name"], room["location"]) == ("CSIT Block", "304", "2nd floor")
    # The same room cannot be booked twice at overlapping times (any case); back to back, another room or the finale is fine.
    clash = root.post("/admin/panels", room_body("IT", building="csit  block", start="11:00", end="12:00"))
    assert clash.status_code == 409 and "CSIT Block · 304 is already booked 22 Oct, 10:00 AM - 1:00 PM (CSE teams)" in clash.json()["detail"]
    later = root.post("/admin/panels", room_body("IT", start="13:00", end="15:00"))
    assert later.status_code == 201
    assert root.post("/admin/panels", room_body("IT", name="305")).status_code == 201
    assert root.post("/admin/panels", {"round": "final", "name": "304"}).status_code == 201
    # Moving a room onto a booked slot is refused too.
    place = {k: v for k, v in room_body("IT", start="12:00", end="14:00").items() if k not in ("round", "department")}
    moved = root.patch(f"/admin/panels/{later.json()['id']}", place)
    assert moved.status_code == 409
    # A department room needs a department, a building and a sensible slot.
    for bad in (
        room_body(None),
        room_body("COE"),
        room_body("IT", building=""),
        room_body("IT", start="12:00", end="11:00"),
        room_body("IT", start="06:00", end="19:00"),
        {**room_body("IT"), "slot_end": None},
        {**room_body("IT"), "slot_start": None, "slot_end": None},
        {**room_body("IT"), "slot_start": "2026-10-22T10:00:00"},
    ):
        assert root.post("/admin/panels", bad).status_code == 422, bad
    # Only submitted teams of the room's department.
    it_team = judging["teams"]["it_a"]["id"]
    assert root.put(f"/admin/panels/{room['id']}/teams", {"team_ids": [it_team]}).status_code == 422
    assert root.put(f"/admin/panels/{room['id']}/teams", {"team_ids": [judging["teams"]["college"]["id"]]}).status_code == 422
    # Faculty never judge their own department.
    refused = root.put(f"/admin/panels/{room['id']}/jurors", {"jurors": [{"email": "cse.prof@kiet.edu"}]})
    assert refused.status_code == 422 and "another department" in refused.json()["detail"]
    assert root.put(f"/admin/panels/{room['id']}/jurors", {"jurors": [{"email": "nobody@kiet.edu"}]}).status_code == 422
    two_chairs = [{"email": "it.prof@kiet.edu", "chair": True}, {"email": "judge@industry.com", "chair": True}]
    assert root.put(f"/admin/panels/{room['id']}/jurors", {"jurors": two_chairs}).status_code == 422
    panel = set_room(judging)
    assert panel["jurors"][0]["email"] == "it.prof@kiet.edu" and panel["jurors"][0]["chair"]
    assert len(panel["teams"]) == 3


def test_a_team_sits_in_one_room_per_round(judging):
    root = judging["root"]
    set_room(judging)
    other = root.post("/admin/panels", room_body("CSE", name="305")).json()
    clash = root.put(f"/admin/panels/{other['id']}/teams", {"team_ids": [judging["teams"]["cse_a"]["id"]]})
    assert clash.status_code == 409 and "CSIT Block · 304" in clash.json()["detail"]
    overview = root.get("/admin/judging/department").json()
    # Every CSE team has a room; the super admin also sees other departments' teams still waiting.
    assert {t["name"] for t in overview["unallotted"]} == {"IT Alpha"} and len(overview["panels"]) == 2


def test_department_admins_see_only_their_rooms(judging):
    set_room(judging)
    judging["root"].post("/admin/panels", room_body("IT", building="Main Block", name="IT Lab"))
    cse = judging["cse"].get("/admin/judging/department").json()
    assert [p["name"] for p in cse["panels"]] == ["304"] and cse["can_manage"] is False and cse["can_create"] is True
    assert cse["panels"][0]["can_edit"] is True
    it = judging["it"].get("/admin/judging/department").json()
    assert [p["name"] for p in it["panels"]] == ["IT Lab"]
    assert {t["name"] for t in it["unallotted"]} == {"IT Alpha"}
    assert judging["cse"].get("/admin/judging/final").status_code == 403
    assert judging["cse"].get("/admin/judging/department/attendance", params={"panel_id": judging["room"]["id"]}).status_code == 200
    assert judging["it"].get("/admin/judging/department/attendance", params={"panel_id": judging["room"]["id"]}).status_code == 403


# ---------- The lock ----------


def test_judging_is_locked_until_a_super_admin_opens_it(judging, settings):
    root, room = judging["root"], judging["room"]
    set_room(judging)
    team = judging["teams"]["cse_a"]
    locked = score(judging["it_prof"], room, team, FULL)
    assert locked.status_code == 423 and "locked" in locked.json()["detail"]
    # Judges already see their room and teams while it is locked.
    view = judging["it_prof"].get("/judge").json()
    assert view["panels"][0]["open"] is False and len(view["panels"][0]["teams"]) == 3
    assert judging["cse"].post("/admin/judging/department/open").status_code == 403

    # Not while registration is open.
    settings.registration_closes = datetime.now(UTC) + timedelta(days=1)
    blocked = root.post("/admin/judging/department/open")
    assert blocked.status_code == 409 and "registration has closed" in blocked.json()["detail"]
    settings.registration_closes = datetime.now(UTC) - timedelta(days=1)

    opened = root.post("/admin/judging/department/open")
    assert opened.status_code == 200 and opened.json()["open"] is True
    assert root.post("/admin/judging/department/open").status_code == 409
    assert score(judging["it_prof"], room, team, FULL).status_code == 200
    assert root.post("/admin/judging/department/lock").json()["open"] is False
    assert score(judging["it_prof"], room, team, FULL).status_code == 423


def test_a_room_with_teams_needs_judges_before_opening(judging):
    root, room = judging["root"], judging["room"]
    root.put(f"/admin/panels/{room['id']}/teams", {"team_ids": [judging["teams"]["cse_a"]["id"]]})
    refused = root.post("/admin/judging/department/open")
    assert refused.status_code == 409 and "no judges" in refused.json()["detail"]


def test_the_finale_opens_after_results_are_published(judging, settings):
    root = judging["root"]
    blocked = root.post("/admin/judging/final/open")
    assert blocked.status_code == 409 and "published" in blocked.json()["detail"]


# ---------- Scores ----------


def test_scores_are_validated_and_scoped(judging):
    root, room = judging["root"], judging["room"]
    set_room(judging)
    root.post("/admin/judging/department/open")
    team = judging["teams"]["cse_a"]
    judge = judging["it_prof"]
    for bad in ([6, 5, 5, 5, 5, 5, 5, 5, 10], [5] * 8, [5, 5, 5, 5, 5, 5, 5, 5, 11], [-1, 5, 5, 5, 5, 5, 5, 5, 10]):
        assert score(judge, room, team, bad).status_code == 422, bad
    saved = score(judge, room, team, [4, 3, 5, 2, 1, 0, 5, 5, 7])
    assert saved.status_code == 200 and saved.json()["total"] == 32
    # Submitted marks are final for the judge.
    again = score(judge, room, team, [5, 5, 5, 5, 5, 5, 5, 5, 9])
    assert again.status_code == 409 and "Only a super admin" in again.json()["detail"]
    # Only a super admin changes them, with a reason; the activity log keeps the old marks.
    path = f"/admin/panels/{room['id']}/teams/{team['id']}/scores/it.prof@kiet.edu"
    body = {"marks": [5, 5, 5, 5, 5, 5, 5, 5, 9], "remarks": "", "reason": "Judge asked to correct a typo"}
    assert judging["cse"].put(path, body).status_code == 403
    assert root.put(path, body | {"reason": "x"}).status_code == 422
    assert root.put(path, body | {"marks": [6, 5, 5, 5, 5, 5, 5, 5, 9]}).status_code == 422
    assert root.put(f"/admin/panels/{room['id']}/teams/{team['id']}/scores/cse.prof@kiet.edu", body).status_code == 422
    edited = root.put(path, body)
    assert edited.status_code == 200 and (edited.json()["total"], edited.json()["edited_by"]) == (49, "root@kiet.edu")
    mine = judge.get("/judge").json()["panels"][0]["teams"]
    assert next(t for t in mine if t["id"] == team["id"])["my_score"]["total"] == 49
    log = root.get("/admin/activity", params={"kind": "judging", "page_size": 100}).json()["items"]
    entry = next(e for e in log if e["action"] == "judging.score_edited")
    assert "was: 32/50 [4, 3, 5, 2, 1, 0, 5, 5, 7]" in entry["detail"] and "correct a typo" in entry["detail"]
    # The super admin can also enter marks for a judge who has none yet (e.g. from a paper sheet).
    entered = root.put(f"/admin/panels/{room['id']}/teams/{judging['teams']['cse_b']['id']}/scores/judge@industry.com", body)
    assert entered.status_code == 200
    # Not on this panel, a team from another room, a withdrawn team.
    assert score(judging["cse_prof"], room, team, FULL).status_code == 403
    assert score(judge, room, judging["teams"]["it_a"], FULL).status_code == 403
    root.post(f"/admin/teams/{judging['teams']['cse_c']['id']}/withdraw", {"reason": "Left the event"})
    assert score(judge, room, judging["teams"]["cse_c"], FULL).status_code == 409
    # The scores show up for organisers, never for other judges; each judge's marks for super admins only.
    panel = root.get("/admin/judging/department").json()["panels"][0]
    row = next(t for t in panel["teams"] if t["id"] == team["id"])
    assert row["average"] == 49 and [s["total"] for s in row["judge_scores"]] == [49]
    cse_row = next(t for t in judging["cse"].get("/admin/judging/department").json()["panels"][0]["teams"] if t["id"] == team["id"])
    assert cse_row["average"] == 49 and cse_row["judge_scores"] is None
    other = judging["external"].get("/judge").json()["panels"][0]["teams"]
    assert next(t for t in other if t["id"] == team["id"])["my_score"] is None


def test_scored_teams_and_judges_cannot_be_removed(judging):
    root, room = judging["root"], judging["room"]
    set_room(judging)
    root.post("/admin/judging/department/open")
    score(judging["it_prof"], room, judging["teams"]["cse_a"], FULL)
    assert root.put(f"/admin/panels/{room['id']}/teams", {"team_ids": [judging["teams"]["cse_b"]["id"]]}).status_code == 409
    assert root.put(f"/admin/panels/{room['id']}/jurors", {"jurors": [{"email": "judge@industry.com"}]}).status_code == 409
    assert root.delete(f"/admin/panels/{room['id']}").status_code == 409
    assert root.delete("/admin/jurors/it.prof@kiet.edu").status_code == 409
    # An unscored team and an unassigned judge can go.
    keep = [judging["teams"][k]["id"] for k in ("cse_a", "cse_b")]
    assert root.put(f"/admin/panels/{room['id']}/teams", {"team_ids": keep}).status_code == 200
    assert root.delete("/admin/jurors/cse.prof@kiet.edu").status_code == 204


# ---------- Rankings ----------


def test_rankings_use_the_tie_breakers(judging):
    root, room = judging["root"], judging["room"]
    set_room(judging)
    root.post("/admin/judging/department/open")
    a, b, c = (judging["teams"][k] for k in ("cse_a", "cse_b", "cse_c"))
    # Category 1 uses the software rubric: criterion 2 (Innovation & Novelty) breaks ties first.
    # a and b both total 40; b scores higher on innovation, so b ranks first.
    score(judging["it_prof"], room, a, [5, 5, 3, 3, 5, 5, 4, 4, 6])
    score(judging["it_prof"], room, b, [3, 3, 5, 5, 5, 5, 4, 4, 6])
    # c: same total and innovation as a, lower Query Addressing.
    score(judging["it_prof"], room, c, [5, 5, 3, 3, 5, 5, 5, 5, 4])
    ranking = root.get("/admin/judging/department/rankings").json()
    group = ranking["groups"][0]
    assert group["department"] == "CSE" and group["category"] == 1
    order = [(t["team"]["name"], t["position"], t["tied"]) for t in group["teams"]]
    assert order == [("CSE Beta", 1, False), ("CSE Alpha", 2, False), ("CSE Gamma", 3, False)]
    assert group["teams"][0]["scores"] == 1 and group["teams"][0]["judges"] == 2

    # A full tie on all three: the chair decides, flagged, still no shared position.
    fix = {"marks": [5, 5, 3, 3, 5, 5, 4, 4, 6], "remarks": "", "reason": "Recounted the sheet"}
    assert root.put(f"/admin/panels/{room['id']}/teams/{c['id']}/scores/it.prof@kiet.edu", fix).status_code == 200
    group = root.get("/admin/judging/department/rankings").json()["groups"][0]
    tied = [t for t in group["teams"] if t["team"]["name"] in ("CSE Alpha", "CSE Gamma")]
    assert [t["position"] for t in tied] == [2, 3] and tied[1]["tied"] is True

    # Department admins see their own rankings only; outside admins none.
    assert judging["cse"].get("/admin/judging/department/rankings").json()["groups"][0]["department"] == "CSE"
    assert judging["it"].get("/admin/judging/department/rankings").json()["groups"] == []


# ---------- Tents and the finale ----------


def test_tents_for_the_finale(judging, settings):
    root = judging["root"]
    college, school, cse_a = (judging["teams"][k] for k in ("college", "school", "cse_a"))
    # Before results, only the direct teams go to the finale.
    overview = root.get("/admin/judging/final").json()
    assert {r["team"]["name"] for r in overview["tents"]} == {"ABES Team", "DPS Team"}
    assert root.put("/admin/judging/final/tents", {"tents": [{"team_id": cse_a["id"], "tent": "T-1"}]}).status_code == 422
    duplicate = [{"team_id": college["id"], "tent": "t-1"}, {"team_id": school["id"], "tent": "T-1"}]
    assert root.put("/admin/judging/final/tents", {"tents": duplicate}).status_code == 422
    assert root.put("/admin/judging/final/tents", {"tents": [{"team_id": college["id"], "tent": "T 1!"}]}).status_code == 422
    saved = root.put(
        "/admin/judging/final/tents", {"tents": [{"team_id": college["id"], "tent": " t-1 "}, {"team_id": school["id"], "tent": "T-2"}]}
    )
    assert saved.status_code == 200
    assert {r["team"]["name"]: r["tent"] for r in saved.json()["tents"]} == {"ABES Team": "T-1", "DPS Team": "T-2"}
    # Swapping two tents in one save works; taking another team's tent does not.
    swap = [{"team_id": college["id"], "tent": "T-2"}, {"team_id": school["id"], "tent": "T-1"}]
    assert root.put("/admin/judging/final/tents", {"tents": swap}).status_code == 200
    assert root.put("/admin/judging/final/tents", {"tents": [{"team_id": college["id"], "tent": "T-1"}]}).status_code == 409

    # After publishing, the finalist joins; the attendance sheet follows tent order.
    root.put("/admin/finalists/CSE", {"nominations": [{"category": 1, "team_ids": [cse_a["id"]]}]})
    assert publish(root, settings).status_code == 200
    assert root.put("/admin/judging/final/tents", {"tents": [{"team_id": cse_a["id"], "tent": "T-10"}]}).status_code == 200
    sheet = root.get("/admin/judging/final/attendance").json()
    assert [t["tent"] for t in sheet["teams"]] == ["T-1", "T-2", "T-10"]
    assert all(len(t["members"]) == 2 and t["members"][0]["role"] == "leader" for t in sheet["teams"])


def test_finale_rankings_group_schools_separately(judging, settings):
    root = judging["root"]
    panel = root.post("/admin/panels", {"round": "final", "name": "Panel A"}).json()
    college, school = judging["teams"]["college"], judging["teams"]["school"]
    root.put(f"/admin/panels/{panel['id']}/teams", {"team_ids": [college["id"], school["id"]]})
    root.put(f"/admin/panels/{panel['id']}/jurors", {"jurors": [{"email": "judge@industry.com", "chair": True}]})
    root.put("/admin/finalists/CSE", {"nominations": [{"category": 1, "team_ids": [judging["teams"]["cse_a"]["id"]]}]})
    assert publish(root, settings).status_code == 200
    assert root.post("/admin/judging/final/open").status_code == 200
    assert score(judging["external"], panel, college, FULL).status_code == 200
    groups = {g["label"]: g for g in root.get("/admin/judging/final/rankings").json()["groups"]}
    assert set(groups) == {"Category 8: CyberShield", "Best School Project"}
    assert groups["Category 8: CyberShield"]["teams"][0]["average"] == 50
    assert groups["Best School Project"]["teams"][0]["position"] is None
    # With the finale under way, results can no longer be withdrawn.
    assert root.post("/admin/results/unpublish", {"confirm": "UNPUBLISH", "reason": "Published by mistake"}).status_code == 409


def test_attendance_sheet_for_a_room(judging):
    set_room(judging)
    sheet = judging["root"].get("/admin/judging/department/attendance", params={"panel_id": judging["room"]["id"]}).json()
    assert sheet["title"] == "CSIT Block · 304 · CSE teams" and sheet["location"] == "2nd floor"
    assert (sheet["building"], sheet["room"], sheet["slot_start"][:16]) == ("CSIT Block", "304", "2026-10-22T04:30")
    assert sheet["jurors"] == ["IT Professor (chair)", "Industry Judge"]
    assert [t["code"] for t in sheet["teams"]] == [judging["teams"][k]["code"] for k in ("cse_a", "cse_b", "cse_c")]
    assert {m["roll_number"] for t in sheet["teams"] for m in t["members"]} != {""}
    assert judging["root"].get("/admin/judging/department/attendance").status_code == 422
    # A whole department's sheet, rooms first.
    whole = judging["cse"].get("/admin/judging/department/attendance").json()
    assert [t["room"] for t in whole["teams"]] == ["CSIT Block · 304"] * 3


def test_judging_actions_are_audited(judging):
    set_room(judging)
    judging["root"].post("/admin/judging/department/open")
    actions = {e["action"] for e in judging["root"].get("/admin/activity", params={"kind": "judging", "page_size": 100}).json()["items"]}
    assert {
        "judging.judge_added",
        "judging.panel_created",
        "judging.teams_allotted",
        "judging.judges_assigned",
        "judging.opened",
    } <= actions
