import json
import uuid
from pathlib import Path

import pymupdf as fitz
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import rules
from ..errors import ApiError
from ..models import (
    AppState,
    Attendance,
    Award,
    CertificateFont,
    CertificateTemplate,
    Juror,
    Profile,
    Team,
    TeamMember,
    User,
)
from ..services import admin as admin_service

CERT_TYPES = [
    "dept_judge",
    "dept_participation",
    "dept_winner",
    "institute_judge",
    "institute_participation",
    "institute_winner",
]

MAX_SHRINK_PT = 6

FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
BUILTIN_FONTS = {
    "Montserrat": "Montserrat-Regular.ttf",
    "Montserrat SemiBold": "Montserrat-SemiBold.ttf",
    "Montserrat Bold": "Montserrat-Bold.ttf",
}


def _get_fonts(db: Session) -> dict[str, bytes]:
    fonts = {name: (FONT_DIR / filename).read_bytes() for name, filename in BUILTIN_FONTS.items()}
    for font in db.scalars(select(CertificateFont)):
        fonts[font.name] = font.data
    return fonts


def _published(db: Session, cert_type: str) -> bool:
    tmpl = db.scalar(select(CertificateTemplate).where(CertificateTemplate.type == cert_type))
    return bool(tmpl and tmpl.is_published)


def _is_present(db: Session, user_id: uuid.UUID, round_: str) -> bool:
    return (
        db.scalar(
            select(Attendance).where(
                Attendance.user_id == user_id,
                Attendance.round == round_,
                Attendance.status == "present",
            )
        )
        is not None
    )


def _results_published(db: Session) -> bool:
    return db.get(AppState, admin_service.RESULTS_KEY) is not None


def _awards_published(db: Session, round_: str) -> bool:
    return db.get(AppState, f"awards_published:{round_}") is not None


def get_student_certificates(db: Session, user: User) -> list:
    certs = []
    profile = db.get(Profile, user.id)
    if not profile:
        return certs

    member = db.scalar(select(TeamMember).where(TeamMember.user_id == user.id))
    team = None
    if member:
        team = db.get(Team, member.team_id)

    # dept participation
    if (
        team
        and team.route == "department"
        and team.status == "submitted"
        and _results_published(db)
        and _is_present(db, user.id, "department")
        and _published(db, "dept_participation")
    ):
        certs.append({"type": "dept_participation", "available": True})

    # dept winners
    if (
        team
        and team.route == "department"
        and _awards_published(db, "department")
        and _is_present(db, user.id, "department")
        and _published(db, "dept_winner")
    ):
        award = db.scalar(select(Award).where(Award.team_id == team.id, Award.round == "department", Award.place.in_([1, 2])))
        if award:
            certs.append({"type": "dept_winner", "available": True})

    return certs


def get_judge_certificates(db: Session, juror: Juror) -> list:
    tmpl = db.scalar(select(CertificateTemplate).where(CertificateTemplate.type == "dept_judge"))
    if tmpl and tmpl.is_published:
        return [{"type": "dept_judge", "available": True}]
    return [{"type": "dept_judge", "available": False}]


def _build_student_data(db: Session, user: User, team: Team, award: Award | None = None) -> dict:
    profile = db.get(Profile, user.id)
    data = {
        "recipient_name": profile.full_name if profile else user.name,
        "team_name": team.name if team else "",
        "team_code": team.code if team else "",
        "department": (team.department or profile.department or "") if team else (profile.department or ""),
        "category": rules.CATEGORIES[team.category].title if team and team.category in rules.CATEGORIES else "",
        "project_title": team.project_title if team else "",
        "organisation": "DEPARTMENT OF IT & CSE - CS",
    }
    if award:
        data["place"] = "1st" if award.place == 1 else "2nd"
        data["award_amount"] = str(award.amount)
    return data


def _build_judge_data(juror: Juror) -> dict:
    return {
        "recipient_name": juror.name,
        "organisation": "DEPARTMENT OF IT & CSE - CS",
    }


def _hex_to_rgb(hex_color: str):
    h = hex_color.lstrip("#")
    if len(h) != 6:
        return (0.0, 0.0, 0.0)
    return tuple(int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))


def render_certificate(db: Session, template_type: str, recipient_data: dict, *, require_published: bool = True) -> bytes:
    tmpl = db.scalar(select(CertificateTemplate).where(CertificateTemplate.type == template_type))
    if not tmpl:
        raise ApiError("Certificate template not found", 404)
    if require_published and not tmpl.is_published:
        raise ApiError("Certificate not available", 404)

    fonts = _get_fonts(db)
    fields = json.loads(tmpl.fields_json) if tmpl.fields_json else []

    doc = fitz.open(stream=tmpl.pdf_data, filetype="pdf")
    page = doc[0]

    for index, field in enumerate(fields):
        label = field.get("label") or field.get("source_key") or ""
        text = ""
        if label in recipient_data:
            text = str(recipient_data[label]) if recipient_data[label] is not None else ""
        elif field.get("default_text"):
            text = field.get("default_text", "")
        if not text:
            continue
        font_name = field.get("font", "Montserrat")
        font_data = fonts.get(font_name) or fonts.get("Montserrat")
        alias = f"certfont{index}"
        color = _hex_to_rgb(field.get("color", "#000000"))
        align = field.get("align", 1)
        rotation = field.get("rotation", 0)
        size = float(field.get("fontsize", 24))
        x = float(field["x_pt"])
        y = float(field["y_pt"])
        w = float(field["w_pt"])
        h = float(field["h_pt"])

        page.insert_font(fontname=alias, fontbuffer=font_data)

        if rotation in (90, 270):
            point = fitz.Point(x + w / 2, y + h)
            page.insert_text(
                point,
                text,
                fontname=alias,
                fontsize=size,
                color=color,
                rotate=rotation,
            )
            continue

        rect = fitz.Rect(x, y, x + w, y + h)
        fitted = size
        placed = False
        while fitted >= MAX_SHRINK_PT:
            remaining = page.insert_textbox(
                rect,
                text,
                fontname=alias,
                fontsize=fitted,
                color=color,
                align=align,
                rotate=rotation,
            )
            if remaining >= 0:
                placed = True
                break
            fitted -= 1
        if not placed:
            raise ApiError(f"The text {label!r} does not fit its box, even at {MAX_SHRINK_PT} pt.", 400)

    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def generate_preview_png(pdf_data: bytes, dpi: int = 150) -> tuple[bytes, float, float]:
    doc = fitz.open(stream=pdf_data, filetype="pdf")
    page = doc[0]
    width_pt, height_pt = page.rect.width, page.rect.height
    zoom = dpi / 72
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat)
    png_bytes = pix.tobytes("png")
    doc.close()
    return png_bytes, width_pt, height_pt


def student_certificate_data(db: Session, user: User, cert_type: str) -> dict:
    eligible = {c["type"] for c in get_student_certificates(db, user) if c["available"]}
    if cert_type not in eligible:
        raise ApiError("Certificate not available.", 404)
    profile = db.get(Profile, user.id)
    if not profile:
        raise ApiError("Certificate not available.", 404)
    member = db.scalar(select(TeamMember).where(TeamMember.user_id == user.id))
    if not member:
        raise ApiError("Certificate not available.", 404)
    team = db.get(Team, member.team_id)
    if not team:
        raise ApiError("Certificate not available.", 404)
    award = None
    if cert_type.endswith("_winner"):
        award = db.scalar(select(Award).where(Award.team_id == team.id, Award.round == "department", Award.place.in_([1, 2])))
    return _build_student_data(db, user, team, award)


def judge_certificate_data(db: Session, juror: Juror, cert_type: str) -> dict:
    if cert_type != "dept_judge" or not any(c["available"] for c in get_judge_certificates(db, juror)):
        raise ApiError("Certificate not available.", 404)
    return _build_judge_data(juror)
