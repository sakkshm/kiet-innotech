"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { CalendarClock, CheckCircle2, IdCard, MapPin, Smartphone, Sun, WifiOff } from "lucide-react";
import { api } from "@/lib/api";
import { istDay, passCode } from "@/lib/pass";
import type { EventPass as Pass, PassRound } from "@/lib/types";
import { buttonStyles, Notice } from "@/components/ui/form";
import { usePortal } from "./PortalProvider";

const CACHE_KEY = "innotech26-pass";
const ROUND_TITLES = { department: "Department round", final: "Grand Finale" } as const;

type Cached = { pass: Pass; offset: number };

function readCache(userId: string): Cached | null {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as Cached | null;
    return cached && cached.pass.userId === userId && cached.pass.seed && cached.pass.day === istDay(Date.now() + cached.offset) ? cached : null;
  } catch {
    return null;
  }
}

function writeCache(value: Cached) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    // Private mode or full storage: the pass still works while this page is open.
  }
}

const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const day = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

function slot(round: PassRound) {
  if (!round.slotStart || !round.slotEnd) return null;
  return `${day.format(new Date(round.slotStart))} · ${time.format(new Date(round.slotStart))} – ${time.format(new Date(round.slotEnd))}`;
}

/** The QR as one SVG path: crisp at any size, and nothing is injected as HTML. */
function QrSvg({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text, "Alphanumeric");
    qr.make();
    const count = qr.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) if (qr.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`;
    return { size: count + 8, path: d };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Your event pass QR code" className="aspect-square w-full" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#0b1633" />
    </svg>
  );
}

/**
 * The student's event pass: a QR code that changes every minute, made on the phone from the day's seed, so it keeps
 * working without mobile data once loaded. Organisers scan it to mark the student present.
 */
export function EventPass() {
  const { me, team } = usePortal();
  const userId = me.profile!.userId;
  const [state, setState] = useState<Cached | null>(() => (typeof window === "undefined" ? null : readCache(userId)));
  const [offline, setOffline] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [code, setCode] = useState<{ key: string; value: string } | null>(null);

  // The pass (and attendance) from the server: on open, every minute, and when the phone comes back online.
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const sent = Date.now();
      try {
        const pass = await api.getMyPass();
        if (cancelled) return;
        // The server's clock decides which code is current; the phone's clock may be off.
        const next = { pass, offset: Date.parse(pass.serverTime) - (sent + Date.now()) / 2 };
        setState(next);
        if (pass.seed) writeCache(next);
        setOffline(false);
      } catch {
        if (!cancelled) setOffline(true);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    void refresh();
    const timer = setInterval(refresh, 60_000);
    window.addEventListener("online", refresh);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("online", refresh);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Keeps the screen on while the pass is shown, where the phone allows it.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request("screen").then((l) => (lock = l), () => undefined);
    return () => void lock?.release();
  }, []);

  const pass = state?.pass ?? null;
  const serverNow = now + (state?.offset ?? 0);
  const periodMs = (pass?.periodSeconds ?? 60) * 1000;
  const period = Math.floor(serverNow / periodMs);
  const left = Math.ceil((periodMs - (serverNow % periodMs)) / 1000);
  const fresh = !!pass?.seed && pass.day === istDay(serverNow);
  const key = fresh ? `${pass!.seed}:${period}` : null;

  useEffect(() => {
    if (!key || !pass?.seed) return;
    let cancelled = false;
    passCode(pass.seed, pass.userId, period).then((value) => !cancelled && setCode({ key, value }));
    return () => {
      cancelled = true;
    };
  }, [key, pass, period]);

  if (!pass && !loaded) return <div aria-busy="true" aria-label="Loading your pass" className="mx-auto h-[28rem] max-w-sm animate-pulse rounded-3xl bg-white ring-1 ring-line" />;

  if (!pass?.seed) {
    const startupOrCoe = team?.approvalRequired && !team.approvedAt;
    return (
      <div className="mx-auto max-w-xl space-y-4">
        {offline && !pass && <Notice tone="error">Could not load your pass. Check your connection and open this page again.</Notice>}
        <Notice tone="info" title="Your pass appears once your team is submitted">
          {!team
            ? "Join or create a team first."
            : team.status === "draft"
              ? "Your team leader has not submitted the team yet."
              : startupOrCoe
                ? "Your entry is waiting for the organisers to accept it."
                : "Your team is not taking part in a round right now."}{" "}
          On event day this page shows a QR code that the organisers scan to mark you present.
        </Notice>
        <Link href="/team" className={buttonStyles("dark")}>
          Go to my team
        </Link>
      </div>
    );
  }

  const current = code && code.key === key ? code.value : null;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
      <section aria-label="Event pass" className="mx-auto w-full max-w-sm overflow-hidden rounded-[2rem] bg-white shadow-xl shadow-navy-900/10 ring-1 ring-line">
        <div className="bg-navy-900 px-6 pb-5 pt-6 text-white">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-brand-300">InnoTech26 · Event pass</p>
          <p className="mt-2 break-words font-display text-2xl font-bold">{me.profile!.fullName}</p>
          <p className="mt-0.5 text-sm text-white/75">
            {me.profile!.rollNumber ? `Roll no. ${me.profile!.rollNumber} · ` : ""}
            {pass.rounds[0]?.teamName} ({pass.rounds[0]?.teamCode})
          </p>
        </div>
        <div className="px-6 pb-6 pt-5">
          <div className="relative mx-auto aspect-square w-full max-w-[18rem] rounded-2xl p-2 ring-1 ring-line">
            {fresh && current ? <QrSvg text={current} /> : <div className="flex size-full items-center justify-center text-center text-sm text-muted">{fresh ? "Preparing…" : "Open this page with internet once today to load your pass."}</div>}
          </div>
          {fresh && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs font-semibold text-muted">
                <span>Changes every minute</span>
                <span className="tabular-nums">New code in {left}s</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface">
                <div className="h-full rounded-full bg-brand-500 transition-[width] duration-1000 ease-linear" style={{ width: `${(left / (periodMs / 1000)) * 100}%` }} />
              </div>
            </div>
          )}
          <ul className="mt-5 space-y-2">
            {pass.rounds.map((round) => (
              <li key={round.round} className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm ring-1 ring-inset ${round.presentAt ? "bg-emerald-50 ring-emerald-200" : "bg-surface ring-line"}`}>
                <span className="font-semibold text-ink">{ROUND_TITLES[round.round]}</span>
                {round.presentAt ? (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                    <CheckCircle2 size={16} aria-hidden="true" />
                    Present · {time.format(new Date(round.presentAt))}
                  </span>
                ) : (
                  <span className="text-muted">Not marked yet</span>
                )}
              </li>
            ))}
          </ul>
          {offline && (
            <p className="mt-3 flex items-center gap-2 text-xs font-medium text-accent-600">
              <WifiOff size={14} aria-hidden="true" />
              Offline. Your pass still works; your attendance updates when you are back online.
            </p>
          )}
        </div>
      </section>

      <div className="space-y-4">
        {pass.rounds.map((round) => (
          <section key={round.round} className="rounded-3xl bg-white p-5 ring-1 ring-line sm:p-6">
            <h2 className="font-display text-lg font-bold text-ink">{ROUND_TITLES[round.round]}</h2>
            {round.round === "department" ? (
              round.room ? (
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex items-start gap-2.5">
                    <MapPin size={18} className="mt-0.5 shrink-0 text-accent-500" aria-hidden="true" />
                    <div>
                      <dt className="sr-only">Room</dt>
                      <dd className="font-semibold text-ink">{round.building ? `${round.building} · ${round.room}` : round.room}</dd>
                      {round.location && <dd className="text-muted">{round.location}</dd>}
                    </div>
                  </div>
                  {slot(round) && (
                    <div className="flex items-start gap-2.5">
                      <CalendarClock size={18} className="mt-0.5 shrink-0 text-accent-500" aria-hidden="true" />
                      <div>
                        <dt className="sr-only">Time</dt>
                        <dd className="font-semibold text-ink">{slot(round)}</dd>
                        <dd className="text-muted">Be there 15 minutes early with your whole team.</dd>
                      </div>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="mt-2 text-sm text-muted">Your room and time slot will appear here once your department allots them.</p>
              )
            ) : (
              <p className="mt-2 text-sm text-muted">
                {round.tent ? (
                  <>
                    Your stall: <span className="font-display text-base font-bold text-ink">{round.tent}</span>
                  </>
                ) : (
                  "Your stall number will appear here before the Grand Finale."
                )}
              </p>
            )}
          </section>
        ))}
        <section className="rounded-3xl bg-navy-900 p-5 text-white sm:p-6">
          <h2 className="font-display text-lg font-bold">At the desk</h2>
          <ul className="mt-3 space-y-2.5 text-sm text-white/85">
            <li className="flex gap-2.5">
              <Smartphone size={18} className="shrink-0 text-brand-300" aria-hidden="true" />
              Open this page on your own phone and show the live code. A screenshot stops working within a minute.
            </li>
            <li className="flex gap-2.5">
              <Sun size={18} className="shrink-0 text-brand-300" aria-hidden="true" />
              Turn your screen brightness up so it scans first time.
            </li>
            <li className="flex gap-2.5">
              <IdCard size={18} className="shrink-0 text-brand-300" aria-hidden="true" />
              Carry your college ID card. The organisers check your name and roll number.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
