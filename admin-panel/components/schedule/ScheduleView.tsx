"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { CalendarClock, DoorClosed, DoorOpen, RotateCcw } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { Schedule } from "@/lib/admin-types";
import { useAdmin } from "@/lib/auth/AuthProvider";
import { formatIst, fromIstInput, toIstInput } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { Loading, Notice } from "@/components/ui/Notice";
import { PageHeader, SectionTitle } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";

const DAY = 86_400_000;

const stateLabel = { open: "Open", upcoming: "Not open yet", closed: "Closed" } as const;
const stateTone = { open: "green", upcoming: "cyan", closed: "slate" } as const;

/** "in 11 days", "2 hours ago": relative to the server's clock, so a wrong device clock cannot mislead. */
function relative(targetMs: number, nowMs: number) {
  const diff = targetMs - nowMs;
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", DAY],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  const [unit, size] = units.find(([, ms]) => abs >= ms) ?? ["minute", 60_000];
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.round(diff / size), unit);
}

export function ScheduleView() {
  const admin = useAdmin();
  const isSuper = admin.role === "super_admin";
  const query = useQuery("schedule", () => api.getSchedule());
  const data = query.data;
  // Kept here, not in the body below: the body remounts whenever the dates change, which would clear it.
  const [saved, setSaved] = useState<string | null>(null);
  // The confirmation fades after a while, so it never lingers beside a later error.
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(null), 8000);
    return () => clearTimeout(timer);
  }, [saved]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isSuper ? "Super admin" : "Read only"}
        title="Schedule"
        description="When students can register, when department admins must finish their finalist nominations, and the earliest moment results can be published. Changes apply on the very next request, with no redeploy."
      />
      {query.error && <Notice tone="error">{query.error}</Notice>}
      {!data && !query.error && <Loading label="Loading the schedule" />}
      {data && (
        <ScheduleBody
          key={`${data.updatedAt}|${data.registration.opens}|${data.registration.closes}|${data.extendedCloses}|${data.nominationsDeadline}|${data.resultsPublishFrom}`}
          schedule={data}
          isSuper={isSuper}
          saved={saved}
          onSaved={(next, message) => {
            setSaved(message);
            query.setData(next);
          }}
        />
      )}
    </div>
  );
}

function ScheduleBody({
  schedule,
  isSuper,
  saved,
  onSaved,
}: {
  schedule: Schedule;
  isSuper: boolean;
  saved: string | null;
  onSaved: (next: Schedule, message: string) => void;
}) {
  // The server's clock: its time when this was loaded (for what is shown), and a ticking copy for click handlers.
  const [clock] = useState(() => {
    const server = new Date(schedule.serverTime).getTime();
    return { loaded: server, skew: server - Date.now() };
  });
  const nowMs = () => Date.now() + clock.skew;
  const { registration } = schedule;
  const [dialog, setDialog] = useState<"open" | "close" | null>(null);

  function applied(next: Schedule, message: string) {
    setDialog(null);
    onSaved(next, message);
  }

  const headline =
    registration.state === "open"
      ? `Closes ${relative(new Date(registration.closes).getTime(), clock.loaded)}`
      : registration.state === "upcoming"
        ? `Opens ${relative(new Date(registration.opens).getTime(), clock.loaded)}`
        : `Closed ${relative(new Date(registration.closes).getTime(), clock.loaded)}`;

  return (
    <>
      {saved && <Notice tone="success">{saved}</Notice>}
      {!isSuper && <Notice tone="info">Only a super admin can change the schedule. You can see it here.</Notice>}

      <section aria-labelledby="registration-status" className="rounded-2xl bg-white p-5 ring-1 ring-line">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <SectionTitle id="registration-status" title="Registration" />
            <div className="flex flex-wrap items-center gap-3">
              <Pill tone={stateTone[registration.state]}>{stateLabel[registration.state]}</Pill>
              <p className="font-display text-2xl font-bold text-navy-900">{headline}</p>
            </div>
            <dl className="mt-3 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted">Opens</dt>
                <dd className="font-medium text-navy-900">{formatIst(registration.opens)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted">Closes</dt>
                <dd className="font-medium text-navy-900">{formatIst(registration.closes)}</dd>
              </div>
              {schedule.extendedCloses && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-muted">Startups and COE KIET close</dt>
                  <dd className="font-medium text-navy-900">{formatIst(schedule.extendedCloses)}</dd>
                </div>
              )}
            </dl>
            <p className="mt-3 text-xs text-muted">
              {schedule.customised
                ? `Changed by ${schedule.updatedBy ?? "an organiser"}${schedule.updatedAt ? ` on ${formatIst(schedule.updatedAt)}` : ""}.`
                : "These are the planned dates from the event document; nobody has changed them yet."}
            </p>
          </div>
          {isSuper && (
            <div className="flex flex-wrap gap-2">
              {registration.state !== "open" && (
                <Button onClick={() => setDialog("open")}>
                  <DoorOpen aria-hidden="true" className="size-4" />
                  Open registration now
                </Button>
              )}
              {registration.state !== "closed" && (
                <Button variant="secondary" onClick={() => setDialog("close")}>
                  <DoorClosed aria-hidden="true" className="size-4" />
                  Close registration now
                </Button>
              )}
            </div>
          )}
        </div>
      </section>

      <DatesForm schedule={schedule} isSuper={isSuper} loadedAt={clock.loaded} onSaved={(next) => applied(next, "Saved. Students see the new dates on their next action.")} />

      {dialog === "open" && (
        <OpenDialog
          schedule={schedule}
          loadedAt={clock.loaded}
          nowMs={nowMs}
          onClose={() => setDialog(null)}
          onOpened={(next) => applied(next, "Registration is open. Students can create profiles and teams now.")}
        />
      )}
      {dialog === "close" && (
        <ConfirmDialog
          title="Close registration now?"
          description="Students will immediately be unable to create profiles, join or create teams, invite, or change and submit teams."
          confirmLabel="Close registration"
          tone="danger"
          onConfirm={async () => applied(await api.closeRegistrationNow(), "Registration is closed.")}
          onClose={() => setDialog(null)}
        >
          <ul className="list-disc space-y-1 pl-5 text-sm text-navy-800">
            <li>Teams that are already submitted are not affected.</li>
            <li>Students can still sign in and see their team.</li>
            <li>You can open registration again at any time.</li>
          </ul>
        </ConfirmDialog>
      )}
    </>
  );
}

function OpenDialog({
  schedule,
  loadedAt,
  nowMs,
  onClose,
  onOpened,
}: {
  schedule: Schedule;
  loadedAt: number;
  nowMs: () => number;
  onClose: () => void;
  onOpened: (next: Schedule) => void;
}) {
  const closeId = useId();
  const oldCloseHasPassed = new Date(schedule.registration.closes).getTime() <= loadedAt;
  const [closes, setCloses] = useState(() => toIstInput(new Date(nowMs() + 7 * DAY).toISOString()));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    let iso: string | undefined;
    if (oldCloseHasPassed) {
      const parsed = fromIstInput(closes);
      if (!parsed || new Date(parsed).getTime() <= nowMs()) {
        setError("Choose a closing date in the future.");
        return;
      }
      iso = parsed;
    }
    setPending(true);
    try {
      onOpened(await api.openRegistrationNow(iso));
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <Dialog
      title="Open registration now?"
      description="Students can create profiles and teams immediately."
      onClose={onClose}
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={confirm} pending={pending}>
            Open registration
          </Button>
        </>
      }
    >
      {oldCloseHasPassed ? (
        <Field label="New closing date and time (IST)" htmlFor={closeId} hint="The old closing date has passed, so registration needs a new one.">
          <Input id={closeId} type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} />
        </Field>
      ) : (
        <p className="text-sm text-navy-800">Registration will stay open until the current closing date: {formatIst(schedule.registration.closes)}.</p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </Dialog>
  );
}

function DatesForm({ schedule, isSuper, loadedAt, onSaved }: { schedule: Schedule; isSuper: boolean; loadedAt: number; onSaved: (next: Schedule) => void }) {
  const ids = { opens: useId(), closes: useId(), extended: useId(), noExtended: useId(), deadline: useId(), none: useId(), results: useId(), anyTime: useId() };
  const initial = {
    opens: toIstInput(schedule.registration.opens),
    closes: toIstInput(schedule.registration.closes),
    extended: toIstInput(schedule.extendedCloses),
    noExtended: schedule.extendedCloses === null,
    deadline: toIstInput(schedule.nominationsDeadline),
    noDeadline: schedule.nominationsDeadline === null,
    results: toIstInput(schedule.resultsPublishFrom),
    anyTime: schedule.resultsPublishFrom === null,
  };
  const [form, setForm] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const opens = fromIstInput(form.opens);
  const closes = fromIstInput(form.closes);
  const extended = form.noExtended ? null : fromIstInput(form.extended);
  const deadline = form.noDeadline ? null : fromIstInput(form.deadline);
  const results = form.anyTime ? null : fromIstInput(form.results);
  const problems: { opens?: string; closes?: string; extended?: string; deadline?: string; results?: string } = {};
  if (!opens) problems.opens = "Enter the opening date and time.";
  if (!closes) problems.closes = "Enter the closing date and time.";
  if (opens && closes) {
    const span = new Date(closes).getTime() - new Date(opens).getTime();
    if (span <= 0) problems.closes = "Registration must close after it opens.";
    else if (span > 366 * DAY) problems.closes = "Registration can stay open for at most a year.";
  }
  if (!form.noExtended && !extended) problems.extended = "Enter the date, or choose “No extension”.";
  else if (extended && closes && new Date(extended) < new Date(closes)) problems.extended = "This cannot be earlier than the general closing date.";
  if (!form.noDeadline && !deadline) problems.deadline = "Enter the deadline, or choose “No deadline”.";
  if (!form.anyTime && !results) problems.results = "Enter the date, or choose “Any time”.";
  else if (results && deadline && new Date(results) < new Date(deadline)) problems.results = "Results can only be published after the nominations deadline.";
  else if (results && closes && new Date(results) < new Date(closes)) problems.results = "Results can only be published after registration closes.";
  const valid = Object.keys(problems).length === 0;
  const changed = JSON.stringify(form) !== JSON.stringify(initial);

  const planned = {
    opens: toIstInput(schedule.planned.registrationOpens),
    closes: toIstInput(schedule.planned.registrationCloses),
    extended: toIstInput(schedule.planned.registrationExtendedCloses),
    noExtended: schedule.planned.registrationExtendedCloses === null,
    deadline: toIstInput(schedule.planned.nominationsDeadline),
    noDeadline: schedule.planned.nominationsDeadline === null,
    results: toIstInput(schedule.planned.resultsPublishFrom),
    anyTime: schedule.planned.resultsPublishFrom === null,
  };
  const isPlanned = JSON.stringify(form) === JSON.stringify(planned);

  // What saving would do right now, so nothing surprises the organiser.
  let effect: string | null = null;
  if (valid && opens && closes && changed) {
    const at = loadedAt;
    const state = at < new Date(opens).getTime() ? "upcoming" : at > new Date(closes).getTime() ? "closed" : "open";
    effect =
      state === "open"
        ? `Registration will be open from the moment you save, until ${formatIst(closes)}.`
        : state === "closed"
          ? "Registration will be closed from the moment you save."
          : `Registration will open on ${formatIst(opens)}.`;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || !opens || !closes) return;
    setPending(true);
    setError(null);
    try {
      onSaved(await api.saveSchedule({ registrationOpens: opens, registrationCloses: closes, registrationExtendedCloses: extended, nominationsDeadline: deadline, resultsPublishFrom: results }));
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5 rounded-2xl bg-white p-5 ring-1 ring-line" aria-labelledby="dates-title">
      <SectionTitle id="dates-title" title="Dates" meta="All times are IST (India Standard Time)" />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Registration opens" htmlFor={ids.opens} error={problems.opens}>
          <Input id={ids.opens} type="datetime-local" value={form.opens} disabled={!isSuper} onChange={(e) => setForm({ ...form, opens: e.target.value })} aria-invalid={problems.opens ? true : undefined} />
        </Field>
        <Field label="Registration closes" htmlFor={ids.closes} error={problems.closes}>
          <Input id={ids.closes} type="datetime-local" value={form.closes} disabled={!isSuper} onChange={(e) => setForm({ ...form, closes: e.target.value })} aria-invalid={problems.closes ? true : undefined} />
        </Field>
        <Field
          label="Startups and COE KIET close"
          htmlFor={ids.extended}
          error={problems.extended}
          hint="Startup entries and COE KIET (technical club) teams can register until this, later than everyone else. Until the general closing date nothing changes for anyone."
        >
          <Input
            id={ids.extended}
            type="datetime-local"
            value={form.noExtended ? "" : form.extended}
            disabled={!isSuper || form.noExtended}
            onChange={(e) => setForm({ ...form, extended: e.target.value })}
            aria-invalid={problems.extended ? true : undefined}
          />
        </Field>
        <div className="flex items-end pb-1">
          <label htmlFor={ids.noExtended} className="flex items-center gap-2 text-sm text-navy-800">
            <input
              id={ids.noExtended}
              type="checkbox"
              checked={form.noExtended}
              disabled={!isSuper}
              onChange={(e) => setForm({ ...form, noExtended: e.target.checked, extended: form.extended || form.closes })}
              className="size-4 accent-brand-600"
            />
            No extension
          </label>
        </div>
        <Field
          label="Finalist nominations due by"
          htmlFor={ids.deadline}
          error={problems.deadline}
          hint="After this, department admins can no longer change their nominations. Super admins always can."
        >
          <Input
            id={ids.deadline}
            type="datetime-local"
            value={form.noDeadline ? "" : form.deadline}
            disabled={!isSuper || form.noDeadline}
            onChange={(e) => setForm({ ...form, deadline: e.target.value })}
            aria-invalid={problems.deadline ? true : undefined}
          />
        </Field>
        <div className="flex items-end pb-1">
          <label htmlFor={ids.none} className="flex items-center gap-2 text-sm text-navy-800">
            <input
              id={ids.none}
              type="checkbox"
              checked={form.noDeadline}
              disabled={!isSuper}
              onChange={(e) => setForm({ ...form, noDeadline: e.target.checked, deadline: form.deadline || planned.deadline })}
              className="size-4 accent-brand-600"
            />
            No deadline
          </label>
        </div>
        <Field
          label="Results can be published from"
          htmlFor={ids.results}
          error={problems.results}
          hint="The event plan declares finalists on 26 October. Publishing is refused before this, even with the typed confirmation."
        >
          <Input
            id={ids.results}
            type="datetime-local"
            value={form.anyTime ? "" : form.results}
            disabled={!isSuper || form.anyTime}
            onChange={(e) => setForm({ ...form, results: e.target.value })}
            aria-invalid={problems.results ? true : undefined}
          />
        </Field>
        <div className="flex items-end pb-1">
          <label htmlFor={ids.anyTime} className="flex items-center gap-2 text-sm text-navy-800">
            <input
              id={ids.anyTime}
              type="checkbox"
              checked={form.anyTime}
              disabled={!isSuper}
              onChange={(e) => setForm({ ...form, anyTime: e.target.checked, results: form.results || planned.results })}
              className="size-4 accent-brand-600"
            />
            Any time (after the nominations deadline)
          </label>
        </div>
      </div>

      {effect && (
        <Notice tone="info" title="What saving will do">
          {effect}
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      {isSuper && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" pending={pending} disabled={!valid || !changed}>
            <CalendarClock aria-hidden="true" className="size-4" />
            Save dates
          </Button>
          <Button variant="ghost" onClick={() => setForm(initial)} disabled={!changed || pending}>
            Discard changes
          </Button>
          <Button variant="ghost" onClick={() => setForm(planned)} disabled={isPlanned || pending}>
            <RotateCcw aria-hidden="true" className="size-4" />
            Use the planned dates
          </Button>
        </div>
      )}
    </form>
  );
}
