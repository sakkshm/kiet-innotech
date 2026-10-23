"use client";

import { useMemo, useState } from "react";
import { Download, FileDown, FileSpreadsheet, FileText } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { AttendanceReportRow } from "@/lib/admin-types";
import { departmentLabel, nominatingDepartments } from "@/lib/content";
import { downloadSheetCsv, downloadSheetExcel, downloadSheetPdf, groupSlots, sheetBase } from "@/lib/attendance-sheets";
import { plural } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Select } from "@/components/ui/Field";
import { Loading, Notice } from "@/components/ui/Notice";

type Format = "pdf" | "excel" | "csv";

const formats: { key: Format; label: string; Icon: typeof FileDown; hint: string }[] = [
  { key: "pdf", label: "PDF", Icon: FileText, hint: "to print or share" },
  { key: "excel", label: "Excel", Icon: FileSpreadsheet, hint: "one sheet per department" },
  { key: "csv", label: "CSV", Icon: FileDown, hint: "plain table" },
];

/**
 * The place to download attendance: one card per time slot of the department round (and one for every slot together), each
 * with PDF, Excel and CSV buttons. Files list students department by department (A to Z), students in alphabetical order,
 * with the final answer, Present or Absent. A department's admin gets their own department; a super admin can pick one or all.
 */
export function AttendanceDownloads({ isSuper, department }: { isSuper: boolean; department: string | null }) {
  const [chosen, setChosen] = useState("");
  const scope = isSuper && chosen ? chosen : undefined;
  const data = useQuery(`attendance-sheets:${scope ?? "all"}`, () => api.attendanceReportAll({ department: scope }));
  const slots = useMemo(() => groupSlots(data.data?.items ?? []), [data.data]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const departmentText = isSuper ? (chosen ? departmentLabel(chosen) : "All departments") : (department ?? "My department");
  const all = data.data?.items ?? [];

  async function download(id: string, rows: AttendanceReportRow[], slotText: string, format: Format) {
    setBusy(`${id}:${format}`);
    setError(null);
    try {
      // Fresh numbers every time: attendance changes while the judges work.
      const fresh = (await api.attendanceReportAll({ department: scope })).items;
      const wanted = id === "all" ? fresh : fresh.filter((r) => rows.some((x) => x.userId === r.userId));
      const base = sheetBase(slotText, departmentText);
      if (format === "pdf") await downloadSheetPdf(wanted, base);
      else if (format === "excel") await downloadSheetExcel(wanted, base);
      else downloadSheetCsv(wanted, base);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  // The first card is everything: every slot together, which for a department's admin is their whole department.
  const everything = isSuper && !chosen ? `All ${plural(slots.length, "slot")} together` : `All of ${departmentText}, every slot`;
  const cards = [
    ...(slots.length > 0
      ? [{ id: "all", title: everything, rows: all, departments: [...new Set(slots.flatMap((s) => s.departments))], slotText: "all-slots" }]
      : []),
    ...slots.map((slot) => ({ id: slot.key, title: slot.label, rows: slot.rows, departments: slot.departments, slotText: slot.label })),
  ];

  return (
    <section aria-labelledby="downloads-title" className="overflow-hidden rounded-3xl bg-white ring-1 ring-line">
      <header className="flex flex-wrap items-center justify-between gap-3 bg-navy-950 px-5 py-4 text-white">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-500">
            <Download aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h2 id="downloads-title" className="font-display text-lg font-bold">
              Download attendance sheets
            </h2>
            <p className="text-sm text-white/70">
              {isSuper
                ? "Choose a time slot below, then PDF, Excel or CSV."
                : `Your department (${department ?? ""}): choose a time slot below, then PDF, Excel or CSV.`}
            </p>
          </div>
        </div>
        {isSuper && (
          <Field label="Departments in the files" htmlFor="sheet-department" className="w-full sm:w-64">
            <Select id="sheet-department" value={chosen} onChange={(e) => setChosen(e.target.value)}>
              <option value="">All departments</option>
              {nominatingDepartments.map((d) => (
                <option key={d} value={d}>
                  {departmentLabel(d)}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </header>

      <div className="space-y-4 p-5">
        <p className="text-sm text-navy-800">
          Every file is grouped <strong>department by department (A to Z)</strong>, with the <strong>students in alphabetical order</strong>. The status shown is
          the final answer, <strong>Present</strong> or <strong>Absent</strong>, and a column says whether a judge marked it or the student counts as present by
          default (nobody has marked them yet).
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        {data.error && <Notice tone="error">{data.error}</Notice>}
        {!data.data && !data.error && <Loading label="Loading the slots" />}
        {data.data && cards.length === 0 && <EmptyState title="Nothing to download yet">No team is in the department round yet. Slots appear here once teams are submitted.</EmptyState>}
        {cards.length > 0 && (
          <ul className="grid gap-3 lg:grid-cols-2">
            {cards.map((card) => {
              const absent = card.rows.filter((r) => r.state === "absent").length;
              return (
                <li key={card.id} className={`rounded-2xl p-4 ring-1 ${card.id === "all" ? "bg-accent-50 ring-accent-200 lg:col-span-2" : "bg-surface/60 ring-line"}`}>
                  <p className="font-display text-base font-bold text-navy-900">{card.title}</p>
                  <p className="mt-0.5 text-sm text-navy-800">
                    {plural(card.rows.length, "student")} · <span className="font-semibold text-emerald-700">{card.rows.length - absent} present</span> ·{" "}
                    <span className={`font-semibold ${absent ? "text-red-700" : "text-muted"}`}>{absent} absent</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted" title={card.departments.join(", ")}>
                    {card.departments.length === 0
                      ? ""
                      : card.departments.length <= 6
                        ? card.departments.join(", ")
                        : `${plural(card.departments.length, "department")}: ${card.departments.slice(0, 6).join(", ")} and ${card.departments.length - 6} more`}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {formats.map(({ key, label, Icon, hint }) => (
                      <Button
                        key={key}
                        size="sm"
                        variant={key === "pdf" ? "primary" : "secondary"}
                        title={`${label}: ${hint}`}
                        onClick={() => download(card.id, card.rows, card.slotText, key)}
                        pending={busy === `${card.id}:${key}`}
                        disabled={busy !== null || card.rows.length === 0}
                      >
                        {busy !== `${card.id}:${key}` && <Icon aria-hidden="true" className="size-3.5" />}
                        {label}
                        <span className="sr-only"> for {card.title}</span>
                      </Button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
