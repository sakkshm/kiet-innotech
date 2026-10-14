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


def score(judge, room, team, parts):
    return judge.put(f"/judge/panels/{room['id']}/teams/{team['id']}/score", marks(parts))


# ---------- Judges ----------


def test_judges_sign_in_and_see_only_their_page(judging, client):
    # A judge without a room cannot sign in yet.
    early = judging["it_prof"].get("/admin/me")
    assert early.status_code == 403 and "not been put in a judging room" in early.json()["detail"]
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
        {**room_body("CSE(DS)"), "slot_start": None, "slot_end": None},
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
    two_chairs = [{"email": "it.prof@kiet.edu", "chair": True}, {"email": "cse.prof@kiet.edu", "chair": True}]
    assert root.put(f"/admin/panels/{room['id']}/jurors", {"jurors": two_chairs}).status_code == 422
    panel = set_room(judging)
    assert panel["jurors"][0]["email"] == "it.prof@kiet.edu" and panel["jurors"][0]["chair"]
    assert len(panel["teams"]) == 3
    # A judge sits in one room: the IT professor cannot also judge IT's room.
    it_room = root.post("/admin/panels", room_body("IT", building="Main Block", name="2")).json()
    busy = root.put(f"/admin/panels/{it_room['id']}/jurors", jurors("it.prof@kiet.edu"))
    assert busy.status_code == 409 and "IT Professor already judges in CSIT Block · 304 (CSE teams, 22 Oct" in busy.json()["detail"]
    listed = {j["email"]: j for j in root.get("/admin/jurors").json()}
    assert [(p["building"], p["name"], p["department"]) for p in listed["it.prof@kiet.edu"]["panels"]] == [("CSIT Block", "304", "CSE")]


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
    assert root.put(f"/admin/panels/{room['id']}/teams/{team['id']}/scores/expert@kiet.edu", body).status_code == 422
    edited = root.put(path, body)
    assert edited.status_code == 200 and (edited.json()["total"], edited.json()["edited_by"]) == (49, "root@kiet.edu")
    mine = judge.get("/judge").json()["panels"][0]["teams"]
    assert next(t for t in mine if t["id"] == team["id"])["my_score"]["total"] == 49
    log = root.get("/admin/activity", params={"kind": "judging", "page_size": 100}).json()["items"]
    entry = next(e for e in log if e["action"] == "judging.score_edited")
    assert "was: 32/50 [4, 3, 5, 2, 1, 0, 5, 5, 7]" in entry["detail"] and "correct a typo" in entry["detail"]
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
    assert cse_row["average"] == 49 and cse_row["judge_scores"] is None
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

    # A full tie on all three: the chair decides, flagged, still no shared position.
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
    assert sheet["jurors"] == ["IT Professor (chair)", "CSE Professor"]
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
    assert slots["CSE(DS)"] == (None, None) and "COE" not in slots and table["grace_minutes"] == 30
    assert cse.get("/admin/judging/timetable").status_code == 200
    body = {
        "slots": [{"department": "CSE", "slot_start": "2026-10-23T14:00:00+05:30", "slot_end": "2026-10-23T17:30:00+05:30"}],
        "grace_minutes": 45,
    }
    assert cse.put("/admin/judging/timetable", body).status_code == 403
    # A CSE room at the old time moves with the timetable; one at another time stays.
    with_slot = root.post(
        "/admin/panels", {**room_body("CSE", building="G Block", name="112"), "slot_start": None, "slot_end": None}
    ).json()
    saved = root.put("/admin/judging/timetable", body)
    assert saved.status_code == 200 and saved.json()["grace_minutes"] == 45
    rooms = {p["id"]: p for p in root.get("/admin/judging/department").json()["panels"]}
    assert rooms[with_slot["id"]]["slot_start"].startswith("2026-10-23T08:30")
    assert rooms[judging["room"]["id"]]["slot_start"].startswith("2026-10-22T04:30")
    assert rooms[judging["room"]["id"]]["scoring_until"].startswith("2026-10-22T08:15")
    for bad in (
        {"slots": [{"department": "COE", "slot_start": None, "slot_end": None}], "grace_minutes": 30},
        {
            "slots": [{"department": "IT", "slot_start": "2026-10-24T12:00:00+05:30", "slot_end": "2026-10-24T11:00:00+05:30"}],
            "grace_minutes": 30,
        },
        {"slots": [], "grace_minutes": 999},
    ):
        assert root.put("/admin/judging/timetable", bad).status_code == 422, bad
    log = root.get("/admin/activity", params={"kind": "judging", "page_size": 100}).json()["items"]
    assert any(e["action"] == "judging.timetable_updated" and "1 rooms moved" in e["detail"] for e in log)


def test_marks_only_during_the_slot_and_the_extra_time(judging, monkeypatch):
    root, room = judging["root"], judging["room"]
    set_room(judging)
    root.post("/admin/judging/department/open")
    a, b, c = (judging["teams"][k] for k in ("cse_a", "cse_b", "cse_c"))
    view = judging["it_prof"].get("/judge").json()
    assert view["panels"][0]["scoring_from"].startswith("2026-10-22T04:30") and view["panels"][0]["scoring_until"].startswith(
        "2026-10-22T08:00"
    )
    monkeypatch.setattr(judging_service, "utcnow", lambda: datetime(2026, 10, 22, 9, 55, tzinfo=rules.IST))
    early = score(judging["it_prof"], room, a, FULL)
    assert early.status_code == 423 and "22 Oct, 10:00 AM to 1:30 PM" in early.json()["detail"]
    monkeypatch.setattr(judging_service, "utcnow", lambda: datetime(2026, 10, 22, 13, 20, tzinfo=rules.IST))
    assert score(judging["it_prof"], room, a, FULL).status_code == 200  # in the extra 30 minutes
    monkeypatch.setattr(judging_service, "utcnow", lambda: datetime(2026, 10, 22, 13, 31, tzinfo=rules.IST))
    # Once scoring has closed, the judge's sign-in window has closed too.
    late = score(judging["it_prof"], room, b, FULL)
    assert late.status_code == 403 and "judging time has ended" in late.json()["detail"]
    # The super admin can still enter marks afterwards, and moving the room's time reopens it for the judges.
    fix = {"marks": FULL, "remarks": "", "reason": "Judge was delayed, marks from the paper sheet"}
    assert root.put(f"/admin/panels/{room['id']}/teams/{b['id']}/scores/it.prof@kiet.edu", fix).status_code == 200
    later = {
        "building": "CSIT Block",
        "name": "304",
        "location": "2nd floor",
        "slot_start": "2026-10-22T12:00:00+05:30",
        "slot_end": "2026-10-22T14:00:00+05:30",
    }
    assert judging["cse"].patch(f"/admin/panels/{room['id']}", later).status_code == 200
    assert score(judging["it_prof"], room, c, FULL).status_code == 200


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


def test_judges_sign_in_only_around_their_slot(judging, monkeypatch, client):
    set_room(judging)
    at = lambda *t: monkeypatch.setattr(judging_service, "utcnow", lambda: datetime(*t, tzinfo=rules.IST))  # noqa: E731
    at(2026, 10, 22, 8, 30)  # the room's slot starts at 10:00; sign-in opens 60 minutes before
    early = judging["it_prof"].get("/admin/me")
    assert (
        early.status_code == 403 and "starts Thu 22 Oct at 10:00 AM" in early.json()["detail"] and "from 9:00 AM" in early.json()["detail"]
    )
    assert judging["it_prof"].get("/judge").status_code == 403
    at(2026, 10, 22, 9, 5)
    assert judging["it_prof"].get("/admin/me").status_code == 200
    at(2026, 10, 22, 13, 40)  # slot ends 1:00 PM, extra time until 1:30 PM
    assert "ended" in judging["it_prof"].get("/judge").json()["detail"]
    # Judges cannot mark attendance outside it either.
    assert judging["it_prof"].post("/admin/attendance/scan", {"code": "x", "round": "department"}).status_code == 403
    # An organiser who also judges is never locked out.
    judging["root"].post("/admin/jurors", {"email": "cse.admin@kiet.edu", "name": "CSE Admin", "kind": "faculty", "department": "CSE"})
    assert judging["cse"].get("/admin/me").json()["role"] == "admin"
    # The super admin can open sign-in earlier with the timetable's lead time.
    table = judging["root"].get("/admin/judging/timetable").json()
    assert table["login_lead_minutes"] == 60
    at(2026, 10, 22, 7, 30)
    body = {"slots": [], "grace_minutes": 30, "login_lead_minutes": 180}
    assert judging["root"].put("/admin/judging/timetable", body).json()["login_lead_minutes"] == 180
    assert judging["it_prof"].get("/admin/me").status_code == 200


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
