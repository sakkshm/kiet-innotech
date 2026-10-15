"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, Mail } from "lucide-react";
import { api } from "@/lib/api";
import { dayMonth } from "@/lib/format";
import { useRegistrationDates, useRegistrationState } from "@/lib/registration";
import { useDateRows } from "@/lib/schedule-content";
import { TEAM_MIN_SIZE, directFinaleKind, participantTypeLabels, yearLabel } from "@/lib/rules";
import type { Invitation, Team } from "@/lib/types";
import { Button, Notice, buttonStyles } from "@/components/ui/form";
import { CreateOrJoin } from "@/components/portal/CreateOrJoin";
import { FinaleNote } from "@/components/portal/FinaleNote";
import { JudgingStatus } from "@/components/portal/JudgingStatus";
import { PageHeading, Panel } from "@/components/portal/PageHeading";
import { usePortal } from "@/components/portal/PortalProvider";
import { TeamStatusNotice, categoryName, statusLabels } from "@/components/portal/TeamManager";
import { useAction } from "@/components/portal/useAction";

export default function DashboardPage() {
  const { me, team, invitations } = usePortal();
  const profile = me.profile!;

  const startup = profile.participantType === "startup";
  const direct = directFinaleKind(profile.participantType, profile.department);
  const submitted = team !== null && team.status !== "draft";
  // Startups and COE KIET teams are not finished until an admin has accepted them.
  const accepted = submitted && (!team.approvalRequired || team.approvedAt !== null);
  const submissionDetail = (noun: string) =>
    !submitted ? (noun === "Entry" ? "Submit your entry" : "Leader submits the team") : accepted ? `${noun} locked` : "Waiting for approval";
  const steps = startup
    ? [
        { title: "Profile", done: true, detail: "Completed" },
        { title: "Entry", done: team !== null, detail: team ? team.name : "Add your project" },
        { title: "Submission", done: accepted, detail: submissionDetail("Entry") },
      ]
    : [
        { title: "Profile", done: true, detail: "Completed" },
        { title: "Team", done: team !== null, detail: team ? team.name : "Create or join a team" },
        {
          title: "Members",
          done: (team?.members.length ?? 0) >= TEAM_MIN_SIZE,
          detail: team ? `${team.members.length} joined, ${TEAM_MIN_SIZE} to 5 needed` : "2 to 5 members",
        },
        { title: "Submission", done: accepted, detail: submissionDetail("Team") },
      ];
  const completed = steps.filter((s) => s.done).length;

  return (
    <>
      <PageHeading eyebrow={`${participantTypeLabels[profile.participantType]}${profile.department ? ` / ${profile.department}` : ""}${profile.club ? ` / ${profile.club}` : ""}`} title={`Hello, ${profile.fullName.split(" ")[0]}`}>
        {completed === steps.length ? "Your registration is complete." : `Your registration is ${completed} of ${steps.length} steps done.`}
      </PageHeading>

      {team && (
        <div className="mb-6 empty:hidden">
          <TeamStatusNotice team={team} />
        </div>
      )}
      {direct && <FinaleNote kind={direct} team={team} className="mb-6" />}
      {accepted && (
        <div className="mb-6">
          <JudgingStatus />
        </div>
      )}

      <Panel className="mb-6">
        <ol
          className={`grid grid-cols-[minmax(0,1fr)] gap-6 sm:grid-cols-[repeat(2,minmax(0,1fr))] lg:gap-0 lg:divide-x lg:divide-line ${
            steps.length === 3 ? "lg:grid-cols-[repeat(3,minmax(0,1fr))]" : "lg:grid-cols-[repeat(4,minmax(0,1fr))]"
          }`}
        >
          {steps.map((step, index) => (
            <li key={step.title} className="flex min-w-0 gap-4 lg:px-6 lg:first:pl-0 lg:last:pr-0">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  step.done ? "bg-emerald-500 text-white" : "bg-surface text-muted ring-1 ring-line"
                }`}
                aria-hidden="true"
              >
                {step.done ? <Check size={18} strokeWidth={3} /> : index + 1}
              </span>
              <div className="min-w-0">
                <p className="font-display font-bold text-ink">
                  {step.title}
                  <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
                </p>
                <p className="truncate text-sm text-muted">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0 space-y-6">
          {!team && invitations.length > 0 && <Invitations invitations={invitations} />}
          {team ? <TeamSummary team={team} isLeader={team.leaderId === profile.userId} /> : <CreateOrJoin hasInvitations={invitations.length > 0} />}
        </div>

        <div className="min-w-0 space-y-6">
          {/* Startups and COE KIET teams get no route panel; their notice tells them where they stand once an admin has accepted them. */}
          {direct === null && (
          <Panel title="Your route">
            <p className="text-sm leading-relaxed text-muted">
              {profile.participantType === "kiet"
                ? `KIET teams are first evaluated at the department round (22 to 24 October). Each department nominates its best team in every category for the Grand Finale on 30 October.`
                : profile.participantType === "school"
                  ? "School teams can enter any category and go straight to the Grand Finale on 30 October at KIET."
                  : "Teams from other colleges go straight to the Grand Finale on 30 October at KIET."}
            </p>
            {!startup && (
              <p className="mt-4 text-sm text-muted">
                {profile.participantType === "school" ? "Class" : "Year"}:{" "}
                <span className="font-semibold text-ink">{yearLabel(profile.year, profile.participantType)}</span>
              </p>
            )}
          </Panel>
          )}
          <KeyDates direct={direct !== null && team !== null && team.approvalRequired && team.approvedAt !== null} />
        </div>
      </div>
    </>
  );
}

function Invitations({ invitations }: { invitations: Invitation[] }) {
  const { refresh } = usePortal();
  const registration = useRegistrationState();
  const { run, pending, error } = useAction();
  const [active, setActive] = useState<string | null>(null);

  const respond = async (invitation: Invitation, accept: boolean) => {
    setActive(invitation.id);
    const done = await run(() => api.respondToInvitation(invitation.id, accept).then(() => true));
    setActive(null);
    if (done) await refresh();
  };

  return (
    <Panel title="Team invitations" description="You can join only one team. Accepting declines your other invitations.">
      <ul className="divide-y divide-line">
        {invitations.map((invitation) => (
          <li key={invitation.id} className="flex flex-col gap-4 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <Mail size={20} className="mt-0.5 shrink-0 text-accent-500" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-semibold text-ink">
                  {invitation.teamName} <span className="font-normal text-muted">({invitation.teamCode})</span>
                </p>
                <p className="text-sm text-muted">
                  {categoryName(invitation.category)}. Invited by {invitation.leaderName}.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" onClick={() => respond(invitation, true)} pending={pending && active === invitation.id} disabled={pending || registration !== "open"}>
                Accept
              </Button>
              <Button size="sm" variant="outline" onClick={() => respond(invitation, false)} disabled={pending}>
                Decline
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <Notice tone="error" className="mt-4">
          {error}
        </Notice>
      )}
    </Panel>
  );
}

function TeamSummary({ team, isLeader }: { team: Team; isLeader: boolean }) {
  const { closes } = useRegistrationDates();
  const startup = team.participantType === "startup";
  const next =
    team.status !== "draft"
      ? "Nothing more to do. Watch this page for results."
      : startup
        ? `Review your entry and submit it before ${dayMonth(closes)}.`
      : isLeader
        ? team.members.length < TEAM_MIN_SIZE
          ? "Invite at least one more member."
          : team.invitations.length > 0
            ? "Wait for pending invitations to be accepted or cancel them, then submit."
            : `Review your team and submit it before ${dayMonth(closes)}.`
        : "Your leader will submit the team once everyone has joined.";

  const rows = startup
    ? [
        ["Startup", team.institution],
        ["Entry", `${team.name} (${team.code})`],
        ["Category", categoryName(team.category)],
        ["Status", statusLabels[team.status]],
      ]
    : [
        ["Team", `${team.name} (${team.code})`],
        ["Category", categoryName(team.category)],
        ["Status", statusLabels[team.status]],
        ["Members", team.members.map((m) => m.fullName).join(", ")],
        ["Your role", isLeader ? "Team leader" : "Member"],
      ];

  return (
    <Panel title={startup ? "Your startup entry" : "Your team"}>
      <dl className="divide-y divide-line">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 py-3 first:pt-0 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="font-semibold text-ink [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 rounded-2xl bg-surface p-4 text-sm text-navy-800">
        <span className="font-semibold">Next: </span>
        {next}
      </p>
      <Link href="/team" className={`${buttonStyles("dark")} mt-6`}>
        {isLeader && team.status === "draft" ? (startup ? "Manage entry" : "Manage team") : startup ? "View entry" : "View team"}
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </Panel>
  );
}

/** Dates that only matter to teams taking the department round. */
const DEPARTMENT_ROUND_DATES = ["Department Level", "Finalists Declared"];

function KeyDates({ direct = false }: { direct?: boolean }) {
  const timeline = useDateRows();
  return (
    <Panel title="Key dates">
      <ul className="divide-y divide-line">
        {timeline.filter((item) => !(direct && DEPARTMENT_ROUND_DATES.includes(item.title))).map((item) => (
          <li key={item.title} className="flex justify-between gap-4 py-3 text-sm first:pt-0 last:pb-0">
            <span className="text-navy-800">{item.title}</span>
            <span className="shrink-0 font-semibold text-ink">{item.dateLabel}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
