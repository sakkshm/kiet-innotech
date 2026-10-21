import type { DirectFinaleKind } from "@/lib/rules";
import type { Team } from "@/lib/types";
import { Notice } from "@/components/ui/form";
import { MailLink } from "@/components/ui/MailLink";

/**
 * Startups and COE KIET teams need an admin to accept their entry as a legal one. Until then they are only told whom
 * to contact: nothing is said about the finals or the department round. Once it is accepted, they are told they are
 * in the Grand Finale (so there is no department round for them) and that their stall number is allotted, not chosen.
 */
export function FinaleNote({ kind, team, className }: { kind: DirectFinaleKind; team?: Team | null; className?: string }) {
  const noun = kind === "startup" ? "entry" : "team";

  if (team?.approvalRequired && team.approvedAt) {
    return (
      <Notice tone="success" title="Approved: you are in the Grand Finale" className={className}>
        An admin has accepted your {noun} as a legal entry. You are already in the Grand Finale, so there is no department round for you and no evaluation to
        prepare for beforehand. You are judged directly at the Grand Finale on 30 October 2026 at KIET. You do not choose a stall: your stall number will be
        allotted to you before the Grand Finale.
      </Notice>
    );
  }

  if (team?.approvalRequired && team.rejectedAt) {
    return (
      <Notice tone="error" title={`Your ${noun} was not accepted`} className={className}>
        The organisers could not accept your {noun}.{team.rejectedReason ? ` Reason: ${team.rejectedReason}` : ""} Please write to <MailLink /> if you have any
        questions.
      </Notice>
    );
  }

  if (team?.approvalRequired) {
    return (
      <Notice tone="warning" title="Waiting for approval" className={className}>
        Your {noun} counts as a legal entry only once an admin has accepted it. Please contact the coordinator, or write to <MailLink />, to get it accepted.
      </Notice>
    );
  }

  // Nothing to say before the entry or team exists.
  return null;
}
