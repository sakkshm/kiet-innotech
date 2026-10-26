import Link from "next/link";
import type { AuditEntry } from "@/lib/admin-types";
import { auditLabels, formatDateTime, formatTime } from "@/lib/format";
import { teamHref } from "@/lib/routes";
import { Pill, type PillTone } from "@/components/ui/Pill";

const tones: Partial<Record<string, PillTone>> = {
  "team.submitted": "green",
  "team.archived": "slate",
  "team.edited": "navy",
  "team.member_added": "navy",
  "team.member_removed": "navy",
  "student.edited": "navy",
  "team.withdrawn": "red",
  "team.disqualified": "red",
  "team.restored": "cyan",
  "team.deleted": "red",
  "member.left": "red",
  "member.removed": "red",
  "finalists.updated": "orange",
  "results.published": "orange",
  "admin.added": "navy",
  "admin.removed": "navy",
  "results.unpublished": "red",
  "judging.opened": "green",
  "judging.locked": "orange",
  "judging.scored": "cyan",
  // Changed marks stand out: they are what the super admins look for.
  "judging.score_edited": "orange",
  "judging.marks_locked": "navy",
  "judging.marks_unlocked": "orange",
  "judging.buffer_changed": "cyan",
  "judging.time_extended": "orange",
  "judging.judge_present": "green",
  "attendance.marked": "green",
  "attendance.absent": "red",
  "judging.judge_unmarked": "slate",
  "team.approved": "green",
  "team.approval_revoked": "slate",
  "team.rejected": "red",
  "team.rejection_revoked": "slate",
  "student.banned": "red",
  "student.unbanned": "cyan",
  "student.deleted": "red",
  "team.leader_changed": "orange",
  "student.created": "green",
  "team.reopened": "orange",
  "team.dissolved": "red",
};

/** A ruled, newest-first list of audit log entries. */
export function AuditList({
  entries,
  showTeam = true,
  timeOnly = false,
  boxed = false,
}: {
  entries: AuditEntry[];
  showTeam?: boolean;
  /** Under a day heading: show just the time. */
  timeOnly?: boolean;
  /** A white card instead of ruled lines. */
  boxed?: boolean;
}) {
  return (
    <ol className={boxed ? "divide-y divide-line overflow-hidden rounded-2xl bg-white px-4 ring-1 ring-line" : "divide-y divide-line border-y border-line"}>
      {entries.map((entry) => (
        <li key={entry.id} className={`grid gap-1 py-3 sm:gap-4 ${timeOnly ? "sm:grid-cols-[4.5rem_minmax(0,1fr)]" : "sm:grid-cols-[8.5rem_minmax(0,1fr)]"}`}>
          <time dateTime={entry.at} className="text-xs tabular-nums text-muted sm:pt-0.5">
            {timeOnly ? formatTime(entry.at) : formatDateTime(entry.at)}
          </time>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {/* Unknown (future) actions fall back to the raw action string. */}
              <Pill tone={tones[entry.action] ?? "slate"}>{(auditLabels as Record<string, string>)[entry.action] ?? entry.action}</Pill>
              {showTeam && entry.teamId && entry.teamCode && (
                <Link href={teamHref(entry.teamId)} className="text-xs font-semibold text-brand-700 hover:underline">
                  {entry.teamCode}
                </Link>
              )}
              {entry.department && <span className="text-xs text-muted">{entry.department}</span>}
            </div>
            <p className="mt-1 text-sm break-words text-navy-900">{entry.detail}</p>
            <p className="mt-0.5 text-xs break-all text-muted">by {entry.actorEmail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
