"use client";

import { useState } from "react";
import { Crown } from "lucide-react";
import { errorMessage } from "@/lib/api";
import type { AttendanceState } from "@/lib/admin-types";
import { AttendanceSlider } from "@/components/attendance/AttendanceSlider";
import { Notice } from "@/components/ui/Notice";

export type AttendanceMember = { userId: string; fullName: string; role: "leader" | "member"; state: AttendanceState };

const words: Record<AttendanceState, { text: string; tone: string }> = {
  present: { text: "Present", tone: "text-emerald-700" },
  absent: { text: "Absent", tone: "text-red-700" },
  not_marked: { text: "Not marked yet", tone: "text-muted" },
};

/**
 * A team's students, each with a three-position slider: left Absent, middle Unmarked, right Present. A student nobody has
 * marked still counts as present, and a team whose students are all marked absent scores 0. `canEdit` false shows the
 * same list as words, without the slider.
 */
export function StudentAttendance({
  members,
  canEdit,
  onChange,
  warnWhenAllAbsent = true,
}: {
  members: AttendanceMember[];
  canEdit: boolean;
  /** Say that the team scores 0 when everyone is absent (off where the page already says so). */
  warnWhenAllAbsent?: boolean;
  /** Saves one student. The list shows what the server says afterwards (the parent passes new `members`). */
  onChange: (userId: string, state: AttendanceState) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function change(member: AttendanceMember, state: AttendanceState) {
    setBusy(member.userId);
    setError(null);
    try {
      await onChange(member.userId, state);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (members.length === 0) return <p className="text-sm text-muted">This team has no students.</p>;
  const absent = members.filter((m) => m.state === "absent").length;
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-line overflow-hidden rounded-xl bg-white ring-1 ring-line">
        {members.map((m) => (
          <li key={m.userId} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 truncate text-sm font-semibold text-navy-900">
                {m.fullName}
                {m.role === "leader" && <Crown aria-label="Team leader" className="size-3.5 shrink-0 text-accent-500" />}
              </span>
              {!canEdit && <span className={`block text-xs font-semibold ${words[m.state].tone}`}>{words[m.state].text}</span>}
            </span>
            {canEdit && (
              <span className="sm:w-72 sm:shrink-0">
                <AttendanceSlider value={m.state} onChange={(state) => change(m, state)} pending={busy === m.userId} name={m.fullName} className="min-w-[15rem] max-w-none" />
              </span>
            )}
          </li>
        ))}
      </ul>
      {warnWhenAllAbsent && absent === members.length && <Notice tone="warning">Every student of this team is absent, so the team scores 0.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
