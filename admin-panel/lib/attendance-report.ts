/**
 * The department round's attendance report as a CSV or a PDF: one row per student with present, absent or not marked, for
 * whatever the filters matched. The PDF library loads only when a PDF is downloaded.
 */
import type { AttendanceReport, AttendanceReportRow, AttendanceState } from "./admin-types";
import { asText, csvFilename, downloadBlob, downloadCsv, toCsv } from "./csv";
import { formatCsvDateTime, formatIst } from "./format";
import { yearLabel } from "./rules";

/**
 * One vocabulary for every screen. Everybody counts as present until a judge or admin marks them absent, so "not marked"
 * is a way of being present: "Present (default)". "Present (marked)" is a student somebody ticked present.
 */
export const stateLabels: Record<AttendanceState, string> = { present: "Present (marked)", absent: "Absent", not_marked: "Present (default)" };

/** What each state means, in a sentence, for tooltips and legends. */
export const stateHelp: Record<AttendanceState, string> = {
  present: "A judge or admin marked this student present.",
  absent: "A judge or admin marked this student absent.",
  not_marked: "Nobody has marked this student yet, so they count as present until somebody marks them absent.",
};

/** The final answer as counted: present (marked or by default) or absent. What the downloaded sheets show first. */
export const finalLabel = (state: AttendanceState) => (state === "absent" ? "Absent" : "Present");

/** How that answer came about, for the column next to it. */
export const recordedLabel = (state: AttendanceState) => (state === "present" ? "Marked present" : state === "absent" ? "Marked absent" : "Not marked (counts as present)");

/** The pill tone for a state: green when marked present, outlined green when present by default, red when absent. */
export const stateTone = { present: "green", absent: "red", not_marked: "greenOutline" } as const;

const dayLabel = (day: string | null) => (day ? new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "");
const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const slot = (row: AttendanceReportRow) => (row.slotStart && row.slotEnd ? `${time.format(new Date(row.slotStart))} – ${time.format(new Date(row.slotEnd))}` : "");

/** What the filters were, in words, for the title of a download. */
export function filterSummary(filters: { department?: string; date?: string; state?: AttendanceState; room?: string; q?: string; teamZero?: boolean }) {
  return [
    filters.department && `Department: ${filters.department}`,
    filters.date && `Day: ${dayLabel(filters.date)}`,
    filters.state && `Status: ${stateLabels[filters.state]}`,
    filters.room && `Room: ${filters.room}`,
    filters.q && `Search: “${filters.q}”`,
    filters.teamZero && "Teams that score 0",
  ].filter(Boolean) as string[];
}

export function attendanceReportCsv(report: AttendanceReport) {
  const header = [
    "Department", "Day", "Room", "Slot (IST)", "Team code", "Team name", "Category", "Student", "Role", "Roll number", "Year", "Course",
    "Phone", "Status", "Marked by", "Marked at (IST)", "Team scores 0 (all absent)",
  ];
  const rows = report.items.map((r) => [
    r.department ?? "", r.day ?? "", r.room ?? "", slot(r), r.teamCode, r.teamName, r.category, r.fullName, r.role === "leader" ? "Leader" : "Member",
    asText(r.rollNumber), yearLabel(r.year), r.course, asText(r.phone), stateLabels[r.state], r.markedBy ?? "", formatCsvDateTime(r.markedAt),
    r.teamAllAbsent ? "Yes" : "No",
  ]);
  return toCsv(header, rows);
}

export function downloadAttendanceReportCsv(report: AttendanceReport) {
  downloadCsv(csvFilename("department-round-attendance"), attendanceReportCsv(report));
}

export async function downloadAttendanceReportPdf(report: AttendanceReport, filters: string[]) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("InnoTech26 · Department round attendance", 12, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const summary = `${report.total} students · ${report.present} marked present · ${report.notMarked} present by default (not marked) · ${report.absent} absent · ${report.teams} teams, ${report.teamsAllAbsent} scoring 0`;
  doc.text(summary, 12, 21, { maxWidth: 270 });
  doc.setTextColor(90, 103, 132);
  doc.text([filters.length ? filters.join("   ·   ") : "All students in scope", `Printed ${formatIst(new Date().toISOString())}`].join("   ·   "), 12, 26, { maxWidth: 270 });
  doc.setTextColor(41, 43, 56);
  const body = report.items.map((r) => [
    r.department ?? "",
    [dayLabel(r.day), slot(r)].filter(Boolean).join("\n"),
    r.room ?? "—",
    `${r.teamCode}\n${r.teamName}`,
    `${r.fullName}${r.role === "leader" ? " (leader)" : ""}`,
    r.rollNumber || "—",
    `${yearLabel(r.year)}, ${r.course}`,
    { content: stateLabels[r.state] + (r.teamAllAbsent ? "\n(team scores 0)" : ""), styles: { fontStyle: "bold" as const, textColor: r.state === "absent" ? ([185, 28, 28] as [number, number, number]) : r.state === "present" ? ([4, 120, 87] as [number, number, number]) : ([90, 103, 132] as [number, number, number]) } },
    r.markedBy ? `${r.markedBy}\n${formatCsvDateTime(r.markedAt)}` : "",
  ]);
  autoTable(doc, {
    head: [["Dept", "Day and slot", "Room", "Team", "Student", "Roll no.", "Year, course", "Status", "Marked by"]],
    body,
    startY: 31,
    margin: { left: 12, right: 12, bottom: 14 },
    theme: "grid",
    styles: { fontSize: 7.5, cellPadding: 1.6, valign: "middle", lineColor: [200, 201, 210], lineWidth: 0.2, textColor: [41, 43, 56] },
    headStyles: { fillColor: [41, 43, 56], textColor: 255, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 14 }, 1: { cellWidth: 32 }, 2: { cellWidth: 28 }, 7: { cellWidth: 24 }, 8: { cellWidth: 44 } },
    didDrawPage: () => {
      doc.setFontSize(7.5);
      doc.setTextColor(90, 103, 132);
      doc.text(`Department round attendance · page ${doc.getNumberOfPages()}`, 12, doc.internal.pageSize.getHeight() - 7);
      doc.setTextColor(41, 43, 56);
    },
  });
  downloadBlob(csvFilename("department-round-attendance").replace(/\.csv$/, ".pdf"), doc.output("blob"));
}
