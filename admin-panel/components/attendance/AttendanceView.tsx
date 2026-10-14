"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { attendanceEnabled } from "@/lib/features";
import { api } from "@/lib/api";
import type { JudgingRound } from "@/lib/admin-types";
import { useAdmin } from "@/lib/auth/AuthProvider";
import { clubDepartment, departmentLabel, nominatingDepartments } from "@/lib/content";
import { roundLabels } from "@/lib/format";
import { roomLabel, slotLabel } from "@/lib/rooms";
import { isTypeAdmin } from "@/lib/scope";
import { useQuery } from "@/lib/use-query";
import { pickParam, useUrlParams } from "@/lib/use-url-params";
import { Field, Select } from "@/components/ui/Field";
import { Loading, Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { AttendanceButtons } from "@/components/judging/AttendanceButtons";
import { AttendanceDesk } from "./AttendanceDesk";

/** Organisers' attendance desk: pick a round and a room (or a whole department), scan passes, download sheets. */
export function AttendanceView() {
  const router = useRouter();
  useEffect(() => {
    // Attendance by event pass is switched off for now: send organisers to the Judging page.
    if (!attendanceEnabled) router.replace("/judging");
  }, [router]);
  if (!attendanceEnabled) return null;
  return <AttendanceDesks />;
}

function AttendanceDesks() {
  const admin = useAdmin();
  const isSuper = admin.role === "super_admin";
  const coeAdmin = admin.role === "admin" && admin.department === clubDepartment;
  const rounds: JudgingRound[] = coeAdmin || isTypeAdmin(admin) ? ["final"] : admin.role === "admin" ? ["department"] : ["department", "final"];
  const { params, update } = useUrlParams();
  const round = pickParam(params, "round", rounds) ?? rounds[0];
  const judging = useQuery(`judging-${round}`, () => api.judging(round));
  const panels = judging.data?.panels ?? [];
  const departmentScopes = round === "department" ? (isSuper ? nominatingDepartments : admin.department ? [admin.department] : []) : [];
  // "room:<id>", "dept:<code>" or "all" (the finale).
  const options = [...panels.map((p) => `room:${p.id}`), ...departmentScopes.map((d) => `dept:${d}`), ...(round === "final" ? ["all"] : [])];
  const scope = pickParam(params, "scope", options) ?? options[0] ?? null;
  const panel = scope?.startsWith("room:") ? panels.find((p) => `room:${p.id}` === scope) : undefined;
  const department = scope?.startsWith("dept:") ? scope.slice(5) : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Event day"
        title="Attendance"
        description="Scan each student's event pass at the room's desk. The code on their phone changes every minute, so screenshots do not work. Mark by hand only after checking the college ID card."
      />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Round" htmlFor="attendance-round" className="w-48">
          <Select id="attendance-round" value={round} onChange={(e) => update({ round: e.target.value, scope: null })} disabled={rounds.length === 1}>
            {rounds.map((r) => (
              <option key={r} value={r}>{roundLabels[r]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Room or group" htmlFor="attendance-scope" className="min-w-0 flex-1 sm:max-w-md">
          <Select id="attendance-scope" value={scope ?? ""} onChange={(e) => update({ scope: e.target.value })} disabled={options.length === 0}>
            {panels.length > 0 && (
              <optgroup label={round === "department" ? "Rooms" : "Panels"}>
                {panels.map((p) => (
                  <option key={p.id} value={`room:${p.id}`}>
                    {roomLabel(p)}
                    {p.department ? ` · ${p.department}` : ""}
                    {p.slotStart ? ` · ${slotLabel(p.slotStart, p.slotEnd)}` : ""}
                  </option>
                ))}
              </optgroup>
            )}
            {departmentScopes.length > 0 && (
              <optgroup label="Whole department">
                {departmentScopes.map((d) => (
                  <option key={d} value={`dept:${d}`}>All {departmentLabel(d)} teams</option>
                ))}
              </optgroup>
            )}
            {round === "final" && <option value="all">Every Grand Finale team</option>}
          </Select>
        </Field>
        {scope && <AttendanceButtons round={round} panelId={panel?.id} department={department} label={panel ? roomLabel(panel) : (department ?? "the finale")} />}
      </div>
      {judging.error && <Notice tone="error">{judging.error}</Notice>}
      {!judging.data && !judging.error && <Loading label="Loading rooms" />}
      {judging.data && !scope && <Notice tone="info">No rooms yet. Set up rooms on the Judging page first.</Notice>}
      {judging.data && scope && (
        <AttendanceDesk
          key={`${round}:${scope}`}
          round={round}
          panelId={panel?.id}
          sheetKey={`${round}:${scope}`}
          load={() => api.attendance(round, { panelId: panel?.id, department })}
        />
      )}
    </div>
  );
}
