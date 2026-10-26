"""Certificate templates, eligibility (including attendance) and downloads."""

import pymupdf
from test_admin import publish, world  # noqa: F401  (fixture)
from test_judging import judging, scored_room  # noqa: F401  (fixture)


def sample_pdf() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page(width=841.89, height=595.276)
    page.insert_text((50, 50), "Certificate")
    data = doc.tobytes()
    doc.close()
    return data


def upload(admin, cert_type: str = "dept_participation", fields: list | None = None):
    response = admin.client.put(
        f"/admin/certificates/{cert_type}/template",
        headers=admin.admin,
        files={"file": ("template.pdf", sample_pdf(), "application/pdf")},
        data={"name": cert_type.replace("_", " ").title()},
    )
    assert response.status_code == 200, response.text
    body = {
        "fields": fields
        or [
            {
                "id": "name",
                "label": "recipient_name",
                "x_pt": 200,
                "y_pt": 250,
                "w_pt": 440,
                "h_pt": 60,
                "font": "Montserrat",
                "fontsize": 28,
                "color": "#000000",
                "align": 1,
                "rotation": 0,
            }
        ]
    }
    assert admin.put(f"/admin/certificates/{cert_type}/fields", json=body).status_code == 200, response.text
    published = admin.put(f"/admin/certificates/{cert_type}/publish")
    assert published.status_code == 200, published.text
    return published.json()


def publish_results(context, settings):
    cse, it = context["cse"], context["it"]
    teams = context["teams"]
    cse_teams = [teams["cse_a"]["id"], teams["cse_b"]["id"]]
    assert cse.put("/admin/finalists/CSE", {"nominations": [{"category": 1, "team_ids": cse_teams}]}).status_code == 200
    assert it.put("/admin/finalists/IT", {"nominations": [{"category": 1, "team_ids": [teams["it_a"]["id"]]}]}).status_code == 200
    response = publish(context["root"], settings)
    assert response.status_code == 200, response.text


def mark_present(admin, email: str, api):
    me = api.get("/me/pass").json()
    response = admin.post(
        "/admin/attendance/mark",
        {"user_id": me["user_id"], "round": "department", "note": "Certificate test at the venue"},
    )
    assert response.status_code == 200, response.text


def test_only_present_students_get_a_certificate_after_results(world, as_user, settings):  # noqa: F811
    root = world["root"]
    a, b = as_user("a@kiet.edu"), as_user("b@kiet.edu")
    upload(root)

    # Results are not out yet.
    assert a.get("/me/certificates").json()["certificates"] == []
    publish_results(world, settings)

    # Nobody is marked yet: no certificates.
    assert a.get("/me/certificates").json()["certificates"] == []
    assert a.get("/me/certificates/dept_participation.pdf").status_code == 404

    # Only the team member who checked in gets one; their present teammate in the same team does not.
    mark_present(root, "a@kiet.edu", a)
    certificates = a.get("/me/certificates").json()["certificates"]
    assert certificates == [{"type": "dept_participation", "available": True, "reason": None}]
    download = a.get("/me/certificates/dept_participation.pdf")
    assert download.status_code == 200 and download.headers["content-type"] == "application/pdf"
    assert download.content.startswith(b"%PDF")
    with pymupdf.open(stream=download.content, filetype="pdf") as pdf:
        page = pdf[0]
        assert "Test Student" in page.get_text()
        placed = page.search_for("Test Student")[0]
        assert abs(placed.x0 + placed.width / 2 - 420) < 2  # centred in x_pt 200 + w_pt 440
        assert abs(placed.y0 - 250) < 2
    assert b.get("/me/certificates").json()["certificates"] == []
    assert b.get("/me/certificates/dept_participation.pdf").status_code == 404

    # An explicit absence is not presence, even though a row exists.
    b_id = b.get("/me/pass").json()["user_id"]
    team_id = world["teams"]["cse_a"]["id"]
    assert root.put(f"/admin/teams/{team_id}/attendance/{b_id}", json={"present": False}).status_code == 200
    assert b.get("/me/certificates").json()["certificates"] == []

    # Withdrawing the template takes the certificate away again.
    assert root.put("/admin/certificates/dept_participation/withdraw").status_code == 200
    assert a.get("/me/certificates/dept_participation.pdf").status_code == 404

    # Changing the field source changes the next download.
    upload(
        root,
        fields=[
            {
                "id": "department",
                "label": "department",
                "x_pt": 200,
                "y_pt": 250,
                "w_pt": 440,
                "h_pt": 60,
                "font": "Montserrat",
                "fontsize": 28,
            }
        ],
    )
    with pymupdf.open(stream=a.get("/me/certificates/dept_participation.pdf").content, filetype="pdf") as pdf:
        text = pdf[0].get_text()
        assert "CSE" in text
        assert "Test Student" not in text


def test_winners_need_awards_published_and_attendance(judging, as_user):  # noqa: F811
    root = judging["root"]
    a, c = as_user("a@kiet.edu"), as_user("c@kiet.edu")
    teams = scored_room(judging)
    mark_present(root, "a@kiet.edu", a)
    mark_present(root, "c@kiet.edu", c)
    upload(
        root,
        "dept_winner",
        fields=[
            {
                "id": "name",
                "label": "recipient_name",
                "x_pt": 200,
                "y_pt": 250,
                "w_pt": 440,
                "h_pt": 60,
                "font": "Montserrat",
                "fontsize": 28,
            },
            {"id": "category", "label": "category", "x_pt": 50, "y_pt": 50, "w_pt": 740, "h_pt": 30, "font": "Montserrat", "fontsize": 18},
            {"id": "place", "label": "place", "x_pt": 50, "y_pt": 90, "w_pt": 300, "h_pt": 30, "font": "Montserrat", "fontsize": 18},
        ],
    )

    # Winners are declared but not published yet.
    assert a.get("/me/certificates").json()["certificates"] == []
    assert root.post("/admin/judging/department/awards", {"team_id": teams["cse_a"]["id"], "place": 1}).status_code == 204
    assert a.get("/me/certificates").json()["certificates"] == []

    assert root.post("/admin/judging/department/awards/publish").status_code == 204
    assert a.get("/me/certificates").json()["certificates"] == [{"type": "dept_winner", "available": True, "reason": None}]
    assert c.get("/me/certificates").json()["certificates"] == []

    # A present member of the winning team but not the leader also gets one.
    b = as_user("b@kiet.edu")
    assert b.get("/me/certificates").json()["certificates"] == []
    mark_present(root, "b@kiet.edu", b)
    download = b.get("/me/certificates/dept_winner.pdf")
    assert download.status_code == 200
    with pymupdf.open(stream=download.content, filetype="pdf") as pdf:
        text = pdf[0].get_text()
        assert "Smart Solutions, Smarter Society" in text
        assert "1st" in text


def test_judges_get_one_certificate_once_published(world, as_user):  # noqa: F811
    root = world["root"]
    response = root.post(
        "/admin/jurors",
        {"email": "judge@kiet.edu", "name": "Judge One", "kind": "external", "organisation": "Acme", "phone": "9876543210"},
    )
    assert response.status_code == 201, response.text
    judge = as_user("judge@kiet.edu")
    assert judge.get("/judge/certificates").json()["certificates"] == [{"type": "dept_judge", "available": False, "reason": None}]
    upload(root, "dept_judge")
    assert judge.get("/judge/certificates").json()["certificates"] == [{"type": "dept_judge", "available": True, "reason": None}]
    download = judge.get("/judge/certificates/dept_judge.pdf")
    assert download.status_code == 200 and download.content.startswith(b"%PDF")
    with pymupdf.open(stream=download.content, filetype="pdf") as pdf:
        assert "Judge One" in pdf[0].get_text()
    assert judge.get("/judge/certificates/dept_participation.pdf").status_code == 404


def test_template_upload_validation_and_fonts(world):  # noqa: F811
    root = world["root"]
    bad = root.client.put(
        "/admin/certificates/dept_participation/template",
        headers=root.admin,
        files={"file": ("x.pdf", b"not a pdf", "application/pdf")},
    )
    assert bad.status_code == 400
    too_big = root.client.put(
        "/admin/certificates/dept_participation/template",
        headers=root.admin,
        files={"file": ("x.pdf", b"%PDF" + b"0" * (1024 * 1024), "application/pdf")},
    )
    assert too_big.status_code == 400

    assert root.put("/admin/certificates/dept_winner/publish").status_code == 404
    # The sample renders while the template is still a draft (it is how the designer checks placement).
    draft = root.client.put(
        "/admin/certificates/dept_participation/template",
        headers=root.admin,
        files={"file": ("template.pdf", sample_pdf(), "application/pdf")},
        data={"name": "Draft"},
    )
    assert draft.status_code == 200, draft.text
    sample = root.get("/admin/certificates/dept_participation/sample.pdf")
    assert sample.status_code == 200 and sample.content.startswith(b"%PDF")
    upload(root, "dept_winner")
    empty = {"fields": []}
    assert root.put("/admin/certificates/dept_winner/fields", json=empty).status_code == 200
    assert root.put("/admin/certificates/dept_winner/publish").status_code == 400

    font = root.client.post(
        "/admin/certificate-fonts",
        headers=root.admin,
        files={"file": ("Custom.ttf", b"\x00\x01\x00\x00", "font/ttf")},
        data={"name": "Custom"},
    )
    assert font.status_code == 201, font.text
    assert any(f["name"] == "Custom" for f in root.get("/admin/certificate-fonts").json())
    custom_field = {
        "id": "name",
        "label": "recipient_name",
        "x_pt": 1,
        "y_pt": 1,
        "w_pt": 100,
        "h_pt": 20,
        "font": "Custom",
    }
    root.put("/admin/certificates/dept_winner/fields", json={"fields": [custom_field]})
    in_use = root.delete(f"/admin/certificate-fonts/{font.json()['id']}")
    assert in_use.status_code == 409 and "used by a certificate" in in_use.json()["detail"]
    root.put("/admin/certificates/dept_winner/fields", json={"fields": []})
    assert root.delete(f"/admin/certificate-fonts/{font.json()['id']}").status_code == 204
    assert root.delete(f"/admin/certificate-fonts/{font.json()['id']}").status_code == 404
