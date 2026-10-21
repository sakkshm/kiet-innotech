/**
 * Attendance sheets for a judging room, a department, a finale panel or every finale stall: one row per student,
 * grouped by team, with columns to tick presence and sign. PDF (jsPDF) or Word (.docx) to print and photocopy, or
 * Excel with who is already present. Students marked by event pass print as "Yes" with the time. The libraries load
 * only when a sheet is downloaded.
 */
import type { AttendanceSheet } from "./admin-types";
import { sheet as excelSheet, downloadWorkbook } from "./excel";
import { categoryTitle, formatCsvDateTime, formatIst, formatTime, roundLabels } from "./format";
import { slotLabel } from "./rooms";
import { yearLabel } from "./rules";

type Row = {
  team: AttendanceSheet["teams"][number];
  member: AttendanceSheet["teams"][number]["members"][number] | null;
  first: boolean;
  span: number;
  index: number;
};

function rows(sheet: AttendanceSheet): Row[] {
  return sheet.teams.flatMap((team, index): Row[] => {
    if (team.members.length === 0) return [{ team, member: null, first: true, span: 1, index }];
    return team.members.map((member, i) => ({ team, member, first: i === 0, span: team.members.length, index }));
  });
}

const showTent = (sheet: AttendanceSheet) => sheet.round === "final";

function heading(sheet: AttendanceSheet) {
  return {
    title: "InnoTech26 · Attendance sheet",
    subtitle: `${roundLabels[sheet.round]} · ${sheet.title}`,
    details: [
      sheet.slotStart && `Time: ${slotLabel(sheet.slotStart, sheet.slotEnd)}`,
      sheet.location && `Directions: ${sheet.location}`,
      sheet.jurors.length > 0 && `Judges: ${sheet.jurors.join(", ")}`,
      `${sheet.teams.length} teams · ${sheet.teams.reduce((sum, t) => sum + t.members.length, 0)} students`,
      `Printed ${formatIst(new Date().toISOString())}`,
    ].filter(Boolean) as string[],
  };
}

const memberCells = (row: Row) =>
  row.member
    ? [
        `${row.member.fullName}${row.member.role === "leader" ? " (leader)" : ""}`,
        `${yearLabel(row.member.year, row.member.course === "School" ? "school" : "college")}, ${row.member.course}`,
        row.member.department ?? row.member.institution,
        row.member.rollNumber || "—",
      ]
    : ["(no members)", "", "", ""];

const teamCell = (row: Row, sheet: AttendanceSheet) =>
  `${row.team.code}\n${row.team.name}\nCat ${row.team.category}: ${categoryTitle(row.team.category)}` +
  // A department-wide sheet says which room each team is in.
  `${!sheet.room && row.team.room ? `\n${row.team.room}` : ""}${row.team.status !== "submitted" ? `\n(${row.team.status})` : ""}`;

/** Already present (by pass, by hand or by a judge) prints as "Yes 10:42", marked absent as "Absent"; the rest stay blank to tick by hand. */
const presentCell = (row: Row) =>
  row.member?.state === "absent" ? "Absent" : row.member?.presentAt ? `Yes ${formatTime(row.member.presentAt)}` : "";

function filename(sheet: AttendanceSheet, extension: string) {
  const slug = sheet.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `innotech26-attendance-${sheet.round}-${slug || "sheet"}.${extension}`;
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadAttendancePdf(sheet: AttendanceSheet) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const { title, subtitle, details } = heading(sheet);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(title, 12, 14);
  doc.setFontSize(11);
  doc.text(subtitle, 12, 21);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(details.join("   ·   "), 12, 27, { maxWidth: 270 });

  const head = [["#", ...(showTent(sheet) ? ["Stall"] : []), "Team", "Student", "Year, course", "Department / institution", "Roll no.", "Present", "Signature"]];
  const body = rows(sheet).map((row) => {
    const teamCells = row.first
      ? [
          { content: String(row.index + 1), rowSpan: row.span },
          ...(showTent(sheet) ? [{ content: row.team.tent ?? "—", rowSpan: row.span }] : []),
          { content: teamCell(row, sheet), rowSpan: row.span },
        ]
      : [];
    return [...teamCells, ...memberCells(row), presentCell(row), ""];
  });
  autoTable(doc, {
    head,
    body,
    startY: 32,
    margin: { left: 12, right: 12, bottom: 16 },
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 1.8, valign: "middle", lineColor: [200, 201, 210], lineWidth: 0.2, textColor: [41, 43, 56] },
    headStyles: { fillColor: [41, 43, 56], textColor: 255, fontStyle: "bold" },
    columnStyles: showTent(sheet)
      ? { 0: { cellWidth: 8 }, 1: { cellWidth: 14 }, 2: { cellWidth: 52 }, 7: { cellWidth: 22 }, 8: { cellWidth: 36 } }
      : { 0: { cellWidth: 8 }, 1: { cellWidth: 56 }, 6: { cellWidth: 22 }, 7: { cellWidth: 38 } },
    bodyStyles: { minCellHeight: 9 },
    didDrawPage: () => {
      const page = doc.getNumberOfPages();
      doc.setFontSize(7.5);
      doc.setTextColor(90, 103, 132);
      doc.text(`${subtitle} · page ${page}`, 12, doc.internal.pageSize.getHeight() - 8);
      doc.text("Coordinator signature: ____________________", doc.internal.pageSize.getWidth() - 12, doc.internal.pageSize.getHeight() - 8, { align: "right" });
      doc.setTextColor(41, 43, 56);
    },
  });
  save(doc.output("blob"), filename(sheet, "pdf"));
}

export async function downloadAttendanceDocx(sheet: AttendanceSheet) {
  const docx = await import("docx");
  const { AlignmentType, BorderStyle, Document, Packer, PageOrientation, Paragraph, Table, TableCell, TableRow, TextRun, VerticalMergeType, WidthType, ShadingType } = docx;
  const { title, subtitle, details } = heading(sheet);
  const border = { style: BorderStyle.SINGLE, size: 4, color: "BEC6D4" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const text = (value: string, bold = false, color?: string) =>
    value.split("\n").map((line) => new Paragraph({ children: [new TextRun({ text: line, bold, size: 17, color })] }));
  const cell = (value: string, options: { bold?: boolean; merge?: (typeof VerticalMergeType)[keyof typeof VerticalMergeType]; width?: number; header?: boolean } = {}) =>
    new TableCell({
      children: text(value, options.bold || options.header, options.header ? "FFFFFF" : undefined),
      borders,
      verticalMerge: options.merge,
      width: options.width ? { size: options.width, type: WidthType.DXA } : undefined,
      shading: options.header ? { type: ShadingType.CLEAR, color: "auto", fill: "292B38" } : undefined,
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
    });

  const headers = ["#", ...(showTent(sheet) ? ["Stall"] : []), "Team", "Student", "Year, course", "Department / institution", "Roll no.", "Present", "Signature"];
  const widths = showTent(sheet) ? [400, 800, 2800, 2600, 1700, 2200, 1500, 900, 2300] : [400, 3000, 2800, 1800, 2400, 1600, 900, 2300];
  const tableRows = [
    new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, { header: true, width: widths[i] })) }),
    ...rows(sheet).map((row) => {
      const merge = row.span > 1 ? (row.first ? VerticalMergeType.RESTART : VerticalMergeType.CONTINUE) : undefined;
      const teamCells = [
        cell(row.first ? String(row.index + 1) : "", { merge }),
        ...(showTent(sheet) ? [cell(row.first ? (row.team.tent ?? "—") : "", { merge, bold: true })] : []),
        cell(row.first ? teamCell(row, sheet) : "", { merge }),
      ];
      return new TableRow({ cantSplit: true, children: [...teamCells, ...memberCells(row).map((value) => cell(value)), cell(presentCell(row)), cell("")] });
    }),
  ];

  const document = new Document({
    creator: "InnoTech26 admin panel",
    title: `${title} · ${subtitle}`,
    sections: [
      {
        properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
        children: [
          new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 30 })] }),
          new Paragraph({ children: [new TextRun({ text: subtitle, bold: true, size: 22 })] }),
          new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: details.join("   ·   "), size: 17, color: "5A6784" })] }),
          new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }),
          new Paragraph({ spacing: { before: 400 }, alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Coordinator signature: ______________________", size: 18 })] }),
        ],
      },
    ],
  });
  save(await Packer.toBlob(document), filename(sheet, "docx"));
}

/** One row per student with the attendance recorded so far. */
export async function downloadAttendanceExcel(sheet: AttendanceSheet) {
  type Line = { index: number; team: AttendanceSheet["teams"][number]; member: AttendanceSheet["teams"][number]["members"][number] };
  const lines: Line[] = sheet.teams.flatMap((team, index) => team.members.map((member) => ({ index: index + 1, team, member })));
  const slug = sheet.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  await downloadWorkbook(`attendance-${sheet.round}-${slug || "sheet"}`, [
    excelSheet<Line>(
      "Attendance",
      [
        { header: "#", width: 5, value: (l) => l.index },
        { header: "Team code", width: 12, value: (l) => l.team.code, text: true },
        { header: "Team", width: 26, value: (l) => l.team.name },
        { header: "Category", width: 10, value: (l) => l.team.category },
        { header: "Room", width: 22, value: (l) => l.team.room ?? "" },
        ...(sheet.round === "final" ? [{ header: "Stall", width: 8, value: (l: Line) => l.team.tent ?? "", text: true }] : []),
        { header: "Student", width: 26, value: (l) => l.member.fullName },
        { header: "Role", width: 8, value: (l) => (l.member.role === "leader" ? "Leader" : "Member") },
        { header: "Roll number", width: 16, value: (l) => l.member.rollNumber, text: true },
        { header: "Year", width: 10, value: (l) => yearLabel(l.member.year, l.member.course === "School" ? "school" : "college") },
        { header: "Course", width: 14, value: (l) => l.member.course },
        { header: "Department / institution", width: 26, value: (l) => l.member.department ?? l.member.institution },
        { header: "Phone", width: 13, value: (l) => l.member.phone, text: true },
        { header: "Present", width: 9, value: (l) => (l.member.state === "absent" ? "Absent" : l.member.presentAt ? "Yes" : "No") },
        { header: "Marked at (IST)", width: 18, value: (l) => formatCsvDateTime(l.member.presentAt) },
        { header: "Marked by", width: 26, value: (l) => l.member.markedBy ?? "" },
        { header: "How", width: 10, value: (l) => (l.member.method === "qr" ? "Event pass" : l.member.method === "manual" ? "By hand" : "") },
      ],
      lines,
    ),
  ]);
}
