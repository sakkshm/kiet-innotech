"use client";

import { useState } from "react";
import { CheckCheck, Download, Eraser, FileSpreadsheet, FileText, FileDown, UserCheck, UserX, X } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { AttendanceState, RollCallQuery, RollCallRow } from "@/lib/admin-types";
import { useAdmin } from "@/lib/auth/AuthProvider";
import { departmentLabel, nominatingDepartments } from "@/lib/content";
import {
  downloadAttendanceCsv,
  downloadAttendanceExcel,
  downloadAttendancePdf,
  fileBase,
  scopeText,
  slotText,
} from "@/lib/attendance-students";
import { formatDateTime, plural } from "@/lib/format";
import { yearLabel } from "@/lib/rules";
import { useQuery } from "@/lib/use-query";
import { useSelection } from "@/lib/use-selection";
import { intParam, pageSizeParam, pickParam, useUrlParams } from "@/lib/use-url-params";
import { AttendanceSlotSheets } from "./AttendanceSlotSheets";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Select } from "@/components/ui/Field";
import { Loading, Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSizeSelect, Pagination } from "@/components/ui/Pagination";
import { Pill } from "@/components/ui/Pill";
import { SearchBox } from "@/components/ui/SearchBox";
import { SelectionBar } from "@/components/ui/SelectionBar";
import { AttendanceSlider } from "./AttendanceSlider";
import { TableFrame, tdClass, Th } from "@/components/ui/Table";

const states: AttendanceState[] = ["present", "absent", "not_marked"];
const keyOf = (row: RollCallRow) => row.userId;

type Format = "pdf" | "excel" | "csv";
const formats: { key: Format; label: string; Icon: typeof FileText }[] = [
  { key: "pdf", label: "PDF", Icon: FileText },
  { key: "excel", label: "Excel", Icon: FileSpreadsheet },
  { key: "csv", label: "CSV", Icon: FileDown },
];

/**
 * Attendance by student, for super admins and department admins: students by department and year, no teams. A student is
 * present only when somebody has marked them present; the rest count as absent, and the ones nobody has marked yet are
 * highlighted so they can be marked. Marks are only added or changed here, never deleted.
 */
export function AttendanceRollCall() {
  const admin = useAdmin();
  const isSuper = admin.role === "super_admin";
  const { params, update, reset } = useUrlParams();
  const [searchKey, setSearchKey] = useState(0);
  const selection = useSelection(keyOf);
  const [busy, setBusy] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<Format | null>(null);
  const [selectingAll, setSelectingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [marking, setMarking] = useState<AttendanceState | null>(null);

  const query: RollCallQuery = {
    department: isSuper ? pickParam(params, "department", nominatingDepartments) : undefined,
    year: intParam(params, "year", 1, 12),
    slot: params.get("slot")?.slice(0, 100) || undefined,
    state: pickParam(params, "state", states),
    q: params.get("q")?.trim().slice(0, 100) || undefined,
    page: intParam(params, "page", 1, 10_000) ?? 1,
    pageSize: pageSizeParam(params),
  };
  const { data, error: loadError, loading, reload } = useQuery(JSON.stringify(query), () => api.rollCall(query));
  const filtered = Boolean(query.department || query.year || query.slot || query.state || query.q);
  const everyYear = data ? Object.values(data.years).reduce((sum, n) => sum + n, 0) : 0;
  const slotName = data?.slots.find((s) => s.key === query.slot);
  const scope = scopeText(
    { department: isSuper ? query.department : (admin.department ?? undefined), year: query.year, slot: query.slot, state: query.state, q: query.q },
    slotName ? slotText({ slotStart: slotName.start, slotEnd: slotName.end }) : undefined,
  );

  const everything = () => api.rollCallAll({ ...query, page: undefined, pageSize: undefined });

  async function mark(ids: string[], state: AttendanceState, busyKey: string) {
    setBusy(busyKey);
    setError(null);
    setNotice(null);
    try {
      const result = await api.markStudents(ids, state);
      const word = state === "present" ? "marked present" : state === "absent" ? "marked absent" : "set back to unmarked";
      setNotice(
        `${plural(result.changed, "student")} ${word}.` +
          (result.unchanged ? ` ${plural(result.unchanged, "was", "were")} already like that.` : "") +
          (result.skipped.length ? ` ${plural(result.skipped.length, "student")} skipped: ${result.skipped.slice(0, 3).map((s) => `${s.fullName} (${s.reason})`).join(", ")}.` : ""),
      );
      selection.clear();
      reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function selectAllMatching() {
    setSelectingAll(true);
    setError(null);
    try {
      selection.replace((await everything()).items);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSelectingAll(false);
    }
  }

  async function download(format: Format) {
    setDownloading(format);
    setError(null);
    try {
      const rows = (await everything()).items;
      const base = fileBase(scope);
      if (format === "pdf") await downloadAttendancePdf(rows, base, scope);
      else if (format === "excel") await downloadAttendanceExcel(rows, base);
      else downloadAttendanceCsv(rows, base);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Event day"
        title="Student attendance"
        description={`Students of the department round${isSuper ? "" : ` in ${admin.department}`}, by department and year. A student is present only once somebody marks them present: everyone else counts as absent, and the ones nobody has marked yet are highlighted so you can mark them. Slide a student to Absent (left) or Present (right); the middle is Unmarked. Or tick several students and use the bar that appears.`}
      />

      {/* Year, separately */}
      {data && (
        <div role="tablist" aria-label="Year" className="flex flex-wrap gap-2">
          {[{ year: undefined as number | undefined, count: everyYear, label: "All years" }, ...Object.entries(data.years).map(([year, count]) => ({ year: Number(year), count, label: yearLabel(Number(year)) }))].map(
            (tab) => (
              <button
                key={tab.label}
                role="tab"
                type="button"
                aria-selected={query.year === tab.year}
                onClick={() => update({ year: tab.year ?? null })}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold ring-1 ring-inset transition ${
                  query.year === tab.year ? "bg-navy-900 text-white ring-navy-900" : "bg-white text-navy-800 ring-line hover:bg-surface"
                }`}
              >
                {tab.label} <span className={query.year === tab.year ? "text-white/70" : "text-muted"}>· {tab.count}</span>
              </button>
            ),
          )}
        </div>
      )}

      <form role="search" onSubmit={(e) => e.preventDefault()} className="space-y-3">
        <SearchBox key={searchKey} id="attendance-search" label="Search students" placeholder="Student name or roll number" value={query.q ?? ""} onSearch={(q) => update({ q })} />
        <div className={`grid grid-cols-2 gap-3 ${isSuper ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
          {isSuper && (
            <Field label="Department" htmlFor="roll-department">
              <Select id="roll-department" value={query.department ?? ""} onChange={(e) => update({ department: e.target.value, slot: null })}>
                <option value="">All departments</option>
                {nominatingDepartments.map((d) => (
                  <option key={d} value={d}>
                    {departmentLabel(d)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Time slot" htmlFor="roll-slot">
            <Select id="roll-slot" value={query.slot ?? ""} onChange={(e) => update({ slot: e.target.value })}>
              <option value="">All slots</option>
              {(data?.slots ?? []).map((s) => (
                <option key={s.key} value={s.key}>
                  {slotText({ slotStart: s.start, slotEnd: s.end })}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="roll-state">
            <Select id="roll-state" value={query.state ?? ""} onChange={(e) => update({ state: e.target.value })}>
              <option value="">Any status</option>
              <option value="present">Present</option>
              <option value="absent">Absent (marked)</option>
              <option value="not_marked">Not marked yet (absent)</option>
            </Select>
          </Field>
        </div>
      </form>

      {loadError && <Notice tone="error">{loadError}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {notice && (
        <Notice
          tone="success"
          action={
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="-mr-1 inline-flex size-7 items-center justify-center rounded-full text-navy-800/70 hover:bg-black/5">
              <X aria-hidden="true" className="size-4" />
            </button>
          }
        >
          {notice}
        </Notice>
      )}
      {!data && !loadError && <Loading label="Loading students" />}

      {data && (
        <>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Totals for these filters">
            <div className="rounded-2xl bg-surface/70 px-3 py-2.5 ring-1 ring-inset ring-line">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">Students</dt>
              <dd className="font-display text-2xl font-bold tabular-nums text-navy-900">{data.students}</dd>
            </div>
            <div className="rounded-2xl bg-emerald-50 px-3 py-2.5 ring-1 ring-inset ring-emerald-200">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">Present</dt>
              <dd className="font-display text-2xl font-bold tabular-nums text-navy-900">{data.present}</dd>
            </div>
            <div className="rounded-2xl bg-red-50 px-3 py-2.5 ring-1 ring-inset ring-red-200">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">Marked absent</dt>
              <dd className="font-display text-2xl font-bold tabular-nums text-navy-900">{data.absent}</dd>
            </div>
            <div className={`rounded-2xl px-3 py-2.5 ring-1 ring-inset ${data.notMarked > 0 ? "bg-accent-50 ring-accent-200" : "bg-surface/70 ring-line"}`}>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">Not marked yet</dt>
              <dd className="flex items-baseline justify-between gap-2">
                <span className="font-display text-2xl font-bold tabular-nums text-navy-900">{data.notMarked}</span>
                {data.notMarked > 0 && query.state !== "not_marked" && (
                  <button type="button" onClick={() => update({ state: "not_marked" })} className="text-xs font-semibold text-accent-600 underline-offset-2 hover:underline">
                    Show them
                  </button>
                )}
              </dd>
              <p className="text-[11px] text-muted">count as absent until marked present</p>
            </div>
          </dl>

          {/* The sheet for each time slot, with that slot's own departments */}
          <AttendanceSlotSheets department={isSuper ? query.department : undefined} />

          {/* Downloads: exactly what is listed below */}
          <section aria-labelledby="download-title" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3.5 ring-1 ring-line">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface text-navy-900">
                <Download aria-hidden="true" className="size-5" />
              </span>
              <div className="min-w-0">
                <h2 id="download-title" className="font-display text-base font-bold text-navy-900">
                  Or download exactly what is listed below ({plural(data.total, "student")})
                </h2>
                <p className="text-xs text-muted">
                  {scope.join(" · ")}. Department by department (A to Z), year by year, students in alphabetical order. Change the filters above for a different list.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {formats.map(({ key, label, Icon }) => (
                <Button
                  key={key}
                  size="sm"
                  variant="secondary"
                  onClick={() => download(key)}
                  pending={downloading === key}
                  disabled={downloading !== null || data.total === 0}
                >
                  {downloading !== key && <Icon aria-hidden="true" className="size-3.5" />}
                  {label}
                </Button>
              ))}
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-muted" aria-live="polite">
              <span className="font-semibold text-navy-900">{plural(data.total, "student")}</span>
              {filtered ? " match these filters" : " in the department round"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {filtered && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchKey((k) => k + 1);
                    reset();
                  }}
                >
                  <X aria-hidden="true" className="size-3.5" />
                  Clear filters
                </Button>
              )}
              <PageSizeSelect value={query.pageSize ?? 25} onChange={(size) => update({ size })} />
            </div>
          </div>

          <SelectionBar
            count={selection.size}
            noun={{ one: "student", many: "students" }}
            matching={data.total}
            selectingAll={selectingAll}
            onSelectAll={selectAllMatching}
            onClear={selection.clear}
            onExport={() => downloadAttendanceCsv(selection.rows, "attendance-selected-students")}
            actions={
              <>
                <Button size="sm" onClick={() => setMarking("present")} disabled={busy !== null}>
                  <UserCheck aria-hidden="true" className="size-3.5" />
                  Mark present
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setMarking("absent")} disabled={busy !== null}>
                  <UserX aria-hidden="true" className="size-3.5" />
                  Mark absent
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setMarking("not_marked")} disabled={busy !== null}>
                  <Eraser aria-hidden="true" className="size-3.5" />
                  Set unmarked
                </Button>
              </>
            }
          />
          {marking !== null && (
            <ConfirmDialog
              title={`${marking === "present" ? "Mark" : marking === "absent" ? "Mark" : "Set"} ${plural(selection.size, "selected student")} ${marking === "present" ? "present" : marking === "absent" ? "absent" : "back to unmarked"}?`}
              description={
                marking === "present"
                  ? "They will be marked present under your name. Students already present stay as they are, and you can change any of them later."
                  : marking === "absent"
                    ? "They will be marked absent under your name. Students already marked absent stay as they are, and you can change any of them later."
                    : "Their mark is taken back, so nobody has marked them: they count as absent until somebody marks them present. This is logged."
              }
              confirmLabel={marking === "present" ? "Mark present" : marking === "absent" ? "Mark absent" : "Set unmarked"}
              tone={marking === "present" ? "primary" : "danger"}
              onClose={() => setMarking(null)}
              onConfirm={async () => {
                const state = marking;
                setMarking(null);
                await mark(
                  selection.rows.map((r) => r.userId),
                  state,
                  "bulk",
                );
              }}
            />
          )}

          {data.total === 0 ? (
            <EmptyState title="No students found">{filtered ? "Try removing a filter." : "No students are in the department round yet."}</EmptyState>
          ) : (
            <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
              <div className="hidden md:block">
              <TableFrame label="Student attendance" minWidth="min-w-[900px]">
                <thead>
                  <tr>
                    <Th className="w-10">
                      <Checkbox
                        label="Select all students on this page"
                        checked={data.items.length > 0 && data.items.every(selection.has)}
                        indeterminate={data.items.some(selection.has)}
                        onChange={(on) => selection.setMany(data.items, on)}
                      />
                    </Th>
                    <Th>Student</Th>
                    <Th>Year</Th>
                    <Th>Course</Th>
                    {isSuper && <Th>Department</Th>}
                    <Th>Time slot</Th>
                    <Th>Attendance</Th>
                    <Th>Marked by</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.userId} className={selection.has(row) ? "bg-brand-50/70" : row.state === "not_marked" ? "bg-accent-50/40 hover:bg-accent-50/70" : "hover:bg-surface/70"}>
                      <td className={tdClass}>
                        <Checkbox label={`Select ${row.fullName}`} checked={selection.has(row)} onChange={() => selection.toggle(row)} />
                      </td>
                      <td className={tdClass}>
                        <span className="font-semibold text-navy-900">{row.fullName}</span>
                        <span className="block text-xs text-muted">{row.rollNumber || "No roll number"}</span>
                      </td>
                      <td className={`${tdClass} whitespace-nowrap`}>
                        <Pill tone="navy">{yearLabel(row.year)}</Pill>
                      </td>
                      <td className={`${tdClass} whitespace-nowrap`}>{row.course}</td>
                      {isSuper && <td className={`${tdClass} whitespace-nowrap font-medium`}>{row.department ?? "—"}</td>}
                      <td className={`${tdClass} text-xs text-navy-800`}>{slotText(row)}</td>
                      <td className={tdClass}>
                        <AttendanceSlider value={row.state} onChange={(state) => mark([row.userId], state, row.userId)} pending={busy === row.userId} name={row.fullName} className="min-w-[18rem] max-w-sm" />
                      </td>
                      <td className={tdClass}>
                        {row.markedBy ? (
                          <>
                            <span className="block break-all text-xs text-navy-800">{row.markedBy}</span>
                            <span className="block text-xs text-muted">{formatDateTime(row.markedAt)}</span>
                          </>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-accent-600">
                            <CheckCheck aria-hidden="true" className="size-3.5" />
                            Needs marking
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableFrame>
              </div>

              {/* Phones: one card per student, the slider across the whole width. */}
              <ul className="space-y-3 md:hidden" aria-label="Students">
                {data.items.map((row) => (
                  <li key={row.userId} className={`rounded-2xl p-3.5 ring-1 ${selection.has(row) ? "bg-brand-50/70 ring-brand-300" : row.state === "not_marked" ? "bg-accent-50/40 ring-accent-200" : "bg-white ring-line"}`}>
                    <div className="flex items-start gap-3">
                      <Checkbox label={`Select ${row.fullName}`} checked={selection.has(row)} onChange={() => selection.toggle(row)} />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-navy-900">{row.fullName}</p>
                        <p className="text-xs text-muted">{row.rollNumber || "No roll number"}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-navy-800">
                          <Pill tone="navy">{yearLabel(row.year)}</Pill>
                          <span>{row.course}</span>
                          {isSuper && row.department && <span className="font-semibold">{row.department}</span>}
                        </p>
                        <p className="mt-1 text-xs text-muted">{slotText(row)}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex justify-center">
                      <AttendanceSlider value={row.state} onChange={(state) => mark([row.userId], state, row.userId)} pending={busy === row.userId} name={row.fullName} />
                    </div>
                    {row.markedBy && (
                      <p className="mt-2 text-center text-[11px] text-muted">
                        Marked by {row.markedBy} · {formatDateTime(row.markedAt)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => update({ page })} disabled={loading} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
