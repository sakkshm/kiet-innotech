"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Crown, FileSpreadsheet, Medal, RefreshCw, Scale, Trophy, Users } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { Leaderboard, LeaderboardCategory, LeaderboardTeam } from "@/lib/admin-types";
import { useAdmin } from "@/lib/auth/AuthProvider";
import { categories, departmentLabel, nominatingDepartments } from "@/lib/content";
import { downloadWorkbook, sheet } from "@/lib/excel";
import { formatDateTime, plural } from "@/lib/format";
import { teamHref } from "@/lib/routes";
import { useQuery } from "@/lib/use-query";
import { intParam, pickParam, useUrlParams } from "@/lib/use-url-params";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Select } from "@/components/ui/Field";
import { Loading, Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { SearchBox } from "@/components/ui/SearchBox";

const rupees = (amount: number) => `₹${amount.toLocaleString("en-IN")}`;
const marks = (value: number | null) => (value === null ? "—" : Number.isInteger(value) ? String(value) : value.toFixed(2));
// Gold, silver and bronze for the first three places.
const podium = ["bg-amber-400 text-white ring-amber-300", "bg-slate-300 text-navy-900 ring-slate-200", "bg-orange-300 text-navy-900 ring-orange-200"];

/**
 * The department round's leaderboard: every department, every problem statement (PS), ranked by the average of both
 * judges, with the department's finalist places (the event document's quotas, as super admins set them) marked. Super
 * admins see every department; a department's admin sees their own. It refreshes by itself every minute.
 */
export function LeaderboardView() {
  const admin = useAdmin();
  const isSuper = admin.role === "super_admin";
  const { params, update } = useUrlParams();
  const department = isSuper ? pickParam(params, "department", nominatingDepartments) : undefined;
  const ps = intParam(params, "ps", 1, categories.length);
  const onlyFinalists = params.get("finalists") === "1";
  const q = params.get("q")?.trim().toLowerCase() ?? "";
  const board = useQuery(`leaderboard:${department ?? "all"}`, () => api.leaderboard(department));
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A live board: judges keep scoring, so it reloads every minute.
  const { reload } = board;
  useEffect(() => {
    const timer = setInterval(reload, 60_000);
    return () => clearInterval(timer);
  }, [reload]);

  const matches = (t: LeaderboardTeam) => !q || [t.team.name, t.team.code, t.team.leaderName, t.team.projectTitle].some((v) => v.toLowerCase().includes(q));
  const visible = (board.data?.departments ?? []).map((d) => ({
    ...d,
    categories: d.categories
      .filter((c) => !ps || c.category === ps)
      .map((c) => ({ ...c, teams: c.teams.filter((t) => matches(t) && (!onlyFinalists || t.inLine)) }))
      .filter((c) => c.teams.length > 0 || (!q && !onlyFinalists)),
  })).filter((d) => d.categories.length > 0);

  async function download(data: Leaderboard) {
    setDownloading(true);
    setError(null);
    try {
      type Row = { category: LeaderboardCategory; team: LeaderboardTeam };
      await downloadWorkbook(
        `leaderboard-${department ?? (isSuper ? "all-departments" : admin.department ?? "department")}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
        data.departments.map((d) =>
          sheet<Row>(
            d.department,
            [
              { header: "PS", width: 5, value: (r) => r.category.category },
              { header: "Problem statement", width: 34, value: (r) => r.category.title },
              { header: "Rank", width: 7, value: (r) => r.team.position ?? "" },
              { header: "Team", width: 26, value: (r) => r.team.team.name },
              { header: "Team code", width: 11, value: (r) => r.team.team.code, text: true },
              { header: "Leader", width: 22, value: (r) => r.team.team.leaderName },
              { header: "Average /50", width: 11, value: (r) => r.team.average ?? "" },
              { header: "Innovation", width: 11, value: (r) => r.team.innovation ?? "" },
              { header: "Query addressing", width: 11, value: (r) => r.team.query ?? "" },
              { header: "Judges scored", width: 10, value: (r) => `${r.team.scores} / ${r.team.judges}` },
              { header: "Finalist places", width: 10, value: (r) => r.category.quota },
              { header: "Standing", width: 30, value: (r) => standing(r.team, r.category).label },
              { header: "Nominated", width: 10, value: (r) => (r.team.nominated ? "Yes" : "") },
            ],
            d.categories.flatMap((category) => category.teams.map((team) => ({ category, team }))),
          ),
        ),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  const data = board.data;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Department round"
        title="Leaderboard"
        description={`Every problem statement${isSuper ? " of every department" : ` of ${admin.department}`}, ranked live from the judges' marks, with the finalist places for the Grand Finale.`}
        actions={
          <div className="flex w-max gap-2">
            <Button variant="secondary" onClick={() => board.reload()} disabled={board.loading}>
              <RefreshCw aria-hidden="true" className={`size-4 ${board.loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="secondary" onClick={() => data && download(data)} pending={downloading} disabled={!data || data.departments.length === 0}>
              {!downloading && <FileSpreadsheet aria-hidden="true" className="size-4" />}
              Excel
            </Button>
          </div>
        }
      />

      {/* The rules, from the event document */}
      <section aria-label="How the leaderboard works" className="grid gap-3 md:grid-cols-3">
        {[
          { Icon: Scale, title: "Ranked on the average", text: "A team's mark is the average of both judges' totals, out of 50. It gets a place once both have scored." },
          { Icon: Medal, title: "Ties", text: "Level teams are split by Innovation / Originality, then Query Addressing; if still level, the department admin or a super admin decides." },
          { Icon: Trophy, title: "Finalist places", text: "One finalist per PS per department; CSE, CS, CSE(AI) and CSE(AIML) have two in PS 1 to 4. Departments nominate their finalists." },
        ].map(({ Icon, title, text }) => (
          <div key={title} className="flex gap-3 rounded-2xl bg-white p-4 ring-1 ring-line">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-navy-950 text-white">
              <Icon aria-hidden="true" className="size-4.5" />
            </span>
            <div>
              <p className="text-sm font-bold text-navy-900">{title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{text}</p>
            </div>
          </div>
        ))}
      </section>

      <div className="space-y-3">
        <div role="tablist" aria-label="Problem statement" className="flex flex-wrap gap-2">
          {[{ n: undefined as number | undefined, label: "All PS" }, ...categories.map((c) => ({ n: c.number, label: `PS ${c.number}` }))].map((tab) => (
            <button
              key={tab.label}
              role="tab"
              type="button"
              aria-selected={ps === tab.n}
              title={tab.n ? categories[tab.n - 1].title : undefined}
              onClick={() => update({ ps: tab.n ?? null })}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ring-1 ring-inset transition ${
                ps === tab.n ? "bg-navy-900 text-white ring-navy-900" : "bg-white text-navy-800 ring-line hover:bg-surface"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className={`grid gap-3 ${isSuper ? "md:grid-cols-[minmax(0,1fr)_16rem_auto]" : "md:grid-cols-[minmax(0,1fr)_auto]"} md:items-end`}>
          <SearchBox id="leaderboard-search" label="Find a team" placeholder="Team name, code, leader or project" value={params.get("q") ?? ""} onSearch={(value) => update({ q: value })} />
          {isSuper && (
            <Field label="Department" htmlFor="leaderboard-department">
              <Select id="leaderboard-department" value={department ?? ""} onChange={(e) => update({ department: e.target.value })}>
                <option value="">All departments</option>
                {nominatingDepartments.map((d) => (
                  <option key={d} value={d}>
                    {departmentLabel(d)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <label className="flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-navy-800 ring-1 ring-line">
            <input type="checkbox" className="size-4 accent-accent-500" checked={onlyFinalists} onChange={(e) => update({ finalists: e.target.checked ? "1" : null })} />
            Only finalist places
          </label>
        </div>
      </div>

      {(board.error || error) && <Notice tone="error">{board.error ?? error}</Notice>}
      {!data && !board.error && <Loading label="Loading the leaderboard" />}
      {data && (
        <p className="text-xs text-muted" aria-live="polite">
          Updated {formatDateTime(data.generatedAt)} · refreshes every minute
          {data.resultsPublished ? " · finalists are published" : data.nominationsDeadline ? ` · nominations due ${formatDateTime(data.nominationsDeadline)}` : ""}
        </p>
      )}
      {data && visible.length === 0 && (
        <EmptyState title={data.departments.length === 0 ? "No teams on the leaderboard yet" : "Nothing matches"}>
          {data.departments.length === 0 ? "Teams appear here once they are allotted to a room; they get a place once both judges have scored them." : "Try another problem statement or clear the search."}
        </EmptyState>
      )}

      {visible.map((d) => (
        <section key={d.department} aria-labelledby={`dept-${d.department}`} className="overflow-hidden rounded-3xl bg-white ring-1 ring-line">
          <header className="flex flex-wrap items-center justify-between gap-3 bg-navy-950 px-5 py-4 text-white">
            <h2 id={`dept-${d.department}`} className="font-display text-xl font-bold">
              {departmentLabel(d.department)}
            </h2>
            <dl className="flex flex-wrap gap-2 text-xs">
              {[
                ["Teams", d.teams],
                ["Ranked", d.scored],
                ["Finalist places", d.finalistPlaces],
                ["Nominated", d.nominated],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-full bg-white/10 px-3 py-1">
                  <dt className="inline text-white/60">{label} </dt>
                  <dd className="inline font-bold">{value}</dd>
                </div>
              ))}
            </dl>
          </header>
          <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-2">
            {d.categories.map((c) => (
              <CategoryCard key={c.category} category={c} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Where a team stands, in a word, for the pill and the download. */
function standing(team: LeaderboardTeam, category: LeaderboardCategory): { label: string; tone: "green" | "navy" | "orange" | "slate" | "red" } {
  if (team.allAbsent) return { label: "All absent · scores 0", tone: "red" };
  if (!team.complete) return { label: `Waiting · ${team.scores} of ${team.judges} judges`, tone: "slate" };
  if (team.tied && team.position === category.quota + 1) return { label: "Tie at the cut-off", tone: "orange" };
  if (team.inLine) return { label: team.nominated ? "Finalist place · nominated" : "Finalist place", tone: "green" };
  if (team.nominated) return { label: "Nominated", tone: "navy" };
  return { label: "Below the cut-off", tone: "slate" };
}

function CategoryCard({ category }: { category: LeaderboardCategory }) {
  const cut = category.teams.findIndex((t) => !t.inLine);
  const hasCut = cut > 0 && category.teams.slice(0, cut).every((t) => t.inLine);
  return (
    <article aria-label={`PS ${category.category}`} className="flex flex-col overflow-hidden rounded-2xl ring-1 ring-line">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line bg-surface/70 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-accent-600">PS {category.category}</p>
          <h3 className="font-display text-base font-bold text-navy-900">{category.title}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone="green">{plural(category.quota, "finalist place")}</Pill>
          {category.prize !== null && <Pill tone="orange">1st prize {rupees(category.prize)}</Pill>}
          <Pill tone="slate">
            <Users aria-hidden="true" className="mr-1 size-3" />
            {category.scored} / {category.teams.length} ranked
          </Pill>
        </div>
      </header>
      {category.teams.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">No team in this problem statement yet.</p>
      ) : (
        <ol className="divide-y divide-line">
          {category.teams.map((t, index) => {
            const s = standing(t, category);
            return (
              <li key={t.team.id}>
                {hasCut && index === cut && (
                  <div className="flex items-center gap-2 bg-white px-4 py-1.5" role="separator" aria-label="Finalist cut-off">
                    <span className="h-px flex-1 border-t-2 border-dashed border-accent-300" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent-600">Finalist cut-off</span>
                    <span className="h-px flex-1 border-t-2 border-dashed border-accent-300" />
                  </div>
                )}
                <div className={`flex items-center gap-3 px-4 py-3 ${t.inLine ? "bg-emerald-50/50" : ""}`}>
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold ring-2 ${
                      t.position && t.position <= 3 ? podium[t.position - 1] : "bg-white text-navy-900 ring-line"
                    }`}
                    aria-label={t.position ? `Rank ${t.position}` : "No rank yet"}
                  >
                    {t.position === 1 ? <Crown aria-hidden="true" className="size-4" /> : (t.position ?? "—")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={teamHref(t.team.id)} className="block truncate font-semibold text-navy-900 hover:text-brand-700 hover:underline">
                      {t.team.name}
                    </Link>
                    <p className="truncate text-xs text-muted">
                      {t.team.code} · {t.team.leaderName}
                      {t.room ? ` · ${t.room}` : ""}
                    </p>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <Pill tone={s.tone}>{s.label}</Pill>
                      {t.award && <Pill tone="orange">{t.award.place === 1 ? "1st" : "2nd"} · {rupees(t.award.amount)}</Pill>}
                    </span>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-display text-2xl font-bold tabular-nums text-navy-900">
                      {t.allAbsent ? "0" : marks(t.average)}
                      <span className="text-xs font-semibold text-muted"> /50</span>
                    </p>
                    <p className="text-[11px] tabular-nums text-muted">
                      Innov. {marks(t.innovation)} · Query {marks(t.query)}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {category.tieAtCut && (
        <p className="flex items-center gap-1.5 border-t border-line bg-accent-50 px-4 py-2 text-xs font-semibold text-accent-600">
          <Scale aria-hidden="true" className="size-3.5" />
          The last finalist place is level with the next team on every tie-break: the department admin or a super admin decides.
        </p>
      )}
    </article>
  );
}
