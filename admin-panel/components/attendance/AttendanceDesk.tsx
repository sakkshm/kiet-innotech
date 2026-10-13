"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CameraOff, Check, CheckCircle2, Crown, Search, TriangleAlert, Undo2, UserCheck, XCircle } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { AttendanceMember, AttendanceSheet, JudgingRound, ScanResult } from "@/lib/admin-types";
import { categoryTitle, formatTime } from "@/lib/format";
import { yearLabel } from "@/lib/rules";
import { useQuery } from "@/lib/use-query";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { Loading, Notice } from "@/components/ui/Notice";
import { Pill } from "@/components/ui/Pill";

type Feedback = { tone: "marked" | "already" | "error"; result?: ScanResult; message?: string; at: number };
type Pending = { member: AttendanceMember; team: string; action: "mark" | "unmark" };

const REASONS = { mark: ["No phone with them", "Pass not loading", "Phone battery dead", "Checked on the printed sheet"], unmark: ["Marked the wrong student", "Student left before judging"] };

/**
 * The attendance desk for a room, a department or the finale: a camera that reads event passes one after another,
 * a search to mark a student by hand, and the live roster. Organisers and the room's judges use it.
 */
export function AttendanceDesk({ round, panelId, load, sheetKey }: { round: JudgingRound; panelId?: string; load: () => Promise<AttendanceSheet>; sheetKey?: string }) {
  const sheet = useQuery(`attendance-${sheetKey ?? panelId ?? round}`, load);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [filter, setFilter] = useState<"all" | "absent" | "present">("all");
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const { reload } = sheet;

  // Other desks scan too: keep the roster fresh while it is open.
  useEffect(() => {
    const timer = setInterval(reload, 15_000);
    return () => clearInterval(timer);
  }, [reload]);

  const data = sheet.data;
  const students = data ? data.teams.reduce((sum, t) => sum + t.members.length, 0) : 0;
  const present = data ? data.teams.reduce((sum, t) => sum + t.members.filter((m) => m.presentAt).length, 0) : 0;
  const fullTeams = data ? data.teams.filter((t) => t.members.length > 0 && t.members.every((m) => m.presentAt)).length : 0;
  const q = text.trim().toLowerCase();
  const teams = useMemo(
    () =>
      (data?.teams ?? [])
        .map((team) => ({
          ...team,
          shown: team.members.filter(
            (m) =>
              (filter === "all" || (filter === "present") === !!m.presentAt) &&
              (!q || [m.fullName, m.rollNumber, team.code, team.name].some((v) => v.toLowerCase().includes(q))),
          ),
        }))
        .filter((team) => team.shown.length > 0),
    [data, filter, q],
  );

  function onScanned(result: ScanResult) {
    setFeedback({ tone: result.result, result, at: Date.now() });
    reload();
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <Scanner round={round} panelId={panelId} onResult={onScanned} onError={(message) => setFeedback({ tone: "error", message, at: Date.now() })} />
        {feedback && <ResultCard feedback={feedback} />}
        <p className="text-xs text-muted">
          The QR code on a student&apos;s phone changes every minute, so a screenshot stops working. Check the name and roll number against
          their college ID card.
        </p>
      </div>

      <div className="min-w-0 space-y-4">
        {sheet.error && <Notice tone="error">{sheet.error}</Notice>}
        {!data && !sheet.error && <Loading label="Loading the roster" />}
        {data && (
          <>
            <div className="grid grid-cols-3 gap-3">
              {[
                ["Present", `${present} / ${students}`],
                ["Absent", students - present],
                ["Teams complete", `${fullTeams} / ${data.teams.length}`],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-2xl bg-white px-3 py-2.5 ring-1 ring-line">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
                  <p className="font-display text-xl font-bold tabular-nums text-navy-900">{value}</p>
                </div>
              ))}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface ring-1 ring-inset ring-line" role="progressbar" aria-label="Students present" aria-valuemin={0} aria-valuemax={students} aria-valuenow={present}>
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${students ? (present / students) * 100 : 0}%` }} />
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
              <Field label="Find a student" htmlFor="desk-search">
                <div className="relative">
                  <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                  <Input id="desk-search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Name, roll number or team" className="pl-9" />
                </div>
              </Field>
              <Field label="Show" htmlFor="desk-filter">
                <Select id="desk-filter" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                  <option value="all">Everyone</option>
                  <option value="absent">Not yet present</option>
                  <option value="present">Present</option>
                </Select>
              </Field>
            </div>
            {teams.length === 0 ? (
              <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-muted ring-1 ring-line">
                {data.teams.length === 0 ? "No teams here yet." : "Nobody matches."}
              </p>
            ) : (
              <ul className="space-y-3">
                {teams.map((team) => {
                  const here = team.members.filter((m) => m.presentAt).length;
                  return (
                    <li key={team.code} className="overflow-hidden rounded-2xl bg-white ring-1 ring-line">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface/60 px-4 py-2.5">
                        <p className="min-w-0">
                          <span className="font-semibold text-navy-900">{team.name}</span>
                          <span className="ml-2 font-mono text-xs text-muted">{team.code}</span>
                          <span className="block text-xs text-muted">
                            Cat {team.category} · {categoryTitle(team.category)}
                            {team.room ? ` · ${team.room}` : ""}
                            {team.tent ? ` · Stall ${team.tent}` : ""}
                          </span>
                        </p>
                        <Pill tone={here === team.members.length ? "green" : here > 0 ? "orange" : "slate"}>
                          {here} / {team.members.length} present
                        </Pill>
                      </div>
                      <ul className="divide-y divide-line">
                        {team.shown.map((m) => (
                          <li key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                            <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${m.presentAt ? "bg-emerald-600 text-white" : "bg-surface text-muted ring-1 ring-inset ring-line"}`}>
                              {m.presentAt ? <Check aria-label="Present" className="size-4" /> : <span className="sr-only">Not present</span>}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5 font-semibold text-navy-900">
                                {m.fullName}
                                {m.role === "leader" && <Crown aria-label="Leader" className="size-3.5 text-accent-500" />}
                              </span>
                              <span className="block text-xs text-muted">
                                {m.rollNumber || "No roll number"} · {yearLabel(m.year, m.course === "School" ? "school" : "college")}, {m.course}
                                {m.presentAt && ` · ${formatTime(m.presentAt)} ${m.method === "qr" ? "by pass" : "by hand"}`}
                              </span>
                            </span>
                            {m.presentAt ? (
                              <Button size="sm" variant="ghost" onClick={() => setPending({ member: m, team: team.name, action: "unmark" })}>
                                <Undo2 aria-hidden="true" className="size-3.5" />
                                Undo
                              </Button>
                            ) : (
                              <Button size="sm" variant="secondary" onClick={() => setPending({ member: m, team: team.name, action: "mark" })}>
                                <UserCheck aria-hidden="true" className="size-3.5" />
                                Mark present
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      {pending && (
        <ManualDialog
          pending={pending}
          round={round}
          onClose={() => setPending(null)}
          onDone={(result) => {
            setPending(null);
            if (result) setFeedback({ tone: result.result, result, at: Date.now() });
            reload();
          }}
        />
      )}
    </div>
  );
}

/** Sounds and a buzz, so the desk does not need to look at the screen after every scan. */
function signal(kind: Feedback["tone"]) {
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audio = new Context();
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    tone.frequency.value = kind === "marked" ? 880 : kind === "already" ? 600 : 220;
    gain.gain.setValueAtTime(0.12, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.25);
    tone.connect(gain).connect(audio.destination);
    tone.start();
    tone.stop(audio.currentTime + 0.25);
    tone.onended = () => void audio.close();
  } catch {
    // No sound available: the card still shows the result.
  }
  navigator.vibrate?.(kind === "error" ? [80, 60, 80] : 60);
}

function Scanner({ round, panelId, onResult, onError }: { round: JudgingRound; panelId?: string; onResult: (r: ScanResult) => void; onError: (message: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const handlers = useRef({ onResult, onError });
  useEffect(() => {
    handlers.current = { onResult, onError };
  });

  useEffect(() => {
    if (!on || !video.current) return;
    const element = video.current;
    let scanner: { start: () => Promise<void>; stop: () => void; destroy: () => void } | null = null;
    let stopped = false;
    let busy = false;
    let last = { code: "", at: 0 };

    async function handle(code: string) {
      // The same code is read many times a second; act once per student, and one at a time.
      if (busy || (code === last.code && Date.now() - last.at < 4000)) return;
      last = { code, at: Date.now() };
      busy = true;
      try {
        const result = await api.scanPass(code, round, panelId);
        signal(result.result);
        handlers.current.onResult(result);
      } catch (err) {
        signal("error");
        handlers.current.onError(errorMessage(err));
      } finally {
        busy = false;
      }
    }

    import("qr-scanner").then(async ({ default: QrScanner }) => {
      if (stopped) return;
      const instance = new QrScanner(element, (result) => void handle(result.data), {
        preferredCamera: "environment",
        maxScansPerSecond: 8,
        highlightScanRegion: true,
        highlightCodeOutline: true,
        returnDetailedScanResult: true,
      });
      scanner = instance;
      try {
        await instance.start();
      } catch {
        setProblem("The camera could not start. Allow camera access for this site in the browser, or mark students by hand.");
        setOn(false);
      }
    });
    return () => {
      stopped = true;
      scanner?.stop();
      scanner?.destroy();
    };
  }, [on, round, panelId]);

  return (
    <section aria-label="Scan event passes" className="overflow-hidden rounded-2xl bg-navy-900 ring-1 ring-navy-900">
      <div className="relative aspect-square w-full bg-navy-950">
        <video ref={video} muted playsInline className={`size-full object-cover ${on ? "" : "hidden"}`} />
        {!on && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white">
            <Camera aria-hidden="true" className="size-10 text-brand-300" />
            <p className="font-display text-lg font-bold">Scan event passes</p>
            <p className="text-sm text-white/70">Point the camera at the QR code on the student&apos;s phone. It keeps scanning, one student after another.</p>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <p className="text-xs text-white/70">{on ? "Scanning… hold the phone steady" : "Camera is off"}</p>
        <button
          type="button"
          onClick={() => {
            setProblem(null);
            setOn(!on);
          }}
          className={`inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition ${on ? "bg-white/10 text-white hover:bg-white/20" : "bg-accent-500 text-white hover:bg-accent-600"}`}
        >
          {on ? <CameraOff aria-hidden="true" className="size-4" /> : <Camera aria-hidden="true" className="size-4" />}
          {on ? "Stop camera" : "Start scanning"}
        </button>
      </div>
      {problem && <p role="alert" className="bg-red-50 px-4 py-2.5 text-sm font-medium text-red-800">{problem}</p>}
    </section>
  );
}

function ResultCard({ feedback }: { feedback: Feedback }) {
  if (feedback.tone === "error") {
    return (
      <div role="status" className="flex gap-3 rounded-2xl bg-red-50 p-4 ring-1 ring-red-200">
        <XCircle aria-hidden="true" className="size-6 shrink-0 text-red-600" />
        <div>
          <p className="font-semibold text-red-900">Not marked</p>
          <p className="text-sm text-red-800">{feedback.message}</p>
        </div>
      </div>
    );
  }
  const r = feedback.result!;
  const marked = feedback.tone === "marked";
  return (
    <div role="status" className={`rounded-2xl p-4 ring-1 ${marked ? "bg-emerald-50 ring-emerald-200" : "bg-brand-50 ring-brand-100"}`}>
      <div className="flex gap-3">
        <CheckCircle2 aria-hidden="true" className={`size-7 shrink-0 ${marked ? "text-emerald-600" : "text-brand-600"}`} />
        <div className="min-w-0">
          <p className={`text-xs font-bold uppercase tracking-wider ${marked ? "text-emerald-700" : "text-brand-700"}`}>
            {marked ? "Present" : `Already marked at ${formatTime(r.markedAt)} by ${r.markedBy}`}
          </p>
          <p className="font-display text-xl font-bold text-navy-900">{r.student.fullName}</p>
          <p className="text-sm text-navy-800">
            Roll no. <span className="font-mono font-semibold">{r.student.rollNumber || "—"}</span> · {yearLabel(r.student.year, r.student.participantType)}, {r.student.course}
          </p>
          <p className="text-sm text-muted">
            {r.team.name} ({r.team.code}){r.student.role === "leader" ? " · leader" : ""}
            {r.room ? ` · ${r.room}` : ""}
          </p>
        </div>
      </div>
      {r.warning && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-accent-50 px-3 py-2 text-sm font-medium text-accent-600">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {r.warning}
        </p>
      )}
    </div>
  );
}

function ManualDialog({ pending, round, onClose, onDone }: { pending: Pending; round: JudgingRound; onClose: () => void; onDone: (result: ScanResult | null) => void }) {
  const reasons = REASONS[pending.action];
  const [reason, setReason] = useState(reasons[0]);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const note = reason === "Other" ? other.trim() : reason;

  async function save() {
    if (note.length < 3) return setError("Write the reason in a few words.");
    setBusy(true);
    setError(null);
    try {
      if (pending.action === "mark") onDone(await api.markPresent(pending.member.userId, round, note));
      else {
        await api.unmarkPresent(pending.member.userId, round, note);
        onDone(null);
      }
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={pending.action === "mark" ? `Mark ${pending.member.fullName} present?` : `Undo ${pending.member.fullName}'s attendance?`}
      description={`${pending.team} · roll no. ${pending.member.rollNumber || "—"}. Check their college ID card first. The reason goes into the activity log.`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={pending.action === "mark" ? "primary" : "danger"} onClick={save} pending={busy}>
            {pending.action === "mark" ? "Mark present" : "Undo"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Reason" htmlFor="manual-reason">
          <Select id="manual-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
            {[...reasons, "Other"].map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>
        </Field>
        {reason === "Other" && (
          <Field label="Write the reason" htmlFor="manual-other">
            <Input id="manual-other" value={other} onChange={(e) => setOther(e.target.value)} maxLength={300} autoFocus />
          </Field>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  );
}
