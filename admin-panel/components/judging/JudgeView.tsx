"use client";

import { useState, type ReactNode } from "react";
import { ArrowRight, CalendarClock, CheckCircle2, Crown, FileDown, Lock, LockOpen, MapPin, QrCode, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { JudgePanel, JudgeTeam } from "@/lib/admin-types";
import { useAdmin } from "@/lib/auth/AuthProvider";
import { categoryTitle, formatDateTime, plural, roundLabels } from "@/lib/format";
import { roomLabel, slotLabel, slotState } from "@/lib/rooms";
import { yearLabel } from "@/lib/rules";
import { useQuery } from "@/lib/use-query";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Textarea } from "@/components/ui/Field";
import { Loading, Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { AttendanceDesk } from "@/components/attendance/AttendanceDesk";
import { HiddenMarks, RevealButton, useHoldToReveal } from "./HiddenMarks";
import { PARTS, RubricForm, RubricSummary, rubricFor, TOTAL } from "./RubricForm";

type Draft = { marks: (number | null)[]; remarks: string };

/** A judge's page: their rooms, each team, and the rubric to score it. Submitted marks are final and stay hidden. */
export function JudgeView() {
  const me = useAdmin();
  const view = useQuery("judge", () => api.judgeView());
  const [scoring, setScoring] = useState<{ panel: JudgePanel; team: JudgeTeam } | null>(null);
  const [desk, setDesk] = useState<JudgePanel | null>(null);
  // Marks being entered survive closing the sheet by mistake (until the page is reloaded).
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [submitted, setSubmitted] = useState<{ panelId: string; teamName: string } | null>(null);

  const nextFor = (panel: JudgePanel) => panel.teams.find((t) => !t.myScore && t.status === "submitted") ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Judge"
        title="My judging"
        description={`Signed in as ${me.name}. You see only the teams of your own rooms. Once you submit a team's marks they are final, and they stay hidden on screen: hover over or hold the eye button to see them.`}
        actions={
          <Button variant="secondary" onClick={view.reload} pending={view.loading && !!view.data}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Refresh
          </Button>
        }
      />
      {view.error && <Notice tone="error">{view.error}</Notice>}
      {!view.data && !view.error && <Loading label="Loading your teams" />}
      {view.data && view.data.panels.length === 0 && (
        <EmptyState title="No room yet">The organisers have not put you in a room yet. This page shows your room and teams as soon as they do.</EmptyState>
      )}
      {view.data?.panels.map((panel) => {
        const next = nextFor(panel);
        return (
          <RoomSection
            key={panel.id}
            panel={panel}
            onScore={(team) => {
              setSubmitted(null);
              setScoring({ panel, team });
            }}
            onAttendance={() => setDesk(panel)}
            banner={
              submitted?.panelId === panel.id ? (
                <Notice
                  tone="success"
                  title={`Marks submitted for ${submitted.teamName}`}
                  action={
                    next && panel.open ? (
                      <Button size="sm" onClick={() => setScoring({ panel, team: next })}>
                        Score {next.name}
                        <ArrowRight aria-hidden="true" className="size-3.5" />
                      </Button>
                    ) : undefined
                  }
                >
                  {next ? "They are final now. The next team is ready." : "Every team in this room is scored. Thank you!"}
                </Notice>
              ) : null
            }
          />
        );
      })}
      {scoring && (
        <ScoreSheet
          key={scoring.team.id}
          panel={scoring.panel}
          team={scoring.team}
          draft={drafts[`${scoring.panel.id}:${scoring.team.id}`]}
          onDraft={(draft) => setDrafts((all) => ({ ...all, [`${scoring.panel.id}:${scoring.team.id}`]: draft }))}
          onClose={() => setScoring(null)}
          onSubmitted={() => {
            setDrafts((all) => {
              const rest = { ...all };
              delete rest[`${scoring.panel.id}:${scoring.team.id}`];
              return rest;
            });
            setSubmitted({ panelId: scoring.panel.id, teamName: scoring.team.name });
            setScoring(null);
            view.reload();
          }}
        />
      )}
      {desk && (
        <Dialog
          title={`Attendance · ${roomLabel(desk)}`}
          description="Scan each student's event pass, or mark them by hand."
          onClose={() => setDesk(null)}
          size="xl"
          footer={
            <Button variant="secondary" onClick={() => setDesk(null)}>
              Done
            </Button>
          }
        >
          <AttendanceDesk round={desk.round} panelId={desk.id} load={() => api.judgeAttendance(desk.id)} />
        </Dialog>
      )}
    </div>
  );
}

function RoomSection({ panel, onScore, onAttendance, banner }: { panel: JudgePanel; onScore: (team: JudgeTeam) => void; onAttendance: () => void; banner: ReactNode }) {
  const done = panel.teams.filter((t) => t.myScore).length;
  const students = panel.teams.reduce((sum, t) => sum + t.members.length, 0);
  const slot = slotLabel(panel.slotStart, panel.slotEnd);
  const state = slotState(panel.slotStart, panel.slotEnd);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function downloadSheet() {
    setDownloading(true);
    setError(null);
    try {
      const [sheet, attendance] = await Promise.all([api.judgeAttendance(panel.id), import("@/lib/attendance")]);
      await attendance.downloadAttendancePdf(sheet);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section aria-labelledby={`judge-panel-${panel.id}`} className="overflow-hidden rounded-3xl bg-white ring-1 ring-line">
      <header className="bg-navy-900 px-5 py-5 text-white sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-300">{roundLabels[panel.round]} round</p>
            <h2 id={`judge-panel-${panel.id}`} className="mt-1 font-display text-2xl font-bold sm:text-3xl">
              {roomLabel(panel)}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-white/80">
              {slot && (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock aria-hidden="true" className="size-4" />
                  {slot}
                  {state === "now" && <span className="rounded-full bg-emerald-400 px-2 py-0.5 text-[11px] font-bold text-navy-950">Now</span>}
                </span>
              )}
              {panel.location && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin aria-hidden="true" className="size-4" />
                  {panel.location}
                </span>
              )}
              {panel.department && <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold">{panel.department} teams</span>}
              {panel.chair && (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-500 px-2.5 py-0.5 text-xs font-semibold">
                  <Crown aria-hidden="true" className="size-3" />
                  You chair this room
                </span>
              )}
            </div>
          </div>
          <p className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${panel.open ? "bg-emerald-400 text-navy-950" : "bg-white/10 text-white"}`}>
            {panel.open ? <LockOpen aria-hidden="true" className="size-4" /> : <Lock aria-hidden="true" className="size-4" />}
            {panel.open ? "Scoring is open" : "Scoring is locked"}
          </p>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3">
          {[
            ["Teams", panel.teams.length],
            ["Students", students],
            ["Submitted", `${done} / ${panel.teams.length}`],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-2xl bg-white/[0.07] px-3 py-2.5 ring-1 ring-inset ring-white/10">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/60">{label}</p>
              <p className="font-display text-2xl font-bold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Teams submitted" aria-valuemin={0} aria-valuemax={panel.teams.length} aria-valuenow={done}>
          <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${panel.teams.length ? (done / panel.teams.length) * 100 : 0}%` }} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={onAttendance} className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-navy-900 transition hover:bg-brand-50">
            <QrCode aria-hidden="true" className="size-4" />
            Mark attendance
          </button>
          <button
            type="button"
            onClick={downloadSheet}
            disabled={downloading}
            className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold text-white ring-1 ring-inset ring-white/30 transition hover:bg-white/10 disabled:opacity-60"
          >
            <FileDown aria-hidden="true" className="size-4" />
            {downloading ? "Preparing…" : "Attendance sheet"}
          </button>
        </div>
        {error && <p role="alert" className="mt-2 text-sm font-medium text-red-200">{error}</p>}
      </header>

      {!panel.open && (
        <p className="border-b border-line bg-surface px-5 py-3 text-sm text-muted sm:px-6">
          You can read every team now. Marks can be submitted once the organisers open scoring for this round.
        </p>
      )}
      {banner && <div className="px-5 pt-5 sm:px-6">{banner}</div>}

      {panel.teams.length === 0 ? (
        <p className="px-6 py-8 text-sm text-muted">No teams in this room yet.</p>
      ) : (
        <ol className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
          {panel.teams.map((team, index) => (
            <TeamCard key={team.id} team={team} index={index} open={panel.open} onScore={() => onScore(team)} />
          ))}
        </ol>
      )}
    </section>
  );
}

function TeamCard({ team, index, open, onScore }: { team: JudgeTeam; index: number; open: boolean; onScore: () => void }) {
  const leader = team.members.find((m) => m.role === "leader");
  const scored = !!team.myScore;
  const scorable = team.status === "submitted";
  return (
    <li className={`flex flex-col rounded-2xl p-4 ring-1 ring-inset transition ${scored ? "bg-emerald-50/60 ring-emerald-200" : "bg-white ring-line hover:ring-navy-800/25"}`}>
      <div className="flex items-start gap-3">
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl font-display text-sm font-bold ${scored ? "bg-emerald-600 text-white" : "bg-surface text-navy-900 ring-1 ring-inset ring-line"}`}>
          {scored ? <CheckCircle2 aria-label="Submitted" className="size-5" /> : index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-base font-bold text-navy-900">{team.name}</span>
            <span className="font-mono text-xs text-muted">{team.code}</span>
            {team.tent && <span className="font-mono text-xs font-bold text-accent-600">Stall {team.tent}</span>}
          </p>
          <p className="mt-0.5 line-clamp-2 text-sm text-navy-800">{team.projectTitle}</p>
          <p className="mt-1.5 flex flex-wrap gap-1.5">
            <Pill tone="navy">Cat {team.category} · {categoryTitle(team.category)}</Pill>
            {!scorable && <Pill tone="red">{team.status}</Pill>}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
            <Users aria-hidden="true" className="size-3.5" />
            {leader ? `${leader.fullName} (leader)` : "No leader"} · {plural(team.members.length, "member")}
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
        {scored ? (
          <span className="flex items-center gap-2 text-xs text-emerald-800">
            <span className="font-semibold">Submitted</span>
            <HiddenMarks value={<>{team.myScore!.total}<span className="text-xs text-muted">/{TOTAL}</span></>} label={`your marks for ${team.name}`} size="sm" />
          </span>
        ) : (
          <span className="text-xs font-semibold text-accent-600">{scorable ? (open ? "To score" : "Not scored yet") : "Not scored"}</span>
        )}
        <Button size="sm" variant={scored || !open || !scorable ? "secondary" : "primary"} onClick={onScore}>
          {scored ? "View" : open && scorable ? "Score team" : "Read"}
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}

function ScoreSheet({
  panel,
  team,
  draft,
  onDraft,
  onClose,
  onSubmitted,
}: {
  panel: JudgePanel;
  team: JudgeTeam;
  draft: Draft | undefined;
  onDraft: (draft: Draft) => void;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const rubric = rubricFor(team.category);
  const [marks, setMarks] = useState<(number | null)[]>(() => draft?.marks ?? PARTS.map(() => null));
  const [remarks, setRemarks] = useState(draft?.remarks ?? "");
  const [step, setStep] = useState<"marks" | "review">("marks");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reveal = useHoldToReveal();
  const scored = team.myScore;
  const editable = !scored && panel.open && team.status === "submitted";
  const total = marks.reduce<number>((sum, m) => sum + (m ?? 0), 0);
  const missing = marks.filter((m) => m === null).length;

  const set = (index: number, value: number) => {
    const next = marks.map((m, i) => (i === index ? value : m));
    setMarks(next);
    onDraft({ marks: next, remarks });
  };

  async function submit() {
    setPending(true);
    setError(null);
    try {
      await api.saveScore(panel.id, team.id, marks as number[], remarks.trim());
      onSubmitted();
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  const footer = scored ? (
    <>
      <span className="mr-auto flex items-center gap-2 text-sm text-muted">
        <ShieldCheck aria-hidden="true" className="size-4 text-emerald-600" />
        Submitted {formatDateTime(scored.updatedAt)}
      </span>
      <Button variant="secondary" onClick={onClose}>
        Close
      </Button>
    </>
  ) : !editable ? (
    <Button variant="secondary" onClick={onClose}>
      Close
    </Button>
  ) : step === "marks" ? (
    <>
      <span className="mr-auto self-center font-display text-xl font-bold tabular-nums text-navy-900">
        {total}
        <span className="text-sm font-semibold text-muted"> / {TOTAL}</span>
        {missing > 0 && <span className="ml-2 align-middle font-sans text-xs font-semibold text-accent-600">{missing} left</span>}
      </span>
      <Button variant="secondary" onClick={onClose}>
        Later
      </Button>
      <Button onClick={() => (missing ? setError(`Give a mark for every part (${missing} left).`) : (setError(null), setStep("review")))}>
        Review marks
        <ArrowRight aria-hidden="true" className="size-4" />
      </Button>
    </>
  ) : (
    <>
      <Button variant="secondary" onClick={() => setStep("marks")} disabled={pending} className="mr-auto">
        Back to edit
      </Button>
      <Button onClick={submit} pending={pending}>
        Submit final marks
      </Button>
    </>
  );

  return (
    <Dialog
      title={`${team.name} · ${team.code}`}
      description={`${roomLabel(panel)} · Category ${team.category}: ${categoryTitle(team.category)}${rubric ? ` · ${rubric.label} rubric` : ""}`}
      onClose={onClose}
      busy={pending}
      size="xl"
      footer={footer}
    >
      <div className="space-y-5">
        {step === "marks" && <TeamBrief team={team} />}

        {!panel.open && !scored && <Notice tone="info">Scoring is locked. You can read the team and the rubric; marks can be submitted once the organisers open this round.</Notice>}
        {panel.open && !scored && team.status !== "submitted" && <Notice tone="warning">This team has been {team.status}, so it is not scored.</Notice>}

        {scored ? (
          <section className="space-y-3 rounded-2xl bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-navy-900">Your marks are submitted and final.</p>
              <RevealButton shown={reveal.shown} bind={reveal.bind} label="your marks">
                Hold to show
              </RevealButton>
            </div>
            <div className={`transition ${reveal.shown ? "" : "pointer-events-none select-none blur-md"}`} aria-hidden={!reveal.shown}>
              <RubricSummary category={team.category} marks={scored.marks} />
              <p className="mt-2 text-right font-display text-xl font-bold tabular-nums text-navy-900">
                {scored.total} <span className="text-sm text-muted">/ {TOTAL}</span>
              </p>
              {scored.remarks && <p className="mt-2 text-sm text-navy-800">Remarks: {scored.remarks}</p>}
            </div>
            {scored.editedBy && <p className="text-xs text-muted">Changed by an organiser ({scored.editedBy}).</p>}
            <p className="text-xs text-muted">Need a correction? Ask a super admin; only they can change submitted marks.</p>
          </section>
        ) : step === "marks" ? (
          <>
            <RubricForm category={team.category} marks={marks} onChange={set} disabled={!editable || pending} />
            <Field label="Remarks (optional)" htmlFor="score-remarks" hint="Only the organisers see these.">
              <Textarea
                id="score-remarks"
                value={remarks}
                onChange={(e) => {
                  setRemarks(e.target.value);
                  onDraft({ marks, remarks: e.target.value });
                }}
                maxLength={1000}
                disabled={!editable || pending}
              />
            </Field>
          </>
        ) : (
          <section className="space-y-4">
            <Notice tone="warning" title="Check before you submit">
              Once submitted, your marks for {team.name} are final. You cannot change them; only a super admin can.
            </Notice>
            <div className="rounded-2xl p-4 ring-1 ring-line">
              <RubricSummary category={team.category} marks={marks as number[]} />
              <p className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
                <span className="text-sm font-semibold text-navy-900">Total</span>
                <span className="font-display text-2xl font-bold tabular-nums text-navy-900">
                  {total} <span className="text-sm text-muted">/ {TOTAL}</span>
                </span>
              </p>
              {remarks.trim() && <p className="mt-2 text-sm text-navy-800">Remarks: {remarks.trim()}</p>}
            </div>
          </section>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  );
}

function TeamBrief({ team }: { team: JudgeTeam }) {
  const [more, setMore] = useState(false);
  const long = team.abstract.length > 360;
  return (
    <section className="grid gap-4 rounded-2xl bg-surface p-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Project</p>
        <p className="mt-0.5 font-display text-lg font-bold text-navy-900">{team.projectTitle}</p>
        {team.domain && <p className="text-xs font-semibold text-brand-700">{team.domain}</p>}
        <p className={`mt-2 whitespace-pre-line text-sm text-navy-800 [overflow-wrap:anywhere] ${!more && long ? "line-clamp-5" : ""}`}>{team.abstract}</p>
        {long && (
          <button type="button" onClick={() => setMore(!more)} className="mt-1 text-xs font-semibold text-brand-700 hover:underline">
            {more ? "Show less" : "Read the whole abstract"}
          </button>
        )}
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Team · {plural(team.members.length, "member")}</p>
        <ul className="mt-1.5 space-y-1.5">
          {team.members.map((m) => (
            <li key={`${m.fullName}-${m.role}`} className="flex items-start gap-2 text-sm">
              {m.role === "leader" ? <Crown aria-label="Leader" className="mt-0.5 size-4 shrink-0 text-accent-500" /> : <span className="size-4 shrink-0" />}
              <span className="min-w-0">
                <span className="font-semibold text-navy-900">{m.fullName}</span>
                <span className="block text-xs text-muted">
                  {yearLabel(m.year, team.participantType)} · {m.course}
                  {m.department ? ` · ${m.department}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">{team.department ? `${team.department} · ` : ""}{team.institution}</p>
      </div>
    </section>
  );
}
