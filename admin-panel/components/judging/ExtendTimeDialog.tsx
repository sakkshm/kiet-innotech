"use client";

import { useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { Panel } from "@/lib/admin-types";
import { departmentLabel } from "@/lib/content";
import { plural } from "@/lib/format";
import { roomLabel } from "@/lib/rooms";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";

const fmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/**
 * Super admin: lets judges keep submitting marks in chosen department rooms until a time of your choice, past the slot and
 * the buffer (for example when judges had to leave campus before uploading), and lets judges who already locked edit again.
 */
export function ExtendTimeDialog({ panels, onClose, onDone }: { panels: Panel[]; onClose: () => void; onDone: (message: string) => void }) {
  const rooms = useMemo(() => panels.filter((p) => p.round === "department"), [panels]);
  const [department, setDepartment] = useState("");
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [unlock, setUnlock] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const departments = [...new Set(rooms.map((p) => p.department ?? ""))].filter(Boolean).sort();
  const q = text.trim().toLowerCase();
  const shown = rooms.filter(
    (p) =>
      (!department || p.department === department) &&
      (!q || roomLabel(p).toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || (p.department ?? "").toLowerCase().includes(q)),
  );
  const categoriesOf = (p: Panel) => [...new Set(p.teams.map((t) => t.category))].sort((a, b) => a - b).join(", ");
  const lockedIn = (p: Panel) => p.jurors.filter((j) => j.locked).length;
  const allShown = shown.length > 0 && shown.every((p) => chosen.has(p.id));

  function toggle(ids: string[], on: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function save() {
    if (chosen.size === 0) return setError("Tick the rooms to extend.");
    if (!until) return setError("Choose the time judging should stay open until.");
    setPending(true);
    setError(null);
    try {
      const result = await api.extendRooms([...chosen], `${until}:00+05:30`, reason.trim(), unlock);
      onDone(
        `Judging time for ${plural(result.rooms, "room")} now runs until ${fmt.format(new Date(result.until ?? until))}` +
          (result.unlocked ? `, and ${plural(result.unlocked, "judge")} who had locked can edit again.` : "."),
      );
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <Dialog
      title="Extend judging time"
      description="Judges keep submitting marks in the ticked rooms until the time you choose (India time), whatever the slot and buffer. Every change is logged."
      onClose={onClose}
      busy={pending}
      size="xl"
      footer={
        <>
          <span className="mr-auto self-center text-sm text-muted">{plural(chosen.size, "room")} ticked</span>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} pending={pending}>
            {!pending && <Clock aria-hidden="true" className="size-4" />}
            Extend judging time
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem]">
          <Field label="Judging stays open until (IST)" htmlFor="extend-until">
            <Input id="extend-until" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
          </Field>
          <Field label="Rooms of" htmlFor="extend-department">
            <Select id="extend-department" value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {departmentLabel(d)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Reason" htmlFor="extend-reason" hint="Saved in the activity log, for example who asked and why.">
          <Textarea id="extend-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-surface px-3 py-2.5 text-sm">
          <input type="checkbox" checked={unlock} onChange={(e) => setUnlock(e.target.checked)} className="mt-0.5 size-4 accent-brand-600" />
          <span>
            <span className="font-semibold text-navy-900">Let judges who already locked their marks edit again</span>
            <span className="block text-xs text-muted">Their saved marks stay as they are; only the lock is lifted.</span>
          </span>
        </label>

        <Field label="Find a room" htmlFor="extend-search">
          <Input id="extend-search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Room number or department" />
        </Field>
        <div className="overflow-hidden rounded-xl ring-1 ring-line">
          <label className="flex items-center gap-3 border-b border-line bg-surface px-3 py-2 text-sm font-semibold text-navy-900">
            <Checkbox label="Tick every room shown" checked={allShown} onChange={(on) => toggle(shown.map((p) => p.id), on)} />
            Tick every room shown ({shown.length})
          </label>
          <ul className="max-h-[36dvh] divide-y divide-line overflow-y-auto">
            {shown.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Checkbox label={`Extend ${roomLabel(p)}`} checked={chosen.has(p.id)} onChange={(on) => toggle([p.id], on)} />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-navy-900">{roomLabel(p)}</span>
                  <span className="ml-2 text-xs text-muted">
                    {p.department} · {plural(p.teams.length, "team")}
                    {categoriesOf(p) ? ` · PS ${categoriesOf(p)}` : ""}
                  </span>
                </span>
                <span className="text-right text-xs text-muted">
                  {p.scoringUntil ? `open until ${fmt.format(new Date(p.scoringUntil))}` : "no time"}
                  {lockedIn(p) > 0 && <span className="block font-semibold text-accent-600">{plural(lockedIn(p), "judge")} locked</span>}
                </span>
              </li>
            ))}
            {shown.length === 0 && <li className="px-3 py-4 text-sm text-muted">No room matches.</li>}
          </ul>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  );
}
