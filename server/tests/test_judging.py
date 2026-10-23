"""Judging: judges, rooms and panels, allotments, tents, the lock, scores, rankings and attendance sheets."""

from datetime import UTC, datetime, timedelta

import pytest
from test_admin import publish, world  # noqa: F401  (fixture)

from app import rules
from app.services import judging as judging_service
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


# Inside the fixture room's slot (22 October, 10:00 AM to 1:00 PM IST), where judges can submit marks.
DURING_SLOT = datetime(2026, 10, 22, 11, 0, tzinfo=rules.IST)


@pytest.fixture
def judging(world, settings, monkeypatch):  # noqa: F811
    """Registration closed, three judges (IT faculty, CSE faculty, external), a CSE room, and the clock inside its slot."""
    monkeypatch.setattr(judging_service, "utcnow", lambda: DURING_SLOT)
    settings.force_registration_open = False
    settings.registration_opens = datetime.now(UTC) - timedelta(days=10)
    settings.registration_closes = datetime.now(UTC) - timedelta(days=1)
    root = world["root"]
    for body in (
        {"email": "it.prof@kiet.edu", "name": "IT Professor", "kind": "faculty", "department": "IT"},
        {"email": "cse.prof@kiet.edu", "name": "CSE Professor", "kind": "faculty", "department": "CSE"},
        {"email": "expert@kiet.edu", "name": "Industry Judge", "kind": "external", "organisation": "Acme Labs"},
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
        "external": Api(client, "expert@kiet.edu"),
    }


def set_room(j, teams=("cse_a", "cse_b", "cse_c"), jurors=(("it.prof@kiet.edu", True), ("cse.prof@kiet.edu", False))):
    root, room = j["root"], j["room"]
    response = root.put(f"/admin/panels/{room['id']}/teams", {"team_ids": [j["teams"][k]["id"] for k in teams]})
    assert response.status_code == 200, response.text
    response = root.put(f"/admin/panels/{room['id']}/jurors", {"jurors": [{"email": e, "chair": c} for e, c in jurors]})
    assert response.status_code == 200, response.text
    return response.json()


def accept_direct(j):
    """Teams from other colleges and schools get stalls only once the organisers have accepted them."""
    ids = [j["teams"][k]["id"] for k in ("college", "school")]
    response = j["root"].post("/admin/teams/accept", {"team_ids": ids, "accepted": True})
    assert response.status_code == 200 and response.json()["changed"] == 2, response.text


def score(judge, room, team, parts):
    return judge.put(f"/judge/panels/{room['id']}/teams/{team['id']}/score", marks(parts))


# ---------- Judges ----------


def test_judges_sign_in_and_see_only_their_page(judging, client):
    # A judge can sign in before being put in a room; their page is simply empty.
    assert judging["it_prof"].get("/judge").json()["panels"] == []
    set_room(judging)
    me = judging["it_prof"].get("/admin/me").json()
    assert (me["role"], me["judge"], me["department"]) == ("judge", True, "IT")
    # A judge is not an organiser: every admin endpoint refuses them.
    assert judging["it_prof"].get("/admin/teams").status_code == 403
    assert judging["it_prof"].get("/admin/stats").status_code == 403
    assert [p["name"] for p in judging["it_prof"].get("/judge").json()["panels"]] == ["304"]
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
    # Department admins add KIET faculty as judges, from their own department or another.
    added = cse.post("/admin/jurors", {"email": "xavier@kiet.edu", "name": "Xavier", "kind": "faculty", "department": "ME"})
    assert added.status_code == 201 and added.json()["added_by"] == "cse.admin@kiet.edu"
    own = cse.post("/admin/jurors", {"email": "own@kiet.edu", "name": "Own Dept", "kind": "faculty", "department": "CSE"})
    assert own.status_code == 201
    assert {j["email"] for j in cse.get("/admin/jurors").json()} >= {"xavier@kiet.edu", "it.prof@kiet.edu"}
    # Rooms for their own department only, never the finale.
    mine = cse.post("/admin/panels", room_body("CSE", building="G Block", name="112"))
    assert mine.status_code == 201 and mine.json()["can_edit"] is True
    assert cse.post("/admin/panels", room_body("IT", building="G Block", name="113")).status_code == 403
    assert cse.post("/admin/panels", {"round": "final", "name": "Panel Z"}).status_code == 403
    assert (
        cse.put(f"/admin/panels/{mine.json()['id']}/jurors", {"jurors": [{"email": "xavier@kiet.edu", "chair": True}]}).status_code == 200
    )
    # Another department's admin cannot touch it.
    place = {"building": "G Block", "name": "114", "slot_start": "2026-10-22T10:00:00+05:30", "slot_end": "2026-10-22T11:00:00+05:30"}
    assert it.patch(f"/admin/panels/{mine.json()['id']}", place).status_code == 403
    assert it.put(f"/admin/panels/{mine.json()['id']}/teams", {"team_ids": []}).status_code == 403
    assert it.delete(f"/admin/panels/{mine.json()['id']}").status_code == 403
    assert cse.patch(f"/admin/panels/{mine.json()['id']}", place).json()["name"] == "114"
    # A department admin removes only judges they added (and only while unassigned).
    assert cse.delete("/admin/jurors/expert@kiet.edu").status_code == 403
    assert cse.delete("/admin/jurors/xavier@kiet.edu").status_code == 409
    cse.put(f"/admin/panels/{mine.json()['id']}/jurors", {"jurors": []})
    assert cse.delete("/admin/jurors/xavier@kiet.edu").status_code == 204
    # Only KIET emails can judge, for super admins and department admins alike.
    for who in (cse, root):
        outsider = who.post("/admin/jurors", {"email": "judge@industry.com", "name": "Outsider", "kind": "faculty", "department": "ME"})
        assert outsider.status_code == 422 and "@kiet.edu" in outsider.json()["detail"]
    # Outside experts (with a KIET account) are appointed by super admins; department admins add faculty only.
    expert = {"email": "guest@kiet.edu", "name": "Guest Expert", "kind": "external", "organisation": "Acme Labs"}
    refused = cse.post("/admin/jurors", expert)
    assert refused.status_code == 403 and "super admin" in refused.json()["detail"]
    assert root.post("/admin/jurors", expert).status_code == 201
    # A department admin adds their own department's faculty too: one of each room's two judges is from it.
    assert (
        cse.post(
            "/admin/jurors", {"email": "cse.colleague@kiet.edu", "name": "CSE Colleague", "kind": "faculty", "department": "CSE"}
        ).status_code
        == 201
    )
    # The COE KIET admin has no department round, so no rooms.
    root.post("/admin/admins", {"email": "coe.admin@kiet.edu", "name": "COE Admin", "role": "admin", "department": "COE"})
    assert Api(client, "coe.admin@kiet.edu").post("/admin/panels", room_body("COE")).status_code == 422
    assert Api(client, "coe.admin@kiet.edu").get("/admin/jurors").status_code == 403
    assert (
        root.post("/admin/jurors", {"email": "it.prof@kiet.edu", "name": "Again", "kind": "faculty", "department": "IT"}).status_code == 409
    )
    assert root.post("/admin/jurors", {"email": "f@kiet.edu", "name": "No Dept", "kind": "faculty"}).status_code == 422
    assert root.post("/admin/jurors", {"email": "e@kiet.edu", "name": "No Org", "kind": "external"}).status_code == 422
    listed = {j["email"]: j for j in root.get("/admin/jurors").json()}
    assert listed["cse.prof@kiet.edu"]["organisation"] == rules.KIET_INSTITUTION


# ---------- Rooms ----------


def test_rooms_follow_the_rules(judging):
    root, room = judging["root"], judging["room"]
    assert (room["building"], room["name"], room["location"]) == ("CSIT Block", "304", "2nd floor")
    # The same room cannot be booked twice at overlapping times (any case); back to back, another room or the finale is fine.
    clash = root.post("/admin/panels", room_body("IT", building="csit  block", start="11:00", end="12:00"))
    assert (
        clash.status_code == 409 and "CSIT Block · 304 is already booked 22 Oct, 10:00 AM - 1:00 PM (CSE teams)" in clash.json()["detail"]
    )
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
        {**room_body("IT"), "slot_start": "2026-10-22T10:00:00"},
    ):
        assert root.post("/admin/panels", bad).status_code == 422, bad
    # A room given no time takes its department's slot from the timetable (IT: 24 October, 9:30 AM to 12:30 PM).
    timed = root.post("/admin/panels", {**room_body("IT", building="Main Block", name="1"), "slot_start": None, "slot_end": None})
    assert timed.status_code == 201 and timed.json()["slot_start"] == "2026-10-24T09:30:00+05:30"
    # Only submitted teams of the room's department.
    it_team = judging["teams"]["it_a"]["id"]
    assert root.put(f"/admin/panels/{room['id']}/teams", {"team_ids": [it_team]}).status_code == 422
    assert root.put(f"/admin/panels/{room['id']}/teams", {"team_ids": [judging["teams"]["college"]["id"]]}).status_code == 422
    # Two judges per room: one from the room's own department, one from another department.
    root.post("/admin/jurors", {"email": "cse.two@kiet.edu", "name": "CSE Two", "kind": "faculty", "department": "CSE"})
    root.post("/admin/jurors", {"email": "me.prof@kiet.edu", "name": "ME Professor", "kind": "faculty", "department": "ME"})
    jurors = lambda *emails: {"jurors": [{"email": e} for e in emails]}  # noqa: E731
    both_cse = root.put(f"/admin/panels/{room['id']}/jurors", jurors("cse.prof@kiet.edu", "cse.two@kiet.edu"))
    assert both_cse.status_code == 422 and "Only one of the two judges can be from CSE" in both_cse.json()["detail"]
    both_other = root.put(f"/admin/panels/{room['id']}/jurors", jurors("it.prof@kiet.edu", "me.prof@kiet.edu"))
    assert both_other.status_code == 422 and "Only one judge can come from another department" in both_other.json()["detail"]
    three = root.put(f"/admin/panels/{room['id']}/jurors", jurors("cse.prof@kiet.edu", "it.prof@kiet.edu", "me.prof@kiet.edu"))
    assert three.status_code == 422 and "two judges" in three.json()["detail"]
    assert root.put(f"/admin/panels/{room['id']}/jurors", {"jurors": [{"email": "nobody@kiet.edu"}]}).status_code == 422
    panel = set_room(judging)
    # The parent department judge (from the room's own department) comes first; nobody is called a chair any more.
    assert [(j["email"], j["parent_department"]) for j in panel["jurors"]] == [("cse.prof@kiet.edu", True), ("it.prof@kiet.edu", False)]
    assert all("chair" not in j for j in panel["jurors"])
    assert len(panel["teams"]) == 3
    # A judge sits in one room: the IT professor cannot also judge IT's room.
    it_room = root.post("/admin/panels", room_body("IT", building="Main Block", name="2")).json()
    busy = root.put(f"/admin/panels/{it_room['id']}/jurors", jurors("it.prof@kiet.edu"))
    assert busy.status_code == 409 and "IT Professor already judges in CSIT Block · 304 (CSE teams, 22 Oct" in busy.json()["detail"]
    listed = {j["email"]: j for j in root.get("/admin/jurors").json()}
    assert [(p["building"], p["name"], p["department"]) for p in listed["it.prof@kiet.edu"]["panels"]] == [("CSIT Block", "304", "CSE")]
    assert (
        listed["cse.prof@kiet.edu"]["panels"][0]["parent_department"] is True
        and listed["it.prof@kiet.edu"]["panels"][0]["parent_department"] is False
    )


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
    # Saved marks stay open to the judge until they lock them, but changing them needs a clear reason.
    edit = {"marks": [5, 5, 5, 5, 5, 5, 5, 5, 9], "remarks": ""}
    assert judge.put(f"/judge/panels/{room['id']}/teams/{team['id']}/score", edit).status_code == 422
    assert judge.put(f"/judge/panels/{room['id']}/teams/{team['id']}/score", edit | {"edit_reason": "typo"}).status_code == 422
    assert (
        judge.put(f"/judge/panels/{room['id']}/teams/{team['id']}/score", edit | {"edit_reason": "aaaaaaaaaaaaaaaaaa"}).status_code == 422
    )
    # Saving the same marks again is harmless and needs no reason.
    assert score(judge, room, team, [4, 3, 5, 2, 1, 0, 5, 5, 7]).status_code == 200
    changed = judge.put(f"/judge/panels/{room['id']}/teams/{team['id']}/score", edit | {"edit_reason": "I mis-typed the last mark"})
    # Nothing about changes is shown to the judge; the count is kept in the record (the admin responses below show it).
    assert changed.status_code == 200 and changed.json()["total"] == 49 and changed.json()["edit_count"] == 0
    # Once the judge locks their marks in the room, they are final for the judge.
    lock = judge.post(f"/judge/panels/{room['id']}/lock")
    assert lock.status_code == 200 and lock.json() == {"locked": 1, "unscored": 2}
    assert judge.post(f"/judge/panels/{room['id']}/lock").status_code == 200
    again = judge.put(f"/judge/panels/{room['id']}/teams/{team['id']}/score", edit | {"edit_reason": "I changed my mind again"})
    assert again.status_code == 409 and "Only a super admin" in again.json()["detail"]
    assert judge.get("/judge").json()["panels"][0]["locked"] is True
    # A department admin changes them with a real reason, a super admin with none; the activity log keeps the old marks.
    path = f"/admin/panels/{room['id']}/teams/{team['id']}/scores/it.prof@kiet.edu"
    body = {"marks": [5, 5, 5, 5, 5, 5, 5, 5, 8], "remarks": "", "reason": "Judge asked to correct a typo"}
    assert judging["it"].put(path, body).status_code == 403
    assert judging["cse"].put(path, body | {"reason": ""}).status_code == 422
    assert judging["cse"].put(path, body | {"reason": "x"}).status_code == 422
    assert root.put(path, body | {"marks": [6, 5, 5, 5, 5, 5, 5, 5, 9]}).status_code == 422
    assert root.put(f"/admin/panels/{room['id']}/teams/{team['id']}/scores/expert@kiet.edu", body).status_code == 422
    by_dept = judging["cse"].put(path, body)
    assert by_dept.status_code == 200 and (by_dept.json()["total"], by_dept.json()["edit_count"]) == (48, 2)
    edited = root.put(path, body | {"marks": [5, 5, 5, 5, 5, 5, 5, 5, 9], "reason": ""})
    assert edited.status_code == 200 and (edited.json()["total"], edited.json()["edited_by"]) == (49, "root@kiet.edu")
    mine = judge.get("/judge").json()["panels"][0]["teams"]
    assert next(t for t in mine if t["id"] == team["id"])["my_score"]["total"] == 49
    log = root.get("/admin/activity", params={"kind": "judging", "page_size": 100}).json()["items"]
    entries = [e["detail"] for e in log if e["action"] == "judging.score_edited"]
    assert any("was: 32/50 [4, 3, 5, 2, 1, 0, 5, 5, 7]" in d and "I mis-typed" in d for d in entries)
    assert any("was: 49/50" in d and "correct a typo" in d for d in entries)
    assert any("was: 48/50" in d and "no reason given" in d for d in entries)
    # The super admin can also enter marks for a judge who has none yet (e.g. from a paper sheet).
    entered = root.put(f"/admin/panels/{room['id']}/teams/{judging['teams']['cse_b']['id']}/scores/cse.prof@kiet.edu", body)
    assert entered.status_code == 200
    # Not on this panel, a team from another room, a withdrawn team.
    assert score(judging["external"], room, team, FULL).status_code == 403
    assert score(judge, room, judging["teams"]["it_a"], FULL).status_code == 403
    root.post(f"/admin/teams/{judging['teams']['cse_c']['id']}/withdraw", {"reason": "Left the event"})
    assert score(judge, room, judging["teams"]["cse_c"], FULL).status_code == 409
    # The scores show up for organisers, never for other judges; each judge's marks for super admins only.
    panel = root.get("/admin/judging/department").json()["panels"][0]
    row = next(t for t in panel["teams"] if t["id"] == team["id"])
    assert row["average"] == 49 and [s["total"] for s in row["judge_scores"]] == [49]
    cse_row = next(t for t in judging["cse"].get("/admin/judging/department").json()["panels"][0]["teams"] if t["id"] == team["id"])
    # A department's own admin sees each judge's marks in its rooms, to be able to correct them; other departments' admins do not.
    assert cse_row["average"] == 49 and [x["total"] for x in cse_row["judge_scores"]] == [49]
    it_panels = judging["it"].get("/admin/judging/department").json()["panels"]
    assert all(t["judge_scores"] is None for p in it_panels if p["id"] == room["id"] for t in p["teams"])
    other = judging["cse_prof"].get("/judge").json()["panels"][0]["teams"]
    assert next(t for t in other if t["id"] == team["id"])["my_score"] is None


def test_scored_teams_and_judges_cannot_be_removed(judging):
    root, room = judging["root"], judging["room"]
    set_room(judging)
    root.post("/admin/judging/department/open")
    score(judging["it_prof"], room, judging["teams"]["cse_a"], FULL)
    assert root.put(f"/admin/panels/{room['id']}/teams", {"team_ids": [judging["teams"]["cse_b"]["id"]]}).status_code == 409
    assert root.put(f"/admin/panels/{room['id']}/jurors", {"jurors": [{"email": "cse.prof@kiet.edu"}]}).status_code == 409
    assert root.delete(f"/admin/panels/{room['id']}").status_code == 409
    assert root.delete("/admin/jurors/it.prof@kiet.edu").status_code == 409
    # An unscored team and an unassigned judge can go.
    keep = [judging["teams"][k]["id"] for k in ("cse_a", "cse_b")]
    assert root.put(f"/admin/panels/{room['id']}/teams", {"team_ids": keep}).status_code == 200
    assert root.delete("/admin/jurors/expert@kiet.edu").status_code == 204


# ---------- Rankings ----------


def test_rankings_use_the_tie_breakers(judging):
    root, room = judging["root"], judging["room"]
    set_room(judging)
    root.post("/admin/judging/department/open")
    a, b, c = (judging["teams"][k] for k in ("cse_a", "cse_b", "cse_c"))
    # Category 1 uses the software rubric: criterion 2 (Innovation & Novelty) breaks ties first.
    # a and b both average 40; b scores higher on innovation, so b ranks first.
    both = lambda team, parts: [score(judging[j], room, team, parts) for j in ("it_prof", "cse_prof")]  # noqa: E731
    both(a, [5, 5, 3, 3, 5, 5, 4, 4, 6])
    both(b, [3, 3, 5, 5, 5, 5, 4, 4, 6])
    # c: same average and innovation as a, lower Query Addressing; for now only one judge has scored it.
    score(judging["it_prof"], room, c, [5, 5, 3, 3, 5, 5, 5, 5, 4])
    group = root.get("/admin/judging/department/rankings").json()["groups"][0]
    assert group["department"] == "CSE" and group["category"] == 1
    order = [(t["team"]["name"], t["position"], t["complete"]) for t in group["teams"]]
    # A team gets a place only once both judges have scored it.
    assert order == [("CSE Beta", 1, True), ("CSE Alpha", 2, True), ("CSE Gamma", None, False)]
    assert group["teams"][0]["scores"] == 2 and group["teams"][0]["judges"] == 2 and group["teams"][0]["average"] == 40
    score(judging["cse_prof"], room, c, [5, 5, 3, 3, 5, 5, 5, 5, 4])
    group = root.get("/admin/judging/department/rankings").json()["groups"][0]
    assert [(t["team"]["name"], t["position"]) for t in group["teams"]] == [("CSE Beta", 1), ("CSE Alpha", 2), ("CSE Gamma", 3)]
    # The average of both judges: different marks from each still rank by the mean.
    assert group["prizes"] == [{"place": 1, "amount": 2000}]

    # A full tie on all three: the parent department judge decides, flagged, still no shared position.
    fix = {"marks": [5, 5, 3, 3, 5, 5, 4, 4, 6], "remarks": "", "reason": "Recounted the sheet"}
    for judge in ("it.prof@kiet.edu", "cse.prof@kiet.edu"):
        assert root.put(f"/admin/panels/{room['id']}/teams/{c['id']}/scores/{judge}", fix).status_code == 200
    group = root.get("/admin/judging/department/rankings").json()["groups"][0]
    tied = [t for t in group["teams"] if t["team"]["name"] in ("CSE Alpha", "CSE Gamma")]
    assert [t["position"] for t in tied] == [2, 3] and tied[1]["tied"] is True

    # Department admins see their own rankings only; outside admins none.
    assert judging["cse"].get("/admin/judging/department/rankings").json()["groups"][0]["department"] == "CSE"
    assert judging["it"].get("/admin/judging/department/rankings").json()["groups"] == []


# ---------- Tents and the finale ----------


def test_tents_for_the_finale(judging, settings):
    accept_direct(judging)
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


def test_other_colleges_and_schools_are_accepted_before_they_get_stalls(judging, as_user):
    import uuid

    root = judging["root"]
    college, school, cse_a = (judging["teams"][k] for k in ("college", "school", "cse_a"))
    # Teams from other colleges and schools wait for the organisers; KIET department teams do not.
    assert root.get(f"/admin/teams/{college['id']}").json()["approval_required"] is True
    assert root.get(f"/admin/teams/{college['id']}").json()["approved_at"] is None
    assert root.get(f"/admin/teams/{cse_a['id']}").json()["approval_required"] is False
    leader, pupil = as_user("r@gmail.com"), as_user("k@gmail.com")
    cards = lambda who: [(c["round"], c["status"]) for c in who.get("/me/results").json()["cards"]]  # noqa: E731
    queue = leader.get("/me/results").json()["cards"][0]
    assert cards(leader) == [("final", "awaiting")] == cards(pupil)
    assert "queue" in queue["title"] and "No stall has been allotted yet" in queue["message"]
    # Not accepted: no stall can be given, and the finale list does not show the team.
    assert {r["team"]["name"] for r in root.get("/admin/judging/final").json()["tents"]} == set()
    refused = root.put("/admin/judging/final/tents", {"tents": [{"team_id": college["id"], "tent": "S-1"}]})
    assert refused.status_code == 422
    # Who may accept: the super admin and the admins of other colleges and schools, not a department admin.
    ids = [college["id"], school["id"], cse_a["id"], str(uuid.uuid4())]
    assert judging["cse"].post("/admin/teams/accept", {"team_ids": ids, "accepted": True}).status_code == 403
    out = root.post("/admin/teams/accept", {"team_ids": ids, "accepted": True}).json()
    assert (out["changed"], out["not_found"]) == (2, 1)
    assert [s["code"] for s in out["skipped"]] == [cse_a["code"]] and "does not need acceptance" in out["skipped"][0]["reason"]
    assert root.post("/admin/teams/accept", {"team_ids": ids, "accepted": True}).json()["changed"] == 0
    # Accepted, no stall yet.
    accepted = leader.get("/me/results").json()["cards"][0]
    assert accepted["status"] == "qualified" and "accepted" in accepted["title"] and "No stall has been allotted yet" in accepted["message"]
    assert cards(pupil) == [("final", "qualified")]
    assert {r["team"]["name"] for r in root.get("/admin/judging/final").json()["tents"]} == {"ABES Team", "DPS Team"}
    # With a stall the team is told it.
    assert root.put("/admin/judging/final/tents", {"tents": [{"team_id": college["id"], "tent": "S-1"}]}).status_code == 200
    assert "S-1" in leader.get("/me/results").json()["cards"][0]["message"]
    # Taking acceptance back is blocked while the team has a stall; the rest go back in the queue.
    back = root.post("/admin/teams/accept", {"team_ids": [college["id"], school["id"]], "accepted": False}).json()
    assert back["changed"] == 1 and "stall" in back["skipped"][0]["reason"].lower()
    assert cards(pupil) == [("final", "awaiting")] and cards(leader) == [("final", "qualified")]
    # Filters: the approval filter finds teams waiting for acceptance.
    waiting = root.get("/admin/teams", params={"type": "school", "approval": "pending"}).json()
    assert [t["code"] for t in waiting["items"]] == [school["code"]]
    # Disqualified teams are told so (colleges and schools alike); a team that is not submitted cannot be accepted.
    assert root.post(f"/admin/teams/{school['id']}/disqualify", {"reason": "Not a genuine entry"}).status_code == 200
    assert cards(pupil) == [("final", "disqualified")]
    skipped = root.post("/admin/teams/accept", {"team_ids": [school["id"]], "accepted": True}).json()
    assert skipped["changed"] == 0 and "not a submitted team" in skipped["skipped"][0]["reason"]
    log = root.get("/admin/activity", params={"kind": "team", "page_size": 100}).json()["items"]
    assert {"team.approved", "team.approval_revoked"} <= {e["action"] for e in log}


def test_finale_rankings_group_schools_separately(judging, settings):
    accept_direct(judging)
    root = judging["root"]
    panel = root.post("/admin/panels", {"round": "final", "name": "Panel A"}).json()
    college, school = judging["teams"]["college"], judging["teams"]["school"]
    root.put(f"/admin/panels/{panel['id']}/teams", {"team_ids": [college["id"], school["id"]]})
    root.put(f"/admin/panels/{panel['id']}/jurors", {"jurors": [{"email": "expert@kiet.edu", "chair": True}]})
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
    assert sheet["jurors"] == ["CSE Professor (parent department)", "IT Professor"]
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


# ---------- Timetable and scoring window ----------


def test_the_department_timetable(judging):
    root, cse = judging["root"], judging["cse"]
    table = root.get("/admin/judging/timetable").json()
    slots = {s["department"]: (s["slot_start"], s["slot_end"]) for s in table["slots"]}
    assert slots["CSE(AI)"] == ("2026-10-23T09:30:00+05:30", "2026-10-23T12:30:00+05:30")
    assert slots["CSE"] == ("2026-10-23T13:30:00+05:30", "2026-10-23T17:00:00+05:30")
    assert slots["KSOM"][0] == "2026-10-24T09:30:00+05:30" and slots["KSOP"][0] == "2026-10-24T13:30:00+05:30"
    # The other branches share the Saturday afternoon slot.
    assert slots["CSE(DS)"] == slots["CSE(CS)"] == slots["MCA"] == ("2026-10-24T13:30:00+05:30", "2026-10-24T17:00:00+05:30")
    assert "COE" not in slots and "grace_minutes" not in table
    assert cse.get("/admin/judging/timetable").status_code == 200
    body = {
        "slots": [{"department": "CSE", "slot_start": "2026-10-23T14:00:00+05:30", "slot_end": "2026-10-23T17:30:00+05:30"}],
    }
    assert cse.put("/admin/judging/timetable", body).status_code == 403
    # A CSE room at the old time moves with the timetable; one at another time stays.
    with_slot = root.post(
        "/admin/panels", {**room_body("CSE", building="G Block", name="112"), "slot_start": None, "slot_end": None}
    ).json()
    saved = root.put("/admin/judging/timetable", body)
    assert saved.status_code == 200
    rooms = {p["id"]: p for p in root.get("/admin/judging/department").json()["panels"]}
    assert rooms[with_slot["id"]]["slot_start"].startswith("2026-10-23T08:30")
    assert rooms[judging["room"]["id"]]["slot_start"].startswith("2026-10-22T04:30")
    # Each room's scoring time runs 15 minutes (the default buffer) past its slot, which ends at 1:00 PM IST.
    assert rooms[judging["room"]["id"]]["scoring_until"].startswith("2026-10-22T07:45")
    assert rooms[judging["room"]["id"]]["buffer_minutes"] == 15
    for bad in (
        {"slots": [{"department": "COE", "slot_start": None, "slot_end": None}]},
        {"slots": [{"department": "IT", "slot_start": "2026-10-24T12:00:00+05:30", "slot_end": "2026-10-24T11:00:00+05:30"}]},
    ):
        assert root.put("/admin/judging/timetable", bad).status_code == 422, bad
    log = root.get("/admin/activity", params={"kind": "judging", "page_size": 100}).json()["items"]
    assert any(e["action"] == "judging.timetable_updated" and "1 rooms moved" in e["detail"] for e in log)
    # A department with no slot (cleared by the super admin) needs a time on each new room.
    root.put("/admin/judging/timetable", {"slots": [{"department": "MCA", "slot_start": None, "slot_end": None}]})
    assert root.post("/admin/panels", {**room_body("MCA"), "slot_start": None, "slot_end": None}).status_code == 422


def test_marks_only_during_the_slot_and_the_room_buffer(judging, monkeypatch):
    root, cse, room = judging["root"], judging["cse"], judging["room"]
    set_room(judging)
    root.post("/admin/judging/department/open")
    a, b, c = (judging["teams"][k] for k in ("cse_a", "cse_b", "cse_c"))
    view = judging["it_prof"].get("/judge").json()
    panel = view["panels"][0]
    assert panel["scoring_from"].startswith("2026-10-22T04:30") and panel["scoring_until"].startswith("2026-10-22T07:45")
    assert panel["buffer_minutes"] == 15 and panel["locked"] is False
    at = lambda *t: monkeypatch.setattr(judging_service, "utcnow", lambda: datetime(*t, tzinfo=rules.IST))  # noqa: E731
    at(2026, 10, 22, 9, 55)
    early = score(judging["it_prof"], room, a, FULL)
    assert early.status_code == 423 and "opens 22 Oct at 10:00 AM" in early.json()["detail"] and "1:" not in early.json()["detail"]
    # The slot ended at 1:00 PM; the room's buffer (15 minutes) is the judges' extra time to submit.
    at(2026, 10, 22, 13, 10)
    assert score(judging["it_prof"], room, a, FULL).status_code == 200
    at(2026, 10, 22, 13, 14)
    assert score(judging["cse_prof"], room, a, FULL).status_code == 200
    at(2026, 10, 22, 13, 16)
    late = score(judging["it_prof"], room, b, FULL)
    assert late.status_code == 423 and "has closed" in late.json()["detail"]
    # Marks lock themselves when the time is over: the judge sees them locked and cannot edit them either.
    mine = judging["it_prof"].get("/judge").json()["panels"][0]
    assert mine["locked"] is True and next(t for t in mine["teams"] if t["id"] == a["id"])["my_score"]["locked"] is True
    change = {"marks": [4] * 8 + [9], "remarks": "", "edit_reason": "I want to be fairer to them"}
    assert judging["it_prof"].put(f"/judge/panels/{room['id']}/teams/{a['id']}/score", change).status_code == 423
    # The judge still signs in and reads the room afterwards.
    assert judging["it_prof"].get("/judge").status_code == 200
    # After the buffer the department admin cannot change marks either; the super admin still can.
    fix = {"marks": FULL, "remarks": "", "reason": "Judge was delayed, marks from the paper sheet"}
    path = f"/admin/panels/{room['id']}/teams/{b['id']}/scores/it.prof@kiet.edu"
    refused = cse.put(path, fix)
    assert refused.status_code == 403 and "time slot" in refused.json()["detail"]
    assert root.put(path, fix).status_code == 200
    # More time for the judges: the department admin widens the buffer (up to an hour), and it reopens the room.
    assert cse.put(f"/admin/panels/{room['id']}/buffer", {"buffer_minutes": 61}).status_code == 422
    assert cse.put(f"/admin/panels/{room['id']}/buffer", {"buffer_minutes": -1}).status_code == 422
    assert judging["it"].put(f"/admin/panels/{room['id']}/buffer", {"buffer_minutes": 30}).status_code == 403
    widened = cse.put(f"/admin/panels/{room['id']}/buffer", {"buffer_minutes": 30})
    assert widened.status_code == 200 and widened.json()["buffer_minutes"] == 30
    assert judging["it_prof"].get("/judge").json()["panels"][0]["locked"] is False
    assert score(judging["it_prof"], room, c, FULL).status_code == 200
    # Within the slot and buffer the department admin may change a judge's marks, with a real reason.
    assert cse.put(f"/admin/panels/{room['id']}/teams/{c['id']}/scores/it.prof@kiet.edu", fix | {"reason": "oops"}).status_code == 422
    assert cse.put(f"/admin/panels/{room['id']}/teams/{c['id']}/scores/it.prof@kiet.edu", fix).status_code == 200
    # Moving the room's time reopens it as well.
    at(2026, 10, 22, 14, 0)
    assert score(judging["cse_prof"], room, b, FULL).status_code == 423
    later = {
        "building": "CSIT Block",
        "name": "304",
        "location": "2nd floor",
        "slot_start": "2026-10-22T12:00:00+05:30",
        "slot_end": "2026-10-22T14:00:00+05:30",
    }
    assert cse.patch(f"/admin/panels/{room['id']}", later).status_code == 200
    assert score(judging["cse_prof"], room, b, FULL).status_code == 200


def test_judges_lock_all_their_marks_and_organisers_can_unlock(judging, monkeypatch):
    root, cse, room = judging["root"], judging["cse"], judging["room"]
    set_room(judging)
    a, b = judging["teams"]["cse_a"], judging["teams"]["cse_b"]
    # Not before the round is open, not for someone else's room.
    assert judging["it_prof"].post(f"/judge/panels/{room['id']}/lock").status_code == 423
    root.post("/admin/judging/department/open")
    assert judging["external"].post(f"/judge/panels/{room['id']}/lock").status_code == 403
    assert score(judging["it_prof"], room, a, FULL).status_code == 200
    assert score(judging["cse_prof"], room, a, FULL).status_code == 200
    # Locking is per judge and covers all their marks; teams they have not marked stay unscored.
    locked = judging["it_prof"].post(f"/judge/panels/{room['id']}/lock")
    assert locked.json() == {"locked": 1, "unscored": 2}
    assert score(judging["it_prof"], room, b, FULL).status_code == 409
    assert score(judging["cse_prof"], room, b, FULL).status_code == 200
    # The organisers see who has locked.
    view = cse.get("/admin/judging/department").json()["panels"][0]
    assert {j["email"]: j["locked"] for j in view["jurors"]} == {"it.prof@kiet.edu": True, "cse.prof@kiet.edu": False}
    # Unlocking: needs the department's admin (or a super admin), and a clear reason from the former.
    other = judging["it"].post(f"/admin/panels/{room['id']}/jurors/it.prof@kiet.edu/unlock", {"reason": "Judge locked too early"})
    assert other.status_code == 403
    assert cse.post(f"/admin/panels/{room['id']}/jurors/it.prof@kiet.edu/unlock", {"reason": "no"}).status_code == 422
    assert cse.post(f"/admin/panels/{room['id']}/jurors/cse.prof@kiet.edu/unlock", {"reason": "Judge locked too early"}).status_code == 409
    unlocked = cse.post(f"/admin/panels/{room['id']}/jurors/it.prof@kiet.edu/unlock", {"reason": "Judge locked too early"})
    assert unlocked.status_code == 200
    assert score(judging["it_prof"], room, b, FULL).status_code == 200
    # A super admin needs no reason.
    assert judging["it_prof"].post(f"/judge/panels/{room['id']}/lock").status_code == 200
    assert root.post(f"/admin/panels/{room['id']}/jurors/it.prof@kiet.edu/unlock", {}).status_code == 200
    log = root.get("/admin/activity", params={"kind": "judging", "page_size": 100}).json()["items"]
    assert {"judging.marks_locked", "judging.marks_unlocked"} <= {e["action"] for e in log}


def test_organisers_mark_judges_present(judging):
    root, cse, room = judging["root"], judging["cse"], judging["room"]
    set_room(judging)
    path = lambda email: f"/admin/panels/{room['id']}/jurors/{email}/present"  # noqa: E731
    seats = lambda who: {j["email"]: j for j in who.get("/admin/judging/department").json()["panels"][0]["jurors"]}  # noqa: E731
    assert all(j["present_at"] is None for j in seats(cse).values())
    # The department's own admin and a super admin can; another department's admin and strangers cannot.
    assert judging["it"].put(path("cse.prof@kiet.edu"), {"present": True}).status_code == 403
    assert cse.put(path("nobody@kiet.edu"), {"present": True}).status_code == 404
    assert cse.put(path("expert@kiet.edu"), {"present": True}).status_code == 404  # a judge, but not in this room
    marked = cse.put(path("cse.prof@kiet.edu"), {"present": True})
    assert marked.status_code == 200
    jurors = {j["email"]: j for j in marked.json()["jurors"]}
    assert jurors["cse.prof@kiet.edu"]["present_at"] and jurors["cse.prof@kiet.edu"]["present_by"] == "cse.admin@kiet.edu"
    assert jurors["it.prof@kiet.edu"]["present_at"] is None
    moment = lambda text: datetime.fromisoformat(text.replace("Z", "+00:00"))  # noqa: E731
    first = moment(jurors["cse.prof@kiet.edu"]["present_at"])
    # Marking twice changes nothing (not even the time) and is logged once.
    again = cse.put(path("cse.prof@kiet.edu"), {"present": True}).json()["jurors"]
    assert moment({j["email"]: j for j in again}["cse.prof@kiet.edu"]["present_at"]) == first
    assert root.put(path("it.prof@kiet.edu"), {"present": True}).status_code == 200
    assert all(j["present_at"] for j in seats(root).values())
    # The judge sees that they were marked present; saving the same judges again keeps attendance.
    mine = judging["cse_prof"].get("/judge").json()["panels"][0]
    assert mine["present_at"] and mine["parent_department"] is True
    assert judging["it_prof"].get("/judge").json()["panels"][0]["parent_department"] is False
    assert (
        cse.put(
            f"/admin/panels/{room['id']}/jurors", {"jurors": [{"email": "it.prof@kiet.edu"}, {"email": "cse.prof@kiet.edu"}]}
        ).status_code
        == 200
    )
    assert all(j["present_at"] for j in seats(root).values())
    # Taking the mark back works, twice is harmless, and both are in the activity log.
    assert cse.put(path("cse.prof@kiet.edu"), {"present": False}).status_code == 200
    assert cse.put(path("cse.prof@kiet.edu"), {"present": False}).status_code == 200
    assert seats(cse)["cse.prof@kiet.edu"]["present_at"] is None
    log = root.get("/admin/activity", params={"kind": "judging", "page_size": 100}).json()["items"]
    actions = [e["action"] for e in log]
    assert actions.count("judging.judge_present") == 2 and actions.count("judging.judge_unmarked") == 1


def test_saving_the_judges_again_keeps_their_locks(judging):
    """Re-saving a room's judges must not undo a judge's lock (that would skip the unlock reason)."""
    root, cse, room = judging["root"], judging["cse"], judging["room"]
    set_room(judging)
    root.post("/admin/judging/department/open")
    assert judging["it_prof"].post(f"/judge/panels/{room['id']}/lock").status_code == 200
    same = {"jurors": [{"email": "it.prof@kiet.edu"}, {"email": "cse.prof@kiet.edu"}]}
    assert cse.put(f"/admin/panels/{room['id']}/jurors", same).status_code == 200
    jurors = {j["email"]: j for j in root.get("/admin/judging/department").json()["panels"][0]["jurors"]}
    assert jurors["it.prof@kiet.edu"]["locked"] is True and jurors["cse.prof@kiet.edu"]["locked"] is False
    assert score(judging["it_prof"], room, judging["teams"]["cse_a"], FULL).status_code == 409


def test_no_deadlock_between_the_slot_the_buffer_and_the_locks(judging, monkeypatch):
    """Whatever happens, a team can always be marked by somebody: judges inside the window, the department admin
    inside the window, and a super admin at any time."""
    root, cse, room = judging["root"], judging["cse"], judging["room"]
    set_room(judging)
    root.post("/admin/judging/department/open")
    a = judging["teams"]["cse_a"]
    at = lambda *t: monkeypatch.setattr(judging_service, "utcnow", lambda: datetime(*t, tzinfo=rules.IST))  # noqa: E731
    path = f"/admin/panels/{room['id']}/teams/{a['id']}/scores/it.prof@kiet.edu"
    fix = {"marks": FULL, "remarks": "", "reason": "Marks from the paper sheet"}
    # A judge locks before marking anyone, then needs the room again: unlock works and so does the department admin.
    assert judging["it_prof"].post(f"/judge/panels/{room['id']}/lock").json() == {"locked": 0, "unscored": 3}
    assert cse.put(path, fix).status_code == 200
    assert (
        cse.post(f"/admin/panels/{room['id']}/jurors/it.prof@kiet.edu/unlock", {"reason": "Judge locked before marking"}).status_code == 200
    )
    # No buffer at all: the slot is the whole window; the department admin may set it back to zero.
    assert cse.put(f"/admin/panels/{room['id']}/buffer", {"buffer_minutes": 0}).json()["buffer_minutes"] == 0
    at(2026, 10, 22, 13, 1)
    assert score(judging["cse_prof"], room, a, FULL).status_code == 423
    # A round the organisers have shut locks the room at once, and opening it again reopens it.
    at(2026, 10, 22, 11, 0)
    root.post("/admin/judging/department/lock")
    assert score(judging["cse_prof"], room, a, FULL).status_code == 423
    assert judging["cse_prof"].get("/judge").json()["panels"][0]["locked"] is True
    root.post("/admin/judging/department/open")
    assert score(judging["cse_prof"], room, a, FULL).status_code == 200
    # A room that has no slot never closes by itself: the judge locks it, or the super admin does the rest.
    assert root.put(path, fix).status_code == 200
    # Even after everything else, the super admin can mark days later.
    at(2026, 10, 30, 9, 0)
    assert root.put(path, fix | {"reason": ""}).status_code == 200
    assert cse.put(path, fix).status_code == 403


def test_scoring_opens_only_when_every_room_has_both_judges(judging):
    root = judging["root"]
    set_room(judging, jurors=(("it.prof@kiet.edu", True),))
    blocked = root.post("/admin/judging/department/open")
    assert blocked.status_code == 409 and "CSIT Block · 304 needs a judge from CSE" in blocked.json()["detail"]
    set_room(judging, jurors=(("cse.prof@kiet.edu", True),))
    assert "needs a judge from another department" in root.post("/admin/judging/department/open").json()["detail"]
    set_room(judging)
    assert root.post("/admin/judging/department/open").status_code == 200


# ---------- Judge sign-in window ----------


def test_judges_read_any_time_but_mark_attendance_only_on_the_day(judging, monkeypatch, as_user):
    from test_attendance import code_for

    set_room(judging)
    at = lambda *t: monkeypatch.setattr(judging_service, "utcnow", lambda: datetime(*t, tzinfo=rules.IST))  # noqa: E731
    alpha = as_user("a@kiet.edu").get("/me/pass").json()
    scan = lambda: judging["it_prof"].post("/admin/attendance/scan", {"code": code_for(alpha), "round": "department"})  # noqa: E731
    # Days before: the judge signs in and reads the room, but cannot mark attendance or submit marks.
    at(2026, 10, 20, 11, 0)
    assert judging["it_prof"].get("/admin/me").json()["role"] == "judge"
    assert judging["it_prof"].get("/judge").json()["panels"][0]["name"] == "304"
    assert scan().status_code == 403
    # On the day, from two hours before the slot (10:00 AM).
    at(2026, 10, 22, 8, 5)
    assert scan().json()["result"] == "marked"


# ---------- Winners and prizes ----------


def scored_room(judging):
    root, room = judging["root"], judging["room"]
    set_room(judging)
    root.post("/admin/judging/department/open")
    for key, parts in (("cse_a", [5, 5, 5, 5, 5, 5, 5, 5, 10]), ("cse_b", [4, 4, 4, 4, 4, 4, 4, 4, 8])):
        for judge in ("it_prof", "cse_prof"):
            assert score(judging[judge], room, judging["teams"][key], parts).status_code == 200
    return judging["teams"]


def test_organisers_declare_and_publish_winners(judging, as_user):
    teams = scored_room(judging)
    root, cse, it = judging["root"], judging["cse"], judging["it"]
    award = lambda who, key, place=1: who.post("/admin/judging/department/awards", {"team_id": teams[key]["id"], "place": place})  # noqa: E731
    # Only teams both judges scored; only 1st place in the department round; only your own department.
    assert award(cse, "cse_c").status_code == 409
    assert award(cse, "cse_a", 2).status_code == 422
    assert award(it, "cse_a").status_code == 403
    assert award(cse, "cse_a").status_code == 204
    taken = award(root, "cse_b")
    assert taken.status_code == 409 and "CSE Alpha already holds this place" in taken.json()["detail"]
    group = cse.get("/admin/judging/department/rankings").json()["groups"][0]
    assert group["teams"][0]["award"]["amount"] == 2000 and group["teams"][0]["team"]["name"] == "CSE Alpha"
    # Students see nothing until a super admin publishes the winners.
    leader = as_user("a@kiet.edu")
    assert [c["status"] for c in leader.get("/me/results").json()["cards"]] == ["awaiting"]
    assert cse.post("/admin/judging/department/awards/publish").status_code == 403
    assert root.post("/admin/judging/department/awards/publish").status_code == 204
    cards = leader.get("/me/results").json()["cards"]
    assert cards[0]["status"] == "winner" and cards[0]["amount"] == 2000 and "Category 1" in cards[0]["message"]
    # Published winners are frozen until withdrawn.
    assert cse.delete(f"/admin/judging/department/awards/{teams['cse_a']['id']}").status_code == 409
    assert root.post("/admin/judging/department/awards/withdraw").status_code == 204
    assert cse.delete(f"/admin/judging/department/awards/{teams['cse_a']['id']}").status_code == 204
    log = root.get("/admin/activity", params={"kind": "judging", "page_size": 100}).json()["items"]
    assert {"judging.award_declared", "judging.awards_published", "judging.awards_withdrawn", "judging.award_removed"} <= {
        e["action"] for e in log
    }


def test_students_see_their_results(judging, as_user, settings):
    teams = scored_room(judging)
    root = judging["root"]
    alpha, beta, college = as_user("a@kiet.edu"), as_user("c@kiet.edu"), as_user("r@gmail.com")
    assert [c["status"] for c in alpha.get("/me/results").json()["cards"]] == ["awaiting"]
    assert [(c["round"], c["status"]) for c in college.get("/me/results").json()["cards"]] == [("final", "awaiting")]
    accept_direct(judging)
    # Finalists published: Alpha is a finalist, Beta is not.
    root.put("/admin/finalists/CSE", {"nominations": [{"category": 1, "team_ids": [teams["cse_a"]["id"]]}]})
    assert publish(root, settings).status_code == 200
    assert [(c["round"], c["status"]) for c in alpha.get("/me/results").json()["cards"]] == [
        ("final", "awaiting"),
        ("department", "finalist"),
    ]
    beta_card = beta.get("/me/results").json()["cards"]
    assert [c["status"] for c in beta_card] == ["not_selected"] and "Better luck next time" in beta_card[0]["message"]
    # Grand Finale winners: 2nd place in a project category wins Rs 5,000; others read "better luck next time".
    panel = root.post("/admin/panels", {"round": "final", "name": "Panel A"}).json()
    root.put(f"/admin/panels/{panel['id']}/teams", {"team_ids": [teams["cse_a"]["id"], teams["college"]["id"]]})
    root.put(f"/admin/panels/{panel['id']}/jurors", {"jurors": [{"email": "expert@kiet.edu", "chair": True}]})
    assert root.post("/admin/judging/final/open").status_code == 200
    for key in ("cse_a", "college"):
        assert score(judging["external"], panel, teams[key], FULL).status_code == 200
    assert judging["cse"].post("/admin/judging/final/awards", {"team_id": teams["cse_a"]["id"], "place": 2}).status_code == 403
    assert root.post("/admin/judging/final/awards", {"team_id": teams["cse_a"]["id"], "place": 2}).status_code == 204
    root.post("/admin/judging/final/awards/publish")
    final = alpha.get("/me/results").json()["cards"][0]
    assert (final["status"], final["place"], final["amount"]) == ("winner", 2, 5000)
    assert college.get("/me/results").json()["cards"][0]["status"] == "participated"


# ---------- Readiness board ----------


def test_the_readiness_board_ranks_departments_and_shows_counts_only(judging):
    root, cse, it = judging["root"], judging["cse"], judging["it"]
    before = {r["department"]: r for r in root.get("/admin/judging/department/readiness").json()["rows"]}
    assert before["CSE"]["rooms"] == 1 and before["CSE"]["allotted"] == 0 and before["CSE"]["percent"] == 0

    # CSE allots its teams and staffs the room; IT has done nothing.
    cse_teams = [t["id"] for t in root.get("/admin/judging/department").json()["unallotted"] if t["department"] == "CSE"]
    assert cse.put(f"/admin/panels/{judging['room']['id']}/teams", {"team_ids": cse_teams}).status_code == 200
    staffed = cse.put(
        f"/admin/panels/{judging['room']['id']}/jurors",
        {"jurors": [{"email": "cse.prof@kiet.edu", "chair": True}, {"email": "it.prof@kiet.edu", "chair": False}]},
    )
    assert staffed.status_code == 200, staffed.text

    # Every department admin sees everyone's progress (counts only), ranked, with their own marked.
    for api, mine in ((cse, "CSE"), (it, "IT"), (root, None)):
        board = api.get("/admin/judging/department/readiness").json()
        assert board["mine"] == mine
        rows = {r["department"]: r for r in board["rows"]}
        assert rows["CSE"]["percent"] > rows["IT"]["percent"] and rows["CSE"]["rank"] < rows["IT"]["rank"]
        assert rows["CSE"]["ready"] is True and rows["IT"]["ready"] is False
        assert set(rows["CSE"]) == {"department", "teams", "allotted", "rooms", "staffed", "percent", "ready", "rank"}
    # Outside and startup admins have no part in the department round.
    for email, role in (("outside.desk@gmail.com", "outside_admin"), ("startup.desk@gmail.com", "startup_admin")):
        assert root.post("/admin/admins", {"email": email, "name": "Desk", "role": role}).status_code == 201
        assert Api(root.client, email).get("/admin/judging/department/readiness").status_code == 403


def test_a_judge_can_sit_in_several_rooms_one_at_a_time(judging):
    root = judging["root"]
    jurors = lambda *emails: {"jurors": [{"email": e} for e in emails]}  # noqa: E731
    first = set_room(judging)  # the CSE room, 22 Oct 10:00 to 1:00 pm, with cse.prof and it.prof
    assert {j["email"] for j in first["jurors"]} == {"cse.prof@kiet.edu", "it.prof@kiet.edu"}

    def book(department, name, day, start, end, emails):
        room = root.post("/admin/panels", room_body(department, building="Main Block", name=name, day=day, start=start, end=end)).json()
        return root.put(f"/admin/panels/{room['id']}/jurors", jurors(*emails)), room

    # Another day: the same two judges are free (it.prof is IT faculty, so IT's room can have them as its parent judge).
    ok, _ = book("IT", "2", "2026-10-23", "09:30", "12:30", ["it.prof@kiet.edu", "cse.prof@kiet.edu"])
    assert ok.status_code == 200, ok.text
    # The same day at an overlapping time, or touching the end of the first room: refused, with when they are free again.
    clash, _ = book("IT", "3", "2026-10-22", "12:00", "14:00", ["it.prof@kiet.edu"])
    assert clash.status_code == 409 and "IT Professor already judges in CSIT Block · 304" in clash.json()["detail"]
    assert "free again from 22 Oct, 1:01 PM" in clash.json()["detail"]
    touching, _ = book("IT", "4", "2026-10-22", "13:00", "15:00", ["it.prof@kiet.edu"])
    assert touching.status_code == 409
    # One minute after the first room ends, they are free.
    free, late = book("IT", "5", "2026-10-22", "13:01", "15:00", ["it.prof@kiet.edu", "cse.prof@kiet.edu"])
    assert free.status_code == 200, free.text

    # The judge's page shows every room, and the Judges list tells organisers where each judge is taken and when.
    assert len(judging["it_prof"].get("/judge").json()["panels"]) == 3
    listed = {j["email"]: j for j in root.get("/admin/jurors").json()}
    rooms = listed["it.prof@kiet.edu"]["panels"]
    assert len(rooms) == 3 and all(r["slot_start"] and r["slot_end"] for r in rooms)
    # Department admins see the same bookings, including rooms of other departments.
    seen = {j["email"]: j for j in judging["it"].get("/admin/jurors").json()}
    assert len(seen["it.prof@kiet.edu"]["panels"]) == 3

    # Moving a room onto another of the judge's rooms is refused too.
    move = root.patch(
        f"/admin/panels/{late['id']}",
        {
            "building": "Main Block",
            "name": "5",
            "location": "",
            "slot_start": "2026-10-23T10:00:00+05:30",
            "slot_end": "2026-10-23T12:00:00+05:30",
        },
    )
    assert move.status_code == 409 and "its new time would clash" in move.json()["detail"]
    later = root.patch(
        f"/admin/panels/{late['id']}",
        {
            "building": "Main Block",
            "name": "5",
            "location": "",
            "slot_start": "2026-10-24T13:30:00+05:30",
            "slot_end": "2026-10-24T16:30:00+05:30",
        },
    )
    assert later.status_code == 200, later.text


def test_changed_marks_are_not_flagged_to_judges_or_on_the_room(judging):
    root, cse, room = judging["root"], judging["cse"], judging["room"]
    set_room(judging)
    root.post("/admin/judging/department/open")
    team = judging["teams"]["cse_a"]
    judge = judging["it_prof"]
    assert score(judge, room, team, FULL).status_code == 200
    # The judge changes their own marks (with a reason), then a department admin and a super admin change them too.
    own = judge.put(
        f"/judge/panels/{room['id']}/teams/{team['id']}/score",
        {"marks": [4] * 8 + [9], "remarks": "", "edit_reason": "I changed my mind about this"},
    )
    assert own.status_code == 200 and own.json()["edit_count"] == 0 and own.json()["edited_by"] is None
    path = f"/admin/panels/{room['id']}/teams/{team['id']}/scores/it.prof@kiet.edu"
    assert cse.put(path, {"marks": [5] * 8 + [8], "remarks": "", "reason": "Judge asked to correct a typo"}).status_code == 200
    assert root.put(path, {"marks": [3] * 8 + [8], "remarks": "", "reason": ""}).status_code == 200

    def mark_of(admin):
        panel = next(p for p in admin.get("/admin/judging/department").json()["panels"] if p["id"] == room["id"])
        return next(s for t in panel["teams"] if t["id"] == team["id"] for s in t["judge_scores"] if s["juror_email"] == "it.prof@kiet.edu")

    # The marks stand, and nothing marks them as changed: not for the super admin, not for the department admin.
    for who in (root, cse):
        shown = mark_of(who)
        assert shown["total"] == 32
        assert (shown["edit_count"], shown["edited_by"], shown["edit_reason"]) == (0, None, None)
    # The judge sees only the marks.
    mine = next(t for t in judge.get("/judge").json()["panels"][0]["teams"] if t["id"] == team["id"])["my_score"]
    assert mine["total"] == 32 and mine["edit_count"] == 0 and mine["edited_by"] is None

    # The record is kept: the activity log has all three changes for super admins. Department admins do not see any of them.
    def edits(who):
        items = who.get("/admin/activity", params={"kind": "judging", "page_size": 100}).json()["items"]
        return [e["actor_email"] for e in items if e["action"] == "judging.score_edited"]

    assert sorted(edits(root)) == ["cse.admin@kiet.edu", "it.prof@kiet.edu", "root@kiet.edu"]
    assert edits(cse) == []


def test_the_leaderboard_ranks_each_problem_statement_against_the_finalist_quota(judging):
    root, cse, it, room = judging["root"], judging["cse"], judging["it"], judging["room"]
    set_room(judging)
    root.post("/admin/judging/department/open")
    a, b, c = (judging["teams"][k] for k in ("cse_a", "cse_b", "cse_c"))
    marks = {a["id"]: FULL, b["id"]: [4] * 8 + [8], c["id"]: [4] * 8 + [8]}
    for team in (a, b, c):
        for judge in ("it_prof", "cse_prof"):
            assert score(judging[judge], room, team, marks[team["id"]]).status_code == 200

    board = root.get("/admin/leaderboard").json()
    dept = next(d for d in board["departments"] if d["department"] == "CSE")
    ps1 = next(cat for cat in dept["categories"] if cat["category"] == 1)
    # CSE has two finalist places in problem statements 1 to 4 (the event document); the top two are in line.
    assert ps1["quota"] == 2 and ps1["prize"] == 2000 and ps1["scored"] == 3
    ranked = [(t["team"]["code"], t["position"], t["in_line"]) for t in ps1["teams"]]
    assert ranked == [(a["code"], 1, True), (b["code"], 2, True), (c["code"], 3, False)]
    # The second and third are level on everything: the cut needs the parent department judge.
    assert ps1["tie_at_cut"] is True and ps1["teams"][2]["tied"] is True
    assert (dept["teams"], dept["scored"], dept["finalist_places"], dept["nominated"]) == (3, 3, 2, 0)
    # Nominations show on the leaderboard.
    assert root.put("/admin/finalists/CSE", {"nominations": [{"category": 1, "team_ids": [a["id"]]}]}).status_code == 200
    ps1 = next(
        cat
        for cat in next(d for d in root.get("/admin/leaderboard").json()["departments"] if d["department"] == "CSE")["categories"]
        if cat["category"] == 1
    )
    assert [t["nominated"] for t in ps1["teams"]] == [True, False, False]
    # Super admins only: department admins and judges cannot open it.
    assert cse.get("/admin/leaderboard").status_code == 403 and it.get("/admin/leaderboard").status_code == 403
    assert judging["it_prof"].get("/admin/leaderboard").status_code == 403
