"use client";

import { useState } from "react";
import { CalendarClock, Pencil, TriangleAlert } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { Judging, Timetable } from "@/lib/admin-types";
import { useAdmin } from "@/lib/auth/AuthProvider";
import { departmentLabel } from "@/lib/content";
import { countdown, timeLabel, WARNING_MINUTES } from "@/lib/rooms";
import { useServerNow } from "@/lib/use-room-now";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";

const day = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const tones = ["bg-brand-500", "bg-violet-600", "bg-accent-500", "bg-emerald-600", "bg-navy-700", "bg-rose-600"];

type Group = { start: string; end: string; departments: string[] };

function groups(timetable: Timetable): Group[] {
  const map = new Map<string, Group>();
  for (const s of timetable.slots) {
    if (!s.slotStart || !s.slotEnd) continue;
    const key = `${s.slotStart}|${s.slotEnd}`;
    const group = map.get(key) ?? { start: s.slotStart, end: s.slotEnd, departments: [] };
    group.departments.push(s.department);
    map.set(key, group);
  }
  return [...map.values()].sort((a, b) => a.start.localeCompare(b.start));
}

/** The department round at a glance: who is judged when, with a live "now" badge. Super admins edit it here. */
export function TimetableStrip({ judging, onSaved }: { judging: Judging; onSaved: () => void }) {
  const admin = useAdmin();
  // The server's clock, ticking every second, so the countdown matches what the server enforces.
  const now = useServerNow(judging.serverTime);
  const [editing, setEditing] = useState(false);
  const timetable = judging.timetable;
  if (!timetable) return null;
  const rooms = (department: string) => judging.panels.filter((p) => p.department === department).length;
  const unscheduled = timetable.slots.filter((s) => !s.slotStart).map((s) => s.department);
  const mine = admin.role === "admin" ? admin.department : null;

  return (
    <section aria-labelledby="timetable-title" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="timetable-title" className="flex items-center gap-2 font-display text-lg font-bold text-navy-900">
            <CalendarClock aria-hidden="true" className="size-5 text-brand-600" />
            Department round timetable
          </h2>
          <p className="text-sm text-muted">
            New rooms take their department&apos;s slot. Judges save marks during their room&apos;s slot and its buffer: extra minutes after the slot
            (15 by default; a department admin can change it for each room, up to 60).
          </p>
        </div>
        {admin.role === "super_admin" && (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            <Pencil aria-hidden="true" className="size-3.5" />
            Edit timetable
          </Button>
        )}
      </div>
      <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {groups(timetable).map((g, i) => {
          const start = new Date(g.start).getTime();
          const end = new Date(g.end).getTime();
          const state = now < start ? "upcoming" : now <= end ? "now" : "done";
          const warn = state === "now" && end - now <= WARNING_MINUTES * 60_000;
          return (
            <li key={g.start + g.end} className={`overflow-hidden rounded-2xl bg-white ring-1 ${state === "now" ? (warn ? "ring-2 ring-red-500" : "ring-2 ring-emerald-500") : "ring-line"} ${state === "done" ? "opacity-70" : ""}`}>
              <div className={`flex items-center justify-between gap-2 px-4 py-2.5 text-white ${tones[i % tones.length]}`}>
                <span className="font-display text-sm font-bold">{day.format(new Date(g.start))}</span>
                <span role="timer" className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${warn ? "bg-red-600" : "bg-white/20"}`}>
                  {state === "upcoming" ? (start - now < 86_400_000 ? `Starts in ${countdown(start - now)}` : "Upcoming") : state === "now" ? `${countdown(end - now)} left` : "Done"}
                </span>
              </div>
              <div className="px-4 py-3">
                <p className="font-display text-xl font-bold tabular-nums text-navy-900">
                  {timeLabel(g.start)} – {timeLabel(g.end)}
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {g.departments.map((d) => (
                    <li
                      key={d}
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
                        d === mine ? "bg-accent-500 text-white ring-accent-500" : rooms(d) ? "bg-surface text-navy-900 ring-line" : "bg-accent-50 text-accent-600 ring-accent-100"
                      }`}
                      title={rooms(d) ? `${rooms(d)} room(s)` : "No room yet"}
                    >
                      {departmentLabel(d)} · {rooms(d) ? `${rooms(d)} ${rooms(d) === 1 ? "room" : "rooms"}` : "no room yet"}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ol>
      {unscheduled.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-accent-50 px-3 py-2 text-sm text-accent-600">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            No slot yet for <strong>{unscheduled.map(departmentLabel).join(", ")}</strong>.{" "}
            {admin.role === "super_admin" ? "Add them with Edit timetable." : "A super admin sets these; rooms can still be given their own time."}
          </span>
        </p>
      )}
      {editing && (
        <TimetableDialog
          timetable={timetable}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onSaved();
          }}
        />
      )}
    </section>
  );
}

function parts(iso: string | null) {
  if (!iso) return { date: "", time: "" };
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

type SlotRow = { id: number; date: string; from: string; to: string; departments: string[] };

/**
 * The super admin edits the timetable slot by slot, the way it is printed: a date, a time, and the departments judged
 * then. Each department sits in one slot; departments left out have no slot (their rooms need their own time).
 */
function TimetableDialog({ timetable, onClose, onSaved }: { timetable: Timetable; onClose: () => void; onSaved: () => void }) {
  const all = timetable.slots.map((s) => s.department);
  const [rows, setRows] = useState<SlotRow[]>(() =>
    groups(timetable).map((g, i) => ({ id: i, date: parts(g.start).date, from: parts(g.start).time, to: parts(g.end).time, departments: g.departments })),
  );
  const [move, setMove] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const placed = new Set(rows.flatMap((r) => r.departments));
  const unplaced = all.filter((d) => !placed.has(d));
  const update = (id: number, change: Partial<SlotRow>) => setRows((list) => list.map((r) => (r.id === id ? { ...r, ...change } : r)));
  // A department belongs to one slot: adding it here takes it out of any other.
  const toggle = (id: number, department: string) =>
    setRows((list) =>
      list.map((r) =>
        r.id === id
          ? { ...r, departments: r.departments.includes(department) ? r.departments.filter((d) => d !== department) : [...r.departments, department] }
          : { ...r, departments: r.departments.filter((d) => d !== department) },
      ),
    );

  async function save() {
    for (const [i, r] of rows.entries()) {
      if (!r.date || !r.from || !r.to) return setError(`Slot ${i + 1}: give the date, the start and the end.`);
      if (r.to <= r.from) return setError(`Slot ${i + 1}: the end must be after the start.`);
    }
    const slotOf = new Map(rows.flatMap((r) => r.departments.map((d) => [d, r] as const)));
    setPending(true);
    setError(null);
    try {
      await api.saveTimetable(
        all.map((department) => {
          const r = slotOf.get(department);
          return { department, slotStart: r ? `${r.date}T${r.from}:00+05:30` : null, slotEnd: r ? `${r.date}T${r.to}:00+05:30` : null };
        }),
        move,
      );
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <Dialog
      title="Department round timetable"
      description="Each slot is a date and time (IST) and the departments judged then. Click a department to put it in a slot."
      onClose={onClose}
      busy={pending}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} pending={pending}>
            Save timetable
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ol className="space-y-3">
          {rows.map((r, i) => (
            <li key={r.id} className="rounded-2xl p-4 ring-1 ring-line">
              <div className="flex flex-wrap items-end gap-3">
                <span className={`mb-1 inline-flex size-8 items-center justify-center rounded-full font-display text-sm font-bold text-white ${tones[i % tones.length]}`}>{i + 1}</span>
                <Field label="Date" htmlFor={`slot-${r.id}-date`} className="w-44">
                  <Input id={`slot-${r.id}-date`} type="date" value={r.date} onChange={(e) => update(r.id, { date: e.target.value })} />
                </Field>
                <Field label="From" htmlFor={`slot-${r.id}-from`} className="w-32">
                  <Input id={`slot-${r.id}-from`} type="time" step={300} value={r.from} onChange={(e) => update(r.id, { from: e.target.value })} />
                </Field>
                <Field label="To" htmlFor={`slot-${r.id}-to`} className="w-32">
                  <Input id={`slot-${r.id}-to`} type="time" step={300} value={r.to} onChange={(e) => update(r.id, { to: e.target.value })} />
                </Field>
                <Button size="sm" variant="ghost" className="mb-1 ml-auto text-red-700" onClick={() => setRows((list) => list.filter((x) => x.id !== r.id))}>
                  Remove slot
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={`Departments in slot ${i + 1}`}>
                {all.map((d) => {
                  const on = r.departments.includes(d);
                  const elsewhere = !on && placed.has(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(r.id, d)}
                      title={elsewhere ? "In another slot: clicking moves it here" : undefined}
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset transition ${
                        on ? "bg-navy-900 text-white ring-navy-900" : elsewhere ? "bg-white text-muted/70 ring-line hover:text-navy-900" : "bg-accent-50 text-accent-600 ring-accent-100 hover:bg-accent-100"
                      }`}
                    >
                      {on && "✓ "}
                      {departmentLabel(d)}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ol>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setRows((list) => [...list, { id: Math.max(0, ...list.map((r) => r.id)) + 1, date: "", from: "", to: "", departments: [] }])}
        >
          Add a slot
        </Button>
        {unplaced.length > 0 && (
          <p className="text-sm text-accent-600">Not in any slot: {unplaced.map(departmentLabel).join(", ")}. Their rooms will need their own date and time.</p>
        )}
        <div className="flex flex-wrap items-end gap-4 rounded-2xl bg-surface p-4">
          <label className="flex items-center gap-2 text-sm text-navy-800">
            <Checkbox label="Move rooms that are still at a department's old time" checked={move} onChange={setMove} />
            Move rooms that are still at a department&apos;s old time
          </label>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  );
}
