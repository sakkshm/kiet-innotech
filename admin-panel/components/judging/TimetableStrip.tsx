"use client";

import { useState } from "react";
import { CalendarClock, Pencil, TriangleAlert } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { Judging, Timetable } from "@/lib/admin-types";
import { useAdmin } from "@/lib/auth/AuthProvider";
import { departmentLabel } from "@/lib/content";
import { timeLabel } from "@/lib/rooms";
import { useNow } from "@/lib/use-now";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { tdClass, Th } from "@/components/ui/Table";

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
  const now = useNow();
  const [editing, setEditing] = useState(false);
  const timetable = judging.timetable;
  if (!timetable) return null;
  const graceMs = timetable.graceMinutes * 60_000;
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
            Judges submit marks during their room&apos;s slot and up to {timetable.graceMinutes} minutes after it. New rooms take their department&apos;s slot.
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
          const state = now < start ? "upcoming" : now <= end ? "now" : now <= end + graceMs ? "extra" : "done";
          return (
            <li key={g.start + g.end} className={`overflow-hidden rounded-2xl bg-white ring-1 ${state === "now" || state === "extra" ? "ring-2 ring-emerald-500" : "ring-line"} ${state === "done" ? "opacity-70" : ""}`}>
              <div className={`flex items-center justify-between gap-2 px-4 py-2.5 text-white ${tones[i % tones.length]}`}>
                <span className="font-display text-sm font-bold">{day.format(new Date(g.start))}</span>
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">
                  {state === "upcoming" ? "Upcoming" : state === "now" ? "Judging now" : state === "extra" ? `Extra time · till ${timeLabel(new Date(end + graceMs).toISOString())}` : "Done"}
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

function TimetableDialog({ timetable, onClose, onSaved }: { timetable: Timetable; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState(() =>
    timetable.slots.map((s) => ({ department: s.department, date: parts(s.slotStart).date, from: parts(s.slotStart).time, to: parts(s.slotEnd).time })),
  );
  const [grace, setGrace] = useState(String(timetable.graceMinutes));
  const [move, setMove] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (i: number, key: "date" | "from" | "to", value: string) => setRows((all) => all.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  async function save() {
    const minutes = Number(grace);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 240) return setError("Extra minutes: a whole number from 0 to 240.");
    for (const r of rows) {
      const any = r.date || r.from || r.to;
      if (any && !(r.date && r.from && r.to)) return setError(`${r.department}: give the date, start and end, or clear all three.`);
      if (any && r.to <= r.from) return setError(`${r.department}: the slot must end after it starts.`);
    }
    setPending(true);
    setError(null);
    try {
      await api.saveTimetable(
        rows.map((r) => ({
          department: r.department,
          slotStart: r.date ? `${r.date}T${r.from}:00+05:30` : null,
          slotEnd: r.date ? `${r.date}T${r.to}:00+05:30` : null,
        })),
        minutes,
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
      description="When each department is judged (IST). Judges can submit marks during the slot and the extra minutes after it."
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
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Extra minutes after each slot" htmlFor="grace" hint="Time for judges to finish entering marks." className="w-56">
            <Input id="grace" type="number" min={0} max={240} step={5} value={grace} onChange={(e) => setGrace(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm text-navy-800">
            <Checkbox label="Also move rooms that are still at a department's old time" checked={move} onChange={setMove} />
            Also move rooms that are still at a department&apos;s old time
          </label>
        </div>
        <div className="max-h-[52dvh] overflow-auto rounded-xl ring-1 ring-line">
          <table className="w-full min-w-[620px] border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-10 bg-white">
              <tr>
                <Th>Department</Th>
                <Th>Date</Th>
                <Th>From</Th>
                <Th>To</Th>
                <Th>
                  <span className="sr-only">Clear</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.department} className={r.date ? "" : "bg-accent-50/60"}>
                  <td className={`${tdClass} font-semibold text-navy-900`}>{departmentLabel(r.department)}</td>
                  <td className={tdClass}>
                    <Input type="date" aria-label={`${r.department} date`} value={r.date} onChange={(e) => set(i, "date", e.target.value)} />
                  </td>
                  <td className={tdClass}>
                    <Input type="time" aria-label={`${r.department} from`} step={300} value={r.from} onChange={(e) => set(i, "from", e.target.value)} />
                  </td>
                  <td className={tdClass}>
                    <Input type="time" aria-label={`${r.department} to`} step={300} value={r.to} onChange={(e) => set(i, "to", e.target.value)} />
                  </td>
                  <td className={tdClass}>
                    <Button size="sm" variant="ghost" onClick={() => setRows((all) => all.map((x, j) => (j === i ? { ...x, date: "", from: "", to: "" } : x)))}>
                      Clear
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  );
}
