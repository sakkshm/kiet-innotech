"use client";

import { useEffect, useState } from "react";
import { BookOpen, Lock, LockOpen, ScrollText } from "lucide-react";
import { api } from "@/lib/api";
import type { Judging, JudgingRound } from "@/lib/admin-types";
import { useAdmin } from "@/lib/auth/AuthProvider";
import { clubDepartment, judgeManualUrl } from "@/lib/content";
import { formatDateTime, roundLabels } from "@/lib/format";
import { isTypeAdmin, scopeName } from "@/lib/scope";
import { useQuery } from "@/lib/use-query";
import { pickParam, useUrlParams } from "@/lib/use-url-params";
import { Button, buttonClass } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Field, Select } from "@/components/ui/Field";
import { Loading, Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { JurorsTab } from "./JurorsTab";
import { PanelsTab } from "./PanelsTab";
import { RankingsTab } from "./RankingsTab";
import { ReadinessBoard } from "./ReadinessBoard";
import { TentsTab } from "./TentsTab";

type Tab = "rooms" | "judges" | "tents" | "rankings";

/** The event document's rules for each round, shown on the page so nobody has to look them up. */
const roundRules: Record<JudgingRound, string[]> = {
  department: [
    "23 and 24 October, by the department timetable. Each room (a building, a room and a time slot) takes one department's teams.",
    "Department admins set up their own rooms, add judges (KIET emails only) and allot teams; super admins can do this for every department.",
    "Two judges per room: one from the room's own department and one from another department. A judge sits in one room only; one of the two chairs.",
    "Judges can sign in and read their room any time; they save marks during the room's slot and its buffer, the extra minutes after the slot (15 by default, at most 60). Each room's timer counts down to the end of the slot, a popup warns 15 minutes before, and the buffer is the judges' extra time to finish. Department admins set the buffer of their rooms; super admins change the timetable.",
    "Every category is marked out of 50 on its common rubric: four criteria of 10 (two parts of 5), then Query Addressing out of 10.",
    "A judge saves each team's marks, can change them (with a clear reason) and then locks all their marks in the room in one go. Marks also lock by themselves when the slot and buffer end. Marks stay hidden on screen. After locking, only a super admin, or the department's own admin during the room's slot and buffer, can change marks or unlock a judge; the department admin must give a clear reason, a super admin need not. Every change is logged and highlighted for the super admins.",
    "Ties: higher Innovation / Originality score, then Query Addressing, then the room's chair decides. No shared positions.",
    "Each department nominates its finalists per category by 24 October, 6:00 PM, within the quota a super admin sets on the Finalists page.",
  ],
  final: [
    "30 October, institute level. Department finalists and teams from other colleges and schools exhibit in numbered stalls.",
    "The plan is 8 panels of 2 external judges (16 judges), covering Categories 1 to 8 and the school entries.",
    "Same rubrics and tie-breakers as the department round. Schools also compete for the Best School Project award.",
    "Prizes: ₹8,000 / ₹5,000 for project categories, ₹4,000 / ₹3,000 for posters, ₹5,000 / ₹3,000 for the best school project.",
  ],
};

export function JudgingView() {
  const admin = useAdmin();
  const isSuper = admin.role === "super_admin";
  // COE KIET teams skip the department round, so their admin sees the Grand Finale only.
  const coeAdmin = admin.role === "admin" && admin.department === clubDepartment;
  const rounds: JudgingRound[] = coeAdmin ? ["final"] : admin.role === "admin" ? ["department"] : isTypeAdmin(admin) ? ["final"] : ["department", "final"];
  const { params, update } = useUrlParams();
  const round = pickParam(params, "round", rounds) ?? rounds[0];
  const tabs: { key: Tab; label: string }[] = [
    { key: "rooms", label: round === "department" ? "Rooms" : "Panels" },
    ...(isSuper ? [{ key: "judges" as Tab, label: "Judges" }] : []),
    ...(round === "final" ? [{ key: "tents" as Tab, label: "Stalls" }] : []),
    ...(!isTypeAdmin(admin) ? [{ key: "rankings" as Tab, label: "Rankings" }] : []),
  ];
  const tab = pickParam(params, "tab", tabs.map((t) => t.key)) ?? "rooms";
  const judging = useQuery(`judging-${round}`, () => api.judging(round));

  // Several organisers can set up the same department's rooms at once: keep this list current, so nobody works on a
  // room someone else has deleted. Refreshes when the tab is shown again and every 45 seconds while it is visible.
  const { reload } = judging;
  useEffect(() => {
    const refresh = () => document.visibilityState === "visible" && reload();
    const timer = window.setInterval(refresh, 45_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reload]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isSuper ? "Super admin" : scopeName(admin)}
        title="Judging"
        description={
          isSuper
            ? "Appoint judges, set up rooms and finale panels, allot teams and stalls, and open scoring when the round starts."
            : round === "department"
              ? "Set up your department's rooms (building, room and time slot), add judges by email and allot your teams. Super admins open scoring."
              : "The Grand Finale panels and your teams' stalls. Organisers manage the allotments."
        }
        actions={
          <div className="flex w-max items-end gap-2">
            {round === "department" && (
              <a href={judgeManualUrl} target="_blank" rel="noopener" className={buttonClass("secondary")} title="The PDF manual for department round judges: share it with your judges.">
                <BookOpen aria-hidden="true" className="size-4" />
                Judge manual
              </a>
            )}
            <Field label="Round" htmlFor="judging-round" className="w-48">
              <Select id="judging-round" value={round} onChange={(e) => update({ round: e.target.value, tab: null })} disabled={rounds.length === 1}>
                {rounds.map((r) => (
                  <option key={r} value={r}>{roundLabels[r]}</option>
                ))}
              </Select>
            </Field>
          </div>
        }
      />

      {judging.error && <Notice tone="error">{judging.error}</Notice>}
      {!judging.data && !judging.error && <Loading label="Loading judging" />}

      {judging.data && (
        <>
          <RoundBar judging={judging.data} canManage={isSuper} onChange={judging.reload} />
          {round === "department" && (isSuper || admin.role === "admin") && <ReadinessBoard refreshKey={judging.data.panels.map((p) => `${p.id}:${p.teams.length}:${p.jurors.length}`).join("|") + judging.data.unallotted.length} />}
          <details className="group rounded-2xl bg-white ring-1 ring-line">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-navy-900">
              <ScrollText aria-hidden="true" className="size-4 text-brand-600" />
              Rules for the {roundLabels[round].toLowerCase()} round (from the event document)
              <span className="ml-auto text-xs font-normal text-muted group-open:hidden">Show</span>
              <span className="ml-auto hidden text-xs font-normal text-muted group-open:inline">Hide</span>
            </summary>
            <ul className="list-disc space-y-1.5 border-t border-line px-4 py-3 pl-8 text-sm text-navy-800">
              {roundRules[round].map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </details>

          <div role="tablist" aria-label="Judging sections" className="flex gap-1 overflow-x-auto border-b border-line">
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                type="button"
                aria-selected={tab === t.key}
                onClick={() => update({ tab: t.key === "rooms" ? null : t.key })}
                className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
                  tab === t.key ? "border-accent-500 text-navy-900" : "border-transparent text-muted hover:text-navy-900"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div role="tabpanel">
            {tab === "rooms" && <PanelsTab judging={judging.data} reload={judging.reload} />}
            {tab === "judges" && isSuper && <JurorsTab onChange={judging.reload} />}
            {tab === "tents" && round === "final" && <TentsTab judging={judging.data} onSaved={judging.setData} />}
            {tab === "rankings" && <RankingsTab round={round} />}
          </div>
        </>
      )}
    </div>
  );
}

function RoundBar({ judging, canManage, onChange }: { judging: Judging; canManage: boolean; onChange: () => void }) {
  const { round } = judging;
  const [confirming, setConfirming] = useState<"open" | "lock" | null>(null);
  const panels = judging.panels.length;
  const teams = judging.panels.reduce((sum, p) => sum + p.teams.length, 0);
  const judges = new Set(judging.panels.flatMap((p) => p.jurors.map((j) => j.email))).size;
  const scored = judging.panels.reduce((sum, p) => sum + p.teams.reduce((s, t) => s + t.scores, 0), 0);
  const expected = judging.panels.reduce((sum, p) => sum + p.teams.length * p.jurors.length, 0);

  return (
    <section aria-label="Scoring status" className={`rounded-2xl px-4 py-4 ring-1 sm:px-5 ${round.open ? "bg-emerald-50 ring-emerald-200" : "bg-white ring-line"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            {round.open ? <LockOpen aria-hidden="true" className="size-5 text-emerald-700" /> : <Lock aria-hidden="true" className="size-5 text-navy-800" />}
            <span className="font-display text-lg font-bold text-navy-900">Scoring is {round.open ? "open" : "locked"}</span>
            <Pill tone={round.open ? "green" : "slate"}>{roundLabels[round.round]}</Pill>
          </p>
          <p className="mt-1 text-sm text-muted">
            {round.open
              ? "Judges save marks for the teams in their own rooms and lock them when done. Locked marks can be changed only by a super admin or, in the room's slot and buffer, by the department's admin."
              : "Judges can already sign in and see their room and teams, but cannot submit marks until scoring is opened."}
            {round.changedAt && ` Last ${round.open ? "opened" : "changed"} ${formatDateTime(round.changedAt)} by ${round.changedBy}.`}
          </p>
          {!round.open && round.openBlocked && canManage && <p className="mt-2 text-sm font-medium text-accent-600">{round.openBlocked}</p>}
        </div>
        {canManage &&
          (round.open ? (
            <Button variant="secondary" onClick={() => setConfirming("lock")}>
              <Lock aria-hidden="true" className="size-4" />
              Lock scoring
            </Button>
          ) : (
            <Button onClick={() => setConfirming("open")} disabled={round.openBlocked !== null}>
              <LockOpen aria-hidden="true" className="size-4" />
              Open scoring
            </Button>
          ))}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[
          [judging.round.round === "department" ? "Rooms" : "Panels", panels],
          ["Teams allotted", teams],
          ["Judges", judges],
          ["Scores in", expected ? `${scored} / ${expected}` : "—"],
        ].map(([label, value]) => (
          <div key={label as string}>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</dt>
            <dd className="font-display text-xl font-bold tabular-nums text-navy-900">{value}</dd>
          </div>
        ))}
      </dl>

      {confirming && (
        <ConfirmDialog
          title={confirming === "open" ? `Open scoring for the ${roundLabels[round.round].toLowerCase()} round?` : "Lock scoring?"}
          description={
            confirming === "open"
              ? "Every judge in a room of this round can submit marks for their own teams until you lock it again."
              : "Judges keep seeing their teams but can no longer submit marks. You can open it again later."
          }
          confirmLabel={confirming === "open" ? "Open scoring" : "Lock scoring"}
          tone={confirming === "open" ? "primary" : "danger"}
          onClose={() => setConfirming(null)}
          onConfirm={async () => {
            if (confirming === "open") await api.openJudging(round.round);
            else await api.lockJudging(round.round);
            setConfirming(null);
            onChange();
          }}
        />
      )}
    </section>
  );
}
