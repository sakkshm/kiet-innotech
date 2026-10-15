"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { api, MAX_SEARCH_LENGTH } from "@/lib/api";
import type { AdminTeam, TeamQuery } from "@/lib/admin-types";
import { useAdmin } from "@/lib/auth/AuthProvider";
import { categories, departmentLabel, departments } from "@/lib/content";
import { categoryTitle, dayHeading, formatTime, istDayKey, plural, typeShortLabels } from "@/lib/format";
import { teamHref } from "@/lib/routes";
import { yearLabel } from "@/lib/rules";
import type { ParticipantType } from "@/lib/types";
import { scopeName, scopedTypes } from "@/lib/scope";
import { useQuery } from "@/lib/use-query";
import { intParam, pageSizeParam, pickParam, useUrlParams } from "@/lib/use-url-params";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Select } from "@/components/ui/Field";
import { Loading, Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSizeSelect, Pagination } from "@/components/ui/Pagination";
import { Pill } from "@/components/ui/Pill";
import { SearchBox } from "@/components/ui/SearchBox";
import { YearChips } from "@/components/teams/YearChips";

/** Submitted teams, newest first, grouped by day: the full version of the Overview's old "Recent submissions". */
export function SubmissionsView() {
  const admin = useAdmin();
  const isSuper = admin.role === "super_admin";
  const scoped = scopedTypes(admin) ?? [];
  const types: ParticipantType[] = isSuper ? ["kiet", "college", "school", "startup"] : scoped.length > 1 ? scoped : [];
  const { params, update, reset } = useUrlParams();
  const [searchKey, setSearchKey] = useState(0);

  const query: TeamQuery = {
    status: "submitted",
    sort: "submitted_at",
    order: "desc",
    department: isSuper ? pickParam(params, "department", departments) : undefined,
    category: intParam(params, "category", 1, categories.length),
    type: types.length ? pickParam(params, "type", types) : undefined,
    leaderYear: intParam(params, "leader_year", 1, 12),
    q: params.get("q")?.trim().slice(0, MAX_SEARCH_LENGTH) || undefined,
    page: intParam(params, "page", 1, 10_000) ?? 1,
    pageSize: pageSizeParam(params),
  };
  const { data, error, loading } = useQuery(JSON.stringify(query), () => api.listTeams(query));
  const filtered = Boolean(query.department || query.category || query.type || query.leaderYear || query.q);

  const days: { key: string; heading: string; teams: AdminTeam[] }[] = [];
  for (const team of data?.items ?? []) {
    const at = team.submittedAt ?? team.createdAt;
    const key = istDayKey(at);
    const last = days[days.length - 1];
    if (last?.key === key) last.teams.push(team);
    else days.push({ key, heading: dayHeading(at), teams: [team] });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isSuper ? "All participants" : scopeName(admin)}
        title="Submissions"
        description="Every submitted team, newest first. Submitted teams are locked and take part in judging."
        actions={
          <Link href="/teams?status=submitted" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
            Open as a table <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        }
      />

      <form role="search" onSubmit={(e) => e.preventDefault()} className="space-y-3">
        <SearchBox key={searchKey} id="submission-search" label="Search submissions" placeholder="Team name, code, member name or email" value={query.q ?? ""} onSearch={(q) => update({ q })} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Category" htmlFor="sub-category">
            <Select id="sub-category" value={query.category ?? ""} onChange={(e) => update({ category: e.target.value })}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.number} value={c.number}>{c.number}. {c.title}</option>
              ))}
            </Select>
          </Field>
          <Field label="Leader's year" htmlFor="sub-year">
            <Select id="sub-year" value={query.leaderYear ?? ""} onChange={(e) => update({ leader_year: e.target.value })}>
              <option value="">Any year</option>
              {[1, 2, 3, 4].map((y) => (
                <option key={y} value={y}>{yearLabel(y)}</option>
              ))}
              {types.includes("school") &&
                [6, 7, 8, 9, 10, 11, 12].map((y) => (
                  <option key={y} value={y}>{yearLabel(y, "school")}</option>
                ))}
            </Select>
          </Field>
          {isSuper && (
            <Field label="Department" htmlFor="sub-department">
              <Select id="sub-department" value={query.department ?? ""} onChange={(e) => update({ department: e.target.value })}>
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>{departmentLabel(d)}</option>
                ))}
              </Select>
            </Field>
          )}
          {types.length > 0 && (
            <Field label="Participant type" htmlFor="sub-type">
              <Select id="sub-type" value={query.type ?? ""} onChange={(e) => update({ type: e.target.value })}>
                <option value="">All types</option>
                {types.map((t) => (
                  <option key={t} value={t}>{typeShortLabels[t]}</option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted" aria-live="polite">
          {data ? (
            <>
              <span className="font-semibold text-navy-900">{plural(data.total, "submitted team")}</span>
              {filtered ? " match these filters" : ""}
            </>
          ) : (
            "Loading…"
          )}
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
      {!data && !error && <Loading label="Loading submissions" />}
      {data && data.total === 0 && (
        <EmptyState title={filtered ? "No submitted teams match" : "No submitted teams yet"}>
          {filtered ? "Try removing a filter." : "Teams appear here as soon as their leader submits them."}
        </EmptyState>
      )}

      {data && data.items.length > 0 && (
        <div className={`space-y-6 transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          {days.map((day) => (
            <section key={day.key} aria-labelledby={`day-${day.key}`}>
              <h2 id={`day-${day.key}`} className="sticky top-14 z-10 -mx-1 mb-2 flex items-baseline gap-2 bg-surface/95 px-1 py-1.5 backdrop-blur lg:top-0">
                <span className="font-display text-sm font-bold text-navy-900">{day.heading}</span>
                <span className="text-xs text-muted">{plural(day.teams.length, "team")}</span>
              </h2>
              <ol className="divide-y divide-line overflow-hidden rounded-2xl bg-white ring-1 ring-line">
                {day.teams.map((team) => (
                  <SubmissionRow key={team.id} team={team} showType={types.length > 0} />
                ))}
              </ol>
            </section>
          ))}
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => { update({ page }); window.scrollTo({ top: 0 }); }} disabled={loading} />
        </div>
      )}
    </div>
  );
}

function SubmissionRow({ team, showType }: { team: AdminTeam; showType: boolean }) {
  const leader = team.members.find((m) => m.role === "leader");
  const years = [...team.members].sort((a, b) => Number(b.role === "leader") - Number(a.role === "leader") || a.year - b.year).map((m) => m.year);
  return (
    <li className="grid gap-x-4 gap-y-2 px-4 py-3.5 transition hover:bg-surface/60 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto] sm:items-center">
      <time dateTime={team.submittedAt ?? undefined} className="text-xs font-semibold tabular-nums text-muted">
        {team.submittedAt ? formatTime(team.submittedAt) : "—"}
      </time>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Link href={teamHref(team.id)} className="font-semibold text-navy-900 hover:text-brand-700 hover:underline">
            {team.name}
          </Link>
          <span className="font-mono text-xs text-muted">{team.code}</span>
        </div>
        <p className="mt-0.5 truncate text-sm text-muted" title={team.projectTitle}>
          {team.projectTitle}
        </p>
        <p className="mt-1 text-xs text-muted">
          Category {team.category} · {categoryTitle(team.category)} · {team.department ?? team.institution} · led by {leader?.fullName ?? "—"}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {showType && <Pill tone={team.participantType === "kiet" ? "navy" : "cyan"}>{typeShortLabels[team.participantType]}</Pill>}
        <YearChips years={years} type={team.participantType} />
      </div>
    </li>
  );
}
