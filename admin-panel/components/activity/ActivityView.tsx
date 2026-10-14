"use client";

import { attendanceEnabled } from "@/lib/features";
import { useState } from "react";
import { X } from "lucide-react";
import { api, MAX_SEARCH_LENGTH } from "@/lib/api";
import type { ActivityKind, ActivityQuery, AuditEntry } from "@/lib/admin-types";
import { useAdmin } from "@/lib/auth/AuthProvider";
import { departmentLabel, departments } from "@/lib/content";
import { dayHeading, istDayKey, plural } from "@/lib/format";
import { scopeName } from "@/lib/scope";
import { useQuery } from "@/lib/use-query";
import { intParam, pageSizeParam, pickParam, useUrlParams } from "@/lib/use-url-params";
import { AuditList } from "@/components/audit/AuditList";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Select } from "@/components/ui/Field";
import { Loading, Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSizeSelect, Pagination } from "@/components/ui/Pagination";
import { SearchBox } from "@/components/ui/SearchBox";

const kinds: { value: ActivityKind; label: string }[] = [
  { value: "team", label: "Teams (created, submitted, withdrawn…)" },
  { value: "member", label: "Members joining and leaving" },
  { value: "student", label: "Students registered or banned by organisers" },
  { value: "invitation", label: "Invitations" },
  { value: "finalists", label: "Finalist nominations" },
  { value: "results", label: "Results" },
  { value: "judging", label: "Judging" },
  ...(attendanceEnabled ? [{ value: "attendance" as ActivityKind, label: "Attendance" }] : []),
  { value: "schedule", label: "Schedule" },
  { value: "admin", label: "Admins" },
];

/** The whole audit log: every change by students, organisers and judges, newest first. */
export function ActivityView() {
  const admin = useAdmin();
  const isSuper = admin.role === "super_admin";
  const { params, update, reset } = useUrlParams();
  const [searchKey, setSearchKey] = useState(0);

  const query: ActivityQuery = {
    kind: pickParam(params, "kind", kinds.map((k) => k.value)),
    department: isSuper ? pickParam(params, "department", departments) : undefined,
    q: params.get("q")?.trim().slice(0, MAX_SEARCH_LENGTH) || undefined,
    page: intParam(params, "page", 1, 10_000) ?? 1,
    pageSize: pageSizeParam(params),
  };
  const { data, error, loading } = useQuery(JSON.stringify(query), () => api.activity(query));
  const filtered = Boolean(query.kind || query.department || query.q);

  const days: { key: string; heading: string; entries: AuditEntry[] }[] = [];
  for (const entry of data?.items ?? []) {
    const key = istDayKey(entry.at);
    const last = days[days.length - 1];
    if (last?.key === key) last.entries.push(entry);
    else days.push({ key, heading: dayHeading(entry.at), entries: [entry] });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isSuper ? "Institute-wide" : scopeName(admin)}
        title="Activity"
        description="The audit log: every change by students, organisers and judges, with who made it and when (IST)."
      />

      <form role="search" onSubmit={(e) => e.preventDefault()} className="space-y-3">
        <SearchBox key={searchKey} id="activity-search" label="Search activity" placeholder="Email, team code or words in the detail" value={query.q ?? ""} onSearch={(q) => update({ q })} />
        <div className={`grid gap-3 ${isSuper ? "sm:grid-cols-2" : "sm:max-w-sm"}`}>
          <Field label="Type of change" htmlFor="activity-kind">
            <Select id="activity-kind" value={query.kind ?? ""} onChange={(e) => update({ kind: e.target.value })}>
              <option value="">Everything</option>
              {kinds.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </Select>
          </Field>
          {isSuper && (
            <Field label="Department" htmlFor="activity-department">
              <Select id="activity-department" value={query.department ?? ""} onChange={(e) => update({ department: e.target.value })}>
                <option value="">All departments and institute-wide</option>
                {departments.map((d) => (
                  <option key={d} value={d}>{departmentLabel(d)}</option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted" aria-live="polite">
          {data ? <span className="font-semibold text-navy-900">{plural(data.total, "entry", "entries")}</span> : "Loading…"}
          {data && filtered ? " match these filters" : ""}
        </p>
        <div className="flex items-center gap-2">
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

      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <Loading label="Loading activity" />}
      {data && data.total === 0 && <EmptyState title={filtered ? "Nothing matches" : "No activity yet"}>{filtered ? "Try removing a filter." : undefined}</EmptyState>}

      {data && data.items.length > 0 && (
        <div className={`space-y-6 transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          {days.map((day) => (
            <section key={day.key} aria-labelledby={`activity-${day.key}`}>
              <h2 id={`activity-${day.key}`} className="sticky top-14 z-10 -mx-1 mb-2 flex items-baseline gap-2 bg-surface/95 px-1 py-1.5 backdrop-blur lg:top-0">
                <span className="font-display text-sm font-bold text-navy-900">{day.heading}</span>
                <span className="text-xs text-muted">{plural(day.entries.length, "entry", "entries")}</span>
              </h2>
              <AuditList entries={day.entries} timeOnly boxed />
            </section>
          ))}
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => { update({ page }); window.scrollTo({ top: 0 }); }} disabled={loading} />
        </div>
      )}
    </div>
  );
}
