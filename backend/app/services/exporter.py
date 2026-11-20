"""Render an approved MOM to DOCX or PDF bytes."""
import io
from xml.sax.saxutils import escape

from docx import Document
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.models import Meeting


def _meta_rows(m: Meeting) -> list[tuple[str, str]]:
    return [
        ("Date", m.meeting_date.isoformat() if m.meeting_date else "-"),
        ("Organiser", f"{m.organizer_name} <{m.organizer_email}>"),
        ("Participants", ", ".join(p.name for p in m.participants) or "-"),
        ("Approved by", m.approved_by or "-"),
    ]


def _action_rows(m: Meeting) -> list[list[str]]:
    return [
        [str(i), a.task, a.owner or "Unassigned", a.deadline.isoformat() if a.deadline else "TBD"]
        for i, a in enumerate(m.action_items, 1)
    ]


def build_docx(m: Meeting) -> bytes:
    doc = Document()
    doc.add_heading(f"Minutes of Meeting: {m.title}", level=0)

    meta = doc.add_table(rows=0, cols=2)
    meta.style = "Light Grid Accent 1"
    for k, v in _meta_rows(m):
        row = meta.add_row().cells
        row[0].text, row[1].text = k, v

    doc.add_heading("Summary", level=1)
    doc.add_paragraph(m.summary or "-")

    for heading, items in (("Key Discussion Points", m.discussion_points), ("Decisions", m.decisions)):
        doc.add_heading(heading, level=1)
        if items:
            for item in items:
                doc.add_paragraph(item, style="List Bullet")
        else:
            doc.add_paragraph("None recorded.")

    doc.add_heading("Action Items", level=1)
    if m.action_items:
        table = doc.add_table(rows=1, cols=4)
        table.style = "Light Grid Accent 1"
        for cell, text in zip(table.rows[0].cells, ("#", "Task", "Owner", "Deadline")):
            cell.text = text
        for r in _action_rows(m):
            for cell, text in zip(table.add_row().cells, r):
                cell.text = text
    else:
        doc.add_paragraph("None recorded.")

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def build_pdf(m: Meeting) -> bytes:
    styles = getSampleStyleSheet()
    body = styles["BodyText"]
    p = lambda text: Paragraph(escape(text), body)  # noqa: E731

    story = [Paragraph(escape(f"Minutes of Meeting: {m.title}"), styles["Title"])]

    meta = Table([[p(k), p(v)] for k, v in _meta_rows(m)], colWidths=[3.5 * cm, 13 * cm])
    meta.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("BACKGROUND", (0, 0), (0, -1), colors.whitesmoke),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story += [meta, Spacer(1, 12)]

    story += [Paragraph("Summary", styles["Heading2"]), p(m.summary or "-")]

    for heading, items in (("Key Discussion Points", m.discussion_points), ("Decisions", m.decisions)):
        story.append(Paragraph(heading, styles["Heading2"]))
        if items:
            story.append(ListFlowable([ListItem(p(i)) for i in items], bulletType="bullet"))
        else:
            story.append(p("None recorded."))

    story.append(Paragraph("Action Items", styles["Heading2"]))
    if m.action_items:
        data = [[p(h) for h in ("#", "Task", "Owner", "Deadline")]]
        data += [[p(c) for c in r] for r in _action_rows(m)]
        t = Table(data, colWidths=[1 * cm, 9 * cm, 3.5 * cm, 3 * cm], repeatRows=1)
        t.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("BACKGROUND", (0, 0), (-1, 0), colors.lightsteelblue),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        story.append(t)
    else:
        story.append(p("None recorded."))

    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=A4, title=m.title, leftMargin=2 * cm, rightMargin=2 * cm).build(story)
    return buf.getvalue()


def export_mom(m: Meeting, fmt: str) -> tuple[bytes, str, str]:
    """Returns (content, media_type, filename)."""
    # ASCII only: the filename ends up in an HTTP header (latin-1). Non-Latin
    # titles (e.g. Hindi) are sent via RFC 5987 filename* in the router.
    safe = "".join(c if (c.isascii() and c.isalnum()) or c in "-_" else "_" for c in m.title)[:60].strip("_") or "mom"
    if fmt == "docx":
        return (
            build_docx(m),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            f"MOM_{safe}.docx",
        )
    return build_pdf(m), "application/pdf", f"MOM_{safe}.pdf"
