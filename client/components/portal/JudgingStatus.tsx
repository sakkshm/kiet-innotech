"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Ban, CalendarClock, Clock, Frown, Hourglass, MapPin, PartyPopper, QrCode, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import { attendanceEnabled } from "@/lib/features";
import type { EventPass, ResultCard } from "@/lib/types";

const day = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

const looks: Record<ResultCard["status"], { box: string; Icon: typeof Trophy }> = {
  winner: { box: "bg-gradient-to-br from-amber-400 to-accent-500 text-white ring-amber-300", Icon: Trophy },
  finalist: { box: "bg-emerald-600 text-white ring-emerald-500", Icon: PartyPopper },
  awaiting: { box: "bg-white text-ink ring-line", Icon: Clock },
  not_selected: { box: "bg-white text-ink ring-line", Icon: Frown },
  participated: { box: "bg-white text-ink ring-line", Icon: Frown },
  qualified: { box: "bg-emerald-600 text-white ring-emerald-500", Icon: PartyPopper },
  disqualified: { box: "bg-red-50 text-red-900 ring-red-200", Icon: Ban },
};

/**
 * Where the student is judged (room, building and time, or the finale stall) and the team's results as they are
 * announced: awaiting, finalist or qualified, better luck next time, disqualified, or a prize with its amount.
 */
export function JudgingStatus({ showPassLink = true }: { showPassLink?: boolean }) {
  const [pass, setPass] = useState<EventPass | null>(null);
  const [results, setResults] = useState<ResultCard[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.getMyPass().then((p) => !cancelled && setPass(p), () => undefined);
    api.getMyResults().then((r) => !cancelled && setResults(r.cards), () => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const rounds = pass?.rounds ?? [];
  if (rounds.length === 0 && results.length === 0) return null;

  return (
    <div className="space-y-4">
      {results.map((card) => {
        const { box, Icon } = looks[card.status];
        const bright = card.status === "winner" || card.status === "finalist" || card.status === "qualified";
        return (
          <section key={`${card.round}-${card.status}`} aria-label={card.title} className={`flex items-start gap-4 rounded-3xl p-5 ring-1 sm:p-6 ${box}`}>
            <span className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${bright ? "bg-white/20" : "bg-surface text-accent-500"}`}>
              <Icon size={24} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-xs font-bold uppercase tracking-[0.18em] ${bright ? "text-white/80" : "text-accent-500"}`}>
                {card.round === "final" ? "Grand Finale" : "Department round"}
              </p>
              <h2 className="mt-1 font-display text-xl font-bold">{card.title}</h2>
              {card.amount !== null && <p className="mt-1 font-display text-3xl font-bold">₹{card.amount.toLocaleString("en-IN")}</p>}
              <p className={`mt-1 text-sm ${bright ? "text-white/90" : card.status === "disqualified" ? "text-red-800" : "text-muted"}`}>{card.message}</p>
            </div>
          </section>
        );
      })}

      {rounds.map((round) => (
        <section key={round.round} className="rounded-3xl bg-white p-5 ring-1 ring-line sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent-500">{round.round === "final" ? "Grand Finale" : "Your room"}</p>
          {round.round === "department" ? (
            round.room ? (
              <div className="mt-2 space-y-2">
                <p className="flex items-start gap-2.5">
                  <MapPin size={20} className="mt-0.5 shrink-0 text-accent-500" aria-hidden="true" />
                  <span>
                    <span className="block font-display text-2xl font-bold text-ink">
                      {round.building ? `${round.building} · ` : ""}Room {round.room}
                    </span>
                    {round.location && <span className="block text-sm text-muted">{round.location}</span>}
                  </span>
                </p>
                {round.slotStart && round.slotEnd && (
                  <p className="flex items-center gap-2.5 text-sm font-semibold text-ink">
                    <CalendarClock size={20} className="shrink-0 text-accent-500" aria-hidden="true" />
                    {day.format(new Date(round.slotStart))} · {time.format(new Date(round.slotStart))} – {time.format(new Date(round.slotEnd))}
                  </p>
                )}
                <p className="text-sm text-muted">Be there 15 minutes early with your whole team and your college ID cards.</p>
              </div>
            ) : (
              <div className="mt-2 flex items-start gap-4">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent-50 text-accent-500">
                  <Hourglass size={24} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="font-display text-xl font-bold text-ink">Your room will be allotted soon</p>
                  <p className="mt-1 text-sm text-muted">
                    Your department will allot your room and time slot before the department round. Come back to this page: it appears here
                    as soon as it is ready.
                  </p>
                  {round.plannedStart && round.plannedEnd && (
                    <p className="mt-3 inline-flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-sm font-semibold text-ink">
                      <CalendarClock size={18} className="shrink-0 text-accent-500" aria-hidden="true" />
                      Your department is judged {day.format(new Date(round.plannedStart))} · {time.format(new Date(round.plannedStart))} –{" "}
                      {time.format(new Date(round.plannedEnd))}
                    </p>
                  )}
                </div>
              </div>
            )
          ) : (
            <p className="mt-2 text-sm text-muted">
              {round.tent ? (
                <>
                  Your stall: <span className="font-display text-2xl font-bold text-ink">{round.tent}</span>
                </>
              ) : (
                "No stall has been allotted yet. Your stall number appears here once the organisers allot it, before the Grand Finale on 30 October."
              )}
            </p>
          )}
          {showPassLink && attendanceEnabled && (
            <Link href="/pass" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-accent-600 hover:underline">
              <QrCode size={16} aria-hidden="true" />
              Open my event pass
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          )}
        </section>
      ))}
    </div>
  );
}
