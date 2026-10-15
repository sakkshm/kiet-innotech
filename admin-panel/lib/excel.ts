/**
 * Excel (.xlsx) downloads. The writer is loaded only when someone exports, so it never weighs on page loads.
 * Cells are typed: numbers stay numbers, everything else is text, so roll and phone numbers keep their digits
 * (no 2.3E+12, no lost leading zeros) and nothing a student typed can run as a formula.
 */
import { downloadBlob } from "./csv";

type CellValue = string | number | null | undefined;

export type ExcelColumn<T> = {
  header: string;
  /** Width in characters. */
  width: number;
  value: (row: T) => CellValue;
  /** Always text, even when it looks like a number (phone, roll number, team code). */
  text?: boolean;
};

export type ExcelSheet = { name: string; header: string[]; widths: number[]; rows: { value: CellValue; text: boolean }[][] };

export function sheet<T>(name: string, columns: ExcelColumn<T>[], rows: T[]): ExcelSheet {
  return {
    name,
    header: columns.map((c) => c.header),
    widths: columns.map((c) => c.width),
    rows: rows.map((row) => columns.map((c) => ({ value: c.value(row), text: Boolean(c.text) }))),
  };
}

const HEADER = { fontWeight: "bold", textColor: "#FFFFFF", backgroundColor: "#292B38", alignVertical: "center" } as const;

export async function downloadWorkbook(name: string, sheets: ExcelSheet[]) {
  const { default: writeExcelFile } = await import("write-excel-file/universal");
  const workbook = sheets.map((s) => ({
    // Excel limits sheet names to 31 characters.
    sheet: s.name.slice(0, 31),
    columns: s.widths.map((width) => ({ width })),
    stickyRowsCount: 1,
    data: [
      s.header.map((value) => ({ value, ...HEADER })),
      ...s.rows.map((row) =>
        row.map(({ value, text }) => {
          if (value === null || value === undefined || value === "") return null;
          return typeof value === "number" && !text ? { type: Number, value } : { type: String, value: String(value) };
        }),
      ),
    ],
  }));
  const blob = await writeExcelFile(workbook, { fontFamily: "Calibri", fontSize: 11 }).toBlob();
  downloadBlob(`innotech26-${name}-${new Date().toISOString().slice(0, 10)}.xlsx`, blob);
}
