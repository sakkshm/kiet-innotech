"use client";

import { useRegistrationState } from "@/lib/registration";
import { Notice } from "@/components/ui/form";
import { usePortal } from "./PortalProvider";

/**
 * Once the student's own registration window has closed (KIET and startups on 15 Oct, other colleges and schools on
 * 21 Oct), anyone who is not in a submitted team is told their registration is archived; so are members of a team
 * an organiser archived. It follows the server's window for this student, so it never shows early.
 */
export function ArchivedNotice({ className = "" }: { className?: string }) {
  const { me, team } = usePortal();
  const registration = useRegistrationState();
  if (!me.profile) return null;
  // An organiser archived the team, or the student's window closed with the team still a draft (or no team at all).
  const archived = team?.status === "archived";
  if (!archived && (registration !== "closed" || (team && team.status !== "draft"))) return null;
  const startup = me.profile.participantType === "startup";
  return (
    <Notice tone="warning" title="Your registration is archived" className={className}>
      {team
        ? `Your ${startup ? "entry" : "team"} was not submitted before registration closed, so it has been archived and is not part of InnoTech26.`
        : `You did not ${startup ? "submit an entry" : "join or create a team"} before registration closed, so your registration has been archived and you are not part of InnoTech26.`}
    </Notice>
  );
}
