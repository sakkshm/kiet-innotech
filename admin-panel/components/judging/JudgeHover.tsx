"use client";

import { useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Juror } from "@/lib/admin-types";
import { roundLabels } from "@/lib/format";
import { roomLabel, slotLabel, slotState } from "@/lib/rooms";

const CARD_WIDTH = 336;
// Room for a card of about six rooms; below that it opens upward when the judge's name is near the bottom of the screen.
const CARD_ROOM = 300;

const stateBadge = { now: ["Now", "bg-emerald-50 text-emerald-800 ring-emerald-200"], over: ["Done", "bg-slate-100 text-slate-600 ring-slate-200"] } as const;

/**
 * A judge's name that shows, on hover or keyboard focus, every room they are booked in and when, earliest first, so an
 * organiser can see at a glance when the judge is taken and when free. The card is fixed to the screen and drawn outside
 * the page's flow (inside the open dialog, if the name is in one, which would otherwise cover it), so a table that
 * scrolls sideways does not cut it off. It does not take the pointer, so it never gets in the way of a click.
 */
export function JudgeHover({ juror, children }: { juror: Juror; children: ReactNode }) {
  const [at, setAt] = useState<({ left: number; top: number } | { left: number; bottom: number }) & { into: HTMLElement } | null>(null);
  const id = useId();

  function show(target: HTMLElement) {
    const box = target.getBoundingClientRect();
    const left = Math.max(8, Math.min(box.left, window.innerWidth - CARD_WIDTH - 8));
    const into = target.closest("dialog") ?? document.body;
    setAt({ into, ...(window.innerHeight - box.bottom < CARD_ROOM && box.top > CARD_ROOM / 2 ? { left, bottom: window.innerHeight - box.top + 6 } : { left, top: box.bottom + 6 }) });
  }

  const rooms = [...juror.panels].sort((a, b) => (a.slotStart ?? "").localeCompare(b.slotStart ?? "") || a.name.localeCompare(b.name));

  return (
    <span
      tabIndex={0}
      aria-describedby={at ? id : undefined}
      onMouseEnter={(event) => show(event.currentTarget)}
      onMouseLeave={() => setAt(null)}
      onFocus={(event) => show(event.currentTarget)}
      onBlur={() => setAt(null)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setAt(null);
      }}
      className="cursor-help rounded underline decoration-dotted decoration-muted/60 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
    >
      {children}
      {at &&
        createPortal(
          <div
            role="tooltip"
            id={id}
            style={{ position: "fixed", width: CARD_WIDTH, left: at.left, ...("top" in at ? { top: at.top } : { bottom: at.bottom }) }}
            className="pointer-events-none z-50 rounded-2xl bg-white p-3.5 text-left text-xs font-normal text-navy-800 shadow-xl ring-1 ring-line"
          >
            <p className="text-sm font-bold text-navy-900">{juror.name}</p>
            <p className="break-all text-muted">
              {juror.email} · {juror.kind === "faculty" ? juror.department : `Outside expert, ${juror.organisation}`}
            </p>
            <p className="mt-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
              {rooms.length === 0 ? "Free" : `Booked in ${rooms.length} ${rooms.length === 1 ? "room" : "rooms"}`}
            </p>
            {rooms.length === 0 ? (
              <p className="mt-1">Not in any room yet, so free at any time.</p>
            ) : (
              <ul className="mt-1.5 space-y-2">
                {rooms.map((room) => {
                  const state = slotState(room.slotStart, room.slotEnd);
                  const badge = state === "now" || state === "over" ? stateBadge[state] : null;
                  return (
                    <li key={room.id} className="rounded-xl bg-surface px-2.5 py-2">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-semibold text-navy-900">{roomLabel(room)}</span>
                        {badge && <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold ring-1 ring-inset ${badge[1]}`}>{badge[0]}</span>}
                      </p>
                      <p className="font-medium text-navy-900">{slotLabel(room.slotStart, room.slotEnd) || "No time set"}</p>
                      <p className="text-muted">
                        {roundLabels[room.round]}
                        {room.department ? ` · ${room.department} teams` : ""}
                        {room.parentDepartment ? " · parent department judge" : ""}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>,
          at.into,
        )}
    </span>
  );
}
