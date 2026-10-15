"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { directFinaleKind } from "@/lib/rules";
import { Notice } from "@/components/ui/form";
import { ArchivedNotice } from "@/components/portal/ArchivedNotice";
import { CreateOrJoin } from "@/components/portal/CreateOrJoin";
import { FinaleNote } from "@/components/portal/FinaleNote";
import { PageHeading } from "@/components/portal/PageHeading";
import { usePortal } from "@/components/portal/PortalProvider";
import { TeamManager, TeamStatusNotice, categoryName, statusLabels } from "@/components/portal/TeamManager";

export default function TeamPage() {
  const { me, team, invitations } = usePortal();
  const startup = me.profile?.participantType === "startup";
  const direct = team ? directFinaleKind(team.participantType, team.department) : null;

  if (!team) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeading eyebrow={startup ? "Your entry" : "Your team"} title={startup ? "You have not created your entry yet" : "You are not in a team yet"}>
          {startup
            ? "Add your project details and submit your startup entry before registration closes."
            : "Start a team as its leader, or join your leader's team with its team code."}
          {!startup && invitations.length > 0 && (
            <>
              {" "}
              You also have {invitations.length === 1 ? "an invitation" : `${invitations.length} invitations`} waiting on your{" "}
              <Link href="/dashboard" className="font-semibold text-accent-600 hover:underline">
                dashboard
              </Link>
              .
            </>
          )}
        </PageHeading>
        <ArchivedNotice className="mb-6" />
        <CreateOrJoin hasInvitations={invitations.length > 0} />
      </div>
    );
  }

  return (
    <>
      <PageHeading eyebrow={`${team.code} / ${statusLabels[team.status]}`} title={team.name}>
        {categoryName(team.category)}
        {team.participantType === "startup" ? " / Startup" : team.department ? ` / ${team.department} department` : ` / ${team.institution}`}
      </PageHeading>

      <div className="mb-6 space-y-4 empty:hidden">
        <Suspense>
          <CreatedNotice />
        </Suspense>
        <ArchivedNotice />
        <TeamStatusNotice team={team} />
        {direct && <FinaleNote kind={direct} team={team} />}
      </div>

      <TeamManager team={team} />
    </>
  );
}

/** Shown once, right after the student created or joined the team. */
function CreatedNotice() {
  const params = useSearchParams();
  const { team } = usePortal();
  if (!team) return null;
  if (params.get("joined") === "1") {
    return (
      <Notice tone="success" title={`You joined ${team.name}`}>
        Your team leader submits the team once everyone has joined.
      </Notice>
    );
  }
  if (team.participantType === "startup") {
    if (params.get("created") !== "1") return null;
    return (
      <Notice tone="success" title="Entry created">
        Review the details below, then submit your entry before registration closes. Nothing else is needed: a startup has no teammates.
      </Notice>
    );
  }
  if (params.get("created") !== "1" || team.members.length > 1 || team.invitations.length > 0) return null;
  return (
    <Notice tone="success" title="Team created">
      Now add your teammates: tap Share invite below and send it on WhatsApp or anywhere else. You need at least one more member before you can submit.
    </Notice>
  );
}
