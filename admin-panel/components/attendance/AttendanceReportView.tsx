"use client";

import Link from "next/link";
import { useState } from "react";
import { Crown, FileDown, FileSpreadsheet, X } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { AttendanceReportQuery, AttendanceReportRow, AttendanceState } from "@/lib/admin-types";
import { useAdmin } from "@/lib/auth/AuthProvider";
import { departmentLabel, nominatingDepartments } from "@/lib/content";
import { downloadAttendanceReportCsv, downloadAttendanceReportPdf, filterSummary, stateLabels } from "@/lib/attendance-report";
import { formatDateTime, plural } from "@/lib/format";
import { roomLabel } from "@/lib/rooms";
import { yearLabel } from "@/lib/rules";
import { teamHref } from "@/lib/routes";
import { useQuery } from "@/lib/use-query";
import { intParam, pageSizeParam, pickParam, useUrlParams } from "@/lib/use-url-params";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field, Input, Select } from "@/components/ui/Field";
import { Loading, Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSizeSelect, Pagination } from "@/components/ui/Pagination";
import { Pill } from "@/components/ui/Pill";
import { SearchBox } from "@/components/ui/SearchBox";
import { Switch } from "@/components/ui/Switch";
import { EmptyState } from "@/components/ui/EmptyState";
import { TableFrame, tdClass, Th } from "@/components/ui/Table";

const states: AttendanceState[] = ["present", "absent", "not_marked"];
const stateTone = { present: "green", absent: "red", not_marked: "slate" } as const;
const dayOnly = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const timeOnly = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/**
 * Who was present on the day: every student of the department round with present, absent or not marked (counted present).
 * Super admins see every department; a department's admin sees their own students. Admins can change a student's
 * attendance here at any time. Downloads as PDF or CSV, for whatever the filters match.
 */
export function AttendanceReportView() {
  const admin = useAdmin();
  const isSuper = admin.role === "super_admin";
  const { params, update, reset } = useUrlParams();
  const [searchKey, setSearchKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<"pdf" | "csv" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? (params.get("date") as string) : undefined;
  const query: AttendanceReportQuery = {
    department: isSuper ? pickParam(params, "department", nominatingDepartments) : undefined,
    date,
    state: pickParam(params, "state", states),
    panelId: params.get("room") ?? undefined,
    q: params.get("q")?.trim().slice(0, 100) || undefined,
    teamZero: params.get("zero") === "1" ? true : undefined,
    page: intParam(params, "page", 1, 10_000) ?? 1,
    pageSize: pageSizeParam(params),
  };
  const report = useQuery(JSON.stringify(query), () => api.attendanceReport(query));
  const rooms = useQuery("report-rooms", () => api.judging("department"));
  const roomChoices = (rooms.data?.panels ?? []).filter((p) => !query.department || p.department === query.department);
  const roomName = roomChoices.find((p) => p.id === query.panelId);
  const data = report.data;
  const filtered = Boolean(query.department || query.date || query.state || query.panelId || query.q || query.teamZero);

  async function change(row: AttendanceReportRow, present: boolean) {
    setBusy(row.userId);
    setError(null);
    try {
      await api.setStudentPresence(row.teamId, row.userId, present);
      report.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function download(format: "pdf" | "csv") {
    setDownloading(format);
    setError(null);
    try {
      const all = await api.attendanceReportAll({ ...query, page: undefined, pageSize: undefined });
      if (format === "csv") downloadAttendanceReportCsv(all);
      else {
        await downloadAttendanceReportPdf(
          all,
          filterSummary({
            department: query.department ?? (isSuper ? undefined : (admin.department ?? undefined)),
            date: query.date,
            state: query.state,
            room: roomName ? roomLabel(roomName) : undefined,
            q: query.q,
            teamZero: query.teamZero,
          }),
        );
      }
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
        title="Attendance report"
        description={`Every student of the department round${isSuper ? "" : ` in ${admin.department}`}: present, absent, or not marked. Judges mark attendance in the room; everyone counts as present until marked absent, and a team whose students are all absent scores 0. You can change a student here at any time.`}
        actions={
          <div className="flex w-max gap-2">
            <Button variant="secondary" onClick={() => download("pdf")} pending={downloading === "pdf"} disabled={downloading !== null || !data || data.total === 0}>
              {downloading !== "pdf" && <FileDown aria-hidden="true" className="size-4" />}
              PDF
            </Button>
            <Button variant="secondary" onClick={() => download("csv")} pending={downloading === "csv"} disabled={downloading !== null || !data || data.total === 0}>
              {downloading !== "csv" && <FileSpreadsheet aria-hidden="true" className="size-4" />}
              CSV
            </Button>
          </div>
        }
      />

      <form role="search" onSubmit={(e) => e.preventDefault()} className="space-y-3">
        <SearchBox key={searchKey} id="attendance-search" label="Search students" placeholder="Student name, roll number, team code or team name" value={query.q ?? ""} onSearch={(q) => update({ q })} />
        <div className={`grid grid-cols-2 gap-3 ${isSuper ? "md:grid-cols-5" : "md:grid-cols-4"}`}>
          {isSuper && (
            <Field label="Department" htmlFor="report-department">
              <Select id="report-department" value={query.department ?? ""} onChange={(e) => update({ department: e.target.value, room: null })}>
                <option value="">All departments</option>
                {nominatingDepartments.map((d) => (
                  <option key={d} value={d}>{departmentLabel(d)}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Day" htmlFor="report-date">
            <Input id="report-date" type="date" value={query.date ?? ""} onChange={(e) => update({ date: e.target.value })} />
          </Field>
          <Field label="Room" htmlFor="report-room">
            <Select id="report-room" value={query.panelId ?? ""} onChange={(e) => update({ room: e.target.value })}>
              <option value="">All rooms</option>
              {roomChoices.map((p) => (
                <option key={p.id} value={p.id}>
                  {roomLabel(p)}
                  {p.department && isSuper ? ` · ${p.department}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="report-state">
            <Select id="report-state" value={query.state ?? ""} onChange={(e) => update({ state: e.target.value })}>
              <option value="">Any</option>
              {states.map((s) => (
                <option key={s} value={s}>{stateLabels[s]}</option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-navy-800">
              <Checkbox label="Only teams that score 0" checked={query.teamZero === true} onChange={(on) => update({ zero: on ? "1" : null })} />
              Only teams that score 0
            </label>
          </div>
        </div>
      </form>

      {report.error && <Notice tone="error">{report.error}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {!data && !report.error && <Loading label="Loading the report" />}

      {data && (
        <>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="Totals for these filters">
            {[
              ["Students", data.total, "bg-surface/70 ring-line"],
              ["Present", data.present, "bg-emerald-50 ring-emerald-200"],
              ["Absent", data.absent, "bg-red-50 ring-red-200"],
              ["Not marked", data.notMarked, "bg-surface/70 ring-line"],
              ["Teams", data.teams, "bg-surface/70 ring-line"],
              ["Teams scoring 0", data.teamsAllAbsent, data.teamsAllAbsent > 0 ? "bg-red-50 ring-red-200" : "bg-surface/70 ring-line"],
            ].map(([label, value, tone]) => (
              <div key={label as string} className={`rounded-2xl px-3 py-2.5 ring-1 ring-inset ${tone}`}>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</dt>
                <dd className="font-display text-2xl font-bold tabular-nums text-navy-900">{value}</dd>
              </div>
            ))}
          </dl>

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

          {data.total === 0 ? (
            <EmptyState title="No students found">{filtered ? "Try removing a filter." : "No teams are in the department round yet."}</EmptyState>
          ) : (
            <div className="space-y-4">
              <TableFrame label="Attendance" minWidth="min-w-[960px]">
                <thead>
                  <tr>
                    <Th>Student</Th>
                    <Th>Team</Th>
                    <Th>Room and time</Th>
                    <Th>Status</Th>
                    <Th>Marked by</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.userId} className="hover:bg-surface/70">
                      <td className={tdClass}>
                        <span className="flex items-center gap-1.5 font-semibold text-navy-900">
                          {row.fullName}
                          {row.role === "leader" && <Crown aria-label="Team leader" className="size-3.5 text-accent-500" />}
                        </span>
                        <span className="block text-xs text-muted">
                          {row.rollNumber || "No roll number"} · {yearLabel(row.year)}, {row.course}
                        </span>
                      </td>
                      <td className={tdClass}>
                        <Link href={teamHref(row.teamId)} className="font-semibold text-navy-900 hover:text-brand-700 hover:underline">
                          {row.teamName}
                        </Link>
                        <span className="block text-xs text-muted">
                          {row.teamCode} · {row.department}
                        </span>
                        {row.teamAllAbsent && <Pill tone="red">All absent: team scores 0</Pill>}
                      </td>
                      <td className={tdClass}>
                        <span className="block">{row.room ?? <span className="text-muted">No room yet</span>}</span>
                        {row.day && (
                          <span className="block text-xs text-muted">
                            {dayOnly.format(new Date(`${row.day}T12:00:00+05:30`))}
                            {row.slotStart && row.slotEnd ? ` · ${timeOnly.format(new Date(row.slotStart))} – ${timeOnly.format(new Date(row.slotEnd))}` : ""}
                          </span>
                        )}
                      </td>
                      <td className={tdClass}>
                        <span className="flex items-center gap-2.5">
                          <Switch checked={row.state !== "absent"} onChange={(present) => change(row, present)} pending={busy === row.userId} label={`Present: ${row.fullName}`} />
                          <Pill tone={stateTone[row.state]}>{stateLabels[row.state]}</Pill>
                        </span>
                      </td>
                      <td className={tdClass}>
                        {row.markedBy ? (
                          <>
                            <span className="block break-all text-xs text-navy-800">{row.markedBy}</span>
                            <span className="block text-xs text-muted">{formatDateTime(row.markedAt)}</span>
                          </>
                        ) : (
                          <span className="text-xs text-muted">Not marked yet</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableFrame>
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => update({ page })} disabled={report.loading} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
