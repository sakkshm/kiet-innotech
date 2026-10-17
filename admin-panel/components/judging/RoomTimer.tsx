"use client";

import { useState } from "react";
import { AlarmClock, CircleCheck, Hourglass, Timer } from "lucide-react";
import { countdown, WARNING_MINUTES, type RoomClock } from "@/lib/rooms";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";

const light = {
  before: "bg-slate-100 text-slate-700 ring-slate-200",
  slot: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warn: "bg-red-50 text-red-700 ring-red-300",
  buffer: "bg-accent-50 text-accent-600 ring-accent-100",
  over: "bg-slate-100 text-slate-600 ring-slate-200",
};
const dark = {
  before: "bg-white/10 text-white ring-white/20",
  slot: "bg-emerald-400 text-navy-950 ring-emerald-300",
  warn: "bg-red-500 text-white ring-red-300",
  buffer: "bg-accent-500 text-white ring-accent-300",
  over: "bg-white/10 text-white/80 ring-white/20",
};

/**
 * The room's clock: time to its start, time left in the slot (red in the last 15 minutes), the extra time after it
 * (the room's buffer), or "time over". The caller ticks it every second from the server's clock.
 */
export function RoomTimer({ clock, tone = "light", className = "" }: { clock: RoomClock; tone?: "light" | "dark"; className?: string }) {
  const palette = tone === "dark" ? dark : light;
  const key = clock.phase === "slot" && clock.warn ? "warn" : clock.phase;
  const Icon = clock.phase === "before" ? Hourglass : clock.phase === "slot" ? Timer : clock.phase === "buffer" ? AlarmClock : CircleCheck;
  const text =
    clock.phase === "before"
      ? `Starts in ${countdown(clock.msLeft)}`
      : clock.phase === "slot"
        ? `${countdown(clock.msLeft)} left`
        : clock.phase === "buffer"
          ? `Extra time ${countdown(clock.msLeft)}`
          : "Time over";
  const spoken =
    clock.phase === "slot" ? "Time left in the slot" : clock.phase === "buffer" ? "Extra time to submit marks" : clock.phase === "before" ? "Time to the slot" : "Slot over";
  return (
    <span
      role="timer"
      aria-label={`${spoken}: ${text}`}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-sm font-semibold tabular-nums ring-1 ring-inset ${palette[key]} ${className}`}
    >
      <Icon aria-hidden="true" className={`size-4 ${key === "warn" ? "animate-pulse" : ""}`} />
      <span aria-hidden="true">{text}</span>
    </span>
  );
}

export type WarningItem = { id: string; room: string; slotEnd: string; msLeft: number; detail: string; note?: string };

/** The "15 minutes left" popup, once per room and slot end on this device (it stays dismissed after a reload). */
export function TimeLeftPopup({ items }: { items: WarningItem[] }) {
  // What was dismissed before a reload; storage can be blocked, which then simply shows the popup again.
  const [seen, setSeen] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(sessionStorage.getItem("innotech:warned") ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const next = items.find((item) => !seen.has(`${item.id}:${item.slotEnd}`));
  if (!next) return null;

  // "15 minutes left" when it first appears; if the page is opened later, the minutes that really are left.
  const minutesLeft = Math.min(WARNING_MINUTES, Math.max(1, Math.ceil(next.msLeft / 60_000)));

  const dismiss = () => {
    const key = `${next.id}:${next.slotEnd}`;
    const all = new Set(seen).add(key);
    setSeen(all);
    try {
      sessionStorage.setItem("innotech:warned", JSON.stringify([...all]));
    } catch {
      /* ignore */
    }
  };

  return (
    <Dialog
      title={minutesLeft <= 1 ? "1 minute left" : `${minutesLeft} minutes left`}
      description={next.room}
      onClose={dismiss}
      footer={<Button onClick={dismiss}>OK, got it</Button>}
    >
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-600">
          <AlarmClock aria-hidden="true" className="size-6" />
        </span>
        <div className="min-w-0 space-y-2 text-sm text-navy-800">
          <p className="font-display text-3xl font-bold tabular-nums text-navy-900">{countdown(next.msLeft)}</p>
          <p>{next.detail}</p>
          {next.note && <p className="text-muted">{next.note}</p>}
        </div>
      </div>
    </Dialog>
  );
}
