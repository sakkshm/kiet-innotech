"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, BadgeCheck, Ban, ChevronDown, CircleX, RotateCcw, Send, Undo2, UserMinus, X, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import type { AdminTeam, BulkAction, BulkResult } from "@/lib/admin-types";
import { plural } from "@/lib/format";
import { buttonClass } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Notice } from "@/components/ui/Notice";

type Who = "all" | "approver" | "super";

type Item = { action: BulkAction; label: string; Icon: LucideIcon; who: Who; group: "Acceptance" | "Status" };

/** Who may do what is the same as for a single team: approvers accept and reject, super admins do the rest, anyone can withdraw. */
const items: Item[] = [
  { action: "accept", label: "Accept teams", Icon: BadgeCheck, who: "approver", group: "Acceptance" },
  { action: "unaccept", label: "Back to queue", Icon: Undo2, who: "approver", group: "Acceptance" },
  { action: "reject", label: "Reject teams", Icon: CircleX, who: "approver", group: "Acceptance" },
  { action: "withdraw", label: "Withdraw teams", Icon: UserMinus, who: "all", group: "Status" },
  { action: "disqualify", label: "Disqualify teams", Icon: Ban, who: "super", group: "Status" },
  { action: "restore", label: "Restore teams", Icon: RotateCcw, who: "super", group: "Status" },
  { action: "archive", label: "Archive drafts", Icon: Archive, who: "super", group: "Status" },
  { action: "submit", label: "Submit drafts", Icon: Send, who: "super", group: "Status" },
];

/** The "Actions" button of the selection bar, with the bulk actions the admin may use. */
export function BulkActionMenu({ approver, isSuper, onPick }: { approver: boolean; isSuper: boolean; onPick: (action: BulkAction) => void }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const allowed = items.filter((item) => item.who === "all" || (item.who === "approver" && approver) || (item.who === "super" && isSuper));
  const groups = (["Acceptance", "Status"] as const).map((name) => ({ name, items: allowed.filter((item) => item.group === name) })).filter((g) => g.items.length > 0);

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={trigger}
        type="button"
        className={buttonClass("secondary", "sm")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Actions
        <ChevronDown aria-hidden="true" className="size-3.5" />
      </button>
      {open && (
        <div role="menu" aria-label="Actions for the selected teams" className="absolute right-0 top-full z-20 mt-2 w-60 rounded-2xl bg-white p-1.5 text-navy-900 shadow-xl ring-1 ring-line">
          {groups.map((group, index) => (
            <div key={group.name} role="group" aria-label={group.name} className={index > 0 ? "mt-1 border-t border-line pt-1" : ""}>
              <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">{group.name}</p>
              {group.items.map(({ action, label, Icon }) => (
                <button
                  key={action}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onPick(action);
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition hover:bg-surface focus-visible:bg-surface focus-visible:outline-2 focus-visible:outline-brand-500 ${
                    action === "reject" || action === "disqualify" ? "text-red-700" : ""
                  }`}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  {label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type Copy = {
  title: (n: string) => string;
  confirm: string;
  tone: "primary" | "danger";
  reasonLabel?: string;
  /** What happened, after "N teams". */
  done: string;
  description: ReactNode;
};

const strong = (text: string) => <strong className="text-navy-900">{text}</strong>;

const copy: Record<BulkAction, Copy> = {
  accept: {
    title: (n) => `Accept ${n}?`,
    confirm: "Accept teams",
    tone: "primary",
    done: "accepted",
    description: (
      <>
        Only {strong("submitted")} startups, COE KIET, other-college and school teams change; the rest are skipped and listed. Accepted teams can be allotted
        stalls for the Grand Finale, and their students see that they are accepted. A rejected team that you accept is no longer rejected.
      </>
    ),
  },
  unaccept: {
    title: (n) => `Put ${n} back in the queue?`,
    confirm: "Back to queue",
    tone: "primary",
    done: "back in the queue",
    description: (
      <>
        Accepted and rejected teams wait for a decision again. Teams that already have a judging panel, scores or a stall stay as they are and are listed.
      </>
    ),
  },
  reject: {
    title: (n) => `Reject ${n}?`,
    confirm: "Reject teams",
    tone: "danger",
    reasonLabel: "Reason (the students see it)",
    done: "rejected",
    description: (
      <>
        Rejected teams are not accepted: they get no stall, and their students see that the team was not accepted, with your reason. Only {strong("submitted")}{" "}
        startups, COE KIET, other-college and school teams change. A team that already has a judging panel, scores or a stall is skipped and listed. You can
        accept a rejected team or put it back in the queue later.
      </>
    ),
  },
  withdraw: {
    title: (n) => `Withdraw ${n}?`,
    confirm: "Withdraw teams",
    tone: "danger",
    reasonLabel: "Reason",
    done: "withdrawn",
    description: (
      <>
        Withdrawn teams no longer take part: their pending invitations are cancelled, any finalist nomination is removed, and their students can leave and join
        another team. Only {strong("draft")} and {strong("submitted")} teams change; the rest are skipped and listed. A super admin can restore them.
      </>
    ),
  },
  disqualify: {
    title: (n) => `Disqualify ${n}?`,
    confirm: "Disqualify teams",
    tone: "danger",
    reasonLabel: "Reason",
    done: "disqualified",
    description: (
      <>
        Disqualified teams are out of InnoTech26 and their students are told so. Draft, submitted and archived teams change; withdrawn or disqualified teams are
        skipped and listed. Only a super admin can restore them.
      </>
    ),
  },
  restore: {
    title: (n) => `Restore ${n}?`,
    confirm: "Restore teams",
    tone: "primary",
    reasonLabel: "Reason",
    done: "restored",
    description: (
      <>
        Withdrawn, disqualified and archived teams return to submitted (or draft, if they were never submitted). Cancelled invitations are not restored. A team that
        lost members since it was withdrawn is skipped and listed.
      </>
    ),
  },
  archive: {
    title: (n) => `Archive ${n}?`,
    confirm: "Archive",
    tone: "danger",
    reasonLabel: "Reason",
    done: "archived",
    description: (
      <>
        Only {strong("draft")} teams whose registration has closed are archived (KIET, COE KIET and startups after 15 October; other colleges and schools after 21
        October). Others are skipped and listed. Members, details and history are kept, and their students see that their registration is archived. A super
        admin can restore, submit or disqualify an archived team later.
      </>
    ),
  },
  submit: {
    title: (n) => `Submit ${n}?`,
    confirm: "Submit teams",
    tone: "primary",
    reasonLabel: "Reason",
    done: "submitted",
    description: (
      <>
        Submits {strong("draft")} and {strong("archived")} teams for their students, even though registration is closed for them. The team rules still apply
        (members, category): a team that breaks them is skipped and listed. Pending invitations are cancelled.
      </>
    ),
  },
};

/** Asks for confirmation (and a reason where one is needed), applies the action to the selected teams, then reports. */
export function BulkActionDialog({ action, teams, onClose, onDone }: { action: BulkAction; teams: AdminTeam[]; onClose: () => void; onDone: (result: BulkResult) => void }) {
  const text = copy[action];
  const bannedCount = action === "restore" ? teams.reduce((n, t) => n + t.members.filter((m) => m.banned).length, 0) : 0;
  const [unban, setUnban] = useState(true);
  return (
    <ConfirmDialog
      title={text.title(plural(teams.length, "selected team"))}
      description={text.description}
      confirmLabel={text.confirm}
      tone={text.tone}
      reasonLabel={text.reasonLabel}
      onClose={onClose}
      onConfirm={async (reason) => {
        const result = await api.bulkTeams(
          teams.map((t) => t.id),
          action,
          { reason: text.reasonLabel ? reason : undefined, unbanMembers: action === "restore" && bannedCount > 0 && unban },
        );
        onDone(result);
      }}
    >
      {bannedCount > 0 && (
        <label className="mb-4 flex cursor-pointer items-start gap-2.5 rounded-xl bg-amber-50 px-3 py-3 text-sm">
          <input type="checkbox" checked={unban} onChange={(e) => setUnban(e.target.checked)} className="mt-0.5 size-4 accent-brand-600" />
          <span>
            <span className="font-semibold text-navy-900">Also lift the ban on {plural(bannedCount, "banned member")}</span>
            <span className="block text-xs text-muted">Restoring alone leaves them banned, so they still cannot sign in to the portal.</span>
          </span>
        </label>
      )}
    </ConfirmDialog>
  );
}

/** What a bulk action did: how many teams changed, and which were skipped and why. */
export function BulkResultNotice({ result, onDismiss }: { result: BulkResult; onDismiss: () => void }) {
  const problems = result.skipped.length > 0 || result.notFound > 0;
  return (
    <Notice
      tone={problems ? "warning" : "success"}
      title={`${plural(result.changed, "team")} ${copy[result.action].done}`}
      action={
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1 inline-flex size-7 items-center justify-center rounded-full text-navy-800/70 hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-brand-500"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      }
    >
      {!problems && result.changed === 0 && "Nothing to change: the selected teams were already in that state."}
      {result.skipped.length > 0 && (
        <details open={result.skipped.length <= 5}>
          <summary className="cursor-pointer font-medium">{plural(result.skipped.length, "team")} skipped</summary>
          <ul className="mt-1.5 max-h-52 space-y-1 overflow-y-auto pr-2">
            {result.skipped.map((s) => (
              <li key={s.code}>
                <span className="font-mono text-xs font-semibold">{s.code}</span> {s.name}: {s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      {result.notFound > 0 && <p>{plural(result.notFound, "selected team")} no longer exist or are outside your area.</p>}
    </Notice>
  );
}
