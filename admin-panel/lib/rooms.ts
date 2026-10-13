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

/** Where a slot stands right now, for the "now" badge on a room. */
export function slotState(start: string | null, end: string | null, now = Date.now()): "upcoming" | "now" | "over" | null {
  if (!start || !end) return null;
  if (now < new Date(start).getTime()) return "upcoming";
  return now <= new Date(end).getTime() ? "now" : "over";
}
