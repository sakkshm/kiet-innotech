"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Check, Copy, Mail, MessageCircle, Pencil, RefreshCw, Send, Share2, X } from "lucide-react";
import { api } from "@/lib/api";
import { categories, departmentLabel } from "@/lib/content";
import { draftKeys, hasDraft } from "@/lib/drafts";
import { formatDate, formatDateTime } from "@/lib/format";
import { clearPendingJoinCode, inviteMessage, joinLink, pendingJoinCode } from "@/lib/invite";
import { useRegistrationDates, useRegistrationState } from "@/lib/registration";
import { TEAM_MAX_SIZE, directFinaleKind, openSlots, submissionChecks, yearLabel } from "@/lib/rules";
import type { RegistrationState, Team } from "@/lib/types";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button, Field, Input, Notice, Pill, buttonStyles } from "@/components/ui/form";
import { MailLink } from "@/components/ui/MailLink";
import { Panel } from "./PageHeading";
import { usePortal } from "./PortalProvider";
import { TeamForm } from "./TeamForm";
import { useAction } from "./useAction";

export function categoryName(number: number) {
  const category = categories.find((c) => c.number === number);
  return category ? `Category ${number}: ${category.title}` : `Category ${number}`;
}

export function TeamStatusNotice({ team }: { team: Team }) {
  if (team.status === "withdrawn" || team.status === "disqualified") {
    return (
      <Notice tone="error" title={team.status === "withdrawn" ? "Team withdrawn" : "Team disqualified"}>
        This team is no longer considered for InnoTech26. If you have questions, write to <MailLink />.
      </Notice>
    );
  }
  // Only KIET teams are told they are selected here. Other colleges and schools are in the queue until a stall is allotted.
  if (team.result === "finalist" && team.route === "department") {
    return (
      <Notice tone="success" title="Selected for the Grand Finale">
        Congratulations. Your team presents at the institute level Grand Finale on 30 October 2026 at KIET.
      </Notice>
    );
  }
  if (team.result === "not_selected") {
    return (
      <Notice tone="info" title="Not selected for the finale">
        Thank you for taking part in the department round. You are welcome to visit the Grand Finale exhibition on 30 October.
      </Notice>
    );
  }
  if (team.status === "submitted") {
    const startup = team.participantType === "startup";
    return (
      <Notice tone="success" title={startup ? "Entry submitted" : "Team submitted"}>
        Submitted on {formatDateTime(team.submittedAt!)}. {startup ? "Your entry is now locked." : "Members and category are now locked."}
        {/* Startups and COE KIET teams are told about the Grand Finale, and what still has to happen, in the approval notice. */}
        {!team.approvalRequired &&
          (team.route === "department"
            ? ` Your team will be evaluated at the ${team.department} department round on 22 to 24 October.`
            : "")}
      </Notice>
    );
  }
  return null;
}

/** Everything a student can see and do with their team. Only the leader can change it, and only before submission. */
export function TeamManager({ team }: { team: Team }) {
  const router = useRouter();
  const { me, refresh } = usePortal();
  const registration = useRegistrationState();
  const isLeader = team.leaderId === me.profile!.userId;
  const startup = team.participantType === "startup";
  const editable = team.status === "draft" && registration === "open";
  const canEdit = isLeader && editable;
  // Joining needs a draft team with a free place while registration is open.
  const canAddTeammates = team.status === "draft" && openSlots(team) > 0 && registration !== "closed" && registration !== "upcoming";
  const draftKey = draftKeys.team(me.email, team.id);
  // Reopen the form if unsaved changes were kept, e.g. after signing in again.
  const [editing, setEditing] = useState(() => canEdit && hasDraft(draftKey));
  const details = useAction();

  const saveDetails = async (input: Parameters<typeof api.updateTeam>[1]) => {
    if (!(await details.run(() => api.updateTeam(team.id, input)))) return false;
    await refresh();
    setEditing(false);
    return true;
  };

  const onLeft = async () => {
    await refresh();
    router.push("/dashboard");
  };

  return (
    <>
    <OtherTeamInvite team={team} />
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
      <div className="min-w-0 space-y-6">
        {startup ? (
          <StartupPanel team={team} />
        ) : (
          <Panel
            title="Members"
            description={`${team.members.length} of ${TEAM_MAX_SIZE}. All members are from ${team.participantType === "kiet" ? "KIET" : team.institution}.`}
          >
            <MembersTable team={team} canEdit={canEdit} leaderId={team.leaderId} />
            {team.invitations.length > 0 && <PendingInvitations team={team} canEdit={canEdit} />}
            {team.status === "draft" && !isLeader && (
              <p className="mt-6 text-sm text-muted">Only the team leader can remove members. Anyone in the team can share the invite.</p>
            )}
          </Panel>
        )}

        {/* Right below the members, so on phones it is near the top of the page. */}
        {canAddTeammates && <AddTeammates team={team} isLeader={isLeader} canEdit={canEdit} />}

        <Panel
          title="Project"
          description={canEdit && !editing ? `You can change these details until the ${startup ? "entry" : "team"} is submitted.` : undefined}
        >
          {editing ? (
            <TeamForm
              initial={{ name: team.name, category: team.category, domain: team.domain, projectTitle: team.projectTitle, abstract: team.abstract }}
              participantType={team.participantType}
              memberYears={team.members.map((m) => m.year)}
              submitLabel="Save changes"
              onSubmit={saveDetails}
              draftKey={draftKey}
              pending={details.pending}
              error={details.error}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <dl className="divide-y divide-line">
                {[
                  ["Category", categoryName(team.category)],
                  ["Domain", team.domain],
                  ["Project title", team.projectTitle],
                ].map(([label, value]) => (
                  <div key={label} className="grid gap-1 py-3.5 first:pt-0 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                    <dt className="text-sm text-muted">{label}</dt>
                    <dd className="font-semibold text-ink [overflow-wrap:anywhere]">{value}</dd>
                  </div>
                ))}
                <div className="grid gap-1 py-3.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                  <dt className="text-sm text-muted">Abstract</dt>
                  <dd className="whitespace-pre-line leading-relaxed text-navy-800 [overflow-wrap:anywhere]">{team.abstract}</dd>
                </div>
              </dl>
              {canEdit && (
                <Button variant="outline" size="sm" className="mt-4" onClick={() => setEditing(true)}>
                  <Pencil size={15} aria-hidden="true" />
                  Edit details
                </Button>
              )}
            </>
          )}
        </Panel>
      </div>

      <div className="min-w-0 space-y-6 lg:sticky lg:top-40">
        {team.status === "draft" && <SubmitPanel team={team} isLeader={isLeader} editable={editable} registration={registration} />}
        <TeamFacts team={team} />
        {((team.status === "draft" && editable) || (team.status === "withdrawn" && registration === "open")) && (
          <DangerZone team={team} deletes={isLeader && team.status === "draft"} onDone={onLeft} />
        )}
      </div>
    </div>
    </>
  );
}

/** A student who is already in a team opened an invite link to another team (see app/join). */
function OtherTeamInvite({ team }: { team: Team }) {
  const [code, setCode] = useState(() => {
    const pending = pendingJoinCode();
    return pending === team.joinCode ? null : pending;
  });
  // Their own team's link (e.g. the leader testing it) needs no notice.
  useEffect(() => {
    if (pendingJoinCode() === team.joinCode) clearPendingJoinCode();
  }, [team.joinCode]);
  if (!code) return null;
  const dismiss = () => {
    clearPendingJoinCode();
    setCode(null);
  };
  return (
    <Notice tone="info" title="You opened an invite to another team" className="mb-6">
      The invite was for team code <span className="font-mono font-semibold">{code}</span>, but you are already in {team.name}. A student can be in
      only one team; to switch, leave this team first and then join with that code.{" "}
      <button type="button" onClick={dismiss} className="font-semibold text-accent-600 hover:underline">
        Dismiss
      </button>
    </Notice>
  );
}

/** A startup is one entry with one person: who it is and how to reach them, in place of a members table. */
function StartupPanel({ team }: { team: Team }) {
  const person = team.members[0];
  const rows: [string, string][] = [
    ["Startup", team.institution],
    ["Contact person", person?.fullName ?? ""],
    ["Email", person?.email ?? ""],
  ];
  return (
    <Panel title="Your startup" description="A startup is a single entry, so there are no teammates to add.">
      <dl className="divide-y divide-line">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 py-3.5 first:pt-0 last:pb-0 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="font-semibold text-ink [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function MembersTable({ team, canEdit, leaderId }: { team: Team; canEdit: boolean; leaderId: string }) {
  const { refresh } = usePortal();
  const { run, pending, error } = useAction();
  const [removing, setRemoving] = useState<Team["members"][number] | null>(null);

  const remove = async () => {
    if (!removing) return;
    if (await run(() => api.removeMember(team.id, removing.userId))) {
      setRemoving(null);
      await refresh();
    }
  };

  return (
    <>
      <table className="w-full border-collapse text-left text-[15px]">
        <thead>
          <tr className="border-b border-line text-xs font-bold uppercase tracking-wider text-muted">
            <th scope="col" className="pb-3 pr-4 font-bold">Name</th>
            <th scope="col" className="hidden pb-3 pr-4 font-bold sm:table-cell">Year</th>
            <th scope="col" className="hidden pb-3 pr-4 font-bold sm:table-cell">Role</th>
            {canEdit && (
              <th scope="col" className="pb-3">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {team.members.map((member) => {
            const leader = member.userId === leaderId;
            const role = leader ? "Leader" : "Member";
            return (
              <tr key={member.userId} className="border-b border-line last:border-0">
                <td className="py-3.5 pr-4">
                  <span className="block font-semibold text-ink">{member.fullName}</span>
                  <span className="block break-all text-sm text-muted">{member.email}</span>
                  {/* On phones, year and role sit under the name instead of in their own columns. */}
                  <span className="mt-1 block text-xs text-muted sm:hidden">
                    {yearLabel(member.year, team.participantType)}
                    {member.department ? `, ${member.department}` : ""} / {role}
                  </span>
                </td>
                <td className="hidden py-3.5 pr-4 text-sm text-muted sm:table-cell">
                  {yearLabel(member.year, team.participantType)}
                  {member.department && <span className="block">{member.department}</span>}
                </td>
                <td className="hidden py-3.5 pr-4 sm:table-cell">{leader ? <Pill tone="orange">Leader</Pill> : <span className="text-sm text-muted">Member</span>}</td>
                {canEdit && (
                  <td className="py-3.5 text-right">
                    {!leader && (
                      <Button variant="link" onClick={() => setRemoving(member)}>
                        Remove
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.fullName ?? "member"}?`}
        confirmLabel="Remove member"
        confirmVariant="danger"
        pending={pending}
        error={error}
        onConfirm={remove}
        onClose={() => setRemoving(null)}
      >
        They will no longer be part of {team.name}. You can invite them again later if you change your mind.
      </ConfirmDialog>
    </>
  );
}

function PendingInvitations({ team, canEdit }: { team: Team; canEdit: boolean }) {
  const { refresh } = usePortal();
  const { run, pending, error } = useAction();

  const cancel = async (invitationId: string) => {
    if (await run(() => api.cancelInvitation(invitationId))) await refresh();
  };

  return (
    <div className="mt-8">
      <h3 className="text-sm font-bold uppercase tracking-wider text-muted">Waiting to accept</h3>
      <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
        {team.invitations.map((invitation) => (
          <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span className="flex min-w-0 items-center gap-3">
              <Mail size={18} className="shrink-0 text-brand-500" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block break-all text-sm font-semibold text-ink">{invitation.email}</span>
                <span className="block text-xs text-muted">Invited on {formatDate(invitation.createdAt)}</span>
              </span>
            </span>
            {canEdit && (
              <Button variant="link" onClick={() => cancel(invitation.id)} disabled={pending}>
                Cancel invite
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      )}
    </div>
  );
}

function InviteForm({ team }: { team: Team }) {
  const { refresh } = usePortal();
  const { run, pending, error, setError } = useAction();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const slots = openSlots(team);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSent(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (await run(() => api.inviteMember(team.id, email))) {
      setSent(email.trim().toLowerCase());
      setEmail("");
      await refresh();
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 border-t border-line pt-6">
      <h3 className="font-display text-lg font-bold text-ink">Or invite a registered student</h3>
      <p className="mt-1 text-sm text-muted">
        For someone who has already signed in and completed their profile. No email is sent: the invitation waits on their dashboard
        until they accept it.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
        <Field
          id="invite-email"
          label="Student's email"
          className="flex-1"
          error={error}
          hint={`${slots} more ${slots === 1 ? "member" : "members"} can be invited.${
            team.participantType === "kiet"
              ? ` Any KIET student can join, from any department or course; the team stays in the ${team.department} department round. Use their @kiet.edu email.`
              : ""
          }`}
        >
          <Input
            id="invite-email"
            type="email"
            value={email}
            invalid={!!error}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            placeholder={team.participantType === "kiet" ? "name@kiet.edu" : "name@example.com"}
            autoComplete="off"
          />
        </Field>
        <Button type="submit" variant="dark" pending={pending} className="sm:mt-7">
          <Send size={16} aria-hidden="true" />
          Invite
        </Button>
      </div>
      {sent && (
        <Notice tone="success" className="mt-4">
          {sent} is invited. They will see it on their dashboard the next time they sign in; tell them to look there.
        </Notice>
      )}
    </form>
  );
}

/**
 * Getting teammates in: share an invite (any app, WhatsApp, the student's own email) with the team code and a join
 * link, or, for the leader, invite someone who has already registered. The portal itself sends no email.
 */
function AddTeammates({ team, isLeader, canEdit }: { team: Team; isLeader: boolean; canEdit: boolean }) {
  const { refresh } = usePortal();
  const { run, pending, error, setError } = useAction();
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState<"code" | "message" | null>(null);
  // Portal pages render only in the browser. The share sheet exists on phones and some desktop browsers; elsewhere
  // "Share" copies the message. The join link uses the address the portal is open at.
  const [canShare] = useState(() => typeof navigator.share === "function");
  const link = joinLink(team.joinCode);
  const slots = openSlots(team);
  const { closes } = useRegistrationDates();
  const fullMessage = inviteMessage(team, closes, link);

  const copy = async (what: "code" | "message") => {
    try {
      await navigator.clipboard.writeText(what === "code" ? team.joinCode : fullMessage);
      setError(null);
      setCopied(what);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      setError("Copying is blocked in this browser. Select the code and copy it instead.");
    }
  };

  const share = async () => {
    if (!canShare) return copy("message");
    try {
      await navigator.share({ title: `Join ${team.name} for InnoTech26`, text: inviteMessage(team, closes), url: link });
    } catch (err) {
      // Closing the share sheet is not an error; anything else falls back to copying.
      if (!(err instanceof DOMException && err.name === "AbortError")) await copy("message");
    }
  };

  const reset = async () => {
    if (await run(() => api.resetJoinCode(team.id))) {
      setConfirming(false);
      await refresh();
    }
  };

  const where = team.participantType === "kiet" ? "KIET (any department or course)" : team.institution;
  const subject = encodeURIComponent(`Join my InnoTech26 team ${team.name}`);
  return (
    <Panel
      title="Add teammates"
      description={`${slots} more ${slots === 1 ? "student" : "students"} from ${where} can join. Send them the invite: they sign in with Google and join with your team code.`}
    >
      <Button size="lg" className="w-full" onClick={share}>
        <Share2 size={18} aria-hidden="true" />
        {canShare ? "Share invite" : copied === "message" ? "Invite message copied" : "Copy invite message"}
      </Button>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(fullMessage)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${buttonStyles("outline", "sm")} w-full`}
        >
          <MessageCircle size={16} aria-hidden="true" />
          WhatsApp
        </a>
        <a
          href={`mailto:?subject=${subject}&body=${encodeURIComponent(fullMessage)}`}
          className={`${buttonStyles("outline", "sm")} w-full`}
        >
          <Mail size={16} aria-hidden="true" />
          Email
        </a>
      </div>
      {canShare && (
        <Button variant="link" className="mt-3" onClick={() => copy("message")}>
          <Copy size={14} aria-hidden="true" />
          {copied === "message" ? "Invite message copied" : "Copy the invite message"}
        </Button>
      )}

      <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-muted">Team code</p>
          <span className="select-all font-mono text-2xl font-bold tracking-[0.2em] text-ink" aria-label={`Team code ${team.joinCode.split("").join(" ")}`}>
            {team.joinCode}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={() => copy("code")}>
          {copied === "code" ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          {copied === "code" ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="mt-3 text-sm text-muted">
        Anyone with this code or link can join while there is space, so share it only with your teammates. The leader can remove anyone who
        joins by mistake{canEdit ? " or get a new code, which stops the old code and links working" : ""}.
      </p>
      {error && !confirming && (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      )}
      {canEdit && (
        <Button
          variant="link"
          className="mt-3"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
        >
          <RefreshCw size={14} aria-hidden="true" />
          Get a new code
        </Button>
      )}

      {canEdit && isLeader && <InviteForm team={team} />}

      <ConfirmDialog
        open={confirming}
        title="Get a new team code?"
        confirmLabel="Get new code"
        pending={pending}
        error={error}
        onConfirm={reset}
        onClose={() => setConfirming(false)}
      >
        The current code {team.joinCode} and any invite links you shared stop working immediately. Members who already joined stay in the team.
      </ConfirmDialog>
    </Panel>
  );
}

function SubmitPanel({ team, isLeader, editable, registration }: { team: Team; isLeader: boolean; editable: boolean; registration: RegistrationState | null }) {
  const { refresh } = usePortal();
  const { run, pending, error, setError } = useAction();
  const [confirming, setConfirming] = useState(false);
  const checks = submissionChecks(team, registration);
  const ready = checks.every((check) => check.ok);
  const startup = team.participantType === "startup";
  const noun = startup ? "entry" : "team";

  const submit = async () => {
    if (await run(() => api.submitTeam(team.id))) {
      setConfirming(false);
      await refresh();
    }
  };

  return (
    <Panel title={`Submit your ${noun}`} description={startup ? "Once submitted, your entry is locked for good." : "Once submitted, the team and all its members are locked for good."}>
      <ul className="space-y-3">
        {checks.map((check) => (
          <li key={check.label} className="flex gap-3 text-sm">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${check.ok ? "bg-emerald-500 text-white" : "bg-line text-muted"}`}
              aria-hidden="true"
            >
              {check.ok ? <Check size={13} strokeWidth={3} /> : <X size={13} strokeWidth={3} />}
            </span>
            <span className={check.ok ? "text-ink" : "text-muted"}>
              {check.label}
              <span className="sr-only">{check.ok ? " (done)" : " (not yet)"}</span>
            </span>
          </li>
        ))}
      </ul>

      {isLeader ? (
        <Button
          className="mt-6 w-full"
          disabled={!ready || !editable}
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
        >
          Submit and lock {noun}
        </Button>
      ) : (
        <p className="mt-6 text-sm text-muted">The team leader submits the team when everyone has joined.</p>
      )}

      <ConfirmDialog
        open={confirming}
        title={`Lock and submit ${team.name}?`}
        confirmLabel={startup ? "Lock entry and submit" : "Lock team and submit"}
        confirmVariant="destructive"
        pending={pending}
        error={error}
        typeToConfirm={team.name}
        typeToConfirmLabel={startup ? "entry name" : "team name"}
        onConfirm={submit}
        onClose={() => setConfirming(false)}
      >
        {startup ? (
          <>
            <p className="font-semibold text-ink">This locks your entry, and it cannot be undone from here.</p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li>The entry name, category, domain, project title and abstract can no longer be changed.</li>
              <li>You cannot create another entry.</li>
              <li>An admin must accept your entry as a legal one before it counts.</li>
            </ul>
            <p className="mt-4">Check the category and the project details before you continue.</p>
          </>
        ) : (
          <>
            <p className="font-semibold text-ink">This locks the whole team, and it cannot be undone from here.</p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li>
                <strong className="text-ink">All {team.members.length} members are locked in:</strong> nobody can leave, and nobody can be added or removed.
                They cannot join or create another team.
              </li>
              <li>The team name, category, domain, project title and abstract can no longer be changed.</li>
              <li>If a member withdraws later, the team is not considered further.</li>
              {team.approvalRequired && (
                <li>
                  {team.participantType === "college" || team.participantType === "school"
                    ? "The organisers review every submitted team and accept it before stalls are allotted for the Grand Finale."
                    : "An admin must accept your team as a legal entry before it counts."}
                </li>
              )}
            </ul>
            <div className="mt-4 rounded-2xl bg-surface px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Members being locked</p>
              <ul className="mt-1.5 space-y-0.5 text-ink">
                {team.members.map((member) => (
                  <li key={member.userId}>
                    {member.fullName} {member.role === "leader" && <span className="text-xs text-muted">(leader)</span>}
                  </li>
                ))}
              </ul>
            </div>
            <p className="mt-4">Check every name, the category and the project details before you continue.</p>
          </>
        )}
      </ConfirmDialog>
    </Panel>
  );
}

export const statusLabels: Record<Team["status"], string> = {
  draft: "Not submitted",
  submitted: "Submitted and locked",
  withdrawn: "Withdrawn",
  disqualified: "Disqualified",
  archived: "Archived",
};

function TeamFacts({ team }: { team: Team }) {
  const startup = team.participantType === "startup";
  const rows = [
    [startup ? "Entry ID" : "Team ID", team.code],
    ["Status", statusLabels[team.status]],
    ...(team.approvalRequired
      ? ([
          [
            "Approval",
            team.participantType === "college" || team.participantType === "school"
              ? team.approvedAt
                ? "Accepted by the organisers"
                : "In the queue to be accepted"
              : team.approvedAt
                ? "Accepted by an admin"
                : "Waiting for an admin",
          ],
        ] as [string, string][])
      : []),
    [team.participantType === "kiet" ? "Department" : startup ? "Startup" : "Institution", team.department ? departmentLabel(team.department) : team.institution],
    // Startups and COE KIET teams see their route only once an admin has accepted them; other colleges and schools are told
    // nothing about a route (their queue or stall status is the card at the top of the dashboard).
    ...(team.route === "department"
      ? ([["Route", "Department round, then Grand Finale"]] as [string, string][])
      : directFinaleKind(team.participantType, team.department) !== null && team.approvedAt
        ? ([["Route", "Directly to the Grand Finale"]] as [string, string][])
        : []),
    ["Created", formatDate(team.createdAt)],
  ];
  return (
    <Panel title={startup ? "Entry details" : "Team details"}>
      <dl className="space-y-3 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right font-semibold text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/** Delete (leader of a draft team) or leave. A withdrawn team can be left by anyone, so they can join another team. */
function DangerZone({ team, deletes, onDone }: { team: Team; deletes: boolean; onDone: () => Promise<void> }) {
  const { run, pending, error, setError } = useAction();
  const [confirming, setConfirming] = useState(false);
  const withdrawn = team.status === "withdrawn";

  const confirm = async () => {
    const ok = await run(() => (deletes ? api.deleteTeam(team.id) : api.leaveTeam(team.id)).then(() => true));
    if (ok) {
      setConfirming(false);
      await onDone();
    }
  };

  return (
    <Panel title={deletes ? (team.participantType === "startup" ? "Delete entry" : "Delete team") : "Leave team"}>
      <p className="text-sm text-muted">
        {deletes
          ? team.participantType === "startup"
            ? "Deleting the entry removes it. You can then create a new one before registration closes."
            : "Deleting the team removes all members and cancels pending invitations. Everyone can then join or create another team."
          : withdrawn
            ? "This team has been withdrawn. Leave it if you want to join or create another team before registration closes."
            : "You can leave before the team is submitted, then join or create another team."}
      </p>
      <Button
        variant="danger"
        size="sm"
        className="mt-4"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
      >
        {deletes ? (team.participantType === "startup" ? "Delete entry" : "Delete team") : "Leave team"}
      </Button>

      <ConfirmDialog
        open={confirming}
        title={deletes ? `Delete ${team.name}?` : `Leave ${team.name}?`}
        confirmLabel={deletes ? (team.participantType === "startup" ? "Delete entry" : "Delete team") : "Leave team"}
        confirmVariant="danger"
        pending={pending}
        error={error}
        onConfirm={confirm}
        onClose={() => setConfirming(false)}
      >
        {deletes
          ? "This cannot be undone."
          : withdrawn
            ? "You cannot rejoin this team afterwards."
            : "The leader will need to invite you again if you want to rejoin."}
      </ConfirmDialog>
    </Panel>
  );
}
