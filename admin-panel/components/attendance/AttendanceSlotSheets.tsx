"use client";

import { useMemo, useState } from "react";
import { Download, FileDown, FileSpreadsheet, FileText } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { downloadAttendanceCsv, downloadAttendanceExcel, downloadAttendancePdf, fileBase, slotGroups, slotKeyOf, type Slot } from "@/lib/attendance-students";
import { departmentLabel } from "@/lib/content";
import { plural } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Loading, Notice } from "@/components/ui/Notice";

type Format = "pdf" | "excel" | "csv";

const formats: { key: Format; label: string; Icon: typeof FileText }[] = [
  { key: "pdf", label: "PDF", Icon: FileText },
  { key: "excel", label: "Excel", Icon: FileSpreadsheet },
  { key: "csv", label: "CSV", Icon: FileDown },
];

/**
 * The attendance sheet of each time slot. Every slot has its own departments (a different number, a different mix), and a
 * sheet lists just those: departments A to Z, each with its students by year in alphabetical order. One more download
 * has every slot in time order. A department's admin gets only their own department in each slot.
 */
export function AttendanceSlotSheets({ department }: { department?: string }) {
  const data = useQuery(`slot-sheets:${department ?? "all"}`, () => api.rollCallAll({ department }));
  const slots = useMemo(() => slotGroups(data.data?.items ?? []), [data.data]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const everyone = slots.reduce((sum, s) => sum + s.students, 0);

  async function download(slot: Slot | null, format: Format) {
    setBusy(`${slot?.key ?? "all"}:${format}`);
    setError(null);
    try {
      // Fresh numbers every time: attendance changes while people mark.
      const fresh = (await api.rollCallAll({ department })).items;
      const rows = slot ? fresh.filter((r) => slotKeyOf(r) === slot.key) : fresh;
      const where = department ? departmentLabel(department) : "All departments";
      const base = fileBase([slot ? `slot ${slot.label}` : "all slots", where]);
      const scope = [slot ? `Slot: ${slot.label}` : "All slots", where];
      if (format === "pdf") await downloadAttendancePdf(rows, base, scope, true);
      else if (format === "excel") await downloadAttendanceExcel(rows, base, slot ? "department" : "slot");
      else downloadAttendanceCsv(rows, base, true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const cards: { slot: Slot | null; title: string; note: string; departments: string[]; counts: Slot }[] = [
    ...(slots.length > 0 ? [{ slot: null, title: `All ${plural(slots.length, "slot")}, one after the other`, note: "Slot by slot in time order, each with its own departments.", departments: [...new Set(slots.flatMap((s) => s.departments))].sort(), counts: { key: "all", label: "", rows: [], departments: [], students: everyone, present: slots.reduce((n, s) => n + s.present, 0), absent: slots.reduce((n, s) => n + s.absent, 0), notMarked: slots.reduce((n, s) => n + s.notMarked, 0) } }] : []),
    ...slots.map((slot) => ({ slot, title: slot.label, note: "", departments: slot.departments, counts: slot })),
  ];

  return (
    <section aria-labelledby="slot-sheets-title" className="overflow-hidden rounded-3xl bg-white ring-1 ring-line">
      <header className="flex items-start gap-3 bg-navy-950 px-5 py-4 text-white">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-500">
          <Download aria-hidden="true" className="size-5" />
        </span>
        <div>
          <h2 id="slot-sheets-title" className="font-display text-lg font-bold">
            Download the attendance sheet of a time slot
          </h2>
          <p className="text-sm text-white/70">
            Every slot has its own departments. Pick a slot, then PDF, Excel or CSV: you get that slot&apos;s departments A to Z, each with its students by year in alphabetical order.
          </p>
        </div>
      </header>
      <div className="space-y-4 p-5">
        {error && <Notice tone="error">{error}</Notice>}
        {data.error && <Notice tone="error">{data.error}</Notice>}
        {!data.data && !data.error && <Loading label="Loading the slots" />}
        {data.data && cards.length === 0 && <EmptyState title="Nothing to download yet">No team is in the department round yet. Slots appear here once teams are submitted.</EmptyState>}
        {cards.length > 0 && (
          <ul className="grid gap-3 lg:grid-cols-2">
            {cards.map(({ slot, title, note, departments, counts }) => (
              <li key={slot?.key ?? "all"} className={`rounded-2xl p-4 ring-1 ${slot ? "bg-surface/60 ring-line" : "bg-accent-50 ring-accent-200 lg:col-span-2"}`}>
                <p className="font-display text-base font-bold text-navy-900">{title}</p>
                {note && <p className="text-xs text-muted">{note}</p>}
                <p className="mt-1 text-sm text-navy-800">
                  {plural(departments.length, "department")} · {plural(counts.students, "student")} ·{" "}
                  <span className="font-semibold text-emerald-700">{counts.present} present</span> ·{" "}
                  <span className={`font-semibold ${counts.absent ? "text-red-700" : "text-muted"}`}>{counts.absent} absent</span>
                  {counts.notMarked > 0 && <span className="text-accent-600"> ({counts.notMarked} not marked yet)</span>}
                </p>
                <p className="mt-0.5 text-xs text-muted">{departments.join(", ")}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {formats.map(({ key, label, Icon }) => (
                    <Button
                      key={key}
                      size="sm"
                      variant={key === "pdf" ? "primary" : "secondary"}
                      onClick={() => download(slot, key)}
                      pending={busy === `${slot?.key ?? "all"}:${key}`}
                      disabled={busy !== null || counts.students === 0}
                    >
                      {busy !== `${slot?.key ?? "all"}:${key}` && <Icon aria-hidden="true" className="size-3.5" />}
                      {label}
                      <span className="sr-only"> for {title}</span>
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
