"use client";

import { useState } from "react";
import { FileDown, FileSpreadsheet, FileText } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { JudgingRound } from "@/lib/admin-types";
import { Button } from "@/components/ui/Button";

/** Downloads an attendance sheet (a room, a department or every finale team) as PDF or Word to print, or Excel with who is present. */
export function AttendanceButtons({ round, panelId, department, label }: { round: JudgingRound; panelId?: string; department?: string; label: string }) {
  const [pending, setPending] = useState<"pdf" | "docx" | "xlsx" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(format: "pdf" | "docx" | "xlsx") {
    setPending(format);
    setError(null);
    try {
      const [sheet, attendance] = await Promise.all([api.attendance(round, { panelId, department }), import("@/lib/attendance")]);
      if (format === "pdf") await attendance.downloadAttendancePdf(sheet);
      else if (format === "docx") await attendance.downloadAttendanceDocx(sheet);
      else await attendance.downloadAttendanceExcel(sheet);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div role="group" aria-label={`Attendance sheet for ${label}`} className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" onClick={() => download("pdf")} pending={pending === "pdf"} disabled={pending !== null}>
          {pending !== "pdf" && <FileDown aria-hidden="true" className="size-3.5" />}
          Attendance PDF
        </Button>
        <Button size="sm" variant="secondary" onClick={() => download("docx")} pending={pending === "docx"} disabled={pending !== null}>
          {pending !== "docx" && <FileText aria-hidden="true" className="size-3.5" />}
          Word
        </Button>
        <Button size="sm" variant="secondary" onClick={() => download("xlsx")} pending={pending === "xlsx"} disabled={pending !== null}>
          {pending !== "xlsx" && <FileSpreadsheet aria-hidden="true" className="size-3.5" />}
          Excel
        </Button>
      </div>
      {error && <p role="alert" className="text-xs font-medium text-red-700">{error}</p>}
    </div>
  );
}
