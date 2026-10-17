"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ArrowLeft, Ban, BadgeCheck, Crown, Pencil, RotateCcw, Send, ShieldX, Trash2, Undo2, UserMinus, UserPlus, UserX } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { AdminTeam } from "@/lib/admin-types";
import { useAdmin } from "@/lib/auth/AuthProvider";
import { clubDepartment } from "@/lib/content";
import { categoryTitle, formatDate, formatDateTime, otherMemberDepartments, participantTypeLabels, routeLabels, statusLabels, typeShortLabels, typeTones } from "@/lib/format";
import { yearLabel } from "@/lib/rules";
import { isTeamId } from "@/lib/routes";
import { useQuery } from "@/lib/use-query";
import { AuditList } from "@/components/audit/AuditList";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input } from "@/components/ui/Field";
import { Loading, Notice } from "@/components/ui/Notice";
import { SectionTitle } from "@/components/ui/PageHeader";
import { Pill, ResultPill, StandingPill, StatusPill } from "@/components/ui/Pill";
import { TableFrame, tdClass, Th } from "@/components/ui/Table";
import { EditTeamDialog } from "./EditTeamDialog";

type Action = "withdraw" | "disqualify" | "restore" | "ban" | "reopen" | "dissolve" | "approve" | "unapprove" | "submit" | "qualify" | "unqualify";

const actionCopy: Record<Action, { title: string; confirm: string; tone: "primary" | "danger"; description: (team: AdminTeam) => ReactNode }> = {
  withdraw: {
    title: "Mark team withdrawn",
    confirm: "Mark withdrawn",
    tone: "danger",
    description: (team) => (
      <>
        <strong className="text-navy-900">{team.name}</strong> ({team.code}) will no longer be considered. Pending invitations are cancelled and any finalist nomination is removed.
      </>
    ),
  },
  disqualify: {
    title: "Disqualify team",
    confirm: "Disqualify",
    tone: "danger",
    description: (team) => (
      <>
        <strong className="text-navy-900">{team.name}</strong> ({team.code}) will be disqualified from InnoTech26. Only the super admin can restore it.
      </>
    ),
  },
  submit: {
    title: "Submit this team",
    confirm: "Submit team",
    tone: "primary",
    description: (team) => (
      <>
        <strong className="text-navy-900">{team.name}</strong> ({team.code}) is submitted for its students, even though registration is closed for
        them. The team rules still apply (members, category). Pending invitations are cancelled. Students are not told this is possible.
      </>
    ),
  },
  reopen: {
    title: "Send back to draft",
    confirm: "Send back to draft",
    tone: "primary",
    description: (team) => (
      <>
        <strong className="text-navy-900">{team.name}</strong> ({team.code}) becomes a draft again, so its leader can change the members and details and
        submit it once more. Any finalist nomination is removed. This works only while registration is open, and not once the team is in judging.
      </>
    ),
  },
  dissolve: {
    title: "Dissolve team",
    confirm: "Dissolve team",
    tone: "danger",
    description: (team) => (
      <>
        <strong className="text-navy-900">{team.name}</strong> ({team.code}) is deleted and its {team.members.length} members are free to join or create
        another team. This cannot be undone; the history stays in the activity log.
      </>
    ),
  },
  ban: {
    title: "Ban team",
    confirm: "Ban team",
    tone: "danger",
    description: (team) => (
      <>
        <strong className="text-navy-900">{team.name}</strong> ({team.code}) is disqualified from InnoTech26. You can also ban every member, so they can no
        longer use the portal or join another team.
      </>
    ),
  },
  approve: {
    title: "Accept this entry",
    confirm: "Accept entry",
    tone: "primary",
    description: (team) => (
      <>
        <strong className="text-navy-900">{team.name}</strong> ({team.code}) is accepted as a legal entry, so it qualifies for the Grand Finale and can be
        allotted to a judging panel and a stall.
      </>
    ),
  },
  qualify: {
    title: "Qualify for the Grand Finale",
    confirm: "Qualify for final",
    tone: "primary",
    description: (team) => (
      <>
        <strong className="text-navy-900">{team.name}</strong> ({team.code}) is shown to its students as qualified for the Grand Finale on 30 October.
      </>
    ),
  },
  unqualify: {
    title: "Back to awaiting",
    confirm: "Back to awaiting",
    tone: "primary",
    description: (team) => (
      <>
        <strong className="text-navy-900">{team.name}</strong> ({team.code}) is shown to its students as awaiting the organisers&apos; decision again.
      </>
    ),
  },
  unapprove: {
    title: "Withdraw acceptance",
    confirm: "Withdraw acceptance",
    tone: "danger",
    description: (team) => (
      <>
        <strong className="text-navy-900">{team.name}</strong> ({team.code}) no longer qualifies for the Grand Finale until it is accepted again. This is
        not possible once it has been allotted to a panel or scored.
      </>
    ),
  },
  restore: {
    title: "Restore team",
    confirm: "Restore",
    tone: "primary",
    description: (team) => (
      <>
        <strong className="text-navy-900">{team.name}</strong> ({team.code}) will return to{" "}
        <strong className="text-navy-900">{team.submittedAt ? statusLabels.submitted : statusLabels.draft}</strong>. Cancelled invitations are not restored.
      </>
    ),
  },
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 border-b border-line py-2.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-navy-900">{children}</dd>
    </div>
  );
}

const back = (
  <Link href="/teams" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
    <ArrowLeft aria-hidden="true" className="size-4" />
    All teams
  </Link>
);

function TeamNotFound({ known }: { known: boolean }) {
  return (
    <div className="space-y-4">
      {back}
      <EmptyState
        title="Team not found"
        action={
          <ButtonLink href="/teams" size="sm">
            Back to all teams
          </ButtonLink>
        }
      >
        {known ? "No team with this ID exists. It may have been deleted by its leader." : "This link does not point to a team."} Find the team in
        the list instead.
      </EmptyState>
    </div>
  );
}

/** Renders inside <Suspense> (useSearchParams): the team ID comes from /teams/view/?id=. */
export function TeamDetail() {
  const id = useSearchParams().get("id");
  if (!isTeamId(id)) return <TeamNotFound known={false} />;
  // Keyed so moving between teams (back/forward) starts fresh instead of showing the previous team.
  return <TeamView key={id} id={id} />;
}

function TeamView({ id }: { id: string }) {
  const router = useRouter();
  const admin = useAdmin();
  const isSuper = admin.role === "super_admin";
  const [notFound, setNotFound] = useState(false);
  const team = useQuery(`team:${id}`, () =>
    api.getTeam(id).catch((error: unknown) => {
      // The live API answers 422 for an ID that is not a UUID; both mean "no such team".
      if (error instanceof ApiError && (error.status === 404 || error.status === 422)) setNotFound(true);
      throw error;
    }),
  );
  const history = useQuery(team.data ? `team-audit:${id}` : null, () => api.audit({ teamId: id, limit: 100 }));
  const [action, setAction] = useState<Action | null>(null);
  const [banMembers, setBanMembers] = useState(true);
  const [unbanMembers, setUnbanMembers] = useState(true);
  const [done, setDone] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [memberAction, setMemberAction] = useState<{ kind: "remove" | "leader"; userId: string; name: string } | null>(null);

  if (notFound && !team.data) return <TeamNotFound known />;

  if (team.error && !team.data) {
    return (
      <div className="space-y-4">
        {back}
        <Notice tone="error" title="This team cannot be shown">
          {team.error}
        </Notice>
      </div>
    );
  }
  if (!team.data) return <Loading label="Loading team" />;

  const t = team.data;
  const canWithdraw = t.status === "draft" || t.status === "submitted";
  const canDisqualify = isSuper && (canWithdraw || t.status === "archived");
  const canRestore = isSuper && (t.status === "withdrawn" || t.status === "disqualified" || t.status === "archived");
  const canBan = isSuper;
  const bannedCount = t.members.filter((m) => m.banned).length;
  const canReopen = isSuper && t.status === "submitted";
  // Late entries: a super admin can submit a draft team for its students, e.g. after the deadline.
  const canSubmit = isSuper && (t.status === "draft" || t.status === "archived");
  // Super admins can edit details and change members whatever the team's status (not while withdrawn or disqualified).
  const canEdit = isSuper;
  const canChangeMembers = isSuper && t.status !== "withdrawn" && t.status !== "disqualified";
  const canDissolve = isSuper;
  // Startup and COE KIET entries qualify for the Grand Finale only once their admin has accepted them.
  const isApprover = isSuper || admin.role === "startup_admin" || (admin.role === "admin" && admin.department === clubDepartment);
  const awaitingApproval = t.approvalRequired && !t.approvedAt;
  const canApprove = isApprover && awaitingApproval && t.status === "submitted";
  const canUnapprove = isApprover && t.approvalRequired && !!t.approvedAt && t.status === "submitted";
  // Teams from other colleges are awaiting until their admin (or a super admin) qualifies them for the Grand Finale.
  const canQualify = (isSuper || admin.role === "outside_admin" || admin.role === "college_admin") && t.participantType === "college" && t.status === "submitted";
  const qualified = t.result === "finalist";

  async function run(kind: Action, reason: string) {
    if (kind === "approve" || kind === "unapprove") {
      const updated = kind === "approve" ? await api.approveTeam(t.id) : await api.revokeApproval(t.id, reason);
      team.setData(updated);
      history.reload();
      setAction(null);
      setDone(kind === "approve" ? `${updated.code} is accepted and now qualifies for the Grand Finale.` : `${updated.code} no longer qualifies until it is accepted again.`);
      return;
    }
    if (kind === "qualify" || kind === "unqualify") {
      const result = await api.qualifyTeams([t.id], kind === "qualify");
      if (result.changed === 0) throw new Error(result.skipped[0]?.reason ? `Nothing changed: ${result.skipped[0].reason}.` : "Nothing changed.");
      team.reload();
      history.reload();
      setAction(null);
      setDone(kind === "qualify" ? `${t.code} is qualified for the Grand Finale.` : `${t.code} is back to awaiting.`);
      return;
    }
    if (kind === "dissolve") {
      await api.dissolveTeam(t.id, reason);
      router.replace("/teams");
      return;
    }
    const updated =
      kind === "withdraw"
        ? await api.withdrawTeam(t.id, reason)
        : kind === "disqualify"
          ? await api.disqualifyTeam(t.id, reason)
          : kind === "reopen"
            ? await api.reopenTeam(t.id, reason)
            : kind === "submit"
            ? await api.submitTeam(t.id, reason)
            : kind === "ban"
            ? await api.banTeam(t.id, reason, banMembers)
            : await api.restoreTeam(t.id, reason, unbanMembers);
    team.setData(updated);
    history.reload();
    setAction(null);
    setDone(
      kind === "reopen"
        ? `${updated.code} is a draft again. Its leader can now change it and submit it once more.`
        : kind === "submit"
        ? `${updated.code} is submitted.`
        : kind === "ban"
        ? `${updated.code} is banned (disqualified)${banMembers ? " and its members can no longer use the portal" : ""}.`
        : `${updated.code} is now ${statusLabels[updated.status].toLowerCase()}.`,
    );
  }

  const leader = t.members.find((m) => m.role === "leader");
  const otherDepartments = otherMemberDepartments(t);

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        {back}
        <header className="flex flex-col gap-4 border-b border-line pb-5 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-xs font-semibold tracking-wider text-brand-600">{t.code}</p>
            <h1 className="mt-1 font-display text-2xl font-bold break-words text-navy-900 sm:text-3xl">{t.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusPill status={t.status} />
              {t.participantType === "college" ? <StandingPill team={t} /> : <ResultPill result={t.result} />}
              <Pill tone={t.route === "finale" ? "orange" : "cyan"}>{routeLabels[t.route]}</Pill>
              {otherDepartments.length > 0 && <Pill tone="navy">Mixed departments</Pill>}
              {t.approvalRequired && <Pill tone={t.approvedAt ? "green" : "orange"}>{t.approvedAt ? "Accepted" : "Awaiting approval"}</Pill>}
            </div>
          </div>
          {(canEdit || canApprove || canUnapprove || canQualify || canSubmit || canWithdraw || canDisqualify || canRestore || canBan || canReopen || canDissolve) && (
            <div className="flex flex-wrap gap-2">
              {canApprove && (
                <Button onClick={() => setAction("approve")}>
                  <BadgeCheck aria-hidden="true" className="size-4" />
                  Accept entry
                </Button>
              )}
              {canQualify && (
                <Button variant={qualified ? "secondary" : "primary"} onClick={() => setAction(qualified ? "unqualify" : "qualify")}>
                  <BadgeCheck aria-hidden="true" className="size-4" />
                  {qualified ? "Back to awaiting" : "Qualify for final"}
                </Button>
              )}
              {canUnapprove && (
                <Button variant="secondary" onClick={() => setAction("unapprove")}>
                  <BadgeCheck aria-hidden="true" className="size-4" />
                  Withdraw acceptance
                </Button>
              )}
              {canEdit && (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden="true" className="size-4" />
                  Edit details
                </Button>
              )}
              {canSubmit && (
                <Button onClick={() => setAction("submit")}>
                  <Send aria-hidden="true" className="size-4" />
                  Submit team
                </Button>
              )}
              {canWithdraw && (
                <Button variant="secondary" onClick={() => setAction("withdraw")}>
                  <UserMinus aria-hidden="true" className="size-4" />
                  Mark withdrawn
                </Button>
              )}
              {canDisqualify && (
                <Button variant="danger" onClick={() => setAction("disqualify")}>
                  <Ban aria-hidden="true" className="size-4" />
                  Disqualify
                </Button>
              )}
              {canReopen && (
                <Button variant="secondary" onClick={() => setAction("reopen")}>
                  <Undo2 aria-hidden="true" className="size-4" />
                  Send back to draft
                </Button>
              )}
              {canDissolve && (
                <Button variant="secondary" className="text-red-700" onClick={() => setAction("dissolve")}>
                  <Trash2 aria-hidden="true" className="size-4" />
                  Dissolve
                </Button>
              )}
              {canBan && (
                <Button variant="danger" onClick={() => setAction("ban")}>
                  <ShieldX aria-hidden="true" className="size-4" />
                  Ban team
                </Button>
              )}
              {canRestore && (
                <Button onClick={() => setAction("restore")}>
                  <RotateCcw aria-hidden="true" className="size-4" />
                  Restore
                </Button>
              )}
            </div>
          )}
        </header>
        {awaitingApproval && t.status !== "withdrawn" && t.status !== "disqualified" && t.status !== "archived" && (
          <Notice tone="warning" title="Waiting for approval">
            {t.status === "submitted"
              ? "This entry does not qualify for the Grand Finale until it is accepted as a legal entry. The students have been told to contact the coordinator or write to innotech@kiet.edu."
              : "It has not been submitted yet. It can be accepted once its leader submits it."}
          </Notice>
        )}
        {done && <Notice tone="success">{done} The change is recorded in the history below.</Notice>}
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section aria-labelledby="team-facts">
          <SectionTitle id="team-facts" title="Registration" />
          <dl className="border-t border-line">
            <Fact label="Category">
              {t.category}. {categoryTitle(t.category)}
            </Fact>
            <Fact label="Domain">{t.domain}</Fact>
            <Fact label="Participant type">{participantTypeLabels[t.participantType]}</Fact>
            <Fact label={t.participantType === "startup" ? "Startup" : "Institution"}>{t.institution}</Fact>
            <Fact label="Department">
              {t.department ? (
                <>
                  {t.department} <span className="text-muted">(leader&apos;s department)</span>
                  {otherDepartments.length > 0 && (
                    <span className="block text-sm text-muted">Also has members from {otherDepartments.join(", ")}</span>
                  )}
                </>
              ) : (
                "—"
              )}
            </Fact>
            <Fact label="Route">{routeLabels[t.route]}</Fact>
            {t.approvalRequired && <Fact label="Approval">{t.approvedAt ? `Accepted on ${formatDate(t.approvedAt)}` : "Waiting for an admin to accept it"}</Fact>}
            <Fact label="Team code">
              <span className="font-mono tracking-wider">{t.joinCode}</span>
            </Fact>
            <Fact label="Leader">{leader ? `${leader.fullName} (${leader.email})` : "—"}</Fact>
            <Fact label="Created">{formatDateTime(t.createdAt)}</Fact>
            <Fact label="Submitted">{formatDateTime(t.submittedAt)}</Fact>
          </dl>
        </section>
        <section aria-labelledby="team-project">
          <SectionTitle id="team-project" title="Project" />
          <div className="border-t border-line pt-3">
            <h3 className="font-display text-lg font-semibold text-navy-900">{t.projectTitle || "Untitled project"}</h3>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-navy-800 [overflow-wrap:anywhere]">{t.abstract || "No abstract yet."}</p>
          </div>
        </section>
      </div>

      <section aria-labelledby="team-members">
        <SectionTitle
          id="team-members"
          title={t.participantType === "startup" ? "Contact person" : `Members (${t.members.length})`}
          meta={t.participantType === "startup" ? "A startup is a single entry" : "Team size must be 2 to 5 at submission"}
        />
        {canChangeMembers && t.participantType !== "startup" && (
          <div className="mb-3 flex justify-end">
            <Button size="sm" variant="secondary" onClick={() => setAddingMember(true)} disabled={t.members.length >= 5}>
              <UserPlus aria-hidden="true" className="size-4" />
              Add member
            </Button>
          </div>
        )}
        <TableFrame label="Team members" minWidth="min-w-[860px]">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Phone</Th>
              <Th>Roll no.</Th>
              <Th>{t.participantType === "kiet" ? "Department" : t.participantType === "startup" ? "Startup" : "Institution"}</Th>
              {t.participantType !== "startup" && <Th>Course</Th>}
              {t.participantType !== "startup" && <Th>Year</Th>}
              <Th>Joined</Th>
              {canChangeMembers && t.participantType !== "startup" && <Th>Change</Th>}
            </tr>
          </thead>
          <tbody>
            {t.members.map((m) => (
              <tr key={m.userId}>
                <td className={`${tdClass} whitespace-nowrap font-semibold text-navy-900`}>
                  {m.fullName} {m.role === "leader" && <Pill tone="navy">Leader</Pill>}
                  {m.banned && (
                    <span className="mt-0.5 block">
                      <Pill tone="red">Banned</Pill>
                    </span>
                  )}
                </td>
                <td className={tdClass}>
                  <a href={`mailto:${m.email}`} className="break-all text-brand-700 hover:underline">
                    {m.email}
                  </a>
                </td>
                <td className={`${tdClass} whitespace-nowrap tabular-nums`}>
                  <a href={`tel:+91${m.phone}`} className="hover:underline">
                    {m.phone}
                  </a>
                </td>
                <td className={`${tdClass} whitespace-nowrap font-mono text-xs`}>{m.rollNumber || "—"}</td>
                <td className={tdClass}>
                  {m.department ?? <span className="block max-w-56">{m.institution}</span>}
                  {m.department === clubDepartment && m.club && <span className="block text-xs text-muted">{m.club}</span>}
                  {t.department && m.department && m.department !== t.department && <span className="block text-xs text-muted">Other branch</span>}
                  {t.participantType !== "kiet" && (
                    <span className="mt-0.5 block">
                      <Pill tone={typeTones[t.participantType]}>{typeShortLabels[t.participantType]}</Pill>
                    </span>
                  )}
                </td>
                {t.participantType !== "startup" && <td className={`${tdClass} whitespace-nowrap`}>{m.course}</td>}
                {t.participantType !== "startup" && <td className={`${tdClass} whitespace-nowrap`}>{yearLabel(m.year, t.participantType)}</td>}
                <td className={`${tdClass} whitespace-nowrap text-muted`}>{formatDate(m.joinedAt)}</td>
                {canChangeMembers && t.participantType !== "startup" && (
                  <td className={`${tdClass} whitespace-nowrap`}>
                    {m.role === "leader" ? (
                      <span className="text-xs text-muted">Leader</span>
                    ) : (
                      <span className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setMemberAction({ kind: "leader", userId: m.userId, name: m.fullName })}>
                          <Crown aria-hidden="true" className="size-3.5" />
                          Make leader
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setMemberAction({ kind: "remove", userId: m.userId, name: m.fullName })}>
                          <UserX aria-hidden="true" className="size-3.5" />
                          Remove
                        </Button>
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </TableFrame>
      </section>

      <section aria-labelledby="team-invitations">
        <SectionTitle id="team-invitations" title="Pending invitations" />
        {t.invitations.length === 0 ? (
          <p className="border-y border-line py-3 text-sm text-muted">No pending invitations.</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {t.invitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
                <span className="break-all font-medium text-navy-900">{inv.email}</span>
                <span className="text-muted">Invited {formatDateTime(inv.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="team-history">
        <SectionTitle id="team-history" title="History" meta="Audit log for this team" />
        {history.error && <Notice tone="error">{history.error}</Notice>}
        {!history.data && !history.error && <Loading label="Loading history" />}
        {history.data && (history.data.length ? <AuditList entries={history.data} showTeam={false} /> : <EmptyState title="No history yet" />)}
      </section>

      <p>
        <ButtonLink href="/teams" size="sm">
          Back to all teams
        </ButtonLink>
      </p>

      {editing && (
        <EditTeamDialog
          team={t}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            team.setData(updated);
            history.reload();
            setEditing(false);
            setDone(`${updated.code} is updated.`);
          }}
        />
      )}
      {addingMember && (
        <ConfirmDialog
          title="Add a member"
          description={
            <>
              Adds a registered student to <strong className="text-navy-900">{t.name}</strong>. They must have completed their profile and not be in another team. The
              team rules (same college or school, category, size) still apply.
            </>
          }
          confirmLabel="Add member"
          tone="primary"
          reasonLabel="Reason"
          onClose={() => {
            setAddingMember(false);
            setNewMemberEmail("");
          }}
          onConfirm={async (reason) => {
            const updated = await api.addTeamMember(t.id, newMemberEmail.trim(), reason);
            team.setData(updated);
            history.reload();
            setAddingMember(false);
            setNewMemberEmail("");
            setDone(`${newMemberEmail.trim()} is now in ${updated.code}.`);
          }}
        >
          <Field label="Student's email" htmlFor="new-member-email" className="mb-4">
            <Input id="new-member-email" type="email" autoComplete="off" value={newMemberEmail} onChange={(e) => setNewMemberEmail(e.target.value)} />
          </Field>
        </ConfirmDialog>
      )}
      {memberAction && (
        <ConfirmDialog
          title={memberAction.kind === "remove" ? `Remove ${memberAction.name}?` : `Make ${memberAction.name} the leader?`}
          description={
            memberAction.kind === "remove" ? (
              <>
                {memberAction.name} leaves <strong className="text-navy-900">{t.name}</strong> and can join or create another team. A submitted team must stay valid
                (2 to 5 members and its category), otherwise this is refused.
              </>
            ) : (
              <>
                {memberAction.name} becomes the leader of <strong className="text-navy-900">{t.name}</strong>; the current leader becomes a member. A KIET team follows its
                leader&apos;s department, which may be refused once the team is nominated or in judging.
              </>
            )
          }
          confirmLabel={memberAction.kind === "remove" ? "Remove member" : "Make leader"}
          tone={memberAction.kind === "remove" ? "danger" : "primary"}
          reasonLabel="Reason"
          onClose={() => setMemberAction(null)}
          onConfirm={async (reason) => {
            const updated =
              memberAction.kind === "remove"
                ? await api.removeTeamMember(t.id, memberAction.userId, reason)
                : await api.setTeamLeader(t.id, memberAction.userId, reason);
            team.setData(updated);
            history.reload();
            setMemberAction(null);
            setDone(memberAction.kind === "remove" ? `${memberAction.name} is out of ${updated.code}.` : `${memberAction.name} now leads ${updated.code}.`);
          }}
        />
      )}
      {action && (
        <ConfirmDialog
          title={actionCopy[action].title}
          description={actionCopy[action].description(t)}
          confirmLabel={actionCopy[action].confirm}
          tone={actionCopy[action].tone}
          reasonLabel={action === "approve" || action === "qualify" || action === "unqualify" ? undefined : "Reason"}
          typeToConfirm={action === "dissolve" ? t.name : undefined}
          onConfirm={(reason) => run(action, reason)}
          onClose={() => setAction(null)}
        >
          {action === "restore" && bannedCount > 0 && (
            <label className="mb-4 flex cursor-pointer items-start gap-2.5 rounded-xl bg-amber-50 px-3 py-3 text-sm">
              <input type="checkbox" checked={unbanMembers} onChange={(e) => setUnbanMembers(e.target.checked)} className="mt-0.5 size-4 accent-brand-600" />
              <span>
                <span className="font-semibold text-navy-900">Also lift the ban on {bannedCount} banned {bannedCount === 1 ? "member" : "members"}</span>
                <span className="block text-xs text-muted">Restoring alone leaves them banned, so they still cannot sign in to the portal.</span>
              </span>
            </label>
          )}
          {action === "ban" && (
            <label className="mb-4 flex cursor-pointer items-start gap-2.5 rounded-xl bg-red-50 px-3 py-3 text-sm">
              <input type="checkbox" checked={banMembers} onChange={(e) => setBanMembers(e.target.checked)} className="mt-0.5 size-4 accent-red-600" />
              <span>
                <span className="font-semibold text-navy-900">Also ban all {t.members.length} members</span>
                <span className="block text-xs text-muted">They are signed out of the portal and cannot join or create another team. A super admin can lift each ban.</span>
              </span>
            </label>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
