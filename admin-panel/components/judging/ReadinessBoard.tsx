"use client";

import { CheckCircle2, Medal, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import { departmentLabel } from "@/lib/content";
import { plural } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { Pill } from "@/components/ui/Pill";

const medal = ["text-amber-500", "text-slate-400", "text-amber-700"];

/**
 * How far every department has got with its department-round rooms, ranked, for super admins and all department
 * admins. It shows counts only (teams in rooms, rooms with both judges), so each department sees where it stands
 * without seeing another department's teams, rooms or judges.
 */
export function ReadinessBoard({ refreshKey }: { refreshKey?: unknown }) {
  const board = useQuery(`readiness-${String(refreshKey)}`, () => api.readiness());
  if (!board.data || board.data.rows.length === 0) return null;
  const { rows, mine } = board.data;
  const readyCount = rows.filter((r) => r.ready).length;

  return (
    <section aria-labelledby="readiness-title" className="rounded-2xl bg-white p-4 ring-1 ring-line sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="readiness-title" className="flex items-center gap-2 font-display text-lg font-bold text-navy-900">
          <Trophy aria-hidden="true" className="size-5 text-accent-500" />
          Room set-up leaderboard
        </h2>
        <p className="text-xs text-muted">
          {readyCount} of {rows.length} departments are ready. Half the score is teams in a room, half is rooms with both judges.
        </p>
      </div>
      <ol className="mt-3 divide-y divide-line">
        {rows.map((row) => {
          const own = mine === row.department;
          return (
            <li key={row.department} className={`grid items-center gap-x-4 gap-y-1.5 py-2.5 sm:grid-cols-[2.5rem_minmax(0,11rem)_minmax(0,1fr)_auto] ${own ? "-mx-2 rounded-xl bg-accent-50 px-2" : ""}`}>
              <span className="flex items-center gap-1 font-display text-lg font-bold tabular-nums text-navy-900">
                {row.rank <= 3 ? <Medal aria-hidden="true" className={`size-4 ${medal[row.rank - 1]}`} /> : null}
                {row.rank}
              </span>
              <span className="min-w-0 font-semibold text-navy-900">
                {departmentLabel(row.department)}
                {own && <span className="ml-2 align-middle"><Pill tone="orange">Your department</Pill></span>}
              </span>
              <span className="min-w-0">
                <span
                  className="block h-2.5 overflow-hidden rounded-full bg-surface ring-1 ring-inset ring-line"
                  role="progressbar"
                  aria-label={`${departmentLabel(row.department)} progress`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={row.percent}
                >
                  <span className={`block h-full rounded-full transition-all ${row.ready ? "bg-emerald-500" : "bg-accent-500"}`} style={{ width: `${row.percent}%` }} />
                </span>
                <span className="mt-1 block text-xs text-muted">
                  {row.allotted} / {plural(row.teams, "team")} in a room · {row.staffed} / {plural(row.rooms, "room")} with both judges
                </span>
              </span>
              <span className="flex items-center gap-2 sm:justify-end">
                {row.ready ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    <CheckCircle2 aria-hidden="true" className="size-3.5" />
                    Ready
                  </span>
                ) : (
                  <span className="font-display text-lg font-bold tabular-nums text-navy-900">{row.percent}%</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
