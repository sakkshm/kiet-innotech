"use client";

import Link from "next/link";
import { useState } from "react";
import { Eye, EyeOff, Medal, Trophy, X } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { JudgingRound, RankedTeam, Rankings } from "@/lib/admin-types";
import { useAdmin } from "@/lib/auth/AuthProvider";
import { departmentLabel, departments } from "@/lib/content";
import { teamHref } from "@/lib/routes";
import { useQuery } from "@/lib/use-query";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Select } from "@/components/ui/Field";
import { Loading, Notice } from "@/components/ui/Notice";
import { Pill } from "@/components/ui/Pill";
import { numClass, TableFrame, tdClass, Th } from "@/components/ui/Table";
import { YearChips } from "@/components/teams/YearChips";

const placeTone = ["text-accent-500", "text-slate-400", "text-amber-700"];
const rupees = (amount: number) => `₹${amount.toLocaleString("en-IN")}`;
const ordinal = (place: number) => (place === 1 ? "1st" : "2nd");

/** The average of both judges' totals, ranked with the event's tie-breakers; organisers declare the prize winners here. */
export function RankingsTab({ round }: { round: JudgingRound }) {
  const admin = useAdmin();
  const [department, setDepartment] = useState("");
  const rankings = useQuery(`rankings-${round}-${department}`, () => api.rankings(round, department || undefined));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<boolean | null>(null);

  async function act(key: string, call: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await call();
      rankings.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const data = rankings.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          A team&apos;s mark is the <strong className="text-navy-900">average of both judges&apos; totals</strong> (out of 50), and it gets a place only once both
          have scored. Level teams are split by Innovation / Originality, then Query Addressing; if still level, the parent department judge decides (the organisers at the Grand Finale).
        </p>
        {admin.role === "super_admin" && (
          <Field label={round === "department" ? "Department" : "Finalists from"} htmlFor="rank-department" className="w-52">
            <Select id="rank-department" value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">All</option>
              {departments.map((d) => (
                <option key={d} value={d}>{departmentLabel(d)}</option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {data && <WinnersBar data={data} onPublish={(publish) => setPublishing(publish)} />}
      {error && <Notice tone="error">{error}</Notice>}
      {rankings.error && <Notice tone="error">{rankings.error}</Notice>}
      {!data && !rankings.error && <Loading label="Loading rankings" />}
      {data && data.groups.length === 0 && <EmptyState title="Nothing to rank yet">Rankings appear once teams are allotted and judges start scoring.</EmptyState>}
      {data?.groups.map((group) => {
        const taken = new Set(group.teams.filter((t) => t.award).map((t) => t.award!.place));
        return (
          <section key={group.key} aria-labelledby={`rank-${group.key}`} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id={`rank-${group.key}`} className="font-display text-base font-bold text-navy-900">
                {group.label}
              </h3>
              {group.prizes.map((p) => (
                <span key={p.place} className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2.5 py-0.5 text-xs font-semibold text-accent-600 ring-1 ring-inset ring-accent-100">
                  <Trophy aria-hidden="true" className="size-3" />
                  {ordinal(p.place)} {rupees(p.amount)}
                </span>
              ))}
            </div>
            <TableFrame label={group.label} minWidth="min-w-[880px]">
              <thead>
                <tr>
                  <Th className="w-16">Place</Th>
                  <Th>Team</Th>
                  <Th>Years</Th>
                  <Th className={numClass}>Average</Th>
                  <Th className={numClass}>Innovation</Th>
                  <Th className={numClass}>Query</Th>
                  <Th className={numClass}>Judges</Th>
                  <Th>Prize</Th>
                </tr>
              </thead>
              <tbody>
                {group.teams.map((row) => (
                  <Row
                    key={row.team.id}
                    row={row}
                    prizes={group.prizes}
                    taken={taken}
                    canAward={data.canAward && !data.awardsPublished}
                    busy={busy}
                    tieBreaker={round === "department" ? "the parent department judge decides" : "the organisers decide"}
                    onDeclare={(place) => act(`${row.team.id}:${place}`, () => api.declareAward(round, row.team.id, place))}
                    onRemove={() => act(`${row.team.id}:remove`, () => api.removeAward(round, row.team.id))}
                  />
                ))}
              </tbody>
            </TableFrame>
          </section>
        );
      })}

      {publishing !== null && (
        <ConfirmDialog
          title={publishing ? "Publish the winners to students?" : "Hide the winners from students?"}
          description={
            publishing
              ? "Every team sees its result on the student portal: the prize and amount for winners, “better luck next time” for the rest. Winners cannot be changed while published."
              : "Students stop seeing the winners and prize money. You can change the winners and publish again."
          }
          confirmLabel={publishing ? "Publish winners" : "Hide winners"}
          tone={publishing ? "primary" : "danger"}
          onClose={() => setPublishing(null)}
          onConfirm={async () => {
            await api.publishAwards(round, publishing);
            setPublishing(null);
            rankings.reload();
          }}
        />
      )}
    </div>
  );
}

function WinnersBar({ data, onPublish }: { data: Rankings; onPublish: (publish: boolean) => void }) {
  const declared = data.groups.reduce((sum, g) => sum + g.teams.filter((t) => t.award).length, 0);
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 ring-1 ${data.awardsPublished ? "bg-emerald-50 ring-emerald-200" : "bg-white ring-line"}`}>
      <p className="flex items-center gap-2 text-sm text-navy-800">
        <Trophy aria-hidden="true" className="size-4 text-accent-500" />
        <span>
          <strong className="text-navy-900">{declared}</strong> {declared === 1 ? "winner" : "winners"} declared.{" "}
          {data.awardsPublished ? "Students can see the winners and prize money." : "Students do not see them until a super admin publishes them."}
        </span>
      </p>
      {data.canPublishAwards &&
        (data.awardsPublished ? (
          <Button size="sm" variant="secondary" onClick={() => onPublish(false)}>
            <EyeOff aria-hidden="true" className="size-3.5" />
            Hide winners
          </Button>
        ) : (
          <Button size="sm" onClick={() => onPublish(true)} disabled={declared === 0}>
            <Eye aria-hidden="true" className="size-3.5" />
            Publish winners to students
          </Button>
        ))}
    </div>
  );
}

function Row({
  row,
  prizes,
  taken,
  canAward,
  busy,
  tieBreaker,
  onDeclare,
  onRemove,
}: {
  row: RankedTeam;
  prizes: { place: number; amount: number }[];
  taken: Set<number>;
  canAward: boolean;
  busy: string | null;
  /** Who settles a team that is level with the one above it. */
  tieBreaker: string;
  onDeclare: (place: number) => void;
  onRemove: () => void;
}) {
  const free = prizes.filter((p) => !taken.has(p.place));
  return (
    <tr className={row.award ? "bg-accent-50/60" : !row.complete ? "bg-surface/50" : ""}>
      <td className={`${tdClass} font-display text-lg font-bold`}>
        {row.position ? (
          <span className="inline-flex items-center gap-1">
            {row.position <= 3 && <Medal aria-hidden="true" className={`size-4 ${placeTone[row.position - 1]}`} />}
            {row.position}
          </span>
        ) : (
          <span className="text-sm text-muted">—</span>
        )}
      </td>
      <td className={tdClass}>
        <Link href={teamHref(row.team.id)} className="font-semibold text-navy-900 hover:text-brand-700 hover:underline">
          {row.team.name}
        </Link>
        <span className="block text-xs text-muted">
          {row.team.code} · {row.team.department ?? row.team.institution} · {row.panel}
        </span>
        {row.tied && <Pill tone="orange">Level with the team above: {tieBreaker}</Pill>}
        {row.allAbsent && <Pill tone="red">All students absent: scores 0, no place</Pill>}
      </td>
      <td className={tdClass}>
        <YearChips years={row.team.memberYears} type={row.team.participantType} />
      </td>
      <td className={`${tdClass} ${numClass} font-semibold text-navy-900`}>{row.average ?? "—"}</td>
      <td className={`${tdClass} ${numClass}`}>{row.innovation ?? "—"}</td>
      <td className={`${tdClass} ${numClass}`}>{row.query ?? "—"}</td>
      <td className={`${tdClass} ${numClass}`}>
        <span className={row.complete ? "text-emerald-700" : "font-semibold text-accent-600"}>
          {row.scores} / {row.judges}
        </span>
        {!row.complete && <span className="block text-[11px] text-muted">waiting</span>}
      </td>
      <td className={tdClass}>
        {row.award ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-500 px-2.5 py-1 text-xs font-bold text-white">
              <Trophy aria-hidden="true" className="size-3" />
              {ordinal(row.award.place)} · {rupees(row.award.amount)}
            </span>
            {canAward && (
              <button
                type="button"
                onClick={onRemove}
                disabled={busy !== null}
                aria-label={`Remove ${row.team.name}'s prize`}
                className="inline-flex size-7 items-center justify-center rounded-full text-muted hover:bg-white hover:text-red-700 disabled:opacity-50"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            )}
          </span>
        ) : canAward && row.complete && row.team.status === "submitted" && free.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {free.map((p) => (
              <Button
                key={p.place}
                size="sm"
                variant={row.position === p.place ? "primary" : "secondary"}
                pending={busy === `${row.team.id}:${p.place}`}
                disabled={busy !== null}
                onClick={() => onDeclare(p.place)}
              >
                Make {ordinal(p.place)}
              </Button>
            ))}
          </span>
        ) : (
          <span className="text-xs text-muted">{!row.complete ? "Both judges must score" : "—"}</span>
        )}
      </td>
    </tr>
  );
}
