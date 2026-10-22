/** How rooms and their time slots read everywhere: "G Block · 112", "Thu 22 Oct · 10:00 am – 1:00 pm" (IST). */

const TIME_ZONE = "Asia/Kolkata";

export function roomLabel(room: { building: string; name: string }) {
  return room.building ? `${room.building} · ${room.name}` : room.name;
}

const day = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: TIME_ZONE });
const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: TIME_ZONE });

export function slotLabel(start: string | null, end: string | null) {
  if (!start || !end) return "";
  return `${day.format(new Date(start))} · ${time.format(new Date(start))} – ${time.format(new Date(end))}`;
}

/** A judge is free for another room this long after the slot of their last room ends (the server uses the same minute). */
const JUDGE_GAP_MS = 60_000;

type Slot = { slotStart: string | null; slotEnd: string | null };

/**
 * Whether one judge cannot sit in both rooms: their slots overlap, or the second starts less than a minute after the first
 * ends. Rooms without a time (finale panels) cannot be shown to be apart, so they clash.
 */
export function roomsClash(a: Slot, b: Slot) {
  if (!a.slotStart || !a.slotEnd || !b.slotStart || !b.slotEnd) return true;
  const [aStart, aEnd, bStart, bEnd] = [a.slotStart, a.slotEnd, b.slotStart, b.slotEnd].map((value) => new Date(value).getTime());
  return aStart < bEnd + JUDGE_GAP_MS && bStart < aEnd + JUDGE_GAP_MS;
}

/** When a judge in a room that ends at `end` is free again: "Fri 23 Oct · 12:31 pm". */
export function freeFromLabel(end: string) {
  const at = new Date(new Date(end).getTime() + JUDGE_GAP_MS);
  return `${day.format(at)} · ${time.format(at)}`;
}

/** Where a slot stands right now, for the "now" badge on a room. */
export function slotState(start: string | null, end: string | null, now = Date.now()): "upcoming" | "now" | "over" | null {
  if (!start || !end) return null;
  if (now < new Date(start).getTime()) return "upcoming";
  return now <= new Date(end).getTime() ? "now" : "over";
}

/** Where a department room's scoring stands: before its slot, during it, in the extra time after it, or done. */
export function scoringState(from: string | null, slotEnd: string | null, until: string | null, now: number): "before" | "slot" | "extra" | "done" | null {
  if (!from || !slotEnd || !until) return null;
  if (now < new Date(from).getTime()) return "before";
  if (now <= new Date(slotEnd).getTime()) return "slot";
  return now <= new Date(until).getTime() ? "extra" : "done";
}

const clock = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: TIME_ZONE });

/** "1:00 pm" in IST. */
export function timeLabel(iso: string) {
  return clock.format(new Date(iso));
}

// ---------- The room clock: slot, buffer, and the minutes left ----------

/** A department room's buffer: the extra minutes after its slot for judges to submit marks (server: rules.py). */
export const DEFAULT_BUFFER_MINUTES = 15;
export const MAX_BUFFER_MINUTES = 60;
/** The popup that warns judges and organisers this many minutes before the slot ends. */
export const WARNING_MINUTES = 15;

export type RoomPhase = "before" | "slot" | "buffer" | "over";

export type RoomClock = {
  phase: RoomPhase;
  /** Milliseconds to the next change: the slot's start, its end, or the end of the buffer (0 when over). */
  msLeft: number;
  /** The slot ends within the warning window. */
  warn: boolean;
};

/** Where a department room stands at `now`: before its slot, in it, in the buffer after it, or over. Null for rooms without a slot. */
export function roomClock(slotStart: string | null, slotEnd: string | null, scoringUntil: string | null, now: number): RoomClock | null {
  if (!slotStart || !slotEnd) return null;
  const start = new Date(slotStart).getTime();
  const end = new Date(slotEnd).getTime();
  const until = scoringUntil ? new Date(scoringUntil).getTime() : end;
  if (now < start) return { phase: "before", msLeft: start - now, warn: false };
  if (now <= end) return { phase: "slot", msLeft: end - now, warn: end - now <= WARNING_MINUTES * 60_000 };
  if (now <= until) return { phase: "buffer", msLeft: until - now, warn: false };
  return { phase: "over", msLeft: 0, warn: false };
}

/** "1:24:10", "12:05" or, far away, "2 d 3 h". */
export function countdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days} d ${hours} h`;
  const two = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}

/** Why a reason for changing saved marks is too weak, or null when it is fine (server: judging._strong_reason). */
export const MIN_REASON_LENGTH = 15;
export function reasonProblem(reason: string): string | null {
  const text = reason.trim().replace(/\s+/g, " ");
  if (text.length < MIN_REASON_LENGTH || new Set(text.toLowerCase()).size < 5) {
    return `Give a clear reason, in a sentence (at least ${MIN_REASON_LENGTH} characters).`;
  }
  return null;
}
