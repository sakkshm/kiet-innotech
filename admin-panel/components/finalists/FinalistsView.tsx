"use client";

import Link from "next/link";
import { useState } from "react";
import { SlidersHorizontal, Send, Undo2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { FinalistSummary } from "@/lib/admin-types";
import { useAdmin } from "@/lib/auth/AuthProvider";
import { categories, clubDepartment, departmentLabel, nominatingDepartments } from "@/lib/content";
import { formatDateTime, formatIst, typeShortLabels, typeTones } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { teamHref } from "@/lib/routes";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Select } from "@/components/ui/Field";
import { Loading, Notice } from "@/components/ui/Notice";
import { PageHeader, SectionTitle } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { numClass, TableFrame, tdClass, Th } from "@/components/ui/Table";
import { BoardForm } from "./BoardForm";
import { QuotaDialog } from "./QuotaDialog";

function Board({
  department,
  onSaved,
  onDirtyChange,
}: {
  department: string;
  onSaved?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const board = useQuery(`finalists:${department}`, () => api.getFinalists(department));
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  // Bumped on every reload after a refused save, so the form remounts with the fresh board even
  // when its updatedAt did not change (e.g. a nominated team was withdrawn meanwhile).
  const [version, setVersion] = useState(0);

  if (board.error) return <Notice tone="error">{board.error}</Notice>;
  if (!board.data || board.data.department !== department || board.loading) return <Loading label={`Loading ${department} teams`} />;
  return (
    <div className="space-y-4">
      {conflict && (
        <Notice tone="error" title="Nominations were not saved">
          {conflict} The board has been reloaded with the latest nominations. Check them and save again.
        </Notice>
      )}
      <BoardForm
        key={`${department}:${version}:${board.data.updatedAt}:${board.data.publishedAt}`}
        board={board.data}
        justSaved={saved}
        onEdit={() => {
          setSaved(false);
          setConflict(null);
        }}
        onDirtyChange={onDirtyChange}
        onSaved={(updated) => {
          setSaved(true);
          setConflict(null);
          board.setData(updated);
          onSaved?.();
        }}
        onConflict={(message) => {
          setSaved(false);
          setConflict(message);
          setVersion((v) => v + 1);
          board.reload();
          onSaved?.();
        }}
      />
    </div>
  );
}

function Matrix({ summary, onPick }: { summary: FinalistSummary; onPick: (department: string) => void }) {
  return (
    <TableFrame label="Nominations by department and category" minWidth="min-w-[760px]">
      <thead>
        <tr>
          <Th>Department</Th>
          {categories.map((c) => (
            <Th key={c.number} className="text-center" title={c.title}>
              Cat {c.number}
            </Th>
          ))}
          <Th className={numClass}>Total</Th>
        </tr>
      </thead>
      <tbody>
        {summary.matrix.map((row) => {
          const nominated = row.categories.reduce((sum, c) => sum + c.nominated, 0);
          return (
            <tr key={row.department}>
              <td className={tdClass}>
                <button type="button" onClick={() => onPick(row.department)} className="font-semibold text-navy-900 hover:text-brand-700 hover:underline">
                  {row.department}
                </button>
              </td>
              {row.categories.map((c) => {
                const target = Math.min(c.quota, c.eligible);
                const tone =
                  c.eligible === 0
                    ? "text-muted/60"
                    : c.nominated === 0
                      ? "text-muted"
                      : c.nominated >= target
                        ? "bg-accent-50 font-semibold text-accent-600"
                        : "font-semibold text-brand-700";
                return (
                  <td
                    key={c.category}
                    className={`${tdClass} text-center tabular-nums ${tone}`}
                    title={`${c.eligible} submitted, ${c.nominated} of ${c.quota} nominated`}
                  >
                    {c.eligible === 0 ? "–" : `${c.nominated}/${c.quota}`}
                  </td>
                );
              })}
              <td className={`${tdClass} ${numClass} font-semibold`}>{nominated}</td>
            </tr>
          );
        })}
      </tbody>
    </TableFrame>
  );
}

function SuperAdminFinalists() {
  const summary = useQuery("finalist-summary", () => api.finalistSummary());
  const [department, setDepartment] = useState(nominatingDepartments[0]);
  const [boardNonce, setBoardNonce] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [published, setPublished] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [quotas, setQuotas] = useState(false);

  const data = summary.data;
  const nominatedTotal = data?.matrix.reduce((sum, row) => sum + row.categories.reduce((s, c) => s + c.nominated, 0), 0) ?? 0;
  const eligibleTotal = data?.matrix.reduce((sum, row) => sum + row.categories.reduce((s, c) => s + c.eligible, 0), 0) ?? 0;
  const departmentsWithout = data?.matrix.filter((row) => row.categories.some((c) => c.eligible > 0) && row.categories.every((c) => c.nominated === 0)).map((row) => row.department) ?? [];

  /** Switches the board, confirming first if the current one has unsaved nominations. */
  function switchTo(next: string) {
    if (next === department) return true;
    if (dirty && !window.confirm(`Discard your unsaved ${department} nominations and open ${next}?`)) return false;
    setDepartment(next);
    return true;
  }

  function pick(next: string) {
    if (!switchTo(next)) return;
    document.getElementById("department-board")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function publish() {
    try {
      const result = await api.publishResults();
      setPublished(`${result.finalists} teams marked finalist and ${result.notSelected} marked not selected.`);
    } catch (error) {
      // 409: already published (perhaps from another tab). Show the current state instead.
      if (!(error instanceof ApiError && error.status === 409)) throw error;
      setPublishError(error.message);
    }
    setPublishing(false);
    summary.reload();
    setBoardNonce((n) => n + 1);
  }

  return (
    <div className="space-y-10">
      {summary.error && <Notice tone="error">{summary.error}</Notice>}
      {!data && !summary.error && <Loading label="Loading nominations" />}

      {data && (
        <section aria-labelledby="publish-title" className="space-y-3">
          <SectionTitle id="publish-title" title="Department round results" />
          {data.publishedAt ? (
            <>
              <Notice
                tone="success"
                title="Results published"
                action={
                  data.unpublishBlocked === null && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setPublishError(null);
                        setPublished(null);
                        setWithdrawing(true);
                      }}
                    >
                      <Undo2 aria-hidden="true" className="size-3.5" />
                      Withdraw results
                    </Button>
                  )
                }
              >
                Published {formatDateTime(data.publishedAt)} by {data.publishedBy}. Nominated teams are marked finalist and the other submitted department-round teams are marked not selected. Nominations are locked.
                {data.resultsPublishFrom && new Date(data.publishedAt) < new Date(data.resultsPublishFrom) && (
                  <strong className="mt-1 block text-red-700">
                    This was before the planned results date ({formatIst(data.resultsPublishFrom)}). If it was a mistake, withdraw the results.
                  </strong>
                )}
              </Notice>
              {data.unpublishBlocked && <p className="text-xs text-muted">{data.unpublishBlocked}</p>}
            </>
          ) : (
            <div className="flex flex-col gap-3 border-y border-line py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted">
                <span className="font-semibold text-navy-900">{nominatedTotal}</span> teams nominated from{" "}
                <span className="font-semibold text-navy-900">{eligibleTotal}</span> submitted KIET teams.
                {departmentsWithout.length > 0 && ` ${departmentsWithout.length} departments have not nominated yet.`}
              </p>
              <Button
                onClick={() => {
                  setPublishError(null);
                  setPublishing(true);
                }}
                disabled={summary.loading || data.publishBlocked !== null}
              >
                <Send aria-hidden="true" className="size-4" />
                Publish results
              </Button>
            </div>
          )}
          {!data.publishedAt && data.publishBlocked && (
            <Notice tone="info" title="Results cannot be published yet">
              {data.publishBlocked}
            </Notice>
          )}
          {published && <Notice tone="success">{published}</Notice>}
          {publishError && <Notice tone="error">{publishError}</Notice>}
        </section>
      )}

      {data && (
        <section aria-labelledby="matrix-title">
          <SectionTitle id="matrix-title" title="Nominations by department" meta="Nominated / quota. – means no submitted teams. Select a department to edit." />
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">The quota is how many teams a department can send to the Grand Finale from each category.</p>
            <Button size="sm" variant="secondary" onClick={() => setQuotas(true)} disabled={!!data.publishedAt}>
              <SlidersHorizontal aria-hidden="true" className="size-3.5" />
              Set quotas
            </Button>
          </div>
          <Matrix summary={data} onPick={pick} />
        </section>
      )}
      {quotas && data && (
        <QuotaDialog
          summary={data}
          onClose={() => setQuotas(false)}
          onSaved={(updated) => {
            setQuotas(false);
            summary.setData(updated);
            setBoardNonce((n) => n + 1);
          }}
        />
      )}

      <section aria-labelledby="board-title" id="department-board" className="scroll-mt-20 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <SectionTitle id="board-title" title={`${department} nominations`} />
          <Field label="Department" htmlFor="board-department" className="sm:w-56">
            <Select id="board-department" value={department} onChange={(e) => switchTo(e.target.value)}>
              {nominatingDepartments.map((d) => (
                <option key={d} value={d}>{departmentLabel(d)}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Board key={`${department}:${boardNonce}`} department={department} onSaved={summary.reload} onDirtyChange={setDirty} />
      </section>

      {data && (
        <section aria-labelledby="direct-title">
          <SectionTitle id="direct-title" title="Direct to the Grand Finale" meta="Submitted teams from other colleges and schools, startups and COE KIET" />
          {data.directTeams.length === 0 ? (
            <EmptyState title="No submitted teams going directly to the finale yet" />
          ) : (
            <TableFrame label="Teams going directly to the Grand Finale" minWidth="min-w-[720px]">
              <thead>
                <tr>
                  <Th>Code</Th>
                  <Th>Team</Th>
                  <Th>Type</Th>
                  <Th>Institution</Th>
                  <Th className="text-center">Cat.</Th>
                  <Th className={numClass}>Members</Th>
                </tr>
              </thead>
              <tbody>
                {data.directTeams.map((team) => (
                  <tr key={team.id}>
                    <td className={`${tdClass} whitespace-nowrap font-mono text-xs`}>
                      <Link href={teamHref(team.id)} className="font-semibold text-brand-700 hover:underline">{team.code}</Link>
                    </td>
                    <td className={`${tdClass} font-semibold text-navy-900`}>{team.name}</td>
                    <td className={tdClass}>
                      <Pill tone={typeTones[team.participantType]}>{typeShortLabels[team.participantType]}</Pill>
                      {team.approvalRequired && (
                        <span className="mt-0.5 block">
                          <Pill tone={team.approvedAt ? "green" : team.rejectedAt ? "red" : "orange"}>{team.approvedAt ? "Accepted" : team.rejectedAt ? "Rejected" : "Awaiting approval"}</Pill>
                        </span>
                      )}
                    </td>
                    <td className={tdClass}>{team.department === clubDepartment ? `COE KIET` : team.institution}</td>
                    <td className={`${tdClass} text-center font-display font-bold`}>{team.category}</td>
                    <td className={`${tdClass} ${numClass}`}>{team.memberCount}</td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          )}
        </section>
      )}

      {withdrawing && data && (
        <ConfirmDialog
          title="Withdraw the published results?"
          description="Use this only to correct a mistake, such as results published early."
          confirmLabel="Withdraw results"
          tone="danger"
          typeToConfirm="UNPUBLISH"
          reasonLabel="Why are the results being withdrawn?"
          onClose={() => setWithdrawing(false)}
          onConfirm={async (reason) => {
            await api.unpublishResults(reason);
            setWithdrawing(false);
            setPublished("Results withdrawn. Every department-round team is back to “result pending” and nominations can change again.");
            summary.reload();
            setBoardNonce((n) => n + 1);
          }}
        >
          <ul className="list-disc space-y-1 pl-5 text-sm text-navy-800">
            <li>Finalist and not-selected results go back to pending, so students stop seeing them.</li>
            <li>Nominations are kept and unlock again (department admins only until their deadline).</li>
            <li>It is saved in the activity log with your reason.</li>
          </ul>
        </ConfirmDialog>
      )}

      {publishing && data && !summary.loading && (
        <ConfirmDialog
          title="Publish department round results?"
          description="Students see their result straight away. A super admin can withdraw the results only until the finale is being prepared (stalls, finale panels or finale scoring)."
          confirmLabel="Publish results"
          typeToConfirm="PUBLISH"
          onClose={() => setPublishing(false)}
          onConfirm={publish}
        >
          <ul className="list-disc space-y-1 pl-5 text-sm text-navy-800">
            <li>{nominatedTotal} nominated teams become finalists for the Grand Finale.</li>
            <li>The other {eligibleTotal - nominatedTotal} submitted KIET teams are marked not selected.</li>
            <li>Nominations lock for every department.</li>
            {departmentsWithout.length > 0 && (
              <li className="font-medium text-red-700">
                No nominations yet from: {departmentsWithout.join(", ")}.
              </li>
            )}
          </ul>
        </ConfirmDialog>
      )}
    </div>
  );
}

export function FinalistsView() {
  const admin = useAdmin();
  const isSuper = admin.role === "super_admin";
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={isSuper ? "All departments" : `${admin.department} department`}
        title="Finalists"
        description={
          isSuper
            ? "Track every department's nominations, then publish the department round results. Teams from other colleges and schools go straight to the Grand Finale."
            : "After the department round (22 to 24 October), choose the finalist teams for each category. One team per category, or two in Categories 1 to 4 for CSE, CS, CSE(AI) and CSE(AIML)."
        }
      />
      {isSuper ? (
        <SuperAdminFinalists />
      ) : admin.role === "admin" && admin.department ? (
        <Board department={admin.department} />
      ) : (
        <Notice tone="info">Teams from other colleges and schools go straight to the Grand Finale; there are no nominations for them. Their stalls are on the Judging page.</Notice>
      )}
    </div>
  );
}
