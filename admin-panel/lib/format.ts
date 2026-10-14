import type { AdminRole, AuditAction } from "./admin-types";
import { categories } from "./content";
import { participantTypeLabels } from "./rules";
import type { ParticipantType, TeamResult, TeamRoute, TeamStatus } from "./types";

const TIME_ZONE = "Asia/Kolkata";

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: TIME_ZONE }).format(new Date(value));
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  }).format(new Date(value));
}

/** For CSV files: "2026-10-12 14:05 IST". Sorts correctly as text and reads the same everywhere. */
export function formatCsvDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: TIME_ZONE,
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} IST`;
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

export function categoryTitle(number: number) {
  return categories.find((c) => c.number === number)?.title ?? `Category ${number}`;
}

export const statusLabels: Record<TeamStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  withdrawn: "Withdrawn",
  disqualified: "Disqualified",
};

export const resultLabels: Record<TeamResult, string> = {
  pending: "Result pending",
  finalist: "Finalist",
  not_selected: "Not selected",
};

export const routeLabels: Record<TeamRoute, string> = {
  department: "Department round",
  finale: "Direct to finale",
};

export const roleLabels: Record<AdminRole | "judge", string> = {
  super_admin: "Super admin",
  admin: "Department admin",
  outside_admin: "Outside teams admin",
  startup_admin: "Startup admin",
  judge: "Judge",
};

/** The pill colour of a participant type, matching its chart colour. */
export const typeTones: Record<ParticipantType, "navy" | "cyan" | "orange" | "violet"> = { kiet: "navy", college: "cyan", school: "cyan", startup: "violet" };

export const typeShortLabels: Record<ParticipantType, string> = {
  kiet: "KIET",
  college: "Other college",
  school: "School",
  startup: "Startup",
};

export const auditLabels: Record<AuditAction, string> = {
  "team.created": "Team created",
  "team.submitted": "Team submitted",
  "team.withdrawn": "Team withdrawn",
  "team.disqualified": "Team disqualified",
  "team.restored": "Team restored",
  "team.updated": "Team details edited",
  "team.deleted": "Team deleted",
  "member.joined": "Member joined",
  "member.left": "Member left",
  "member.removed": "Member removed",
  "invitation.sent": "Invitation sent",
  "invitation.cancelled": "Invitation cancelled",
  "invitation.declined": "Invitation declined",
  "finalists.updated": "Finalists updated",
  "results.published": "Results published",
  "admin.added": "Admin added",
  "admin.removed": "Admin removed",
  "team.code_reset": "Team code reset",
  "schedule.updated": "Schedule changed",
  "schedule.opened": "Registration opened",
  "schedule.closed": "Registration closed",
  "results.unpublished": "Results withdrawn",
  "judging.opened": "Judging opened",
  "judging.locked": "Judging locked",
  "judging.judge_added": "Judge appointed",
  "judging.judge_removed": "Judge removed",
  "judging.panel_created": "Room / panel created",
  "judging.panel_updated": "Room / panel changed",
  "judging.panel_deleted": "Room / panel deleted",
  "judging.teams_allotted": "Teams allotted",
  "judging.judges_assigned": "Judges assigned",
  "judging.score_edited": "Score changed by a super admin",
  "judging.timetable_updated": "Timetable changed",
  "judging.award_declared": "Winner declared",
  "judging.award_removed": "Winner removed",
  "judging.awards_published": "Winners published to students",
  "judging.awards_withdrawn": "Winners hidden from students",
  "attendance.marked": "Marked present",
  "attendance.unmarked": "Attendance undone",
  "finalists.quotas_updated": "Finalist quotas changed",
  "judging.tents_allotted": "Stalls allotted",
  "judging.scored": "Team scored",
  "student.created": "Student registered",
  "student.banned": "Student banned",
  "student.unbanned": "Ban lifted",
  "student.deleted": "Student profile deleted",
  "team.leader_changed": "Team leader changed",
  "team.reopened": "Team sent back to draft",
  "team.dissolved": "Team dissolved",
  "team.approved": "Entry accepted for the Grand Finale",
  "team.approval_revoked": "Acceptance withdrawn",
};

export const roundLabels = { department: "Departmental", final: "Grand Finale" } as const;

export { participantTypeLabels };

export function plural(count: number, one: string, many = `${one}s`) {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}

/**
 * Departments of a KIET team's members other than the team's own (the leader's) department.
 * KIET teams may mix branches; an empty list means every member is from the team's department.
 */
export function otherMemberDepartments(team: { department: string | null; members: { department: string | null }[] }) {
  if (!team.department) return [];
  return [...new Set(team.members.map((m) => m.department).filter((d): d is string => !!d && d !== team.department))];
}

// ---------- IST date-time inputs ----------

const IST_OFFSET = "+05:30";

/** An ISO time as the value of a <input type="datetime-local">, in IST ("2026-10-12T23:59"), whatever the browser's zone. */
export function toIstInput(iso: string | null | undefined) {
  if (!iso) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** The reverse: a datetime-local value read as IST, as an ISO string with the offset. Empty or invalid gives null. */
export function fromIstInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00${IST_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : `${value}:00${IST_OFFSET}`;
}

/** e.g. "12 Oct 2026, 11:59 pm IST" */
export function formatIst(iso: string | null | undefined) {
  if (!iso) return "—";
  return `${new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })} IST`;
}

/** "IST day" of an ISO time, e.g. "2026-10-05", for grouping lists by day. */
export function istDayKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

/** "Today", "Yesterday" or e.g. "Sat, 3 Oct", for day headings in feeds. */
export function dayHeading(iso: string, now = new Date()) {
  const day = istDayKey(iso);
  const today = istDayKey(now.toISOString());
  const yesterday = istDayKey(new Date(now.getTime() - 86_400_000).toISOString());
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: TIME_ZONE }).format(new Date(iso));
}

/** e.g. "2:05 pm" in IST. */
export function formatTime(iso: string) {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: TIME_ZONE }).format(new Date(iso));
}
