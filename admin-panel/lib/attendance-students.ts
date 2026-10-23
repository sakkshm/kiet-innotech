/**
 * Attendance by student: the words used on every screen, and the PDF, Excel and CSV downloads.
 *
 * The rule: a student is present only when somebody has marked them present. Nobody marked yet counts as absent
 * ("Absent · not marked"), so those are the students still to mark. The files show the final answer, Present or Absent,
 * and a column says whether it was marked or is absent by default. Students are grouped by department (A to Z), then
 * year (1st to 4th), then in alphabetical order. There are no teams anywhere.
 */
import type { AttendanceState, RollCallRow } from "./admin-types";
import { asText, downloadBlob, toCsv } from "./csv";
import { downloadWorkbook, sheet, type ExcelSheet } from "./excel";
import { formatCsvDateTime, formatIst } from "./format";
import { slotLabel } from "./rooms";
import { yearLabel } from "./rules";

// ---------- The words ----------

export const stateLabels: Record<AttendanceState, string> = { present: "Present", absent: "Absent", not_marked: "Absent · not marked" };

/** What each state means, for tooltips and the legend. */
export const stateHelp: Record<AttendanceState, string> = {
  present: "Marked present by a judge or an admin.",
  absent: "Marked absent by a judge or an admin.",
  not_marked: "Nobody has marked this student yet, so they count as absent until marked present.",
};

/** Present is green, absent is red, and a student still to mark is amber so they stand out. */
export const stateTone = { present: "green", absent: "red", not_marked: "orange" } as const;

/** The final answer as counted. */
export const finalLabel = (state: AttendanceState) => (state === "present" ? "Present" : "Absent");

/** How that answer came about. */
export const recordedLabel = (state: AttendanceState) =>
  state === "present" ? "Marked present" : state === "absent" ? "Marked absent" : "Not marked yet (absent by default)";

const NO_SLOT = "No time set yet";
export const slotText = (row: Pick<RollCallRow, "slotStart" | "slotEnd">) => slotLabel(row.slotStart, row.slotEnd) || NO_SLOT;

// ---------- Order and groups ----------

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Department A to Z, then year, then name A to Z: the order of every file. */
export function sheetOrder(rows: RollCallRow[]) {
  return [...rows].sort(
    (a, b) => collator.compare(a.department ?? "", b.department ?? "") || a.year - b.year || collator.compare(a.fullName, b.fullName) || collator.compare(a.rollNumber, b.rollNumber),
  );
}

type Group = { department: string; year: number; rows: RollCallRow[] };

function groups(rows: RollCallRow[]): Group[] {
  const out: Group[] = [];
  for (const row of sheetOrder(rows)) {
    const department = row.department ?? "";
    const last = out[out.length - 1];
    if (last && last.department === department && last.year === row.year) last.rows.push(row);
    else out.push({ department, year: row.year, rows: [row] });
  }
  return out;
}

const counts = (rows: RollCallRow[]) => ({
  students: rows.length,
  present: rows.filter((r) => r.state === "present").length,
  absent: rows.filter((r) => r.state !== "present").length,
  notMarked: rows.filter((r) => r.state === "not_marked").length,
});

// ---------- File names ----------

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const today = () => new Date().toISOString().slice(0, 10);

/** What the filters were, in words: "All departments · 3rd year · all slots". */
export function scopeText(f: { department?: string; year?: number; slot?: string; state?: AttendanceState; q?: string }, slotName?: string) {
  return [
    f.department ?? "All departments",
    f.year ? yearLabel(f.year) : "All years",
    f.slot ? (slotName ?? "one slot") : "All slots",
    f.state && `Status: ${f.state === "not_marked" ? "not marked yet" : f.state}`,
    f.q && `Search: “${f.q}”`,
  ].filter(Boolean) as string[];
}

/** "attendance-cse-ai-3rd-year-all-slots" (the prefix and the date are added when saving). */
export const fileBase = (parts: string[]) => `attendance-${slug(parts.join(" "))}`;
const fileFor = (base: string, extension: string) => `innotech26-${base}-${today()}.${extension}`;

// ---------- CSV ----------

const header = ["Department", "Year", "Student", "Roll number", "Course", "Slot", "Status", "How recorded", "Marked by", "Marked at (IST)"];

const csvRow = (r: RollCallRow) => [
  r.department ?? "", yearLabel(r.year), r.fullName, asText(r.rollNumber), r.course, slotText(r), finalLabel(r.state), recordedLabel(r.state), r.markedBy ?? "", formatCsvDateTime(r.markedAt),
];

export const attendanceCsv = (rows: RollCallRow[]) => toCsv(header, sheetOrder(rows).map(csvRow));

export function downloadAttendanceCsv(rows: RollCallRow[], base: string) {
  downloadBlob(fileFor(base, "csv"), new Blob(["﻿", attendanceCsv(rows)], { type: "text/csv;charset=utf-8" }));
}

// ---------- Excel ----------

/** A Summary sheet (department and year with counts), then one sheet per department: years in order, names A to Z. */
export function attendanceWorkbook(rows: RollCallRow[]): ExcelSheet[] {
  const ordered = sheetOrder(rows);
  const summary = groups(ordered).map((g) => ({ ...g, ...counts(g.rows) }));
  type Row = RollCallRow;
  const columns = [
    { header: "Year", width: 10, value: (r: Row) => yearLabel(r.year) },
    { header: "Student", width: 28, value: (r: Row) => r.fullName },
    { header: "Roll number", width: 17, value: (r: Row) => r.rollNumber, text: true },
    { header: "Course", width: 12, value: (r: Row) => r.course },
    { header: "Slot", width: 32, value: (r: Row) => slotText(r) },
    { header: "Status", width: 10, value: (r: Row) => finalLabel(r.state) },
    { header: "How recorded", width: 34, value: (r: Row) => recordedLabel(r.state) },
    { header: "Marked by", width: 30, value: (r: Row) => r.markedBy ?? "" },
    { header: "Marked at (IST)", width: 20, value: (r: Row) => formatCsvDateTime(r.markedAt) },
  ];
  const departments = [...new Set(ordered.map((r) => r.department ?? ""))].sort(collator.compare);
  type Line = (typeof summary)[number];
  return [
    sheet(
      "Summary",
      [
        { header: "Department", width: 14, value: (g: Line) => g.department },
        { header: "Year", width: 10, value: (g: Line) => yearLabel(g.year) },
        { header: "Students", width: 10, value: (g: Line) => g.students },
        { header: "Present", width: 10, value: (g: Line) => g.present },
        { header: "Absent", width: 10, value: (g: Line) => g.absent },
        { header: "of which not marked yet", width: 22, value: (g: Line) => g.notMarked },
      ],
      summary,
    ),
    ...departments.map((department) => sheet(department || "No department", columns, ordered.filter((r) => (r.department ?? "") === department))),
  ];
}

export async function downloadAttendanceExcel(rows: RollCallRow[], base: string) {
  // downloadWorkbook adds the prefix, the date and the extension.
  await downloadWorkbook(base, attendanceWorkbook(rows));
}

// ---------- PDF ----------

type Rgb = [number, number, number];
const GREEN: Rgb = [4, 120, 87];
const RED: Rgb = [185, 28, 28];
const AMBER: Rgb = [180, 83, 9];
const GREY: Rgb = [90, 103, 132];

/**
 * One department per run of pages, its years one under the other (1st year first), students in alphabetical order. The PDF
 * library loads only when a PDF is made.
 */
export async function attendancePdf(rows: RollCallRow[], scope: string[]): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const printed = `Printed ${formatIst(new Date().toISOString())}`;
  const byDepartment = new Map<string, Group[]>();
  for (const g of groups(rows)) byDepartment.set(g.department, [...(byDepartment.get(g.department) ?? []), g]);

  [...byDepartment.entries()].forEach(([department, years], index) => {
    if (index > 0) doc.addPage();
    const all = years.flatMap((g) => g.rows);
    const c = counts(all);
    const drawHeader = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(41, 43, 56);
      doc.text("InnoTech26 · Department round attendance", 12, 13);
      doc.setFontSize(10.5);
      doc.text(`Department: ${department || "—"}`, 12, 20);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...GREY);
      doc.text(`${scope.join("  ·  ")}   ·   ${printed}`, 12, 25.5, { maxWidth: 270 });
      doc.text(`${c.students} students · ${c.present} present · ${c.absent} absent (${c.notMarked} of them not marked yet).  A student is present only when marked present.`, 12, 30, { maxWidth: 270 });
      doc.setTextColor(41, 43, 56);
    };
    const body: (string | { content: string; colSpan?: number; styles?: object })[][] = [];
    for (const g of years) {
      const gc = counts(g.rows);
      body.push([{ content: `${yearLabel(g.year)} · ${gc.students} students · ${gc.present} present · ${gc.absent} absent`, colSpan: 7, styles: { fillColor: [232, 234, 242], fontStyle: "bold" } }]);
      g.rows.forEach((r, i) => {
        body.push([
          String(i + 1),
          r.fullName,
          r.rollNumber || "—",
          r.course,
          slotText(r),
          { content: finalLabel(r.state), styles: { fontStyle: "bold", textColor: r.state === "present" ? GREEN : r.state === "absent" ? RED : AMBER } },
          r.state === "not_marked" ? "Not marked yet\n(absent by default)" : `${recordedLabel(r.state)}\n${r.markedBy ?? ""}${r.markedAt ? ` · ${formatCsvDateTime(r.markedAt)}` : ""}`,
        ]);
      });
    }
    autoTable(doc, {
      head: [["#", "Student", "Roll no.", "Course", "Slot", "Status", "How recorded"]],
      body,
      startY: 34,
      margin: { top: 34, left: 12, right: 12, bottom: 14 },
      theme: "grid",
      styles: { fontSize: 8.5, cellPadding: 1.6, valign: "middle", lineColor: [200, 201, 210], lineWidth: 0.2, textColor: [41, 43, 56] },
      headStyles: { fillColor: [41, 43, 56], textColor: 255, fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 62 }, 2: { cellWidth: 32 }, 3: { cellWidth: 22 }, 4: { cellWidth: 56 }, 5: { cellWidth: 24 } },
      didDrawPage: () => {
        drawHeader();
        doc.setFontSize(7.5);
        doc.setTextColor(...GREY);
        doc.text(`${department} · page ${doc.getNumberOfPages()}`, 12, doc.internal.pageSize.getHeight() - 7);
        doc.setTextColor(41, 43, 56);
      },
    });
  });
  return doc.output("blob");
}

export async function downloadAttendancePdf(rows: RollCallRow[], base: string, scope: string[]) {
  downloadBlob(fileFor(base, "pdf"), await attendancePdf(rows, scope));
}
