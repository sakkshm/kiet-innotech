"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { AlarmClock, CalendarClock, ChevronDown, Lock, LockOpen, MapPin, Pencil, Plus, Trash2, TriangleAlert, Undo2, UserCheck, UserCog, UserPlus, Users } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { Judging, Juror, Panel, PanelJuror, PanelScore, PanelTeam, TeamSummary, Timetable } from "@/lib/admin-types";
import { useAdmin } from "@/lib/auth/AuthProvider";
import { attendanceEnabled } from "@/lib/features";
import { categories, clubDepartment, departmentLabel, departments } from "@/lib/content";
import { categoryTitle, formatDateTime, plural } from "@/lib/format";
import { DEFAULT_BUFFER_MINUTES, MAX_BUFFER_MINUTES, MIN_REASON_LENGTH, reasonProblem, roomClock, roomLabel, slotLabel, timeLabel } from "@/lib/rooms";
import { teamHref } from "@/lib/routes";
import { useServerNow } from "@/lib/use-room-now";
import { useQuery } from "@/lib/use-query";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Loading, Notice } from "@/components/ui/Notice";
import { Pill } from "@/components/ui/Pill";
import { numClass, TableFrame, tdClass, Th } from "@/components/ui/Table";
import { YearChips } from "@/components/teams/YearChips";
import { AttendanceButtons } from "./AttendanceButtons";
import { HiddenMarks } from "./HiddenMarks";
import { StudentAttendance } from "./StudentAttendance";
import { RoomTimer, TimeLeftPopup, type WarningItem } from "./RoomTimer";
import { PARTS, RubricForm, TOTAL } from "./RubricForm";
import { TimetableStrip } from "./TimetableStrip";

const roomDepartments = departments.filter((d) => d !== clubDepartment);

/** The room no longer exists: another organiser deleted it (several can work on a department's rooms at once). */
const isGone = (err: unknown) => err instanceof ApiError && err.status === 404;
const GONE_MESSAGE = "That room was already deleted by another organiser. The list is up to date now.";

export function PanelsTab({ judging, reload }: { judging: Judging; reload: () => void }) {
  const admin = useAdmin();
  const isSuper = admin.role === "super_admin";
  const round = judging.round.round;
  const isRooms = round === "department";
  const [department, setDepartment] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Panel | null>(null);
  const [allotting, setAllotting] = useState<Panel | null>(null);
  const [staffing, setStaffing] = useState<Panel | null>(null);
  const [deleting, setDeleting] = useState<Panel | null>(null);
  const [changing, setChanging] = useState<{ panel: Panel; team: PanelTeam } | null>(null);
  const [buffering, setBuffering] = useState<Panel | null>(null);
  const [unlocking, setUnlocking] = useState<{ panel: Panel; juror: PanelJuror } | null>(null);
  // A judge being marked present (or un-marked): "<room id>:<judge email>" while the request runs.
  const [presenting, setPresenting] = useState<string | null>(null);
  const [presentError, setPresentError] = useState<string | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  // The server's clock, ticking every second, for each room's timer and the "15 minutes left" popup.
  const now = useServerNow(judging.serverTime);
  // A room another organiser removed: close whatever was open on it and show the current list.
  const roomGone = () => {
    setCreating(false);
    setEditing(null);
    setAllotting(null);
    setStaffing(null);
    setChanging(null);
    setBuffering(null);
    setUnlocking(null);
    setDeleting(null);
    setGone(GONE_MESSAGE);
    reload();
  };

  async function markJudge(panel: Panel, juror: PanelJuror, present: boolean) {
    setPresenting(`${panel.id}:${juror.email}`);
    setPresentError(null);
    try {
      await api.setJudgePresent(panel.id, juror.email, present);
      reload();
    } catch (err) {
      if (isGone(err)) return roomGone();
      setPresentError(errorMessage(err));
    } finally {
      setPresenting(null);
    }
  }

  // A department admin or a super admin switches a student present or absent at any time; the list refreshes after.
  async function changePresence(team: PanelTeam, userId: string, present: boolean) {
    await api.setStudentPresence(team.id, userId, present);
    reload();
  }

  const panels = department ? judging.panels.filter((p) => p.department === department) : judging.panels;
  const waiting = department ? judging.unallotted.filter((t) => t.department === department) : judging.unallotted;
  const waitingByDepartment = Object.entries(
    judging.unallotted.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.department ?? "Other"]: (acc[t.department ?? "Other"] ?? 0) + 1 }), {}),
  ).sort((a, b) => b[1] - a[1]);
  const buildings = [...new Set(judging.panels.map((p) => p.building).filter(Boolean))].sort();
  // "15 minutes left": the rooms this organiser looks after whose slot is about to end.
  const warnings: WarningItem[] = judging.panels.flatMap((panel) => {
    const clock = roomClock(panel.slotStart, panel.slotEnd, panel.scoringUntil, now);
    if (!panel.canEdit || clock?.phase !== "slot" || !clock.warn) return [];
    const open = panel.jurors.filter((j) => !j.locked).length;
    return [
      {
        id: panel.id,
        room: roomLabel(panel),
        slotEnd: panel.slotEnd!,
        msLeft: clock.msLeft,
        detail: panel.jurors.length ? `${open} of ${plural(panel.jurors.length, "judge")} still ${open === 1 ? "has" : "have"} to lock their marks.` : "This room has no judges yet.",
        note: panel.bufferMinutes > 0 ? `Judges get ${panel.bufferMinutes} extra minutes after the slot, then their marks lock by themselves.` : "Judges' marks lock by themselves when the slot ends.",
      },
    ];
  });

  return (
    <div className="space-y-5">
      {isRooms && <TimetableStrip judging={judging} onSaved={reload} />}
      <div className="flex flex-wrap items-end justify-between gap-3">
        {isRooms && isSuper ? (
          <Field label="Department" htmlFor="rooms-department" className="w-56">
            <Select id="rooms-department" value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">All departments</option>
              {roomDepartments.map((d) => (
                <option key={d} value={d}>{departmentLabel(d)}</option>
              ))}
            </Select>
          </Field>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap gap-2">
          {round === "final" && <AttendanceButtons round="final" label="every finale team" />}
          {isRooms && !isSuper && admin.department && (
            <div className="flex flex-col items-end gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Every {admin.department} team, all rooms</span>
              <AttendanceButtons round="department" department={admin.department} label={`all ${admin.department} teams`} />
            </div>
          )}
          {judging.canCreate && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" className="size-4" />
              {isRooms ? "New room" : "New panel"}
            </Button>
          )}
        </div>
      </div>

      {waiting.length > 0 ? (
        <Notice tone="warning" title={`${plural(waiting.length, "team")} not yet allotted to a ${isRooms ? "room" : "panel"}`}>
          {isRooms && !department && waitingByDepartment.length > 1 ? (
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              {waitingByDepartment.map(([d, count]) => (
                <button key={d} type="button" onClick={() => setDepartment(d)} className="font-semibold text-brand-700 hover:underline">
                  {d}: {count}
                </button>
              ))}
            </span>
          ) : (
            <span>
              {waiting.slice(0, 12).map((t) => t.code).join(", ")}
              {waiting.length > 12 ? "…" : ""}
            </span>
          )}
        </Notice>
      ) : (
        judging.panels.length > 0 && <Notice tone="success">Every eligible team is allotted.</Notice>
      )}

      {panels.length === 0 ? (
        <EmptyState title={isRooms ? "No rooms yet" : "No finale panels yet"}>
          {judging.canCreate
            ? isRooms
              ? "Create a room for each time slot: its building, the room, and when it runs. Then allot teams and add judges from other departments."
              : "Create the finale panels (the plan: 8 panels of 2 external judges), then allot teams and judges."
            : "Organisers have not set up rooms for this round yet."}
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {panels.map((panel) => (
            <PanelCard
              key={panel.id}
              panel={panel}
              now={now}
              showMarks={panel.teams.some((t) => t.judgeScores !== null)}
              presenting={presenting}
              onPresence={changePresence}
              onJudgePresent={(juror, present) => markJudge(panel, juror, present)}
              onBuffer={() => setBuffering(panel)}
              onUnlock={(juror) => setUnlocking({ panel, juror })}
              onEdit={() => setEditing(panel)}
              onAllot={() => setAllotting(panel)}
              onStaff={() => setStaffing(panel)}
              onDelete={() => setDeleting(panel)}
              onChangeScore={(team) => setChanging({ panel, team })}
            />
          ))}
        </div>
      )}

      <TimeLeftPopup items={warnings} />
      {presentError && (
        <div className="mb-4">
          <Notice tone="error">{presentError}</Notice>
        </div>
      )}
      {gone && (
        <div className="mb-4">
          <Notice tone="info">{gone}</Notice>
        </div>
      )}
      {(creating || editing) && (
        <PanelFormDialog
          round={round}
          panel={editing}
          buildings={buildings}
          timetable={judging.timetable}
          defaultDepartment={isSuper ? department : (admin.department ?? "")}
          fixedDepartment={!isSuper}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onGone={roomGone}
          onSaved={() => {
            setGone(null);
            setCreating(false);
            setEditing(null);
            reload();
          }}
        />
      )}
      {allotting && (
        <AllotTeamsDialog
          panel={allotting}
          candidates={[...allotting.teams, ...judging.unallotted.filter((t) => round === "final" || t.department === allotting.department)]}
          onClose={() => setAllotting(null)}
          onGone={roomGone}
          onSaved={() => {
            setAllotting(null);
            reload();
          }}
        />
      )}
      {staffing && (
        <PanelJudgesDialog
          panel={staffing}
          onClose={() => setStaffing(null)}
          onGone={roomGone}
          onSaved={() => {
            setStaffing(null);
            reload();
          }}
        />
      )}
      {buffering && (
        <BufferDialog
          panel={buffering}
          onClose={() => setBuffering(null)}
          onGone={roomGone}
          onSaved={() => {
            setBuffering(null);
            reload();
          }}
        />
      )}
      {unlocking && (
        <UnlockDialog
          panel={unlocking.panel}
          juror={unlocking.juror}
          onClose={() => setUnlocking(null)}
          onGone={roomGone}
          onSaved={() => {
            setUnlocking(null);
            reload();
          }}
        />
      )}
      {changing && (
        <ChangeScoreDialog
          panel={changing.panel}
          team={changing.team}
          onClose={() => setChanging(null)}
          onSaved={() => {
            setChanging(null);
            reload();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${roomLabel(deleting)}?`}
          description="Its teams go back to the unallotted list and its judges are freed. Not possible once any team here has been scored."
          confirmLabel="Delete"
          tone="danger"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await api.deletePanel(deleting.id);
              setGone(null);
            } catch (err) {
              // Already deleted by someone else: the goal is met, so refresh instead of failing again and again.
              if (!isGone(err)) throw err;
              setGone(GONE_MESSAGE);
            }
            setDeleting(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function PanelCard({
  panel,
  now,
  showMarks,
  presenting,
  onPresence,
  onJudgePresent,
  onBuffer,
  onUnlock,
  onEdit,
  onAllot,
  onStaff,
  onDelete,
  onChangeScore,
}: {
  panel: Panel;
  now: number;
  showMarks: boolean;
  /** "<room id>:<judge email>" of the judge whose attendance is being saved. */
  presenting: string | null;
  /** Switches a student of a team in this room present or absent. */
  onPresence: (team: PanelTeam, userId: string, present: boolean) => Promise<void>;
  onJudgePresent: (juror: PanelJuror, present: boolean) => void;
  onBuffer: () => void;
  onUnlock: (juror: PanelJuror) => void;
  onEdit: () => void;
  onAllot: () => void;
  onStaff: () => void;
  onDelete: () => void;
  onChangeScore: (team: PanelTeam) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [studentsOpen, setStudentsOpen] = useState<string | null>(null);
  const final = panel.round === "final";
  const scored = panel.teams.reduce((sum, t) => sum + t.scores, 0);
  const expected = panel.teams.length * panel.jurors.length;
  const students = panel.teams.reduce((sum, t) => sum + t.memberCount, 0);
  const present = panel.teams.reduce((sum, t) => sum + t.present, 0);
  const judgesPresent = panel.jurors.filter((j) => j.presentAt).length;
  const seat = (juror: PanelJuror | undefined, label: string) => (
    <JudgeSeat
      key={juror?.email ?? label}
      label={label}
      juror={juror}
      canUnlock={panel.canEditMarks}
      onUnlock={onUnlock}
      canMark={panel.canEdit}
      busy={juror ? presenting === `${panel.id}:${juror.email}` : false}
      onPresent={onJudgePresent}
    />
  );
  const slot = slotLabel(panel.slotStart, panel.slotEnd);
  const clock = roomClock(panel.slotStart, panel.slotEnd, panel.scoringUntil, now);
  const label = roomLabel(panel);
  // Marks that were changed after the judge saved them: what a super admin looks for.
  const changed = panel.teams.flatMap((t) => t.judgeScores ?? []).filter((x) => x.editCount > 0 || x.editedBy);

  return (
    <article aria-labelledby={`panel-${panel.id}`} className="overflow-hidden rounded-3xl bg-white ring-1 ring-line">
      <header className="border-b border-line px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id={`panel-${panel.id}`} className="flex flex-wrap items-center gap-2 font-display text-xl font-bold text-navy-900">
              {label}
              {panel.department && <Pill tone="navy">{panel.department} teams</Pill>}
              {clock && <RoomTimer clock={clock} />}
              {changed.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-500 px-2.5 py-0.5 text-[11px] font-bold text-white" title="Marks changed after the judge saved them">
                  <TriangleAlert aria-hidden="true" className="size-3" />
                  {plural(changed.length, "changed mark")}
                </span>
              )}
            </h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
              {slot && (
                <span className="inline-flex items-center gap-1.5 font-medium text-navy-800">
                  <CalendarClock aria-hidden="true" className="size-4 text-brand-600" />
                  {slot}
                </span>
              )}
              {panel.location && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin aria-hidden="true" className="size-4" />
                  {panel.location}
                </span>
              )}
            </p>
            {panel.slotStart && panel.scoringUntil && (
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                <span>
                  Judges can save marks {timeLabel(panel.slotStart)} – {timeLabel(panel.scoringUntil)}: the slot plus a buffer of{" "}
                  <strong className="text-navy-900">{panel.bufferMinutes} min</strong>.
                </span>
                {panel.canEdit && (
                  <button type="button" onClick={onBuffer} className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline">
                    <AlarmClock aria-hidden="true" className="size-3.5" />
                    Change buffer
                  </button>
                )}
              </p>
            )}
          </div>
          <AttendanceButtons round={panel.round} panelId={panel.id} label={label} />
        </div>

        <dl className={`mt-4 grid grid-cols-2 gap-2.5 ${attendanceEnabled ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
          <Stat label="Teams" value={panel.teams.length} />
          {attendanceEnabled && <Stat label="Students present" value={`${present} / ${students}`} bar={students ? present / students : 0} tone="emerald" />}
          <Stat
            label="Judges present"
            value={panel.jurors.length ? `${judgesPresent} / ${panel.jurors.length}` : "—"}
            bar={panel.jurors.length ? judgesPresent / panel.jurors.length : 0}
            tone="emerald"
            warn={panel.jurors.length === 0 && panel.teams.length > 0}
          />
          <Stat label="Scores in" value={expected ? `${scored} / ${expected}` : "—"} bar={expected ? scored / expected : 0} tone="brand" />
        </dl>

        {panel.round === "department" ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {seat(panel.jurors.find((j) => j.parentDepartment), "Parent department judge")}
            {seat(panel.jurors.find((j) => !j.parentDepartment), "Judge from another department")}
          </div>
        ) : (
        <div className="mt-3">
          {panel.jurors.length === 0 ? (
            <span className="text-sm font-medium text-accent-600">No judges yet</span>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">{panel.jurors.map((j) => seat(j, "Judge"))}</div>
          )}
        </div>
        )}

        {panel.canEdit && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" onClick={onAllot}>
              <Users aria-hidden="true" className="size-3.5" />
              Teams
            </Button>
            <Button size="sm" variant="secondary" onClick={onStaff}>
              <UserCog aria-hidden="true" className="size-3.5" />
              Judges
            </Button>
            <Button size="sm" variant="ghost" onClick={onEdit}>
              <Pencil aria-hidden="true" className="size-3.5" />
              Edit room
            </Button>
            <Button size="sm" variant="ghost" className="text-red-700" onClick={onDelete} aria-label={`Delete ${label}`}>
              <Trash2 aria-hidden="true" className="size-3.5" />
            </Button>
          </div>
        )}
      </header>
      {panel.teams.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">No teams allotted yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {final && <Th>Stall</Th>}
                <Th>Team</Th>
                <Th>Project</Th>
                <Th>Category</Th>
                <Th>Years</Th>
                {!final && <Th>Students</Th>}
                {attendanceEnabled && <Th className={numClass}>Present</Th>}
                <Th className={numClass}>Scores</Th>
                <Th className={numClass}>Average /50</Th>
              </tr>
            </thead>
            <tbody>
              {panel.teams.map((team) => (
                <TeamRows
                  key={team.id}
                  team={team}
                  final={final}
                  judges={panel.jurors.length}
                  showMarks={showMarks}
                  canEditMarks={panel.canEditMarks}
                  canMarkStudents={panel.canEdit}
                  studentsOpen={studentsOpen === team.id}
                  onStudents={() => setStudentsOpen(studentsOpen === team.id ? null : team.id)}
                  onPresence={(userId, present) => onPresence(team, userId, present)}
                  open={open === team.id}
                  onToggle={() => setOpen(open === team.id ? null : team.id)}
                  onChange={() => onChangeScore(team)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function JudgeSeat({
  label,
  juror,
  canUnlock,
  onUnlock,
  canMark,
  busy,
  onPresent,
}: {
  label: string;
  juror: PanelJuror | undefined;
  canUnlock: boolean;
  onUnlock: (juror: PanelJuror) => void;
  /** The viewer may mark this judge present (super admins, and a department's admin for their own rooms). */
  canMark: boolean;
  busy: boolean;
  onPresent: (juror: PanelJuror, present: boolean) => void;
}) {
  const here = !!juror?.presentAt;
  return (
    <div className={`flex items-start gap-3 rounded-2xl px-3 py-2.5 ring-1 ring-inset ${!juror ? "bg-accent-50 ring-accent-100" : here ? "bg-emerald-50/60 ring-emerald-200" : "bg-white ring-line"}`}>
      <span className={`relative mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${juror ? "bg-navy-900 text-white" : "bg-white text-accent-600 ring-1 ring-inset ring-accent-100"}`}>
        <UserCog aria-hidden="true" className="size-4" />
        {here && <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full bg-emerald-500 ring-2 ring-white" aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
        {juror ? (
          <span className="block truncate font-semibold text-navy-900" title={juror.email}>
            {juror.name}
            <span className="font-normal text-muted"> · {juror.kind === "faculty" ? juror.department : juror.organisation}</span>
          </span>
        ) : (
          <span className="block text-sm font-semibold text-accent-600">Not chosen yet</span>
        )}
        {juror && (
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {here ? (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800"
                title={juror.presentBy ? `Marked present by ${juror.presentBy}` : undefined}
              >
                <UserCheck aria-hidden="true" className="size-3" />
                Present · {timeLabel(juror.presentAt!)}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Not here yet</span>
            )}
            {canMark &&
              (here ? (
                <button
                  type="button"
                  onClick={() => onPresent(juror, false)}
                  disabled={busy}
                  aria-label={`Undo ${juror.name}'s attendance`}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-navy-900 hover:underline disabled:opacity-50"
                >
                  <Undo2 aria-hidden="true" className="size-3" />
                  Undo
                </button>
              ) : (
                <Button size="sm" variant="secondary" className="!h-7 !px-3 !text-xs" onClick={() => onPresent(juror, true)} pending={busy}>
                  <UserCheck aria-hidden="true" className="size-3.5" />
                  Mark present
                  <span className="sr-only"> for {juror.name}</span>
                </Button>
              ))}
          </span>
        )}
        {juror?.locked && (
          <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-navy-800">
            <Lock aria-hidden="true" className="size-3" />
            Marks locked
            {canUnlock && (
              <button type="button" onClick={() => onUnlock(juror)} className="ml-1 inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline">
                <LockOpen aria-hidden="true" className="size-3" />
                Unlock
              </button>
            )}
          </span>
        )}
      </span>
    </div>
  );
}

function Stat({ label, value, bar, tone, warn }: { label: string; value: ReactNode; bar?: number; tone?: "emerald" | "brand"; warn?: boolean }) {
  return (
    <div className={`rounded-2xl px-3 py-2.5 ring-1 ring-inset ${warn ? "bg-accent-50 ring-accent-100" : "bg-surface/70 ring-line"}`}>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="font-display text-xl font-bold tabular-nums text-navy-900">{value}</dd>
      {bar !== undefined && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white ring-1 ring-inset ring-line">
          <div className={`h-full rounded-full ${tone === "emerald" ? "bg-emerald-500" : "bg-brand-500"}`} style={{ width: `${Math.round(bar * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

function TeamRows({
  team,
  final,
  judges,
  showMarks,
  canEditMarks,
  canMarkStudents,
  studentsOpen,
  onStudents,
  onPresence,
  open,
  onToggle,
  onChange,
}: {
  team: PanelTeam;
  final: boolean;
  judges: number;
  showMarks: boolean;
  /** The viewer may change the judges' marks right now. */
  canEditMarks: boolean;
  /** The viewer may switch this team's students present or absent (any time). */
  canMarkStudents: boolean;
  studentsOpen: boolean;
  onStudents: () => void;
  onPresence: (userId: string, present: boolean) => Promise<void>;
  open: boolean;
  onToggle: () => void;
  onChange: () => void;
}) {
  const columns = 7 + (attendanceEnabled ? 1 : 0);
  const here = team.memberCount - team.absent;
  return (
    <>
      <tr className="hover:bg-surface/70">
        {final && <td className={`${tdClass} font-mono text-xs font-bold`}>{team.tent ?? "—"}</td>}
        <td className={tdClass}>
          <Link href={teamHref(team.id)} className="font-semibold text-navy-900 hover:text-brand-700 hover:underline">
            {team.name}
          </Link>
          <span className="block text-xs text-muted">
            {team.code} · {team.leaderName}
            {team.status !== "submitted" && <span className="font-semibold text-red-700"> · {team.status}</span>}
          </span>
        </td>
        <td className={`${tdClass} max-w-[16rem]`}>
          <span className="line-clamp-2 text-navy-800">{team.projectTitle}</span>
        </td>
        <td className={tdClass} title={categoryTitle(team.category)}>
          <span className="font-display font-bold text-navy-900">{team.category}</span>
          <span className="ml-1 hidden text-xs text-muted xl:inline">{categoryTitle(team.category)}</span>
        </td>
        <td className={tdClass}>
          <YearChips years={team.memberYears} type={team.participantType} />
        </td>
        {!final && (
          <td className={tdClass}>
            <button
              type="button"
              onClick={onStudents}
              aria-expanded={studentsOpen}
              aria-label={`Students' attendance for ${team.name}`}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset transition hover:bg-surface ${
                team.allAbsent ? "bg-red-50 text-red-700 ring-red-200" : team.absent > 0 ? "bg-accent-50 text-accent-600 ring-accent-100" : "bg-white text-navy-800 ring-line"
              }`}
            >
              {team.allAbsent ? "All absent: scores 0" : team.absent > 0 ? `${here} / ${team.memberCount} here · ${team.absent} absent` : `${team.memberCount} / ${team.memberCount} here`}
              <ChevronDown aria-hidden="true" className={`size-3.5 transition ${studentsOpen ? "rotate-180" : ""}`} />
            </button>
          </td>
        )}
        {attendanceEnabled && (
          <td className={`${tdClass} ${numClass}`}>
            <span className={team.present === team.memberCount ? "font-semibold text-emerald-700" : team.present ? "font-semibold text-accent-600" : "text-muted"}>
              {team.present} / {team.memberCount}
            </span>
          </td>
        )}
        <td className={`${tdClass} ${numClass}`}>
          {team.scores} / {judges}
          {team.judgeScores?.some((x) => x.editCount > 0 || x.editedBy) && (
            <span title="Marks were changed after the judge saved them" className="ml-1.5 inline-flex align-middle text-accent-500">
              <TriangleAlert aria-label="Marks were changed after saving" className="size-3.5" />
            </span>
          )}
        </td>
        <td className={`${tdClass} ${numClass}`}>
          <span className="inline-flex items-center justify-end gap-1">
            {team.average === null ? <span className="text-muted">—</span> : <HiddenMarks value={team.average} label={`the average for ${team.name}`} size="sm" />}
            {showMarks && (
              <button type="button" onClick={onToggle} aria-expanded={open} aria-label={`Each judge's marks for ${team.name}`} className="inline-flex size-8 items-center justify-center rounded-full text-navy-800 hover:bg-surface">
                <ChevronDown aria-hidden="true" className={`size-4 transition ${open ? "rotate-180" : ""}`} />
              </button>
            )}
          </span>
        </td>
      </tr>
      {!final && studentsOpen && (
        <tr>
          <td colSpan={columns} className="border-b border-line bg-surface/60 px-4 py-3">
            <div className="max-w-xl space-y-2">
              <p className="text-xs text-muted">
                Everyone counts as present until switched off, and a team whose students are all absent scores 0.{" "}
                {canMarkStudents ? "You can change this at any time." : "Judges and the department's admin change it."}
              </p>
              <StudentAttendance members={team.members} canEdit={canMarkStudents} onChange={onPresence} />
            </div>
          </td>
        </tr>
      )}
      {showMarks && open && (
        <tr>
          <td colSpan={columns} className="border-b border-line bg-surface/60 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              {team.judgeScores && team.judgeScores.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {team.judgeScores.map((s) => (
                    <JudgeScoreChip key={s.jurorEmail} score={s} team={team.name} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No marks submitted yet.</p>
              )}
              {canEditMarks ? (
                <Button size="sm" variant="secondary" onClick={onChange}>
                  <Pencil aria-hidden="true" className="size-3.5" />
                  Change or enter marks
                </Button>
              ) : (
                <p className="max-w-xs text-xs text-muted">Marks can be changed during this room&apos;s slot and its buffer, or by a super admin.</p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function JudgeScoreChip({ score, team }: { score: PanelScore; team: string }) {
  const changed = score.editCount > 0 || !!score.editedBy;
  return (
    <li className={`flex max-w-sm items-center gap-2 rounded-xl px-3 py-1.5 ring-1 ${changed ? "bg-accent-50 ring-2 ring-accent-500" : "bg-white ring-line"}`}>
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-xs font-semibold text-navy-900">
          {score.jurorName}
          {score.locked && <Lock aria-label="Locked" className="size-3 text-muted" />}
        </span>
        <span className="block text-[11px] text-muted">
          {formatDateTime(score.updatedAt)}
          {score.editedBy && ` · changed by ${score.editedBy}`}
        </span>
        {changed && (
          <span className="mt-0.5 block text-[11px] font-semibold text-accent-600">
            <TriangleAlert aria-hidden="true" className="mr-1 inline size-3 align-[-1px]" />
            Changed {score.editCount > 0 ? `${score.editCount}×` : "by an organiser"}
            {score.editReason ? `: “${score.editReason}”` : ""}
          </span>
        )}
      </span>
      <HiddenMarks value={score.total} label={`${score.jurorName}'s marks for ${team}`} size="sm" />
    </li>
  );
}

/** "2026-10-22" and "10:00" in IST from an ISO time. */
function istParts(iso: string | null) {
  if (!iso) return { date: "", time: "" };
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function PanelFormDialog({
  round,
  panel,
  buildings,
  timetable,
  defaultDepartment,
  fixedDepartment,
  onClose,
  onSaved,
  onGone,
}: {
  round: Judging["round"]["round"];
  panel: Panel | null;
  buildings: string[];
  timetable: Timetable | null;
  defaultDepartment: string;
  fixedDepartment: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** The room being edited was deleted meanwhile. */
  onGone: () => void;
}) {
  const isRoom = round === "department";
  // A new room starts at its department's slot in the timetable.
  const slotOf = (d: string) => timetable?.slots.find((s) => s.department === d) ?? null;
  const planned = panel ? null : slotOf(defaultDepartment);
  const start = istParts(panel?.slotStart ?? planned?.slotStart ?? null);
  const end = istParts(panel?.slotEnd ?? planned?.slotEnd ?? null);
  const [building, setBuilding] = useState(panel?.building ?? "");
  const [name, setName] = useState(panel?.name ?? "");
  const [location, setLocation] = useState(panel?.location ?? "");
  const [date, setDate] = useState(start.date);
  const [from, setFrom] = useState(start.time);
  const [to, setTo] = useState(end.time);
  const [buffer, setBuffer] = useState(String(panel?.bufferMinutes ?? DEFAULT_BUFFER_MINUTES));
  const [department, setDepartment] = useState(panel?.department ?? defaultDepartment);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    const wantsSlot = isRoom || from || to;
    if (isRoom && !building.trim()) return setError("Enter the building, e.g. “G Block”.");
    if (!name.trim()) return setError(isRoom ? "Enter the room, e.g. “112” or “Seminar Hall 2”." : "Give the panel a name, e.g. “Panel A”.");
    if (wantsSlot && (!date || !from || !to)) return setError("Give the date and the start and end time.");
    if (wantsSlot && to <= from) return setError("The slot must end after it starts.");
    if (isRoom && !panel && !department) return setError("Choose the department whose teams are judged here.");
    const bufferMinutes = Number(buffer);
    if (isRoom && (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > MAX_BUFFER_MINUTES)) {
      return setError(`The buffer is a whole number of minutes from 0 to ${MAX_BUFFER_MINUTES}.`);
    }
    const place = {
      building: building.trim(),
      name: name.trim(),
      location: location.trim(),
      slotStart: wantsSlot ? `${date}T${from}:00+05:30` : null,
      slotEnd: wantsSlot ? `${date}T${to}:00+05:30` : null,
      bufferMinutes: isRoom ? bufferMinutes : DEFAULT_BUFFER_MINUTES,
    };
    setPending(true);
    setError(null);
    try {
      if (panel) await api.updatePanel(panel.id, place);
      else await api.createPanel({ round, ...place, department: isRoom ? department : null });
      onSaved();
    } catch (err) {
      if (panel && isGone(err)) return onGone();
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <Dialog
      title={panel ? `Edit ${roomLabel(panel)}` : isRoom ? "New room" : "New finale panel"}
      description={
        isRoom
          ? "A room judges one department's teams in one time slot. The same room can host another department at another time."
          : "A finale panel judges the teams you allot to it, usually one or two categories."
      }
      onClose={onClose}
      busy={pending}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} pending={pending}>
            {panel ? "Save changes" : isRoom ? "Create room" : "Create panel"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={isRoom ? "Building" : "Building (optional)"} htmlFor="panel-building">
          <Input id="panel-building" list="known-buildings" value={building} onChange={(e) => setBuilding(e.target.value)} maxLength={60} placeholder="G Block" />
          <datalist id="known-buildings">
            {buildings.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </Field>
        <Field label={isRoom ? "Room" : "Panel name"} htmlFor="panel-name">
          <Input id="panel-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={isRoom ? "112" : "Panel A · Categories 1 and 2"} />
        </Field>
        <Field label="Date" htmlFor="panel-date">
          <Input id="panel-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" htmlFor="panel-from">
            <Input id="panel-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} step={300} />
          </Field>
          <Field label="To" htmlFor="panel-to">
            <Input id="panel-to" type="time" value={to} onChange={(e) => setTo(e.target.value)} step={300} />
          </Field>
        </div>
        {isRoom && (
          <Field
            label="Buffer after the slot (minutes)"
            htmlFor="panel-buffer"
            hint={`Extra time for the judges to submit their marks once the slot ends. ${DEFAULT_BUFFER_MINUTES} by default, at most ${MAX_BUFFER_MINUTES}.`}
            className="sm:col-span-2"
          >
            <Input id="panel-buffer" type="number" inputMode="numeric" min={0} max={MAX_BUFFER_MINUTES} step={5} value={buffer} onChange={(e) => setBuffer(e.target.value)} />
          </Field>
        )}
        <Field label="Directions (optional)" htmlFor="panel-location" hint="Printed on the room's roster and shown to students with their room." className="sm:col-span-2">
          <Input id="panel-location" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} placeholder="2nd floor, next to the lift" />
        </Field>
        {isRoom && !panel && (
          <Field label="Department whose teams are judged here" htmlFor="panel-department" className="sm:col-span-2">
            {fixedDepartment ? (
              <Input id="panel-department" value={departmentLabel(department)} disabled />
            ) : (
              <Select
                id="panel-department"
                value={department}
                onChange={(e) => {
                  setDepartment(e.target.value);
                  const slot = slotOf(e.target.value);
                  if (slot?.slotStart && slot.slotEnd) {
                    setDate(istParts(slot.slotStart).date);
                    setFrom(istParts(slot.slotStart).time);
                    setTo(istParts(slot.slotEnd).time);
                  }
                }}
              >
                <option value="">Choose a department</option>
                {roomDepartments.map((d) => (
                  <option key={d} value={d}>{departmentLabel(d)}</option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <p className="text-xs text-muted sm:col-span-2">
          Times are Indian Standard Time.{" "}
          {isRoom && "The date and time come from the department timetable; change them only if this room runs at a different time."}
        </p>
        {error && (
          <div className="sm:col-span-2">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function AllotTeamsDialog({ panel, candidates, onClose, onSaved, onGone }: { panel: Panel; candidates: TeamSummary[]; onClose: () => void; onSaved: () => void; onGone: () => void }) {
  const [chosen, setChosen] = useState(() => new Set(panel.teams.map((t) => t.id)));
  const [category, setCategory] = useState(0);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const q = text.trim().toLowerCase();
  const shown = candidates.filter(
    (t) => (!category || t.category === category) && (!q || [t.name, t.code, t.institution, t.leaderName, t.projectTitle].some((v) => v.toLowerCase().includes(q))),
  );
  const students = candidates.filter((t) => chosen.has(t.id)).reduce((sum, t) => sum + t.memberCount, 0);
  const toggle = (id: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function save() {
    setPending(true);
    setError(null);
    try {
      await api.setPanelTeams(panel.id, [...chosen]);
      onSaved();
    } catch (err) {
      if (isGone(err)) return onGone();
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <Dialog
      title={`Teams in ${roomLabel(panel)}`}
      description={
        panel.department
          ? `Submitted ${panel.department} teams not yet in another room. A room can mix categories; each team is marked on its own category's rubric.`
          : "Finalists and teams from other colleges and schools not yet on another panel."
      }
      onClose={onClose}
      busy={pending}
      size="xl"
      footer={
        <>
          <span className="mr-auto self-center text-sm text-muted">
            {plural(chosen.size, "team")} · {plural(students, "student")}
          </span>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} pending={pending}>
            Save allotment
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_16rem]">
          <Field label="Search" htmlFor="allot-search">
            <Input id="allot-search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Team, code, leader or project" />
          </Field>
          <Field label="Problem statement (category)" htmlFor="allot-category">
            <Select id="allot-category" value={category} onChange={(e) => setCategory(Number(e.target.value))}>
              <option value={0}>All categories</option>
              {categories.map((c) => (
                <option key={c.number} value={c.number}>
                  {c.number}. {c.title} ({candidates.filter((t) => t.category === c.number).length})
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Button size="sm" variant="secondary" onClick={() => shown.forEach((t) => toggle(t.id, true))} disabled={shown.length === 0}>
            Select all shown ({shown.length})
          </Button>
          <Button size="sm" variant="ghost" onClick={() => shown.forEach((t) => toggle(t.id, false))} disabled={shown.length === 0}>
            Clear shown
          </Button>
        </div>
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No teams to allot{category || q ? " with these filters" : ""}.</p>
        ) : (
          <TableFrame label="Teams to allot" minWidth="min-w-[720px]">
            <thead>
              <tr>
                <Th className="w-10">
                  <span className="sr-only">Allotted</span>
                </Th>
                <Th>Team</Th>
                <Th>Project</Th>
                <Th>Category</Th>
                <Th>Years</Th>
                <Th className={numClass}>Members</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} className={chosen.has(t.id) ? "bg-brand-50/70" : ""}>
                  <td className={tdClass}>
                    <Checkbox label={`Allot ${t.name}`} checked={chosen.has(t.id)} onChange={(on) => toggle(t.id, on)} />
                  </td>
                  <td className={tdClass}>
                    <span className="font-semibold text-navy-900">{t.name}</span>
                    <span className="block text-xs text-muted">
                      {t.code} · {t.leaderName}
                    </span>
                  </td>
                  <td className={`${tdClass} max-w-[16rem] text-navy-800`}>
                    <span className="line-clamp-2">{t.projectTitle}</span>
                  </td>
                  <td className={tdClass} title={categoryTitle(t.category)}>
                    {t.category}
                  </td>
                  <td className={tdClass}>
                    <YearChips years={t.memberYears} type={t.participantType} />
                  </td>
                  <td className={`${tdClass} ${numClass}`}>{t.memberCount}</td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  );
}

/** The room or panel of the same round where this judge already sits, if any (a judge sits in one room). */
function sitsElsewhere(juror: Juror, panel: Panel) {
  return juror.panels.find((p) => p.round === panel.round && p.id !== panel.id) ?? null;
}

function elsewhereLabel(p: Juror["panels"][number]) {
  return `${p.building ? `${p.building} · ` : ""}${p.name}${p.department ? ` (${p.department})` : ""}`;
}

function JudgeOption({ juror, panel, name, checked, onPick }: { juror: Juror; panel: Panel; name: string; checked: boolean; onPick: () => void }) {
  const busy = sitsElsewhere(juror, panel);
  return (
    <li>
      <label className={`flex items-start gap-3 px-3 py-2.5 ${busy ? "cursor-not-allowed bg-surface/70" : "cursor-pointer hover:bg-brand-50/60"} ${checked ? "bg-brand-50" : ""}`}>
        <input type="radio" name={name} className="mt-1 accent-accent-500" checked={checked} disabled={!!busy} onChange={onPick} />
        <span className="min-w-0 flex-1">
          <span className={`block font-semibold ${busy ? "text-muted" : "text-navy-900"}`}>{juror.name}</span>
          <span className="block truncate text-xs text-muted">
            {juror.email} · {juror.kind === "faculty" ? juror.department : `Outside expert, ${juror.organisation}`}
          </span>
          {busy && <span className="mt-0.5 inline-block rounded-full bg-accent-50 px-2 py-0.5 text-[11px] font-semibold text-accent-600">Judging in {elsewhereLabel(busy)}</span>}
        </span>
      </label>
    </li>
  );
}

function PanelJudgesDialog({ panel, onClose, onSaved, onGone }: { panel: Panel; onClose: () => void; onSaved: () => void; onGone: () => void }) {
  const jurors = useQuery("jurors", () => api.listJurors());
  const seats = panel.round === "department";
  // Department rooms: two seats, one judge from the room's department and one from another department.
  const [own, setOwn] = useState(panel.jurors.find((j) => j.department === panel.department)?.email ?? "");
  const [other, setOther] = useState(panel.jurors.find((j) => j.department !== panel.department)?.email ?? "");
  // Finale panels: any judges.
  const [chosen, setChosen] = useState(() => new Set(panel.jurors.map((j) => j.email)));
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const all = jurors.data ?? [];
  const picked = seats ? [own, other].filter(Boolean) : [...chosen];
  const q = text.trim().toLowerCase();
  const matches = (j: Juror) => !q || [j.name, j.email, j.department ?? "", j.organisation].some((v) => v.toLowerCase().includes(q));
  // Free judges first, then those already in another room.
  const order = (list: Juror[]) => [...list].sort((a, b) => Number(!!sitsElsewhere(a, panel)) - Number(!!sitsElsewhere(b, panel)) || a.name.localeCompare(b.name));
  const ownList = order(all.filter((j) => j.department === panel.department && (j.email === own || matches(j))));
  const otherList = order(all.filter((j) => j.department !== panel.department && (j.email === other || matches(j))));

  async function save() {
    setPending(true);
    setError(null);
    try {
      await api.setPanelJurors(panel.id, picked.map((email) => ({ email })));
      onSaved();
    } catch (err) {
      if (isGone(err)) return onGone();
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <Dialog
      title={`Judges for ${roomLabel(panel)}`}
      description={
        seats
          ? `Two judges: the parent department judge (from ${panel.department}) and one from another department. A judge sits in one room only.`
          : "The plan is two outside experts per finale panel. A judge sits on one panel only."
      }
      onClose={onClose}
      busy={pending}
      size="xl"
      footer={
        <>
          <span className="mr-auto self-center text-sm text-muted">
            {seats ? `${picked.length} of 2 chosen` : `${picked.length} chosen`}
            {seats && picked.length < 2 && " · scoring can open once both are chosen"}
          </span>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} pending={pending}>
            Save judges
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {adding ? (
          <NewJudgeForm
            panel={panel}
            onCancel={() => setAdding(false)}
            onAdded={(juror) => {
              setAdding(false);
              if (!seats) setChosen((current) => new Set(current).add(juror.email));
              else if (juror.department === panel.department) setOwn(juror.email);
              else setOther(juror.email);
              jurors.reload();
            }}
          />
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Find a judge" htmlFor="judge-search" className="min-w-0 flex-1">
              <Input id="judge-search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Name, email or department" />
            </Field>
            <Button variant="secondary" onClick={() => setAdding(true)}>
              <UserPlus aria-hidden="true" className="size-4" />
              Add a new judge
            </Button>
          </div>
        )}
        {jurors.error && <Notice tone="error">{jurors.error}</Notice>}
        {!jurors.data && !jurors.error && <Loading label="Loading judges" />}

        {jurors.data && seats && (
          <div className="grid gap-4 lg:grid-cols-2">
            {[
              { key: "own", title: `1 · Parent department judge (${panel.department})`, list: ownList, value: own, set: setOwn, empty: `No ${panel.department} faculty added yet. Use “Add a new judge”.` },
              { key: "other", title: "2 · Judge from another department", list: otherList, value: other, set: setOther, empty: "No faculty from other departments yet. Use “Add a new judge”." },
            ].map((seat) => (
              <section key={seat.key} aria-label={seat.title} className="overflow-hidden rounded-2xl ring-1 ring-line">
                <header className="flex items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2.5">
                  <p className="text-sm font-bold text-navy-900">{seat.title}</p>
                  {seat.value ? (
                    <button type="button" onClick={() => seat.set("")} className="text-xs font-semibold text-brand-700 hover:underline">
                      Clear
                    </button>
                  ) : (
                    <span className="text-xs font-semibold text-accent-600">Not chosen</span>
                  )}
                </header>
                {seat.list.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted">{q ? "Nobody matches." : seat.empty}</p>
                ) : (
                  <ul className="max-h-[38dvh] divide-y divide-line overflow-y-auto">
                    {seat.list.map((j) => (
                      <JudgeOption key={j.email} juror={j} panel={panel} name={`seat-${seat.key}`} checked={seat.value === j.email} onPick={() => seat.set(j.email)} />
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}

        {jurors.data && !seats && (
          <ul className="max-h-[50dvh] divide-y divide-line overflow-y-auto rounded-xl ring-1 ring-line">
            {order(all.filter((j) => chosen.has(j.email) || matches(j))).map((j) => {
              const busy = sitsElsewhere(j, panel);
              return (
                <li key={j.email} className="flex items-start gap-3 px-3 py-2.5">
                  <Checkbox
                    label={`Appoint ${j.name}`}
                    checked={chosen.has(j.email)}
                    disabled={!!busy && !chosen.has(j.email)}
                    onChange={(on) =>
                      setChosen((current) => {
                        const next = new Set(current);
                        if (on) next.add(j.email);
                        else next.delete(j.email);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold text-navy-900">{j.name}</span>
                    <span className="block text-xs text-muted">{j.email}</span>
                    {busy && <span className="mt-0.5 inline-block rounded-full bg-accent-50 px-2 py-0.5 text-[11px] font-semibold text-accent-600">On {elsewhereLabel(busy)}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  );
}

function NewJudgeForm({ panel, onCancel, onAdded }: { panel: Panel; onCancel: () => void; onAdded: (juror: Juror) => void }) {
  // Department admins appoint KIET faculty only; outside experts are appointed by super admins.
  const isSuper = useAdmin().role === "super_admin";
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"faculty" | "external">("faculty");
  const [department, setDepartment] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = departments.filter((d) => d !== clubDepartment);

  async function add() {
    if (!/^[^\s@]+@kiet\.edu$/i.test(email.trim())) return setError("Judges need a @kiet.edu email: they sign in with their KIET Google account.");
    if (name.trim().length < 2) return setError("Enter the judge's name.");
    if (kind === "faculty" && !department) return setError("Choose the faculty member's department.");
    if (kind === "external" && organisation.trim().length < 2) return setError("Enter where the external judge comes from.");
    setPending(true);
    setError(null);
    try {
      onAdded(
        await api.addJuror({
          email: email.trim(),
          name: name.trim(),
          kind,
          department: kind === "faculty" ? department : null,
          organisation: kind === "external" ? organisation.trim() : "",
          phone: phone.trim(),
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <section className="space-y-3 rounded-2xl bg-surface p-4 ring-1 ring-inset ring-line">
      <p className="text-sm font-semibold text-navy-900">New judge</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email" htmlFor="new-judge-email" hint="Their KIET Google account (@kiet.edu).">
          <Input id="new-judge-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@kiet.edu" autoFocus />
        </Field>
        <Field label="Name" htmlFor="new-judge-name">
          <Input id="new-judge-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Judge type" htmlFor="new-judge-kind">
          <Select id="new-judge-kind" value={kind} onChange={(e) => setKind(e.target.value as "faculty" | "external")}>
            <option value="faculty">KIET faculty</option>
            {isSuper && <option value="external">Outside expert, with a KIET account</option>}
          </Select>
        </Field>
        {kind === "faculty" ? (
          <Field label="Department" htmlFor="new-judge-department" hint={panel.department ? `${panel.department} faculty fill seat 1; others fill seat 2.` : undefined}>
            <Select id="new-judge-department" value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">Choose a department</option>
              {options.map((d) => (
                <option key={d} value={d}>{departmentLabel(d)}</option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Organisation" htmlFor="new-judge-org">
            <Input id="new-judge-org" value={organisation} onChange={(e) => setOrganisation(e.target.value)} maxLength={200} />
          </Field>
        )}
        <Field label="Phone (optional)" htmlFor="new-judge-phone">
          <Input id="new-judge-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
        </Field>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={add} pending={pending}>
          Add judge
        </Button>
      </div>
    </section>
  );
}

/**
 * Changes a judge's saved marks, or enters them for a judge (e.g. from a paper sheet). A super admin any time and
 * without a reason; the department's own admin during the room's slot and buffer, with a clear reason. Both are logged.
 */
function ChangeScoreDialog({ panel, team, onClose, onSaved }: { panel: Panel; team: PanelTeam; onClose: () => void; onSaved: () => void }) {
  const admin = useAdmin();
  const isSuper = admin.role === "super_admin";
  const scores = team.judgeScores ?? [];
  const [juror, setJuror] = useState(panel.jurors[0]?.email ?? "");
  const current = scores.find((s) => s.jurorEmail === juror);
  const [marks, setMarks] = useState<(number | null)[]>(() => current?.marks ?? PARTS.map(() => null));
  const [remarks, setRemarks] = useState(current?.remarks ?? "");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = marks.reduce<number>((sum, m) => sum + (m ?? 0), 0);
  const reasonError = !isSuper && reason.trim() ? reasonProblem(reason) : null;

  function pick(email: string) {
    const existing = scores.find((s) => s.jurorEmail === email);
    setJuror(email);
    setMarks(existing?.marks ?? PARTS.map(() => null));
    setRemarks(existing?.remarks ?? "");
  }

  async function save() {
    if (marks.some((m) => m === null)) return setError("Give a mark for every part.");
    if (!isSuper) {
      const problem = reasonProblem(reason);
      if (problem) return setError(problem);
    }
    setPending(true);
    setError(null);
    try {
      await api.editScore(panel.id, team.id, juror, marks as number[], remarks.trim(), reason.trim());
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <Dialog
      title={`Marks for ${team.name}`}
      description={`${roomLabel(panel)} · Category ${team.category}: ${categoryTitle(team.category)}. ${
        isSuper
          ? "You can change or enter marks at any time. The old marks stay in the activity log."
          : "You can change marks during this room's slot and buffer. Your reason is shown to the super admins with the old marks."
      }`}
      onClose={onClose}
      busy={pending}
      size="xl"
      footer={
        <>
          <span className="mr-auto self-center font-display text-xl font-bold tabular-nums text-navy-900">
            {total}
            <span className="text-sm text-muted"> / {TOTAL}</span>
          </span>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} pending={pending} disabled={!juror}>
            {current ? "Save changed marks" : "Enter marks"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {panel.jurors.length === 0 ? (
          <Notice tone="warning">This room has no judges.</Notice>
        ) : (
          <Field label="Judge" htmlFor="change-judge">
            <Select id="change-judge" value={juror} onChange={(e) => pick(e.target.value)}>
              {panel.jurors.map((j) => (
                <option key={j.email} value={j.email}>
                  {j.name} · {scores.some((s) => s.jurorEmail === j.email) ? "marks saved" : "no marks yet"}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <RubricForm category={team.category} marks={marks} onChange={(index, value) => setMarks((m) => m.map((v, i) => (i === index ? value : v)))} disabled={pending || !juror} />
        <Field label="Remarks" htmlFor="change-remarks">
          <Textarea id="change-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={1000} />
        </Field>
        <Field
          label={isSuper ? "Reason (optional)" : "Reason for the change"}
          htmlFor="change-reason"
          hint={
            isSuper
              ? "Not needed for a super admin. The change is logged either way."
              : `Required: say what was wrong, in a sentence (at least ${MIN_REASON_LENGTH} characters). Shown in the activity log with the old and new marks.`
          }
          error={reasonError ?? undefined}
        >
          <Textarea id="change-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. The judge wrote 3 instead of 5 for Ease of Use on the paper sheet" />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  );
}

/** The extra minutes after a room's slot in which its judges can still submit marks. Super admins and the department's admin. */
function BufferDialog({ panel, onClose, onSaved, onGone }: { panel: Panel; onClose: () => void; onSaved: () => void; onGone: () => void }) {
  const [value, setValue] = useState(String(panel.bufferMinutes));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minutes = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(minutes) && minutes >= 0 && minutes <= MAX_BUFFER_MINUTES;
  const until = valid && panel.slotEnd ? timeLabel(new Date(new Date(panel.slotEnd).getTime() + minutes * 60_000).toISOString()) : null;

  async function save() {
    if (!valid) return setError(`The buffer is a whole number of minutes from 0 to ${MAX_BUFFER_MINUTES}.`);
    setPending(true);
    setError(null);
    try {
      await api.setPanelBuffer(panel.id, minutes);
      onSaved();
    } catch (err) {
      if (isGone(err)) return onGone();
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <Dialog
      title={`Buffer for ${roomLabel(panel)}`}
      description="Extra time after the slot in which this room's judges can still submit their marks. After it, their marks lock by themselves."
      onClose={onClose}
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} pending={pending} disabled={!valid || minutes === panel.bufferMinutes}>
            Save buffer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Buffer (minutes)" htmlFor="buffer-minutes" hint={`From 0 to ${MAX_BUFFER_MINUTES}. The default is ${DEFAULT_BUFFER_MINUTES}.`}>
          <Input id="buffer-minutes" type="number" inputMode="numeric" min={0} max={MAX_BUFFER_MINUTES} step={5} value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Common buffers">
          {[0, 15, 30, 45, 60].map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={minutes === m}
              onClick={() => setValue(String(m))}
              className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition ${minutes === m ? "bg-navy-900 text-white ring-navy-900" : "bg-white text-navy-800 ring-line hover:bg-surface"}`}
            >
              {m === 0 ? "None" : `${m} min`}
            </button>
          ))}
        </div>
        {until && <p className="text-sm text-navy-800">Judges can then submit marks until <strong>{until}</strong>.</p>}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  );
}

/** Lets a judge change their marks again after locking them. Super admins, and the department's admin during the slot and buffer. */
function UnlockDialog({ panel, juror, onClose, onSaved, onGone }: { panel: Panel; juror: PanelJuror; onClose: () => void; onSaved: () => void; onGone: () => void }) {
  const admin = useAdmin();
  const isSuper = admin.role === "super_admin";
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonError = !isSuper && reason.trim() ? reasonProblem(reason) : null;

  async function save() {
    if (!isSuper) {
      const problem = reasonProblem(reason);
      if (problem) return setError(problem);
    }
    setPending(true);
    setError(null);
    try {
      await api.unlockJudge(panel.id, juror.email, reason.trim());
      onSaved();
    } catch (err) {
      if (isGone(err)) return onGone();
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <Dialog
      title={`Unlock ${juror.name}'s marks?`}
      description={roomLabel(panel)}
      onClose={onClose}
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} pending={pending}>
            <LockOpen aria-hidden="true" className="size-4" />
            Unlock
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-navy-800">
          The judge can save and change their marks again while the room&apos;s time (the slot and its buffer) runs. They lock again when the judge locks them or the time ends.
        </p>
        <Field
          label={isSuper ? "Reason (optional)" : "Reason"}
          htmlFor="unlock-reason"
          hint={isSuper ? "Not needed for a super admin. The change is logged either way." : `Required, at least ${MIN_REASON_LENGTH} characters. It goes into the activity log.`}
          error={reasonError ?? undefined}
        >
          <Textarea id="unlock-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. The judge locked before marking the last team" />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  );
}
