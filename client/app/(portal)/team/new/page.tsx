"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { draftKeys } from "@/lib/drafts";
import { longDate } from "@/lib/format";
import { useRegistrationDates, useRegistrationState } from "@/lib/registration";
import { routeFor } from "@/lib/rules";
import type { TeamInput } from "@/lib/types";
import { Notice, buttonStyles } from "@/components/ui/form";
import { PageHeading, Panel } from "@/components/portal/PageHeading";
import { usePortal } from "@/components/portal/PortalProvider";
import { TeamForm } from "@/components/portal/TeamForm";
import { useAction } from "@/components/portal/useAction";

export default function NewTeamPage() {
  const router = useRouter();
  const { me, team, invitations, refresh } = usePortal();
  const profile = me.profile!;
  const registration = useRegistrationState();
  const { opens, closes } = useRegistrationDates();
  const { run, pending, error } = useAction();
  const created = useRef(false);

  // A student can be in only one team. Skipped right after creating one, which navigates by itself.
  useEffect(() => {
    if (team && !created.current) router.replace("/team");
  }, [team, router]);
  if (team) return null;

  const create = async (input: TeamInput) => {
    if (!(await run(() => api.createTeam(input)))) return false;
    created.current = true;
    await refresh();
    router.push("/team?created=1");
    return true;
  };

  const startup = profile.participantType === "startup";
  // Only KIET teams are told a route. Startups, COE KIET, other colleges and schools are told nothing until an admin accepts them.
  const route = routeFor(profile.participantType, profile.department) === "department" ? `the ${profile.department} department round` : "";

  return (
    <div className="mx-auto max-w-3xl">
      {startup ? (
        <PageHeading eyebrow="Step 2 of 3" title="Create your startup entry">
          Add your project details. There is no team to build: {profile.institution} is a single entry.
        </PageHeading>
      ) : (
        <PageHeading eyebrow="Step 2 of 4" title="Create your team">
          You will be the team leader. After creating the team you can add 1 to 4 registered students from{" "}
          {profile.participantType === "kiet" ? "KIET, from any department" : profile.institution}, by sharing an invite link with your team code.{route && ` Your team goes to ${route}.`}
        </PageHeading>
      )}

      {invitations.length > 0 && (
        <Notice tone="info" title={`You have ${invitations.length === 1 ? "an invitation" : `${invitations.length} invitations`} to join a team`} className="mb-6">
          If you want to join an existing team instead, accept the invitation on your{" "}
          <Link href="/dashboard" className="font-semibold underline">
            dashboard
          </Link>
          . Creating a team of your own means you cannot accept it.
        </Notice>
      )}

      {registration !== "open" ? (
        <Panel>
          <Notice tone={registration === "closed" ? "warning" : "info"} title={registration === "closed" ? "Registration has closed" : `Registration opens on ${longDate(opens)} and closes on ${longDate(closes)}`}>
            {registration === "closed" ? "New teams can no longer be created." : "You can create your team once registration opens."}
          </Notice>
          <Link href="/dashboard" className={`${buttonStyles("outline", "sm")} mt-6`}>
            Back to dashboard
          </Link>
        </Panel>
      ) : (
        <Panel>
          <TeamForm
            participantType={profile.participantType}
            memberYears={[profile.year]}
            initial={startup ? { name: profile.institution.slice(0, 40).trim(), category: 0, domain: "", projectTitle: "", abstract: "" } : undefined}
            submitLabel={startup ? "Create entry" : "Create team"}
            onSubmit={create}
            draftKey={draftKeys.newTeam(me.email)}
            pending={pending}
            error={error}
            onCancel={() => router.push("/dashboard")}
          />
        </Panel>
      )}
    </div>
  );
}
