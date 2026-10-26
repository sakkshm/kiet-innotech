/**
 * Attendance by student: the words used on every screen, and the PDF, Excel and CSV downloads.
 *
 * The rule: a student is present only when somebody has marked them present. Nobody marked yet counts as absent
 * ("Absent · not marked"), so those are the students still to mark. The files show the final answer, Present or Absent,
 * and a column says whether it was marked or is absent by default. Students are grouped by department (A to Z), then
 * year (1st to 4th), then in alphabetical order. There are no teams anywhere.
 *
 * A sheet by time slot has the departments of that slot only (every slot has its own mix of departments, and a department
 * can be in several slots); the sheet for all slots goes slot by slot, in time order, each with its own departments.
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

export const slotKeyOf = (row: RollCallRow) => `${row.slotStart ?? ""}|${row.slotEnd ?? ""}`;
const slotTime = (row: RollCallRow) => (row.slotStart ? new Date(row.slotStart).getTime() : Number.POSITIVE_INFINITY);

/** Department A to Z, then year, then name A to Z. With `bySlot`, slot (time order) comes first: the order of a slot sheet. */
export function sheetOrder(rows: RollCallRow[], bySlot = false) {
  return [...rows].sort(
    (a, b) =>
      (bySlot ? slotTime(a) - slotTime(b) : 0) ||
      collator.compare(a.department ?? "", b.department ?? "") ||
      a.year - b.year ||
      collator.compare(a.fullName, b.fullName) ||
      collator.compare(a.rollNumber, b.rollNumber),
  );
}

type Group = { slot: string; department: string; year: number; rows: RollCallRow[] };

/** Students in runs of the same slot (when `bySlot`), department and year, in file order. */
function groups(rows: RollCallRow[], bySlot = false): Group[] {
  const out: Group[] = [];
  for (const row of sheetOrder(rows, bySlot)) {
    const department = row.department ?? "";
    const slot = bySlot ? slotText(row) : "";
    const last = out[out.length - 1];
    if (last && last.slot === slot && last.department === department && last.year === row.year) last.rows.push(row);
    else out.push({ slot, department, year: row.year, rows: [row] });
  }
  return out;
}

const counts = (rows: RollCallRow[]) => ({
  students: rows.length,
  present: rows.filter((r) => r.state === "present").length,
  absent: rows.filter((r) => r.state !== "present").length,
  notMarked: rows.filter((r) => r.state === "not_marked").length,
});

export type Slot = ReturnType<typeof counts> & {
  key: string;
  /** "Fri, 23 Oct · 9:30 am – 12:30 pm". */
  label: string;
  rows: RollCallRow[];
  /** The departments that have students in this slot, A to Z: every slot has its own. */
  departments: string[];
};

/** The time slots among the rows, earliest first, each with its own departments and students. */
export function slotGroups(rows: RollCallRow[]): Slot[] {
  const byKey = new Map<string, RollCallRow[]>();
  for (const row of rows) byKey.set(slotKeyOf(row), [...(byKey.get(slotKeyOf(row)) ?? []), row]);
  return [...byKey.entries()]
    .map(([key, list]) => ({ time: slotTime(list[0]), slot: { key, label: slotText(list[0]), rows: sheetOrder(list), departments: [...new Set(list.map((r) => r.department ?? ""))].filter(Boolean).sort(collator.compare), ...counts(list) } }))
    .sort((a, b) => a.time - b.time)
    .map((entry) => entry.slot);
}

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

export const attendanceCsv = (rows: RollCallRow[], bySlot = false) => toCsv(header, sheetOrder(rows, bySlot).map(csvRow));

export function downloadAttendanceCsv(rows: RollCallRow[], base: string, bySlot = false) {
  downloadBlob(fileFor(base, "csv"), new Blob(["\uFEFF", attendanceCsv(rows, bySlot)], { type: "text/csv;charset=utf-8" }));
}

// ---------- Excel ----------

/** Excel allows 31 characters and no : / ? * [ ] in a sheet name: "Fri, 23 Oct · 9:30 am – 12:30 pm" becomes "Fri 23 Oct 9.30am-12.30pm". */
const sheetName = (label: string) =>
  label
    .replace(/[\\/?*[\]]/g, "")
    .replace(/\s*[·,]\s*/g, " ")
    .replace(/(\d+):(\d+)\s*(am|pm)/g, "$1.$2$3")
    .replace(/\s*–\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31);

/**
 * A Summary sheet (slot, department and year with counts), then the students: one sheet per department by default, or one
 * sheet per slot (that slot's departments one after the other) for the all-slots file. Years in order, names A to Z.
 */
export function attendanceWorkbook(rows: RollCallRow[], sheetsBy: "department" | "slot" = "department"): ExcelSheet[] {
  const ordered = sheetOrder(rows, sheetsBy === "slot");
  const summary = groups(ordered, true).map((g) => ({ ...g, ...counts(g.rows) }));
  type Row = RollCallRow;
  const columns = [
    ...(sheetsBy === "slot" ? [{ header: "Department", width: 14, value: (r: Row) => r.department ?? "" }] : [{ header: "Slot", width: 32, value: (r: Row) => slotText(r) }]),
    { header: "Year", width: 10, value: (r: Row) => yearLabel(r.year) },
    { header: "Student", width: 28, value: (r: Row) => r.fullName },
    { header: "Roll number", width: 17, value: (r: Row) => r.rollNumber, text: true },
    { header: "Course", width: 12, value: (r: Row) => r.course },
    { header: "Status", width: 10, value: (r: Row) => finalLabel(r.state) },
    { header: "How recorded", width: 34, value: (r: Row) => recordedLabel(r.state) },
    { header: "Marked by", width: 30, value: (r: Row) => r.markedBy ?? "" },
    { header: "Marked at (IST)", width: 20, value: (r: Row) => formatCsvDateTime(r.markedAt) },
  ];
  type Line = (typeof summary)[number];
  const summarySheet = sheet(
    "Summary",
    [
      { header: "Slot", width: 32, value: (g: Line) => g.slot },
      { header: "Department", width: 14, value: (g: Line) => g.department },
      { header: "Year", width: 10, value: (g: Line) => yearLabel(g.year) },
      { header: "Students", width: 10, value: (g: Line) => g.students },
      { header: "Present", width: 10, value: (g: Line) => g.present },
      { header: "Absent", width: 10, value: (g: Line) => g.absent },
      { header: "of which not marked yet", width: 22, value: (g: Line) => g.notMarked },
    ],
    summary,
  );
  if (sheetsBy === "slot") {
    return [summarySheet, ...slotGroups(ordered).map((slot) => sheet(sheetName(slot.label), columns, sheetOrder(slot.rows)))];
  }
  const departments = [...new Set(ordered.map((r) => r.department ?? ""))].sort(collator.compare);
  return [summarySheet, ...departments.map((department) => sheet(department || "No department", columns, ordered.filter((r) => (r.department ?? "") === department)))];
}

export async function downloadAttendanceExcel(rows: RollCallRow[], base: string, sheetsBy: "department" | "slot" = "department") {
  // downloadWorkbook adds the prefix, the date and the extension.
  await downloadWorkbook(base, attendanceWorkbook(rows, sheetsBy));
}

// ---------- PDF ----------

type Rgb = [number, number, number];
const GREEN: Rgb = [4, 120, 87];
const RED: Rgb = [185, 28, 28];
const AMBER: Rgb = [180, 83, 9];
const GREY: Rgb = [90, 103, 132];

/**
 * One department per run of pages, its years one under the other (1st year first), students in alphabetical order. With
 * `bySlot`, each slot's departments come under that slot, slot by slot in time order, and every page says which slot and
 * department it is. The PDF library loads only when a PDF is made.
 */
export async function attendancePdf(rows: RollCallRow[], scope: string[], bySlot = false): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const printed = `Printed ${formatIst(new Date().toISOString())}`;
  const runs = new Map<string, { slot: string; department: string; years: Group[] }>();
  for (const g of groups(rows, bySlot)) {
    const key = `${g.slot}|${g.department}`;
    const run = runs.get(key) ?? { slot: g.slot, department: g.department, years: [] };
    run.years.push(g);
    runs.set(key, run);
  }

  [...runs.values()].forEach((run, index) => {
    if (index > 0) doc.addPage();
    const c = counts(run.years.flatMap((g) => g.rows));
    const drawHeader = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(41, 43, 56);
      doc.text("InnoTech26 · Department round attendance", 12, 13);
      doc.setFontSize(10.5);
      doc.text(bySlot ? `${run.slot}   ·   Department: ${run.department || "—"}` : `Department: ${run.department || "—"}`, 12, 20);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...GREY);
      doc.text(`${scope.join("  ·  ")}   ·   ${printed}`, 12, 25.5, { maxWidth: 270 });
      doc.text(`${c.students} ${c.students === 1 ? "student" : "students"} · ${c.present} present · ${c.absent} absent (${c.notMarked} of them not marked yet).  A student is present only when marked present.`, 12, 30, { maxWidth: 270 });
      doc.setTextColor(41, 43, 56);
    };
    const body: (string | { content: string; colSpan?: number; styles?: object })[][] = [];
    for (const g of run.years) {
      const gc = counts(g.rows);
      body.push([{ content: `${yearLabel(g.year)} · ${gc.students} ${gc.students === 1 ? "student" : "students"} · ${gc.present} present · ${gc.absent} absent`, colSpan: 7, styles: { fillColor: [232, 234, 242], fontStyle: "bold" } }]);
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
        doc.text(`${bySlot ? `${run.slot} · ` : ""}${run.department} · page ${doc.getNumberOfPages()}`, 12, doc.internal.pageSize.getHeight() - 7);
        doc.setTextColor(41, 43, 56);
      },
    });
  });
  return doc.output("blob");
}

export async function downloadAttendancePdf(rows: RollCallRow[], base: string, scope: string[], bySlot = false) {
  downloadBlob(fileFor(base, "pdf"), await attendancePdf(rows, scope, bySlot));
}
