"""The schedule an organiser controls: registration window and the nominations deadline."""

import json
from datetime import UTC, datetime, timedelta, timezone

import pytest

from app.db import get_sessionmaker
from app.models import AppState
from conftest import college_profile, kiet_profile, team_input
from test_concurrency import parallel

IST = timezone(timedelta(hours=5, minutes=30))


def iso(moment: datetime) -> str:
    return moment.isoformat()


def window(opens: timedelta, closes: timedelta) -> dict:
    now = datetime.now(UTC)
    return {"registration_opens": iso(now + opens), "registration_closes": iso(now + closes)}


@pytest.fixture
def real_window(settings):
    """Turns off the testing shortcut so the dates really decide, with the planned window currently open."""
    settings.force_registration_open = False
    settings.registration_opens = datetime.now(UTC) - timedelta(days=1)
    settings.registration_closes = datetime.now(UTC) + timedelta(days=5)
    return settings


@pytest.fixture
def root(as_user):
    return as_user("root@kiet.edu")


@pytest.fixture
def dept_admin(root, as_user):
    root.post("/admin/admins", {"email": "cse.admin@kiet.edu", "name": "CSE Admin", "role": "admin", "department": "CSE"})
    return as_user("cse.admin@kiet.edu")


def state(api) -> str:
    return api.get("/me").json()["registration"]["state"]


# ---------- Reading ----------


def test_planned_dates_apply_until_an_organiser_saves_a_change(root, real_window):
    schedule = root.get("/admin/schedule").json()
    assert schedule["customised"] is False and schedule["updated_by"] is None
    assert schedule["registration"]["state"] == "open"
    assert schedule["planned"]["registration_opens"] == schedule["registration"]["opens"]
    assert schedule["server_time"]


def test_public_config_needs_no_sign_in(client, real_window):
    response = client.get("/config")
    assert response.status_code == 200
    body = response.json()
    assert body["registration"]["state"] == "open"
    assert body["registration"]["opens"] and body["registration"]["closes"] and body["server_time"]
    # It carries nothing private: no admin or student data.
    assert set(body) == {"registration", "server_time"}


def test_every_admin_can_read_but_only_a_super_admin_can_change(root, dept_admin, as_user, student, real_window):
    assert dept_admin.get("/admin/schedule").status_code == 200
    body = window(timedelta(days=1), timedelta(days=2))
    assert dept_admin.put("/admin/schedule", body).status_code == 403
    assert dept_admin.post("/admin/schedule/open-now").status_code == 403
    assert dept_admin.post("/admin/schedule/close-now").status_code == 403
    student("a@kiet.edu")
    assert as_user("a@kiet.edu").get("/admin/schedule").status_code == 403
    assert as_user("a@kiet.edu").put("/admin/schedule", body).status_code == 403
    # Nothing was changed by the refused attempts.
    assert root.get("/admin/schedule").json()["customised"] is False


def test_signed_out_requests_to_the_schedule_are_refused(client):
    assert client.get("/admin/schedule").status_code == 401
    assert client.put("/admin/schedule", json={}).status_code == 401
    assert client.post("/admin/schedule/open-now").status_code == 401


# ---------- Changing the window ----------


def test_students_follow_the_saved_window_immediately(root, student, real_window):
    leader = student("a@kiet.edu")
    assert state(leader) == "open"

    # Closed before it opens, then opened, then closed: every change applies on the very next request.
    root.put("/admin/schedule", window(timedelta(days=1), timedelta(days=9)))
    assert state(leader) == "upcoming"
    response = leader.post("/teams", team_input())
    assert response.status_code == 403 and "Registration opens on" in response.json()["detail"]

    root.put("/admin/schedule", window(timedelta(days=-1), timedelta(days=9)))
    assert state(leader) == "open"
    assert leader.post("/teams", team_input()).status_code == 201

    root.put("/admin/schedule", window(timedelta(days=-9), timedelta(days=-1)))
    assert state(leader) == "closed"
    team = leader.get("/me/team").json()
    for call in (
        lambda: leader.patch(f"/teams/{team['id']}", team_input(name="Renamed")),
        lambda: leader.post(f"/teams/{team['id']}/invitations", {"email": "someone@kiet.edu"}),
        lambda: leader.post(f"/teams/{team['id']}/submit"),
        lambda: leader.post(f"/teams/{team['id']}/join-code/reset"),
        lambda: leader.delete(f"/teams/{team['id']}"),
    ):
        response = call()
        assert response.status_code == 403 and "Registration closed on" in response.json()["detail"]


def test_messages_show_the_organiser_dates_in_ist(root, as_user, real_window):
    opens = datetime(2031, 3, 5, 0, 0, tzinfo=IST)
    saved = root.put("/admin/schedule", {"registration_opens": iso(opens), "registration_closes": iso(opens + timedelta(days=3))}).json()
    assert saved["customised"] is True and saved["updated_by"] == "root@kiet.edu"
    # A new student cannot create a profile before the window, and is told the date the organiser chose.
    refused = as_user("new@kiet.edu").put("/me/profile", kiet_profile())
    assert refused.status_code == 403 and refused.json()["detail"] == "Registration opens on 5 March 2031."


def test_dates_keep_their_instant_whatever_offset_they_are_sent_in(root, real_window):
    opens = datetime(2026, 10, 20, 9, 0, tzinfo=IST)
    closes = datetime(2026, 10, 25, 23, 59, tzinfo=IST)
    body = root.put("/admin/schedule", {"registration_opens": iso(opens), "registration_closes": iso(closes.astimezone(UTC))}).json()
    assert datetime.fromisoformat(body["registration"]["opens"]) == opens
    assert datetime.fromisoformat(body["registration"]["closes"]) == closes


@pytest.mark.parametrize(
    "body",
    [
        {"registration_opens": "2026-10-10T10:00:00", "registration_closes": "2026-10-12T10:00:00+05:30"},  # no timezone
        {"registration_opens": "not a date", "registration_closes": "2026-10-12T10:00:00+05:30"},
        {"registration_opens": "2026-10-12T10:00:00+05:30", "registration_closes": "2026-10-12T10:00:00+05:30"},  # equal
        {"registration_opens": "2026-10-12T10:00:00+05:30", "registration_closes": "2026-10-10T10:00:00+05:30"},  # backwards
        {"registration_opens": "2026-10-01T10:00:00+05:30", "registration_closes": "2028-10-01T10:00:00+05:30"},  # two years
        {"registration_opens": "1999-01-01T00:00:00+05:30", "registration_closes": "1999-02-01T00:00:00+05:30"},
        {"registration_opens": "2026-10-01T10:00:00+05:30"},
        {"registration_opens": "2026-10-01T10:00:00+05:30", "registration_closes": "2026-10-09T10:00:00+05:30", "extra": 1},
    ],
)
def test_invalid_dates_are_rejected_and_change_nothing(root, real_window, body):
    assert root.put("/admin/schedule", body).status_code == 422
    assert root.get("/admin/schedule").json()["customised"] is False


# ---------- Open now / close now ----------


def test_open_now_before_the_planned_opening(root, student, as_user, real_window):
    real_window.registration_opens = datetime.now(UTC) + timedelta(days=2)
    real_window.registration_closes = datetime.now(UTC) + timedelta(days=9)
    new_student = as_user("early@kiet.edu")
    assert new_student.get("/me").json()["registration"]["state"] == "upcoming"

    schedule = root.post("/admin/schedule/open-now").json()
    assert schedule["registration"]["state"] == "open" and schedule["customised"] is True
    # The planned closing date is kept, to the instant.
    assert datetime.fromisoformat(schedule["registration"]["closes"]) == real_window.registration_closes
    assert new_student.put("/me/profile", kiet_profile()).status_code == 200
    assert root.post("/admin/schedule/open-now").status_code == 409  # already open


def test_open_again_after_the_closing_date_needs_a_new_closing_date(root, real_window):
    root.put("/admin/schedule", window(timedelta(days=-9), timedelta(days=-1)))
    assert root.get("/admin/schedule").json()["registration"]["state"] == "closed"

    refused = root.post("/admin/schedule/open-now")
    assert refused.status_code == 422 and "new closing date" in refused.json()["detail"]
    past = root.post("/admin/schedule/open-now", {"registration_closes": iso(datetime.now(UTC) - timedelta(hours=1))})
    assert past.status_code == 422

    reopened = root.post("/admin/schedule/open-now", {"registration_closes": iso(datetime.now(UTC) + timedelta(days=3))})
    assert reopened.status_code == 200 and reopened.json()["registration"]["state"] == "open"


def test_close_now_stops_changes_but_keeps_submitted_teams(root, student, team_of, real_window):
    leader, mate = student("a@kiet.edu"), student("b@kiet.edu")
    team = team_of(leader, [mate], name="Early Birds")
    assert leader.post(f"/teams/{team['id']}/submit").status_code == 200
    draft_leader = student("c@kiet.edu")
    assert draft_leader.post("/teams", team_input(name="Still Drafting")).status_code == 201

    closed = root.post("/admin/schedule/close-now").json()
    assert closed["registration"]["state"] == "closed"
    assert root.post("/admin/schedule/close-now").status_code == 409  # already closed

    # Nobody can change or submit anything any more, and a new student cannot start.
    assert draft_leader.post(f"/teams/{draft_leader.get('/me/team').json()['id']}/submit").status_code == 403
    assert draft_leader.post("/teams", team_input(name="Too Late")).status_code == 403
    # What was submitted is intact and still visible.
    assert leader.get("/me/team").json()["status"] == "submitted"
    assert root.get("/admin/teams", params={"status": "submitted"}).json()["total"] == 1


def test_close_now_before_registration_opened(root, real_window):
    real_window.registration_opens = datetime.now(UTC) + timedelta(days=2)
    real_window.registration_closes = datetime.now(UTC) + timedelta(days=9)
    assert root.post("/admin/schedule/close-now").json()["registration"]["state"] == "closed"
    # The stored window is still valid (opens before it closes), so it can be opened again.
    again = root.post("/admin/schedule/open-now", {"registration_closes": iso(datetime.now(UTC) + timedelta(days=4))})
    assert again.status_code == 200


def test_open_and_close_can_repeat(root, real_window):
    for _ in range(3):
        assert root.post("/admin/schedule/close-now").json()["registration"]["state"] == "closed"
        reopened = root.post("/admin/schedule/open-now", {"registration_closes": iso(datetime.now(UTC) + timedelta(days=2))})
        assert reopened.json()["registration"]["state"] == "open"


# ---------- Audit trail ----------


def test_every_change_is_in_the_audit_log_for_super_admins_only(root, dept_admin, real_window):
    root.put("/admin/schedule", window(timedelta(days=-1), timedelta(days=4)))
    root.post("/admin/schedule/close-now")
    root.post("/admin/schedule/open-now", {"registration_closes": iso(datetime.now(UTC) + timedelta(days=2))})
    actions = [entry["action"] for entry in root.get("/admin/audit", params={"limit": 50}).json()]
    assert {"schedule.updated", "schedule.closed", "schedule.opened"} <= set(actions)
    entry = next(e for e in root.get("/admin/audit", params={"limit": 50}).json() if e["action"] == "schedule.updated")
    assert entry["actor_email"] == "root@kiet.edu" and "closes" in entry["detail"]
    # Department admins see only their own department's history, and these entries belong to no department.
    assert not any(e["action"].startswith("schedule.") for e in dept_admin.get("/admin/audit", params={"limit": 50}).json())


# ---------- Nominations deadline ----------


def nominate(api, team_id: str, department: str = "CSE"):
    return api.put(f"/admin/finalists/{department}", {"nominations": [{"category": 1, "team_ids": [team_id]}]})


def submitted_cse_team(student, team_of):
    leader = student("a@kiet.edu")
    team = team_of(leader, [student("b@kiet.edu")], name="CSE Alpha", category=1)
    assert leader.post(f"/teams/{team['id']}/submit").status_code == 200
    return team


def test_planned_deadline_applies_until_changed(root, dept_admin, student, team_of, real_window):
    real_window.nominations_deadline = datetime.now(UTC) - timedelta(hours=1)
    team = submitted_cse_team(student, team_of)
    board = dept_admin.get("/admin/finalists").json()
    assert board["nominations_locked"] is True and board["nominations_deadline"]
    refused = nominate(dept_admin, team["id"])
    assert refused.status_code == 403 and "deadline passed" in refused.json()["detail"]
    # A super admin can still change it, after the deadline.
    assert nominate(root, team["id"]).status_code == 200
    assert root.get("/admin/finalists", params={"department": "CSE"}).json()["nominations_locked"] is False


def test_moving_the_deadline_reopens_nominations(root, dept_admin, student, team_of, real_window):
    team = submitted_cse_team(student, team_of)
    soon = datetime.now(UTC) + timedelta(days=2)
    dates = {**window(timedelta(days=-1), timedelta(days=5)), "nominations_deadline": iso(soon)}
    assert root.put("/admin/schedule", dates).json()["nominations_open"] is True
    assert nominate(dept_admin, team["id"]).status_code == 200

    past = {**dates, "nominations_deadline": iso(datetime.now(UTC) - timedelta(minutes=1))}
    assert root.put("/admin/schedule", past).json()["nominations_open"] is False
    assert nominate(dept_admin, team["id"]).status_code == 403

    # Clearing it means there is no deadline.
    cleared = {**dates, "nominations_deadline": None}
    body = root.put("/admin/schedule", cleared).json()
    assert body["nominations_deadline"] is None and body["nominations_open"] is True
    assert nominate(dept_admin, team["id"]).status_code == 200


# ---------- Safety ----------


def test_a_damaged_row_never_locks_students_out(root, student, real_window):
    leader = student("a@kiet.edu")
    with get_sessionmaker()() as db:
        db.add(AppState(key="schedule", value="{this is not json"))
        db.commit()
    assert state(leader) == "open"  # falls back to the planned dates
    assert root.get("/admin/schedule").json()["customised"] is False
    # And an organiser can simply save over it.
    assert root.put("/admin/schedule", window(timedelta(days=-1), timedelta(days=3))).status_code == 200
    assert root.get("/admin/schedule").json()["customised"] is True


def test_a_row_without_a_timezone_is_ignored(student, real_window):
    leader = student("a@kiet.edu")
    row = json.dumps({"opens": "2030-01-01T00:00:00", "closes": "2030-02-01T00:00:00"})
    with get_sessionmaker()() as db:
        db.add(AppState(key="schedule", value=row))
        db.commit()
    assert state(leader) == "open"


def test_two_organisers_saving_at_once_never_fail_or_mix_dates(root, real_window):
    first = window(timedelta(days=-2), timedelta(days=3))
    second = window(timedelta(days=-1), timedelta(days=7))
    codes = parallel(lambda: root.put("/admin/schedule", first), lambda: root.put("/admin/schedule", second))
    assert codes == [200, 200]
    saved = root.get("/admin/schedule").json()["registration"]
    pair = (datetime.fromisoformat(saved["opens"]), datetime.fromisoformat(saved["closes"]))
    expected = [
        (datetime.fromisoformat(body["registration_opens"]), datetime.fromisoformat(body["registration_closes"]))
        for body in (first, second)
    ]
    assert pair in expected  # one whole save won; the two were never mixed


def test_simultaneous_open_and_close_leave_a_valid_schedule(root, real_window):
    codes = parallel(
        lambda: root.post("/admin/schedule/close-now"),
        lambda: root.post("/admin/schedule/open-now", {"registration_closes": iso(datetime.now(UTC) + timedelta(days=2))}),
    )
    assert all(code in (200, 409, 422) for code in codes), codes
    saved = root.get("/admin/schedule").json()
    assert saved["registration"]["state"] in ("open", "closed")
    assert datetime.fromisoformat(saved["registration"]["opens"]) < datetime.fromisoformat(saved["registration"]["closes"])


def test_the_testing_shortcut_still_wins_in_development(root, student, settings):
    leader = student("a@kiet.edu")
    root.put("/admin/schedule", window(timedelta(days=-9), timedelta(days=-1)))  # closed by the dates
    assert settings.force_registration_open is True  # the test environment's shortcut
    assert state(leader) == "open"


def test_stats_carry_the_schedule_and_follow_it(root, dept_admin, student, real_window):
    student("a@kiet.edu")
    stats = root.get("/admin/stats").json()
    assert stats["schedule"]["registration"]["state"] == "open"
    dept = dept_admin.get("/admin/stats").json()
    assert dept["schedule"]["registration"]["state"] == "open"
    root.post("/admin/schedule/close-now")
    assert dept_admin.get("/admin/stats").json()["schedule"]["registration"]["state"] == "closed"
    # The daily timeline never runs past the closing date.
    last_day = stats["timeline"][-1]["date"]
    assert last_day <= datetime.now(IST).date().isoformat()


def test_college_students_are_held_to_the_same_window(root, student, as_user, real_window):
    root.put("/admin/schedule", window(timedelta(days=-9), timedelta(days=-1)))
    outsider = as_user("someone@gmail.com")
    assert outsider.put("/me/profile", college_profile()).status_code == 403
    assert outsider.get("/me").json()["registration"]["state"] == "closed"


# ---------- Publishing results is one-way, so it is guarded ----------


def two_nominated(root, student, team_of):
    team = submitted_cse_team(student, team_of)
    assert nominate(root, team["id"]).status_code == 200
    return team


def test_publishing_needs_the_typed_confirmation(root, student, team_of, real_window):
    two_nominated(root, student, team_of)
    real_window.nominations_deadline = datetime.now(UTC) - timedelta(minutes=1)
    for body in (None, {}, {"confirm": ""}, {"confirm": "yes"}, {"confirm": "publish now"}):
        response = root.post("/admin/results/publish", body)
        assert response.status_code == 422, (body, response.text)
    # Nothing was published by any of those.
    assert root.get("/admin/finalists/summary").json()["published_at"] is None
    assert root.post("/admin/results/publish", {"confirm": "PUBLISH"}).status_code == 200


def test_publishing_waits_for_the_nominations_deadline(root, student, team_of, real_window):
    two_nominated(root, student, team_of)
    real_window.nominations_deadline = datetime.now(UTC) + timedelta(days=3)
    summary = root.get("/admin/finalists/summary").json()
    assert "nominate finalists until" in summary["publish_blocked"] and summary["nominations_deadline"]
    refused = root.post("/admin/results/publish", {"confirm": "PUBLISH"})
    assert refused.status_code == 409 and "cannot be published yet" in refused.json()["detail"]
    assert root.get("/admin/finalists/summary").json()["published_at"] is None

    # A super admin can move the deadline on purpose, and then it works.
    dates = {**window(timedelta(days=-1), timedelta(days=5)), "nominations_deadline": iso(datetime.now(UTC) - timedelta(minutes=1))}
    assert root.put("/admin/schedule", dates).status_code == 200
    assert root.get("/admin/finalists/summary").json()["publish_blocked"] is None
    assert root.post("/admin/results/publish", {"confirm": "PUBLISH"}).status_code == 200


def test_publishing_is_allowed_when_there_is_no_deadline(root, student, team_of, real_window):
    two_nominated(root, student, team_of)
    dates = {**window(timedelta(days=-1), timedelta(days=5)), "nominations_deadline": None}
    root.put("/admin/schedule", dates)
    assert root.post("/admin/results/publish", {"confirm": "PUBLISH"}).status_code == 200


def test_publishing_with_nobody_nominated_is_refused(root, student, team_of, real_window):
    submitted_cse_team(student, team_of)  # submitted, but nobody nominated
    real_window.nominations_deadline = datetime.now(UTC) - timedelta(minutes=1)
    summary = root.get("/admin/finalists/summary").json()
    assert "No finalists have been nominated" in summary["publish_blocked"]
    refused = root.post("/admin/results/publish", {"confirm": "PUBLISH"})
    assert refused.status_code == 409 and "nothing to publish" in refused.json()["detail"]
    # And with no teams at all, the same: the mistake that happened on the live site (0 finalists, 0 not selected).
    assert root.get("/admin/finalists/summary").json()["published_at"] is None


def test_only_a_super_admin_can_publish_even_with_the_phrase(dept_admin, real_window):
    real_window.nominations_deadline = datetime.now(UTC) - timedelta(minutes=1)
    assert dept_admin.post("/admin/results/publish", {"confirm": "PUBLISH"}).status_code == 403


# ---------- Everyone but KIET departments: a later deadline ----------


def extended(opens: timedelta, closes: timedelta, extra: timedelta, **more) -> dict:
    return {**window(opens, closes), "registration_extended_closes": iso(datetime.now(UTC) + extra), **more}


def test_everyone_but_kiet_departments_registers_after_the_general_deadline(root, as_user, real_window):
    from test_startups_clubs import club_profile, startup_profile

    assert root.put("/admin/schedule", extended(timedelta(days=-9), timedelta(days=-1), timedelta(days=2))).status_code == 200
    # KIET departments are closed out, with a message that says who can still register.
    late = as_user("late@kiet.edu").put("/me/profile", kiet_profile())
    assert late.status_code == 403 and "can register until" in late.json()["detail"]
    # Other colleges, schools, startups and COE KIET are not.
    outsider = as_user("someone@gmail.com")
    assert outsider.put("/me/profile", college_profile()).status_code == 200
    mine = outsider.get("/me").json()["registration"]
    assert (mine["state"], mine["extended"]) == ("open", True)
    assert as_user("founder@gmail.com").put("/me/profile", startup_profile()).status_code == 200
    assert as_user("club@kiet.edu").put("/me/profile", club_profile()).status_code == 200
    # A KIET department student who has no profile yet may turn out to be a COE club member, so the later window shows.
    assert as_user("regular@kiet.edu").get("/me").json()["registration"]["extended"] is True
    assert root.get("/admin/schedule").json()["extended_closes"]


def test_the_later_deadline_ends_too(root, as_user, real_window):
    root.put("/admin/schedule", extended(timedelta(days=-9), timedelta(days=-3), timedelta(days=-1)))
    outsider = as_user("someone@gmail.com")
    assert outsider.put("/me/profile", college_profile()).status_code == 403
    assert outsider.get("/me").json()["registration"]["state"] == "closed"


def test_before_the_general_deadline_nothing_differs_for_kiet_departments(root, as_user, real_window):
    root.put("/admin/schedule", extended(timedelta(days=-1), timedelta(days=3), timedelta(days=9)))
    regular = as_user("regular@kiet.edu")
    mine = regular.get("/me").json()["registration"]
    assert (mine["state"], mine["extended"]) == ("open", False)
    assert regular.put("/me/profile", kiet_profile()).status_code == 200


def test_a_kiet_department_profile_cannot_turn_into_coe_to_beat_the_deadline(root, as_user, real_window):
    student = as_user("regular@kiet.edu")
    assert student.put("/me/profile", kiet_profile()).status_code == 200
    root.put("/admin/schedule", extended(timedelta(days=-9), timedelta(days=-1), timedelta(days=2)))
    assert student.put("/me/profile", kiet_profile(department="COE", club="Robotics Club")).status_code == 403


def test_the_extended_deadline_is_validated_kept_and_removable(root, real_window):
    base = window(timedelta(days=-1), timedelta(days=3))
    early = {**base, "registration_extended_closes": iso(datetime.now(UTC) + timedelta(days=1))}
    assert root.put("/admin/schedule", early).status_code == 422
    root.put("/admin/schedule", extended(timedelta(days=-1), timedelta(days=3), timedelta(days=6)))
    kept = root.put("/admin/schedule", base).json()
    assert kept["extended_closes"] is not None
    cleared = root.put("/admin/schedule", {**base, "registration_extended_closes": None}).json()
    assert cleared["extended_closes"] is None
    assert root.get("/admin/activity", params={"kind": "schedule"}).json()["items"]


def test_close_now_stops_everyone(root, as_user, real_window):
    root.put("/admin/schedule", extended(timedelta(days=-1), timedelta(days=3), timedelta(days=9)))
    assert root.post("/admin/schedule/close-now").status_code == 200
    assert as_user("someone@gmail.com").put("/me/profile", college_profile()).status_code == 403


def test_a_college_team_builds_and_submits_after_the_general_deadline(root, as_user, student, team_of, real_window):
    # A KIET team is built while registration is open, then the KIET departments' deadline passes.
    cse_lead, cse_mate = student("lead@kiet.edu"), student("mate@kiet.edu")
    cse = team_of(cse_lead, [cse_mate])
    root.put("/admin/schedule", extended(timedelta(days=-9), timedelta(days=-1), timedelta(days=2)))
    # The KIET team is locked out of changes; a college team is not.
    assert cse_lead.post(f"/teams/{cse['id']}/submit").status_code == 403
    assert cse_mate.get("/me").json()["registration"]["state"] == "closed"
    lead = as_user("c.lead@gmail.com")
    assert lead.put("/me/profile", college_profile()).status_code == 200
    entry = lead.post("/teams", team_input(name="College Crew"))
    assert entry.status_code == 201, entry.json()
    mate = as_user("c.mate@gmail.com")
    assert mate.put("/me/profile", college_profile()).status_code == 200
    assert lead.post(f"/teams/{entry.json()['id']}/invitations", {"email": "c.mate@gmail.com"}).status_code == 201
    invitation = mate.get("/me/invitations").json()[0]
    assert mate.post(f"/invitations/{invitation['id']}/accept").status_code == 204
    assert lead.post(f"/teams/{entry.json()['id']}/submit").status_code == 200
