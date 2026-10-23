/**
 * Attendance sheets for the department round, one file per time slot (or every slot together) as PDF, Excel or CSV.
 * Inside a file students are grouped by department, departments in alphabetical order, and students in alphabetical order.
 * The status shown is the final answer: Present (marked or not yet marked, everybody counts as present until marked
 * absent) or Absent, with a column saying how it was recorded.
 */
import type { AttendanceReportRow } from "./admin-types";
import { asText, downloadBlob, toCsv } from "./csv";
import { downloadWorkbook, sheet, type ExcelSheet } from "./excel";
import { formatCsvDateTime, formatIst } from "./format";
import { finalLabel, recordedLabel } from "./attendance-report";
import { slotLabel } from "./rooms";
import { yearLabel } from "./rules";

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const NO_SLOT = "No time set yet";

export type Slot = {
  /** Stable id: the slot's start and end. */
  key: string;
  start: string | null;
  end: string | null;
  /** "Fri 23 Oct · 9:30 am – 12:30 pm". */
  label: string;
  rows: AttendanceReportRow[];
  departments: string[];
  students: number;
  present: number;
  absent: number;
};

const slotKey = (row: AttendanceReportRow) => `${row.slotStart ?? ""}|${row.slotEnd ?? ""}`;
const slotTime = (row: AttendanceReportRow) => (row.slotStart ? new Date(row.slotStart).getTime() : Number.POSITIVE_INFINITY);
export const slotName = (row: AttendanceReportRow) => slotLabel(row.slotStart, row.slotEnd) || NO_SLOT;

/** Slot, then department, then student: the order of every sheet. */
export function sheetOrder(rows: AttendanceReportRow[]) {
  return [...rows].sort(
    (a, b) =>
      slotTime(a) - slotTime(b) ||
      collator.compare(a.department ?? "", b.department ?? "") ||
      collator.compare(a.fullName, b.fullName) ||
      collator.compare(a.teamCode, b.teamCode),
  );
}

/** The distinct time slots among the rows, earliest first, each with its students and counts. */
export function groupSlots(rows: AttendanceReportRow[]): Slot[] {
  const slots = new Map<string, Slot>();
  for (const row of rows) {
    const key = slotKey(row);
    let slot = slots.get(key);
    if (!slot) {
      slot = { key, start: row.slotStart, end: row.slotEnd, label: slotName(row), rows: [], departments: [], students: 0, present: 0, absent: 0 };
      slots.set(key, slot);
    }
    slot.rows.push(row);
  }
  return [...slots.values()]
    .map((slot) => ({
      ...slot,
      rows: sheetOrder(slot.rows),
      departments: [...new Set(slot.rows.map((r) => r.department ?? ""))].filter(Boolean).sort(collator.compare),
      students: slot.rows.length,
      absent: slot.rows.filter((r) => r.state === "absent").length,
      present: slot.rows.filter((r) => r.state !== "absent").length,
    }))
    .sort((a, b) => (a.start ? new Date(a.start).getTime() : Infinity) - (b.start ? new Date(b.start).getTime() : Infinity));
}

/** The students of one department within a slot, in alphabetical order. */
type Section = { slot: string; department: string; rows: AttendanceReportRow[] };

function sections(rows: AttendanceReportRow[]): Section[] {
  const out: Section[] = [];
  for (const row of sheetOrder(rows)) {
    const slot = slotName(row);
    const department = row.department ?? "";
    const last = out[out.length - 1];
    if (last && last.slot === slot && last.department === department) last.rows.push(row);
    else out.push({ slot, department, rows: [row] });
  }
  return out;
}

const counts = (rows: AttendanceReportRow[]) => ({ students: rows.length, absent: rows.filter((r) => r.state === "absent").length, present: rows.filter((r) => r.state !== "absent").length });

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const today = () => new Date().toISOString().slice(0, 10);

/** The name of a file without prefix or date: "attendance-fri-23-oct-9-30-am-12-30-pm-all-departments". */
export function sheetBase(slotText: string, departmentText: string) {
  return `attendance-${slug(slotText)}-${slug(departmentText)}`;
}

/** innotech26-attendance-fri-23-oct-9-30-am-12-30-pm-all-departments-2026-10-23.pdf */
const fileFor = (base: string, extension: string) => `innotech26-${base}-${today()}.${extension}`;

// ---------- CSV ----------

const header = [
  "Slot", "Department", "Student", "Roll number", "Year", "Course", "Student's own department", "Team code", "Team name", "Role", "Room",
  "Status", "How recorded", "Marked by", "Marked at (IST)", "Team scores 0 (all absent)",
];

const csvRow = (r: AttendanceReportRow) => [
  slotName(r), r.department ?? "", r.fullName, asText(r.rollNumber), yearLabel(r.year), r.course, r.studentDepartment ?? "", asText(r.teamCode), r.teamName,
  r.role === "leader" ? "Leader" : "Member", r.room ?? "", finalLabel(r.state), recordedLabel(r.state), r.markedBy ?? "", formatCsvDateTime(r.markedAt),
  r.teamAllAbsent ? "Yes" : "No",
];

export function sheetCsv(rows: AttendanceReportRow[]) {
  return toCsv(header, sheetOrder(rows).map(csvRow));
}

// ---------- Excel ----------

/** A summary sheet (every slot and department with counts), then one sheet per department, students in alphabetical order. */
export function sheetWorkbook(rows: AttendanceReportRow[]): ExcelSheet[] {
  const ordered = sheetOrder(rows);
  const summary = sections(ordered).map((s) => ({ ...s, ...counts(s.rows) }));
  const columns = [
    { header: "Slot", width: 30, value: (r: AttendanceReportRow) => slotName(r) },
    { header: "Student", width: 28, value: (r: AttendanceReportRow) => r.fullName },
    { header: "Roll number", width: 17, value: (r: AttendanceReportRow) => r.rollNumber, text: true },
    { header: "Year", width: 12, value: (r: AttendanceReportRow) => yearLabel(r.year) },
    { header: "Course", width: 12, value: (r: AttendanceReportRow) => r.course },
    { header: "Student's own department", width: 14, value: (r: AttendanceReportRow) => r.studentDepartment ?? "" },
    { header: "Team code", width: 11, value: (r: AttendanceReportRow) => r.teamCode, text: true },
    { header: "Team name", width: 26, value: (r: AttendanceReportRow) => r.teamName },
    { header: "Role", width: 9, value: (r: AttendanceReportRow) => (r.role === "leader" ? "Leader" : "Member") },
    { header: "Room", width: 24, value: (r: AttendanceReportRow) => r.room ?? "" },
    { header: "Status", width: 10, value: (r: AttendanceReportRow) => finalLabel(r.state) },
    { header: "How recorded", width: 30, value: (r: AttendanceReportRow) => recordedLabel(r.state) },
    { header: "Marked by", width: 30, value: (r: AttendanceReportRow) => r.markedBy ?? "" },
    { header: "Marked at (IST)", width: 20, value: (r: AttendanceReportRow) => formatCsvDateTime(r.markedAt) },
    { header: "Team scores 0", width: 13, value: (r: AttendanceReportRow) => (r.teamAllAbsent ? "Yes" : "No") },
  ];
  const departments = [...new Set(ordered.map((r) => r.department ?? ""))].sort(collator.compare);
  return [
    sheet(
      "Summary",
      [
        { header: "Slot", width: 32, value: (s: (typeof summary)[number]) => s.slot },
        { header: "Department", width: 14, value: (s: (typeof summary)[number]) => s.department },
        { header: "Students", width: 10, value: (s: (typeof summary)[number]) => s.students },
        { header: "Present", width: 10, value: (s: (typeof summary)[number]) => s.present },
        { header: "Absent", width: 10, value: (s: (typeof summary)[number]) => s.absent },
      ],
      summary,
    ),
    ...departments.map((department) => sheet(department || "No department", columns, ordered.filter((r) => (r.department ?? "") === department))),
  ];
}

export async function downloadSheetExcel(rows: AttendanceReportRow[], base: string) {
  // downloadWorkbook adds the prefix, the date and the extension.
  await downloadWorkbook(base, sheetWorkbook(rows));
}

export function downloadSheetCsv(rows: AttendanceReportRow[], base: string) {
  downloadBlob(fileFor(base, "csv"), new Blob(["\ufeff", sheetCsv(rows)], { type: "text/csv;charset=utf-8" }));
}

// ---------- PDF ----------

type Rgb = [number, number, number];
const GREEN: Rgb = [4, 120, 87];
const RED: Rgb = [185, 28, 28];
const GREY: Rgb = [90, 103, 132];

/**
 * One department of one slot per page (longer ones continue on the next pages), each page headed with the slot and the
 * department, students in alphabetical order. The PDF library loads only when a PDF is made.
 */
export async function sheetPdf(rows: AttendanceReportRow[]): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const printed = `Printed ${formatIst(new Date().toISOString())}`;
  sections(rows).forEach((section, index) => {
    if (index > 0) doc.addPage();
    const c = counts(section.rows);
    const drawHeader = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(41, 43, 56);
      doc.text("InnoTech26 · Department round attendance", 12, 13);
      doc.setFontSize(10.5);
      doc.text(`${section.slot}   ·   Department: ${section.department || "—"}`, 12, 20);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...GREY);
      doc.text(`${c.students} students · ${c.present} present · ${c.absent} absent   ·   ${printed}`, 12, 25.5);
      doc.text("Present includes students nobody has marked yet: everyone counts as present until a judge or admin marks them absent.", 12, 30);
      doc.setTextColor(41, 43, 56);
    };
    autoTable(doc, {
      head: [["#", "Student", "Roll no.", "Year, course", "Team", "Room", "Status", "How recorded"]],
      body: section.rows.map((r, i) => [
        String(i + 1),
        `${r.fullName}${r.role === "leader" ? " (leader)" : ""}${r.studentDepartment && r.studentDepartment !== r.department ? `\nDept: ${r.studentDepartment}` : ""}`,
        r.rollNumber || "—",
        `${yearLabel(r.year)}, ${r.course}`,
        `${r.teamCode}\n${r.teamName}`,
        r.room ?? "—",
        {
          content: finalLabel(r.state) + (r.teamAllAbsent ? "\n(team scores 0)" : ""),
          styles: { fontStyle: "bold" as const, textColor: r.state === "absent" ? RED : GREEN },
        },
        r.state === "not_marked" ? "Not marked by a judge\n(counts as present)" : `${recordedLabel(r.state)}\n${r.markedBy ?? ""}${r.markedAt ? ` · ${formatCsvDateTime(r.markedAt)}` : ""}`,
      ]),
      startY: 34,
      margin: { top: 34, left: 12, right: 12, bottom: 14 },
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 1.6, valign: "middle", lineColor: [200, 201, 210], lineWidth: 0.2, textColor: [41, 43, 56] },
      headStyles: { fillColor: [41, 43, 56], textColor: 255, fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 9 }, 1: { cellWidth: 52 }, 2: { cellWidth: 28 }, 3: { cellWidth: 30 }, 4: { cellWidth: 52 }, 5: { cellWidth: 30 }, 6: { cellWidth: 24 } },
      didDrawPage: () => {
        drawHeader();
        doc.setFontSize(7.5);
        doc.setTextColor(...GREY);
        doc.text(`${section.department} · ${section.slot} · page ${doc.getNumberOfPages()}`, 12, doc.internal.pageSize.getHeight() - 7);
        doc.setTextColor(41, 43, 56);
      },
    });
  });
  return doc.output("blob");
}

export async function downloadSheetPdf(rows: AttendanceReportRow[], base: string) {
  downloadBlob(fileFor(base, "pdf"), await sheetPdf(rows));
}
