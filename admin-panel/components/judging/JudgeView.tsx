"use client";

import { useState, type ReactNode } from "react";
import { ArrowRight, BookOpen, CalendarClock, CheckCircle2, Crown, FileDown, Lock, LockOpen, MapPin, Pencil, QrCode, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { JudgePanel, JudgeTeam, LockResult } from "@/lib/admin-types";
import { useAdmin } from "@/lib/auth/AuthProvider";
import { judgeManualUrl } from "@/lib/content";
import { categoryTitle, formatDateTime, plural, roundLabels } from "@/lib/format";
import { roomClock, roomLabel, slotLabel, slotState, timeLabel, reasonProblem, MIN_REASON_LENGTH, type RoomClock } from "@/lib/rooms";
import { attendanceEnabled } from "@/lib/features";
import { useServerNow } from "@/lib/use-room-now";
import { yearLabel } from "@/lib/rules";
import { useQuery } from "@/lib/use-query";
import { Button, buttonClass } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Textarea } from "@/components/ui/Field";
import { Loading, Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { AttendanceDesk } from "@/components/attendance/AttendanceDesk";
import { HiddenMarks, RevealButton, useHoldToReveal } from "./HiddenMarks";
import { RoomTimer, TimeLeftPopup, type WarningItem } from "./RoomTimer";
import { PARTS, RubricForm, RubricSummary, rubricFor, TOTAL } from "./RubricForm";

type Draft = { marks: (number | null)[]; remarks: string };

const dayLabel = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

type Scoring = { can: boolean; label: string; note: string | null; live: boolean; clock: RoomClock | null; locked: boolean };

/**
 * Whether this judge can save marks in this room now, and how to say so. The server checks the same rules: the round
 * must be open, the room's slot must have started and its buffer not run out, and the judge must not have locked.
 */
function scoringFor(panel: JudgePanel, now: number): Scoring {
  const clock = roomClock(panel.slotStart, panel.slotEnd, panel.scoringUntil, now);
  const over = clock?.phase === "over";
  if (!panel.open) {
    return { can: false, label: "Scoring is locked", note: "You can read every team now. Marks can be saved once the organisers open scoring for this round.", live: false, clock, locked: false };
  }
  if (clock?.phase === "before") {
    const when = `${dayLabel.format(new Date(panel.scoringFrom!))}, ${timeLabel(panel.scoringFrom!)}`;
    return {
      can: false,
      label: `Scoring opens ${when}`,
      note: `Get familiar with your room: read every team and open the score sheet. Marks can be saved from ${when}.`,
      live: false,
      clock,
      locked: false,
    };
  }
  if (over) {
    return {
      can: false,
      label: "Time is over: your marks are locked",
      note: "Your saved marks were locked when the room's time ran out. If a team still needs marks, please contact the organisers.",
      live: false,
      clock,
      locked: true,
    };
  }
  if (panel.locked) {
    return { can: false, label: "You locked your marks", note: "Your marks in this room are locked. Only a super admin or your department's admin can change them now.", live: false, clock, locked: true };
  }
  const buffer = clock?.phase === "buffer";
  return {
    can: true,
    label: buffer ? "Extra time to submit" : "Scoring is open",
    note: buffer ? "The slot is over. Finish saving your marks now, then lock them. They lock by themselves when the extra time ends." : null,
    live: true,
    clock,
    locked: false,
  };
}

type Banner = { panelId: string; tone: "success" | "info"; title: string; text: string; next?: JudgeTeam | null };

/** A judge's page: their rooms, each team, and the rubric to score it. Marks can be changed until locked, and stay hidden on screen. */
export function JudgeView() {
  const me = useAdmin();
  const view = useQuery("judge", () => api.judgeView());
  // The server's clock, so a device with a wrong time still counts down to the moment the server enforces.
  const now = useServerNow(view.data?.serverTime);
  const [scoring, setScoring] = useState<{ panel: JudgePanel; team: JudgeTeam } | null>(null);
  const [desk, setDesk] = useState<JudgePanel | null>(null);
  const [locking, setLocking] = useState<JudgePanel | null>(null);
  // Marks being entered survive closing the sheet by mistake (until the page is reloaded).
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [notice, setNotice] = useState<Banner | null>(null);

  const panels = view.data?.panels ?? [];
  // The "15 minutes left" popup: for each room of this judge whose slot is about to end while they can still save marks.
  const warnings: WarningItem[] = panels.flatMap((panel) => {
    const status = scoringFor(panel, now);
    if (!status.can || status.clock?.phase !== "slot" || !status.clock.warn) return [];
    const unmarked = panel.teams.filter((t) => !t.myScore && t.status === "submitted").length;
    return [
      {
        id: panel.id,
        room: roomLabel(panel),
        slotEnd: panel.slotEnd!,
        msLeft: status.clock.msLeft,
        detail: unmarked
          ? `Finish scoring your teams, check your marks, then lock them. ${plural(unmarked, "team")} still ${unmarked === 1 ? "has" : "have"} no marks from you.`
          : "All your teams have marks. Check them, then lock your marks.",
        note:
          panel.bufferMinutes > 0
            ? `When the slot ends you get ${panel.bufferMinutes} extra minutes to submit. After that your saved marks lock by themselves.`
            : "When the slot ends your saved marks lock by themselves.",
      },
    ];
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Judge"
        title="My judging"
        description={`Signed in as ${me.name}. You see only the teams of your own rooms. Save marks for each team and change them, with a reason, until you lock them all in one go. Marks stay hidden on screen: hover over or hold the eye button to see them.`}
        actions={
          // w-max: the header would otherwise squeeze the two buttons into a column.
          <div className="flex w-max gap-2">
            <a href={judgeManualUrl} target="_blank" rel="noopener" className={buttonClass("secondary")}>
              <BookOpen aria-hidden="true" className="size-4" />
              Judge manual
            </a>
            <Button variant="secondary" onClick={view.reload} pending={view.loading && !!view.data}>
              <RefreshCw aria-hidden="true" className="size-4" />
              Refresh
            </Button>
          </div>
        }
      />
      {view.error && <Notice tone="error">{view.error}</Notice>}
      {!view.data && !view.error && <Loading label="Loading your teams" />}
      {view.data && view.data.panels.length === 0 && (
        <EmptyState
          title="No room yet"
          action={
            <a href={judgeManualUrl} target="_blank" rel="noopener" className={buttonClass("secondary", "sm")}>
              <BookOpen aria-hidden="true" className="size-3.5" />
              Read the judge manual
            </a>
          }
        >
          The organisers have not put you in a room yet. This page shows your room and teams as soon as they do.
        </EmptyState>
      )}
      {panels.map((panel) => {
        const status = scoringFor(panel, now);
        const next = notice?.panelId === panel.id ? notice.next : null;
        return (
          <RoomSection
            key={panel.id}
            panel={panel}
            now={now}
            status={status}
            onScore={(team) => {
              setNotice(null);
              setScoring({ panel, team });
            }}
            onAttendance={() => setDesk(panel)}
            onLock={() => setLocking(panel)}
            banner={
              notice?.panelId === panel.id ? (
                <Notice
                  tone={notice.tone}
                  title={notice.title}
                  action={
                    next && status.can ? (
                      <Button size="sm" onClick={() => setScoring({ panel, team: next })}>
                        Score {next.name}
                        <ArrowRight aria-hidden="true" className="size-3.5" />
                      </Button>
                    ) : undefined
                  }
                >
                  {notice.text}
                </Notice>
              ) : null
            }
          />
        );
      })}
      <TimeLeftPopup items={warnings} />
      {scoring && (
        <ScoreSheet
          key={scoring.team.id}
          panel={scoring.panel}
          team={scoring.team}
          canScore={scoringFor(scoring.panel, now).can}
          draft={drafts[`${scoring.panel.id}:${scoring.team.id}`]}
          onDraft={(draft) => setDrafts((all) => ({ ...all, [`${scoring.panel.id}:${scoring.team.id}`]: draft }))}
          onClose={() => setScoring(null)}
          onSaved={(changed) => {
            setDrafts((all) => {
              const rest = { ...all };
              delete rest[`${scoring.panel.id}:${scoring.team.id}`];
              return rest;
            });
            const rest = scoring.panel.teams.filter((t) => t.id !== scoring.team.id && !t.myScore && t.status === "submitted");
            setNotice({
              panelId: scoring.panel.id,
              tone: "success",
              title: changed ? `Marks changed for ${scoring.team.name}` : `Marks saved for ${scoring.team.name}`,
              text: rest.length
                ? "Saved. You can still change them until you lock your marks. The next team is ready."
                : "Saved. Every team in this room has your marks. Check them, then lock your marks when you are done.",
              next: rest[0] ?? null,
            });
            setScoring(null);
            view.reload();
          }}
        />
      )}
      {locking && (
        <LockDialog
          panel={locking}
          onClose={() => setLocking(null)}
          onLocked={(result) => {
            setNotice({
              panelId: locking.id,
              tone: "info",
              title: "Your marks are locked",
              text: `${plural(result.locked, "team")} locked.${result.unscored ? ` ${plural(result.unscored, "team")} had no marks from you and stay unscored.` : ""} Only a super admin or your department's admin can change them now.`,
            });
            setLocking(null);
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

function RoomSection({
  panel,
  now,
  status,
  onScore,
  onAttendance,
  onLock,
  banner,
}: {
  panel: JudgePanel;
  now: number;
  status: Scoring;
  onScore: (team: JudgeTeam) => void;
  onAttendance: () => void;
  onLock: () => void;
  banner: ReactNode;
}) {
  const done = panel.teams.filter((t) => t.myScore).length;
  const students = panel.teams.reduce((sum, t) => sum + t.members.length, 0);
  const slot = slotLabel(panel.slotStart, panel.slotEnd);
  const state = slotState(panel.slotStart, panel.slotEnd, now);
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
          <div className="flex flex-col items-start gap-2 sm:items-end">
            {status.clock && <RoomTimer clock={status.clock} tone="dark" className="text-base" />}
            <p className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${status.live ? "bg-emerald-400 text-navy-950" : "bg-white/10 text-white"}`}>
              {status.live ? <LockOpen aria-hidden="true" className="size-4" /> : <Lock aria-hidden="true" className="size-4" />}
              {status.label}
            </p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3">
          {[
            ["Teams", panel.teams.length],
            ["Students", students],
            ["Marks saved", `${done} / ${panel.teams.length}`],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-2xl bg-white/[0.07] px-3 py-2.5 ring-1 ring-inset ring-white/10">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/60">{label}</p>
              <p className="font-display text-2xl font-bold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Teams with your marks" aria-valuemin={0} aria-valuemax={panel.teams.length} aria-valuenow={done}>
          <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${panel.teams.length ? (done / panel.teams.length) * 100 : 0}%` }} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {status.can && done > 0 && (
            <button type="button" onClick={onLock} className="inline-flex h-9 items-center gap-2 rounded-full bg-accent-500 px-4 text-sm font-semibold text-white transition hover:bg-accent-600">
              <Lock aria-hidden="true" className="size-4" />
              Lock all my marks
            </button>
          )}
          {attendanceEnabled && (
            <>
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
            </>
          )}
        </div>
        {error && <p role="alert" className="mt-2 text-sm font-medium text-red-200">{error}</p>}
      </header>

      {status.note && (
        <p className={`border-b border-line px-5 py-3 text-sm sm:px-6 ${status.can ? "bg-accent-50 font-semibold text-accent-600" : "bg-surface text-muted"}`}>{status.note}</p>
      )}
      {banner && <div className="px-5 pt-5 sm:px-6">{banner}</div>}

      {panel.teams.length === 0 ? (
        <p className="px-6 py-8 text-sm text-muted">No teams in this room yet.</p>
      ) : (
        <>
          <MarksOverview panel={panel} canEdit={status.can} locked={status.locked} onOpen={onScore} />
          <ol className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:p-5">
            {panel.teams.map((team, index) => (
              <TeamCard key={team.id} team={team} index={index} open={status.can} locked={status.locked} onScore={() => onScore(team)} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

/** Every mark the judge saved in this room on one screen: totals stay hidden until the eye is held; pick a team to look at it or change it. */
function MarksOverview({ panel, canEdit, locked, onOpen }: { panel: JudgePanel; canEdit: boolean; locked: boolean; onOpen: (team: JudgeTeam) => void }) {
  const reveal = useHoldToReveal();
  const rows = panel.teams.filter((t) => t.myScore);
  if (rows.length === 0) return null;
  return (
    <section aria-label="Your saved marks" className="mx-4 mt-4 overflow-hidden rounded-2xl ring-1 ring-line sm:mx-5">
      <header className="flex flex-wrap items-center justify-between gap-3 bg-surface px-4 py-3">
        <div className="min-w-0">
          <h3 className="font-display text-base font-bold text-navy-900">My marks</h3>
          <p className="text-xs text-muted">
            {locked ? "Locked: you can look at your marks but not change them." : canEdit ? "Saved. You can change a team's marks (with a reason) until you lock them." : "Saved."}
          </p>
        </div>
        <RevealButton shown={reveal.shown} bind={reveal.bind} label="all your marks">
          Hold to show
        </RevealButton>
      </header>
      <ul className="divide-y divide-line">
        {rows.map((team) => {
          const score = team.myScore!;
          return (
            <li key={team.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-navy-900">{team.name}</span>
                <span className="font-mono text-xs text-muted">{team.code}</span>
              </span>
              <span className={`font-display text-lg font-bold tabular-nums ${reveal.shown ? "text-navy-900" : "tracking-[0.2em] text-muted"}`} aria-hidden={!reveal.shown}>
                {reveal.shown ? `${score.total}/${TOTAL}` : "••/••"}
              </span>
              {score.editCount > 0 && <Pill tone="orange">Changed {score.editCount}×</Pill>}
              {score.locked || locked ? <Pill tone="navy">Locked</Pill> : <Pill tone="green">Saved</Pill>}
              <Button size="sm" variant="secondary" onClick={() => onOpen(team)}>
                {canEdit && !locked ? (
                  <>
                    <Pencil aria-hidden="true" className="size-3.5" />
                    Review / edit
                  </>
                ) : (
                  "View"
                )}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LockDialog({ panel, onClose, onLocked }: { panel: JudgePanel; onClose: () => void; onLocked: (result: LockResult) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = panel.teams.filter((t) => t.myScore).length;
  const unscored = panel.teams.filter((t) => !t.myScore && t.status === "submitted");

  async function lock() {
    setPending(true);
    setError(null);
    try {
      onLocked(await api.lockMarks(panel.id));
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <Dialog
      title="Lock all my marks?"
      description={roomLabel(panel)}
      onClose={onClose}
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Not yet
          </Button>
          <Button onClick={lock} pending={pending}>
            <Lock aria-hidden="true" className="size-4" />
            Lock my marks
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-navy-800">
        <Notice tone="warning" title="You cannot undo this yourself">
          After locking, only a super admin or your department&apos;s admin can change your marks. If you are not sure about a team, open it and check first.
        </Notice>
        <p>
          You have saved marks for <strong>{saved}</strong> of {plural(panel.teams.length, "team")} in this room.
        </p>
        {unscored.length > 0 && (
          <div className="rounded-xl bg-accent-50 p-3 text-accent-600">
            <p className="font-semibold">{plural(unscored.length, "team")} without your marks:</p>
            <p className="mt-0.5 text-navy-900">
              {unscored
                .slice(0, 6)
                .map((t) => t.name)
                .join(", ")}
              {unscored.length > 6 ? ` and ${unscored.length - 6} more` : ""}
            </p>
            <p className="mt-1 text-xs">They stay unscored by you. Go back if you still want to mark them.</p>
          </div>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  );
}

function TeamCard({ team, index, open, locked, onScore }: { team: JudgeTeam; index: number; open: boolean; locked: boolean; onScore: () => void }) {
  const leader = team.members.find((m) => m.role === "leader");
  const scored = !!team.myScore;
  const scorable = team.status === "submitted";
  return (
    <li className={`flex min-w-0 flex-col rounded-2xl p-4 ring-1 ring-inset transition ${scored ? "bg-emerald-50/60 ring-emerald-200" : "bg-white ring-line hover:ring-navy-800/25"}`}>
      <div className="flex items-start gap-3">
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl font-display text-sm font-bold ${scored ? "bg-emerald-600 text-white" : "bg-surface text-navy-900 ring-1 ring-inset ring-line"}`}>
          {scored ? <CheckCircle2 aria-label="Marks saved" className="size-5" /> : index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-base font-bold text-navy-900">{team.name}</span>
            <span className="font-mono text-xs text-muted">{team.code}</span>
            {team.tent && <span className="font-mono text-xs font-bold text-accent-600">Stall {team.tent}</span>}
          </p>
          <p className="mt-0.5 line-clamp-2 text-sm text-navy-800">{team.projectTitle}</p>
          <p className="mt-1.5 flex flex-wrap gap-1.5">
            {/* Not a Pill: long category names must wrap on a phone instead of pushing the card wider. */}
            <span className="inline-flex max-w-full rounded-lg bg-navy-900 px-2 py-0.5 text-[11px] font-semibold text-white">
              Cat {team.category} · {categoryTitle(team.category)}
            </span>
            {!scorable && <Pill tone="red">{team.status}</Pill>}
            {team.myScore && team.myScore.editCount > 0 && <Pill tone="orange">Changed {team.myScore.editCount}×</Pill>}
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
            <span className="inline-flex items-center gap-1 font-semibold">
              {(team.myScore!.locked || locked) && <Lock aria-hidden="true" className="size-3" />}
              {team.myScore!.locked || locked ? "Locked" : "Saved"}
            </span>
            <HiddenMarks value={<>{team.myScore!.total}<span className="text-xs text-muted">/{TOTAL}</span></>} label={`your marks for ${team.name}`} size="sm" />
          </span>
        ) : (
          <span className="text-xs font-semibold text-accent-600">{scorable ? (open ? "To score" : "Not scored yet") : "Not scored"}</span>
        )}
        <Button size="sm" variant={scored || !open || !scorable ? "secondary" : "primary"} onClick={onScore}>
          {scored ? (open ? "Review / edit" : "View") : open && scorable ? "Score team" : "Read"}
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}

function sameMarks(a: readonly (number | null)[], b: readonly number[]) {
  return a.length === b.length && a.every((m, i) => m === b[i]);
}

function ScoreSheet({
  panel,
  team,
  canScore,
  draft,
  onDraft,
  onClose,
  onSaved,
}: {
  panel: JudgePanel;
  team: JudgeTeam;
  canScore: boolean;
  draft: Draft | undefined;
  onDraft: (draft: Draft) => void;
  onClose: () => void;
  /** `changed`: these were saved marks that were changed (not a first save). */
  onSaved: (changed: boolean) => void;
}) {
  const rubric = rubricFor(team.category);
  const scored = team.myScore;
  const [marks, setMarks] = useState<(number | null)[]>(() => draft?.marks ?? scored?.marks ?? PARTS.map(() => null));
  const [remarks, setRemarks] = useState(draft?.remarks ?? scored?.remarks ?? "");
  const [reason, setReason] = useState("");
  // Saved marks open for reading; changing them is a deliberate step.
  const [editing, setEditing] = useState(!scored);
  const [step, setStep] = useState<"marks" | "review">("marks");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reveal = useHoldToReveal();
  const savable = canScore && team.status === "submitted";
  const total = marks.reduce<number>((sum, m) => sum + (m ?? 0), 0);
  const missing = marks.filter((m) => m === null).length;
  const unchanged = !!scored && sameMarks(marks, scored.marks) && remarks.trim() === scored.remarks;
  const reasonError = scored && reason.trim() ? reasonProblem(reason) : null;

  const set = (index: number, value: number) => {
    const next = marks.map((m, i) => (i === index ? value : m));
    setMarks(next);
    if (!scored) onDraft({ marks: next, remarks });
  };

  async function save() {
    if (scored) {
      const problem = reasonProblem(reason);
      if (problem) return setError(problem);
    }
    setPending(true);
    setError(null);
    try {
      await api.saveScore(panel.id, team.id, marks as number[], remarks.trim(), scored ? reason.trim() : "");
      onSaved(!!scored);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  const footer = !savable || (scored && !editing) ? (
    <>
      {scored && (
        <span className="mr-auto flex items-center gap-2 text-sm text-muted">
          <ShieldCheck aria-hidden="true" className="size-4 text-emerald-600" />
          Saved {formatDateTime(scored.updatedAt)}
          {(scored.locked || !canScore) && " · locked"}
        </span>
      )}
      {scored && savable && (
        <Button variant="secondary" onClick={() => setEditing(true)}>
          <Pencil aria-hidden="true" className="size-4" />
          Change marks
        </Button>
      )}
      <Button variant="secondary" onClick={onClose}>
        Close
      </Button>
    </>
  ) : step === "marks" ? (
    <>
      <span className="mr-auto self-center font-display text-xl font-bold tabular-nums text-navy-900">
        {total}
        <span className="text-sm font-semibold text-muted"> / {TOTAL}</span>
        {missing > 0 && <span className="ml-2 align-middle font-sans text-xs font-semibold text-accent-600">{missing} left</span>}
      </span>
      <Button variant="secondary" onClick={onClose}>
        {scored ? "Cancel" : "Later"}
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
      <Button onClick={save} pending={pending} disabled={unchanged}>
        {scored ? "Save changes" : "Save marks"}
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
        {(step === "marks" || (scored && !editing)) && <TeamBrief team={team} />}

        {!canScore && !scored && <Notice tone="info">Practice view: read the team and the rubric to get familiar. Marks can be saved once scoring opens for your room.</Notice>}
        {canScore && !scored && team.status !== "submitted" && <Notice tone="warning">This team has been {team.status}, so it is not scored.</Notice>}

        {scored && !editing ? (
          <section className="space-y-3 rounded-2xl bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-navy-900">
                {savable ? "Your marks are saved. You can change them until you lock your marks." : "Your marks are saved and locked."}
              </p>
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
            {scored.editCount > 0 && <p className="text-xs font-semibold text-accent-600">These marks were changed {plural(scored.editCount, "time")} after they were first saved.</p>}
            {scored.editedBy && <p className="text-xs text-muted">Changed by an organiser ({scored.editedBy}).</p>}
            {!savable && <p className="text-xs text-muted">Need a correction? Ask a super admin or your department&apos;s admin.</p>}
          </section>
        ) : step === "marks" ? (
          <>
            {scored && (
              <Notice tone="warning" title="You are changing saved marks">
                You will be asked for a clear reason before they are saved. The organisers see the reason and that the marks were changed.
              </Notice>
            )}
            <RubricForm category={team.category} marks={marks} onChange={set} disabled={!savable || pending} />
            <Field label="Remarks (optional)" htmlFor="score-remarks" hint="Only the organisers see these.">
              <Textarea
                id="score-remarks"
                value={remarks}
                onChange={(e) => {
                  setRemarks(e.target.value);
                  if (!scored) onDraft({ marks, remarks: e.target.value });
                }}
                maxLength={1000}
                disabled={!savable || pending}
              />
            </Field>
          </>
        ) : (
          <section className="space-y-4">
            {scored ? (
              <Notice tone="warning" title="Why are you changing these marks?">
                Your reason is kept with the change, and the organisers see it. Marks saved before: {scored.total} / {TOTAL}.
              </Notice>
            ) : (
              <Notice tone="info" title="Check before you save">
                You can still change saved marks until you lock all your marks in this room (a reason is needed). They lock by themselves when the room&apos;s time ends.
              </Notice>
            )}
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
            {scored && (
              <Field
                label="Reason for the change"
                htmlFor="edit-reason"
                hint={`Say what you got wrong, in a sentence (at least ${MIN_REASON_LENGTH} characters).`}
                error={reasonError ?? undefined}
              >
                <Textarea id="edit-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} disabled={pending} placeholder="For example: I entered the innovation mark in the wrong box." />
              </Field>
            )}
            {unchanged && <Notice tone="info">Nothing has changed from your saved marks.</Notice>}
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
