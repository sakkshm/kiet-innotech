"use client";

import Link from "next/link";
import { useState } from "react";
import { Download, Pencil, ShieldCheck, ShieldX, Trash2, UserPlus, X } from "lucide-react";
import { api, errorMessage, MAX_SEARCH_LENGTH } from "@/lib/api";
import type { AdminStudent, StudentQuery, StudentSort } from "@/lib/admin-types";
import { useAdmin } from "@/lib/auth/AuthProvider";
import { clubDepartment, departmentLabel, departments } from "@/lib/content";
import { downloadStudents, downloadStudentsExcel } from "@/lib/export";
import { formatDate, plural, typeShortLabels, typeTones } from "@/lib/format";
import { collegeYears, schoolClasses, yearLabel } from "@/lib/rules";
import { isOutsideAdmin, isTypeAdmin, scopedTypes, scopeName } from "@/lib/scope";
import type { ParticipantType } from "@/lib/types";
import { useQuery } from "@/lib/use-query";
import { intParam, pageSizeParam, pickParam, useUrlParams } from "@/lib/use-url-params";
import { useSelection } from "@/lib/use-selection";
import { teamHref } from "@/lib/routes";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { AddStudentDialog } from "./AddStudentDialog";
import { EditStudentDialog } from "./EditStudentDialog";
import { ExportDialog, type ExportFormat, type ExportScope } from "@/components/ui/ExportDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Select } from "@/components/ui/Field";
import { Loading, Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { lastPage, PageSizeSelect, Pagination } from "@/components/ui/Pagination";
import { SelectionBar } from "@/components/ui/SelectionBar";
import { Pill, StatusPill } from "@/components/ui/Pill";
import { SearchBox } from "@/components/ui/SearchBox";
import { SortableTh, TableFrame, tdClass, Th } from "@/components/ui/Table";

const types: ParticipantType[] = ["kiet", "college", "school", "startup"];
const sorts: StudentSort[] = ["name", "email", "department", "year", "institution", "created_at"];
const studentKey = (student: AdminStudent) => student.userId;

export function StudentsView() {
  const admin = useAdmin();
  const isSuper = admin.role === "super_admin";
  const outside = isOutsideAdmin(admin);
  const scoped = scopedTypes(admin) ?? [];
  const typeChoices = isSuper ? types : scoped.length > 1 ? types.filter((t) => scoped.includes(t)) : [];
  const typeLimited = isTypeAdmin(admin);
  // A startup has no year of study or roll number, so a startup admin sees neither.
  const startupOnly = admin.role === "startup_admin";
  const { params, update, reset } = useUrlParams();
  const [searchKey, setSearchKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [selectError, setSelectError] = useState<string | null>(null);
  const selection = useSelection(studentKey);

  const inTeam = params.get("team");
  const bannedParam = params.get("banned");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<AdminStudent | null>(null);
  const [editing, setEditing] = useState<AdminStudent | null>(null);
  const [banning, setBanning] = useState<{ student: AdminStudent; lift: boolean } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const query: StudentQuery = {
    type: typeChoices.length ? pickParam(params, "type", typeChoices) : undefined,
    department: isSuper ? pickParam(params, "department", departments) : undefined,
    year: intParam(params, "year", 1, 12),
    inTeam: inTeam === "yes" || inTeam === "no" ? inTeam : undefined,
    banned: bannedParam === "yes" || bannedParam === "no" ? bannedParam : undefined,
    q: params.get("q")?.trim().slice(0, MAX_SEARCH_LENGTH) || undefined,
    sort: pickParam(params, "sort", sorts) ?? "name",
    order: params.get("order") === "desc" ? "desc" : "asc",
    page: intParam(params, "page", 1, 10_000) ?? 1,
    pageSize: pageSizeParam(params),
  };
  const { data, error, loading, reload } = useQuery(JSON.stringify(query), () => api.listStudents(query));
  const filtered = Boolean(query.type || query.department || query.year || query.inTeam || query.banned || query.q);

  function onSort(sort: StudentSort) {
    update({ sort, order: query.sort === sort && query.order === "asc" ? "desc" : "asc" });
  }

  // Every page of the current filters, in the current order: what "all matching" means for selecting and exporting.
  const allMatching = () => api.exportStudents({ ...query, page: undefined, pageSize: undefined });

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
            : await api.exportStudents({ sort: query.sort, order: query.order });
    if (format === "xlsx") await downloadStudentsExcel(rows);
    else downloadStudents(rows);
  }

  const sortProps = { sort: query.sort ?? "name", order: query.order ?? "asc", onSort } as const;
  const showClasses = (typeChoices.includes("school") || admin.role === "school_admin") && query.type !== "kiet" && query.type !== "college";
  const showYears = query.type !== "school" && admin.role !== "school_admin";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isSuper ? "All participants" : scopeName(admin)}
        title="Students"
        description={
          isSuper
            ? "Everyone who has registered, whether or not they have joined a team."
            : outside
              ? `Students from ${scopeName(admin).toLowerCase()}, whether or not they have joined a team.`
              : admin.role === "startup_admin"
                ? "Startups that have registered, with the person to contact for each."
                : `KIET students registered in ${admin.department}, including those in teams led by other departments.`
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => setExportOpen(true)} disabled={!data || data.total === 0}>
              <Download aria-hidden="true" className="size-4" />
              Export
            </Button>
            <Button onClick={() => setAdding(true)}>
              <UserPlus aria-hidden="true" className="size-4" />
              Add student
            </Button>
          </>
        }
      />
      {message && <Notice tone="success">{message}</Notice>}

      <form role="search" onSubmit={(e) => e.preventDefault()} className="space-y-3">
        <SearchBox
          key={searchKey}
          id="student-search"
          label="Search students"
          placeholder="Name, email, roll number, phone or institution"
          value={query.q ?? ""}
          onSearch={(q) => update({ q })}
        />
        <div className={`grid grid-cols-2 gap-3 ${isSuper ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
          {typeChoices.length > 0 && (
            <Field label="Participant type" htmlFor="filter-type">
              <Select id="filter-type" value={query.type ?? ""} onChange={(e) => update({ type: e.target.value, year: null })}>
                <option value="">All types</option>
                {typeChoices.map((t) => (
                  <option key={t} value={t}>{typeShortLabels[t]}</option>
                ))}
              </Select>
            </Field>
          )}
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
          {!startupOnly && (
            <Field label="Year / class" htmlFor="filter-year">
              <Select id="filter-year" value={query.year ?? ""} onChange={(e) => update({ year: e.target.value })}>
                <option value="">Any year</option>
                {showYears && collegeYears.map((y) => <option key={y} value={y}>{yearLabel(y)}</option>)}
                {showClasses && schoolClasses.map((y) => <option key={y} value={y}>{yearLabel(y, "school")}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Team" htmlFor="filter-team">
            <Select id="filter-team" value={query.inTeam ?? ""} onChange={(e) => update({ team: e.target.value })}>
              <option value="">In a team or not</option>
              <option value="yes">In a team</option>
              <option value="no">Not in a team</option>
            </Select>
          </Field>
          {isSuper && (
            <Field label="Access" htmlFor="filter-banned">
              <Select id="filter-banned" value={query.banned ?? ""} onChange={(e) => update({ banned: e.target.value })}>
                <option value="">Everyone</option>
                <option value="no">Active</option>
                <option value="yes">Banned</option>
              </Select>
            </Field>
          )}
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted" aria-live="polite">
          {data ? (
            <>
              <span className="font-semibold text-navy-900">{plural(data.total, "student")}</span>
              {filtered ? " match these filters" : " registered"}
            </>
          ) : (
            "Loading students…"
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
        noun={{ one: "student", many: "students" }}
        matching={data?.total ?? 0}
        selectingAll={selectingAll}
        onSelectAll={selectAllMatching}
        onClear={selection.clear}
        onExport={() => setExportOpen(true)}
      />
      {selectError && <Notice tone="error">{selectError}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <Loading label="Loading students" />}

      {data && data.total === 0 && (
        <EmptyState title="No students found">{filtered ? "Try removing a filter or searching for something else." : "Nobody has registered yet."}</EmptyState>
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
              The list is shorter than this page number, possibly because students were removed since the link was made.
            </EmptyState>
          ) : (
            <TableFrame label="Students" minWidth="min-w-[1000px]">
              <thead>
                <tr>
                  <Th className="w-10">
                    <Checkbox
                      label="Select all students on this page"
                      checked={data.items.every(selection.has)}
                      indeterminate={data.items.some(selection.has)}
                      onChange={(on) => selection.setMany(data.items, on)}
                    />
                  </Th>
                  <SortableTh label="Name" sortKey="name" {...sortProps} />
                  <SortableTh label="Email" sortKey="email" {...sortProps} />
                  <Th>Phone</Th>
                  <SortableTh label={isSuper ? "Department / institution" : outside ? "Institution" : admin.role === "startup_admin" ? "Startup" : "Department"} sortKey="department" {...sortProps} />
                  {!startupOnly && <SortableTh label="Year" sortKey="year" {...sortProps} />}
                  {!startupOnly && <Th>Roll no.</Th>}
                  <Th>Team</Th>
                  <SortableTh label="Registered" sortKey="created_at" {...sortProps} />
                  {isSuper && (
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  )}
                </tr>
              </thead>
              <tbody>
                {data.items.map((s) => {
                  const teamVisible = s.team && (isSuper || typeLimited || s.team.department === admin.department);
                  return (
                    <tr key={s.userId} className={selection.has(s) ? "bg-brand-50/70" : "hover:bg-surface/70"}>
                      <td className={tdClass}>
                        <Checkbox label={`Select ${s.fullName}`} checked={selection.has(s)} onChange={() => selection.toggle(s)} />
                      </td>
                      <td className={`${tdClass} whitespace-nowrap font-semibold text-navy-900`}>
                        {s.fullName}
                        {s.bannedAt && (
                          <span className="mt-0.5 block" title={s.bannedReason ?? undefined}>
                            <Pill tone="red">Banned</Pill>
                          </span>
                        )}
                      </td>
                      <td className={`${tdClass} break-all`}>{s.email}</td>
                      <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{s.phone}</td>
                      <td className={tdClass}>
                        {s.department ?? <span className="block max-w-56">{s.institution}</span>}
                        {s.department === clubDepartment && s.club && <span className="block text-xs text-muted">{s.club}</span>}
                        {typeChoices.length > 0 && (
                          <span className="mt-0.5 block">
                            <Pill tone={typeTones[s.participantType]}>{typeShortLabels[s.participantType]}</Pill>
                          </span>
                        )}
                      </td>
                      {!startupOnly && (
                        <td className={`${tdClass} whitespace-nowrap`}>
                          {yearLabel(s.year, s.participantType)}
                          {s.participantType !== "startup" && <span className="block text-xs text-muted">{s.course}</span>}
                        </td>
                      )}
                      {!startupOnly && <td className={`${tdClass} whitespace-nowrap font-mono text-xs`}>{s.rollNumber || "—"}</td>}
                      <td className={`${tdClass} whitespace-nowrap`}>
                        {s.team ? (
                          <>
                            {teamVisible ? (
                              <Link href={teamHref(s.team.id)} className="font-mono text-xs font-semibold text-brand-700 hover:underline">
                                {s.team.code}
                              </Link>
                            ) : (
                              <span className="font-mono text-xs font-semibold" title={`Led by a ${s.team.department} student`}>
                                {s.team.code}
                              </span>
                            )}
                            <span className="ml-1.5 text-xs text-muted">{s.team.role === "leader" ? "Leader" : "Member"}</span>
                            <span className="mt-0.5 block">
                              <StatusPill status={s.team.status} />
                            </span>
                            {!teamVisible && <span className="block text-xs text-muted">{s.team.department} team</span>}
                          </>
                        ) : (
                          <span className="text-muted">Not in a team</span>
                        )}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-muted`}>{formatDate(s.createdAt)}</td>
                      {isSuper && (
                        <td className={`${tdClass} text-right`}>
                          {s.bannedAt ? (
                            <Button size="sm" variant="ghost" onClick={() => setBanning({ student: s, lift: true })}>
                              <ShieldCheck aria-hidden="true" className="size-3.5" />
                              Lift ban<span className="sr-only"> for {s.fullName}</span>
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setBanning({ student: s, lift: false })}>
                              <ShieldX aria-hidden="true" className="size-3.5" />
                              Ban<span className="sr-only"> {s.fullName}</span>
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                            <Pencil aria-hidden="true" className="size-3.5" />
                            Edit<span className="sr-only"> {s.fullName}&apos;s profile</span>
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setDeleting(s)}>
                            <Trash2 aria-hidden="true" className="size-3.5" />
                            Delete<span className="sr-only"> {s.fullName}&apos;s profile</span>
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </TableFrame>
          )}
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => update({ page })} disabled={loading} />
        </div>
      )}

      {adding && (
        <AddStudentDialog
          admin={admin}
          onClose={() => setAdding(false)}
          onCreated={(student) => {
            setAdding(false);
            setMessage(`${student.fullName} (${student.email}) is registered. They can sign in with Google using this email.`);
            reload();
          }}
        />
      )}

      {banning && (
        <ConfirmDialog
          title={banning.lift ? `Lift the ban on ${banning.student.fullName}?` : `Ban ${banning.student.fullName}?`}
          description={
            banning.lift ? (
              <>They can sign in to the portal again. Their team is not restored automatically.</>
            ) : (
              <>
                <strong className="text-navy-900">{banning.student.email}</strong> is signed out of the portal and cannot join or create a team.
                {banning.student.team
                  ? banning.student.team.role === "member" && banning.student.team.status === "draft"
                    ? ` They are removed from the draft team ${banning.student.team.code}.`
                    : ` They stay in team ${banning.student.team.code} (${banning.student.team.status}); withdraw or ban that team if it should not take part.`
                  : ""}
              </>
            )
          }
          confirmLabel={banning.lift ? "Lift ban" : "Ban student"}
          tone={banning.lift ? "primary" : "danger"}
          reasonLabel="Reason"
          onClose={() => setBanning(null)}
          onConfirm={async (reason) => {
            const updated = banning.lift ? await api.unbanStudent(banning.student.userId, reason) : await api.banStudent(banning.student.userId, reason);
            setBanning(null);
            setMessage(banning.lift ? `${updated.fullName} can use the portal again.` : `${updated.fullName} is banned.`);
            reload();
          }}
        />
      )}

      {editing && (
        <EditStudentDialog
          key={editing.userId}
          student={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setEditing(null);
            setMessage(`${updated.fullName}'s profile is updated.`);
            reload();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.fullName}'s profile?`}
          description={
            <>
              <strong className="text-navy-900">{deleting.email}</strong> loses their profile and can register again from scratch.
              {deleting.team
                ? deleting.team.role === "leader"
                  ? ` They lead team ${deleting.team.code}: a random team mate becomes leader, or the team is deleted if they are its only member.`
                  : ` They are removed from team ${deleting.team.code}.`
                : ""}{" "}
              This cannot be undone.
            </>
          }
          confirmLabel="Delete profile"
          typeToConfirm="DELETE"
          tone="danger"
          reasonLabel="Reason"
          onClose={() => setDeleting(null)}
          onConfirm={async (reason) => {
            const result = await api.deleteStudent(deleting.userId, reason);
            setDeleting(null);
            setMessage(result);
            reload();
          }}
        />
      )}

      {exportOpen && data && (
        <ExportDialog
          noun={{ one: "student", many: "students" }}
          counts={{ selected: selection.size, page: data.items.length, matching: data.total }}
          filtered={filtered}
          formatNote="One Students sheet with contact details, institution, year and team."
          onExport={exportRows}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
}
