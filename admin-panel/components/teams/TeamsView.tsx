"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Plus, X } from "lucide-react";
import { api, errorMessage, MAX_SEARCH_LENGTH } from "@/lib/api";
import type { AdminTeam, BulkAction, BulkResult, TeamQuery, TeamSort } from "@/lib/admin-types";
import { useAdmin } from "@/lib/auth/AuthProvider";
import { categories, clubDepartment, departmentLabel, departments } from "@/lib/content";
import { downloadTeams, downloadTeamsExcel } from "@/lib/export";
import { formatDate, otherMemberDepartments, plural, routeLabels, statusLabels, typeShortLabels, typeTones } from "@/lib/format";
import type { ParticipantType, TeamResult, TeamRoute, TeamStatus } from "@/lib/types";
import { useQuery } from "@/lib/use-query";
import { intParam, pageSizeParam, pickParam, useUrlParams } from "@/lib/use-url-params";
import { useSelection } from "@/lib/use-selection";
import { teamHref } from "@/lib/routes";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ExportDialog, type ExportFormat, type ExportScope } from "@/components/ui/ExportDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Select } from "@/components/ui/Field";
import { Loading, Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { lastPage, PageSizeSelect, Pagination } from "@/components/ui/Pagination";
import { SelectionBar } from "@/components/ui/SelectionBar";
import { Pill, ResultPill, StatusPill } from "@/components/ui/Pill";
import { yearLabel } from "@/lib/rules";
import { isOutsideAdmin, scopedTypes, scopeName } from "@/lib/scope";
import { BulkActionDialog, BulkActionMenu, BulkResultNotice } from "./BulkTeamActions";
import { CreateTeamDialog } from "./CreateTeamDialog";
import { YearChips } from "./YearChips";
import { SearchBox } from "@/components/ui/SearchBox";
import { numClass, SortableTh, TableFrame, tdClass, Th } from "@/components/ui/Table";

const statuses: TeamStatus[] = ["draft", "submitted", "withdrawn", "disqualified", "archived"];
const types: ParticipantType[] = ["kiet", "college", "school", "startup"];
const routes: TeamRoute[] = ["department", "finale"];
const approvals = ["pending", "approved", "rejected"] as const;
const results: TeamResult[] = ["pending", "finalist", "not_selected"];
const sorts: TeamSort[] = ["code", "name", "category", "department", "status", "members", "submitted_at", "leader_year"];
const memberYears = (team: AdminTeam) =>
  [...team.members].sort((a, b) => Number(b.role === "leader") - Number(a.role === "leader") || a.year - b.year).map((m) => m.year);
const teamKey = (team: AdminTeam) => team.id;

export function TeamsView() {
  const admin = useAdmin();
  const isSuper = admin.role === "super_admin";
  const outside = isOutsideAdmin(admin);
  // A startup has no year of study, so a startup admin sees no year filters or columns.
  const startupOnly = admin.role === "startup_admin";
  // Startups, COE KIET, other colleges and schools wait for an admin to accept them; only their admins (and super admins) see those.
  const seesApprovals = isSuper || startupOnly || outside || (admin.role === "admin" && admin.department === clubDepartment);
  // Super admins filter by every type; outside admins between colleges and schools; startup admins see one type only.
  const scoped = scopedTypes(admin) ?? [];
  const typeChoices = isSuper ? types : scoped.length > 1 ? types.filter((t) => scoped.includes(t)) : [];
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const { params, update, reset } = useUrlParams();
  const [searchKey, setSearchKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [selectError, setSelectError] = useState<string | null>(null);
  const selection = useSelection(teamKey);
  // The bulk action being confirmed for the selected teams, and what the last one did.
  const [bulk, setBulk] = useState<BulkAction | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);

  const query: TeamQuery = {
    department: isSuper ? pickParam(params, "department", departments) : undefined,
    category: intParam(params, "category", 1, categories.length),
    status: pickParam(params, "status", statuses),
    type: typeChoices.length ? pickParam(params, "type", typeChoices) : undefined,
    route: isSuper ? pickParam(params, "route", routes) : undefined,
    approval: seesApprovals ? pickParam(params, "approval", approvals) : undefined,
    result: pickParam(params, "result", results),
    year: intParam(params, "year", 1, 12),
    leaderYear: intParam(params, "leader_year", 1, 12),
    q: params.get("q")?.trim().slice(0, MAX_SEARCH_LENGTH) || undefined,
    sort: pickParam(params, "sort", sorts) ?? "code",
    order: params.get("order") === "desc" ? "desc" : "asc",
    page: intParam(params, "page", 1, 10_000) ?? 1,
    pageSize: pageSizeParam(params),
  };
  const key = JSON.stringify(query);
  const { data, error, loading, reload } = useQuery(key, () => api.listTeams(query));
  const filtered = Boolean(query.department || query.category || query.status || query.type || query.route || query.approval || query.result || query.year || query.leaderYear || query.q);
  const yearChoices = [
    // A school admin sees school classes only; a college admin college years only.
    ...(query.type === "school" || admin.role === "school_admin" ? [] : [1, 2, 3, 4].map((y) => ({ value: y, label: yearLabel(y) }))),
    ...((typeChoices.includes("school") || admin.role === "school_admin") && query.type !== "college"
      ? [6, 7, 8, 9, 10, 11, 12].map((y) => ({ value: y, label: yearLabel(y, "school") }))
      : []),
  ];

  function onSort(sort: TeamSort) {
    update({ sort, order: query.sort === sort && query.order === "asc" ? "desc" : "asc" });
  }

  // Every page of the current filters, in the current order: what "all matching" means for selecting and exporting.
  const allMatching = () => api.exportTeams({ ...query, page: undefined, pageSize: undefined });

  async function selectAllMatching() {
    setSelectingAll(true);
    setSelectError(null);
    try {
      selection.replace(await allMatching());
    } catch (err) {
      setSelectError(errorMessage(err));
    } finally {
      setSelectingAll(false);
    }
  }

  async function exportRows(scope: ExportScope, format: ExportFormat) {
    const rows =
      scope === "selected"
        ? selection.rows
        : scope === "page"
          ? (data?.items ?? [])
          : scope === "matching"
            ? await allMatching()
            : await api.exportTeams({ sort: query.sort, order: query.order });
    if (format === "xlsx") await downloadTeamsExcel(rows);
    else downloadTeams(rows);
  }

  const sortProps = { sort: query.sort ?? "code", order: query.order ?? "asc", onSort } as const;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isSuper ? "All participants" : scopeName(admin)}
        title="Teams"
        description={
          isSuper
            ? "Every team from KIET departments, other colleges, schools and startups."
            : outside
              ? `Teams from ${scopeName(admin).toLowerCase()}. They go straight to the Grand Finale.`
              : admin.role === "startup_admin"
                ? "Startup entries, one per startup. They go straight to the Grand Finale."
                : `Teams whose leader is a ${admin.department} student. Members may come from other branches.`
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => setExportOpen(true)} disabled={!data || data.total === 0}>
              <Download aria-hidden="true" className="size-4" />
              Export
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" className="size-4" />
              Create team
            </Button>
          </>
        }
      />

      <form role="search" onSubmit={(e) => e.preventDefault()} className="space-y-3">
        <SearchBox
          key={searchKey}
          id="team-search"
          label="Search teams"
          placeholder="Team name, code, member name or email"
          value={query.q ?? ""}
          onSearch={(q) => update({ q })}
        />
        <div className={`grid grid-cols-2 gap-3 ${isSuper ? "md:grid-cols-4 xl:grid-cols-8" : outside ? "md:grid-cols-3 xl:grid-cols-5" : "md:grid-cols-4"}`}>
          {isSuper && (
            <Field label="Department" htmlFor="filter-department">
              <Select id="filter-department" value={query.department ?? ""} onChange={(e) => update({ department: e.target.value })}>
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>{departmentLabel(d)}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Category" htmlFor="filter-category">
            <Select id="filter-category" value={query.category ?? ""} onChange={(e) => update({ category: e.target.value })}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.number} value={c.number}>{c.number}. {c.title}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="filter-status">
            <Select id="filter-status" value={query.status ?? ""} onChange={(e) => update({ status: e.target.value })}>
              <option value="">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>{statusLabels[s]}</option>
              ))}
            </Select>
          </Field>
          {!startupOnly && (
            <>
              <Field label="Has a member in" htmlFor="filter-year">
                <Select id="filter-year" value={query.year ?? ""} onChange={(e) => update({ year: e.target.value })}>
                  <option value="">Any year</option>
                  {yearChoices.map((y) => (
                    <option key={y.value} value={y.value}>{y.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Leader's year" htmlFor="filter-leader-year">
                <Select id="filter-leader-year" value={query.leaderYear ?? ""} onChange={(e) => update({ leader_year: e.target.value })}>
                  <option value="">Any year</option>
                  {yearChoices.map((y) => (
                    <option key={y.value} value={y.value}>{y.label}</option>
                  ))}
                </Select>
              </Field>
            </>
          )}
          {typeChoices.length > 0 && (
            <Field label="Participant type" htmlFor="filter-type">
              <Select id="filter-type" value={query.type ?? ""} onChange={(e) => update({ type: e.target.value })}>
                <option value="">All types</option>
                {typeChoices.map((t) => (
                  <option key={t} value={t}>{typeShortLabels[t]}</option>
                ))}
              </Select>
            </Field>
          )}
          {seesApprovals && (
            <Field label="Approval" htmlFor="filter-approval">
              <Select id="filter-approval" value={query.approval ?? ""} onChange={(e) => update({ approval: e.target.value })}>
                <option value="">Any</option>
                <option value="pending">Awaiting approval</option>
                <option value="approved">Accepted</option>
                <option value="rejected">Rejected</option>
              </Select>
            </Field>
          )}
          {(isSuper || admin.role === "admin") && (
            <Field label="Result" htmlFor="filter-result">
              <Select id="filter-result" value={query.result ?? ""} onChange={(e) => update({ result: e.target.value })}>
                <option value="">Any</option>
                <option value="pending">Pending</option>
                <option value="finalist">Finalist</option>
                <option value="not_selected">Not selected</option>
              </Select>
            </Field>
          )}
          {isSuper && (
            <Field label="Route" htmlFor="filter-route">
              <Select id="filter-route" value={query.route ?? ""} onChange={(e) => update({ route: e.target.value })}>
                <option value="">All routes</option>
                {routes.map((r) => (
                  <option key={r} value={r}>{routeLabels[r]}</option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted" aria-live="polite">
          {data ? (
            <>
              <span className="font-semibold text-navy-900">{plural(data.total, "team")}</span>
              {filtered ? " match these filters" : " in total"}
            </>
          ) : (
            "Loading teams…"
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchKey((k) => k + 1);
                reset();
              }}
            >
              <X aria-hidden="true" className="size-3.5" />
              Clear filters
            </Button>
          )}
          <PageSizeSelect value={query.pageSize ?? 25} onChange={(size) => update({ size })} />
        </div>
      </div>

      <SelectionBar
        count={selection.size}
        noun={{ one: "team", many: "teams" }}
        matching={data?.total ?? 0}
        selectingAll={selectingAll}
        onSelectAll={selectAllMatching}
        onClear={selection.clear}
        onExport={() => setExportOpen(true)}
        actions={<BulkActionMenu approver={seesApprovals} isSuper={isSuper} onPick={setBulk} />}
      />
      {bulkResult && <BulkResultNotice result={bulkResult} onDismiss={() => setBulkResult(null)} />}
      {bulk && (
        <BulkActionDialog
          action={bulk}
          teams={selection.rows}
          onClose={() => setBulk(null)}
          onDone={(result) => {
            setBulk(null);
            setBulkResult(result);
            selection.clear();
            reload();
          }}
        />
      )}
      {selectError && <Notice tone="error">{selectError}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <Loading label="Loading teams" />}

      {data && data.total === 0 && (
        <EmptyState title="No teams found">{filtered ? "Try removing a filter or searching for something else." : "No teams have been created yet."}</EmptyState>
      )}

      {data && data.total > 0 && (
        <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          {data.items.length === 0 ? (
            <EmptyState
              title="No results on this page"
              action={
                <Button variant="secondary" size="sm" onClick={() => update({ page: lastPage(data) })} disabled={loading}>
                  Go to page {lastPage(data)}
                </Button>
              }
            >
              The list is shorter than this page number, possibly because teams were removed since the link was made.
            </EmptyState>
          ) : (
            <TableFrame label="Teams" minWidth="min-w-[1040px]">
              <thead>
                <tr>
                  <Th className="w-10">
                    <Checkbox
                      label="Select all teams on this page"
                      checked={data.items.every(selection.has)}
                      indeterminate={data.items.some(selection.has)}
                      onChange={(on) => selection.setMany(data.items, on)}
                    />
                  </Th>
                  <SortableTh label="Code" sortKey="code" {...sortProps} />
                  <SortableTh label="Team" sortKey="name" {...sortProps} />
                  <SortableTh label="Cat." sortKey="category" {...sortProps} />
                  <SortableTh label={isSuper ? "Department / institution" : outside ? "Institution" : startupOnly ? "Startup" : "Department"} sortKey="department" {...sortProps} />
                  <SortableTh label="Members" sortKey="members" {...sortProps} className={numClass} />
                  {!startupOnly && <SortableTh label="Years" sortKey="leader_year" {...sortProps} />}
                  <SortableTh label="Status" sortKey="status" {...sortProps} />
                  <SortableTh label="Submitted" sortKey="submitted_at" {...sortProps} />
                  <Th>Result</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((team) => {
                  const leader = team.members.find((m) => m.role === "leader");
                  return (
                    <tr key={team.id} className={selection.has(team) ? "bg-brand-50/70" : "hover:bg-surface/70"}>
                      <td className={tdClass}>
                        <Checkbox label={`Select team ${team.name}`} checked={selection.has(team)} onChange={() => selection.toggle(team)} />
                      </td>
                      <td className={`${tdClass} whitespace-nowrap font-mono text-xs`}>
                        <Link href={teamHref(team.id)} className="font-semibold text-brand-700 hover:underline">
                          {team.code}
                        </Link>
                      </td>
                      <td className={`${tdClass} min-w-56`}>
                        <Link href={teamHref(team.id)} className="font-semibold text-navy-900 hover:text-brand-700 hover:underline">
                          {team.name}
                        </Link>
                        <p className="text-xs text-muted">Led by {leader?.fullName ?? "—"}</p>
                      </td>
                      <td className={`${tdClass} whitespace-nowrap`} title={categories.find((c) => c.number === team.category)?.title}>
                        <span className="font-display font-bold text-navy-900">{team.category}</span>
                      </td>
                      <td className={tdClass}>
                        {team.department ? (
                          <>
                            <span className="font-medium">{team.department}</span>
                            {team.department === clubDepartment && leader?.club && <span className="block text-xs text-muted">{leader.club}</span>}
                            {otherMemberDepartments(team).length > 0 && (
                              <span className="block text-xs text-muted">+ {otherMemberDepartments(team).join(", ")}</span>
                            )}
                          </>
                        ) : (
                          <span className="block max-w-56 text-sm">{team.institution}</span>
                        )}
                        {typeChoices.length > 0 && (
                          <span className="mt-0.5 flex gap-1">
                            <Pill tone={typeTones[team.participantType]}>{typeShortLabels[team.participantType]}</Pill>
                            {team.route === "finale" && <Pill tone="orange">Direct to finale</Pill>}
                          </span>
                        )}
                      </td>
                      <td className={`${tdClass} ${numClass}`}>
                        {team.members.length}
                        {team.invitations.length > 0 && <span className="block text-xs text-muted">+{team.invitations.length} invited</span>}
                      </td>
                      {!startupOnly && (
                        <td className={tdClass}>
                          <YearChips years={memberYears(team)} type={team.participantType} />
                        </td>
                      )}
                      <td className={tdClass}>
                        <StatusPill status={team.status} />
                        {team.approvalRequired && (
                          <span className="mt-0.5 block">
                            <Pill tone={team.approvedAt ? "green" : team.rejectedAt ? "red" : "orange"}>
                              {team.approvedAt ? "Accepted" : team.rejectedAt ? "Rejected" : "Awaiting approval"}
                            </Pill>
                          </span>
                        )}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-muted`}>{formatDate(team.submittedAt)}</td>
                      <td className={tdClass}>{team.result !== "pending" ? <ResultPill result={team.result} /> : <span className="text-muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </TableFrame>
          )}
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => update({ page })} disabled={loading} />
        </div>
      )}

      {creating && (
        <CreateTeamDialog
          onClose={() => setCreating(false)}
          onCreated={(team) => {
            setCreating(false);
            router.push(teamHref(team.id));
          }}
        />
      )}

      {exportOpen && data && (
        <ExportDialog
          noun={{ one: "team", many: "teams" }}
          counts={{ selected: selection.size, page: data.items.length, matching: data.total }}
          filtered={filtered}
          formatNote="Two sheets: Teams (one row per team, with the leader's contact) and Members (one row per member)."
          onExport={exportRows}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
}
