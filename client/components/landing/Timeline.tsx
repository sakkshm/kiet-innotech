"use client";

import { useSyncExternalStore, type ComponentType } from "react";
import { Check, ClipboardCheck, ClipboardPen, Lock, Megaphone, Trophy, type LucideProps } from "lucide-react";
import { event, type Milestone } from "@/lib/content";
import { useTimeline } from "@/lib/schedule-content";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { Celebrate } from "./Celebrate";

/** "next" is the stage coming up when none is under way (between two stages, or before the first). */
type Status = "done" | "current" | "next" | "upcoming";

// Milestone dates are ISO days ("2026-10-12"), so plain string comparison orders them correctly.
function getStatus(milestone: Milestone, today: string): Exclude<Status, "next"> {
  if (today > milestone.end) return "done";
  if (today >= milestone.start) return "current";
  return "upcoming";
}

function daysUntil(day: string, today: string) {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** Where we are: the stage under way, or else the first one still to come. */
function statusesFor(timeline: Milestone[], today: string | null): Status[] {
  if (today === null) return timeline.map(() => "upcoming");
  const base = timeline.map((milestone) => getStatus(milestone, today));
  if (!base.includes("current")) {
    const next = base.indexOf("upcoming");
    if (next >= 0) return base.map((status, index) => (index === next ? "next" : status));
  }
  return base;
}

/** "Happening now", "Starts tomorrow", "Starts in 5 days": what the badge says for the stage we are at. */
function badgeText(milestone: Milestone, status: Status, today: string | null) {
  if (status === "current") return milestone.start === milestone.end ? "Happening today" : "Happening now";
  const days = today === null ? 0 : daysUntil(milestone.start, today);
  return days <= 1 ? "Up next · tomorrow" : `Up next · in ${days} days`;
}

/** Today's date in IST as "YYYY-MM-DD". */
function getTodayInIndia() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

const noSubscription = () => () => {};

/**
 * One colour and icon per milestone, in timeline order: orange fading into charcoal, like the line under the logo's
 * wordmark. Full class strings so Tailwind can find them.
 */
const stages: { icon: ComponentType<LucideProps>; text: string; bg: string; border: string }[] = [
  { icon: ClipboardPen, text: "text-brand-500", bg: "bg-brand-500", border: "border-brand-500" },
  { icon: Lock, text: "text-brand-600", bg: "bg-brand-600", border: "border-brand-600" },
  { icon: ClipboardCheck, text: "text-brand-700", bg: "bg-brand-700", border: "border-brand-700" },
  { icon: Megaphone, text: "text-navy-700", bg: "bg-navy-700", border: "border-navy-700" },
  { icon: Trophy, text: "text-navy-900", bg: "bg-navy-900", border: "border-navy-900" },
];

const number = (index: number) => String(index + 1).padStart(2, "0");

export function Timeline() {
  const timeline = useTimeline();
  // Read the visitor's clock on the client only; the server render shows every milestone as upcoming.
  const today = useSyncExternalStore(noSubscription, getTodayInIndia, () => null);
  const statuses = statusesFor(timeline, today);

  return (
    <Section id="timeline" className="bg-[#fdfcfb]">
      <Reveal className="mb-14 text-center lg:mb-10">
        <h2 className="font-display text-6xl font-black uppercase tracking-tight text-navy-900 sm:text-7xl lg:text-8xl">Timeline</h2>
        <p className="mt-2 font-display text-base font-bold uppercase tracking-wide text-ink sm:text-xl lg:text-2xl">
          Of the {event.name} journey to the Grand Finale
        </p>
      </Reveal>

      {/* Desktop: horizontal line, icons alternating above and below */}
      <ol className="hidden grid-cols-5 lg:grid">
        {timeline.map((milestone, index) => {
          const iconAbove = index % 2 === 1;
          const status = statuses[index];
          const focus = status === "current" || status === "next";
          return (
            <Reveal as="li" key={milestone.title} delay={index * 100} className="grid grid-rows-[15rem_0.75rem_15rem]">
              <div className="flex flex-col justify-end">
                {iconAbove ? (
                  <IconStem index={index} above focus={focus} />
                ) : (
                  <StageText milestone={milestone} index={index} status={status} today={today} className="pb-7" />
                )}
              </div>
              <div className={`relative ${stages[index].bg}`}>
                {focus && (
                  <>
                    <span className={`animate-ripple absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full ${stages[index].bg}`} aria-hidden="true" />
                    <span className={`animate-ripple absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full [animation-delay:1.3s] ${stages[index].bg}`} aria-hidden="true" />
                  </>
                )}
                <span
                  className={`absolute left-1/2 top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[5px] ${stages[index].border} ${
                    status === "upcoming" || status === "next" ? "bg-white" : stages[index].bg
                  } ${focus ? "scale-125" : ""}`}
                  aria-hidden="true"
                >
                  {status === "done" && <Check size={12} strokeWidth={4} className="text-white" />}
                </span>
              </div>
              <div className="flex flex-col">
                {iconAbove ? (
                  <StageText milestone={milestone} index={index} status={status} today={today} className="pt-7" />
                ) : (
                  <IconStem index={index} focus={focus} />
                )}
              </div>
            </Reveal>
          );
        })}
      </ol>

      {/* Phones and tablets: vertical line */}
      <ol className="mx-auto max-w-xl lg:hidden">
        {timeline.map((milestone, index) => {
          const Stage = stages[index].icon;
          const status = statuses[index];
          const focus = status === "current" || status === "next";
          const finale = index === timeline.length - 1;
          const ring = (
            <span
              className={`relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-[7px] bg-white ${stages[index].border} ${
                focus ? "animate-ring-glow" : ""
              }`}
            >
              <Stage size={24} className={`text-navy-900 ${finale ? "animate-tada" : ""}`} aria-hidden="true" />
              {status === "done" && (
                <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-white">
                  <Check size={12} strokeWidth={4} className="text-white" aria-hidden="true" />
                </span>
              )}
            </span>
          );
          return (
            <Reveal as="li" key={milestone.title} delay={index * 80} className="flex gap-5">
              <div className="flex flex-col items-center">
                {finale ? <Celebrate scale={0.55}>{ring}</Celebrate> : ring}
                {index < timeline.length - 1 && <span className={`w-1.5 flex-1 ${stages[index].bg}`} aria-hidden="true" />}
              </div>
              <StageText milestone={milestone} index={index} status={status} today={today} className="pb-10 pt-2 text-left" />
            </Reveal>
          );
        })}
      </ol>
    </Section>
  );
}

/** The big ring icon on a stem, with the stage number beside the stem. */
function IconStem({ index, above = false, focus = false }: { index: number; above?: boolean; focus?: boolean }) {
  const stage = stages[index];
  const Stage = stage.icon;
  const finale = index === stages.length - 1;
  const ring = (
    <span
      className={`flex h-32 w-32 shrink-0 items-center justify-center rounded-full border-[16px] bg-white shadow-[0_12px_30px_-12px_rgb(41_43_56/0.35)] ${stage.border} ${
        focus ? "animate-ring-glow" : ""
      }`}
    >
      <Stage size={44} strokeWidth={2.25} className={`text-navy-900 ${finale ? "animate-tada" : ""}`} aria-hidden="true" />
    </span>
  );
  // The stage we are at floats gently; the finale's trophy gets a glow, sparkles and a burst of confetti.
  const marked = finale ? <Celebrate>{ring}</Celebrate> : focus ? <span className="animate-bob inline-flex">{ring}</span> : ring;
  const stem = (
    <span className="relative w-2.5 flex-1">
      <span className={`absolute inset-0 ${stage.bg}`} />
      <span className={`absolute left-6 top-1/2 -translate-y-1/2 font-display text-4xl font-black ${stage.text}`} aria-hidden="true">
        {number(index)}
      </span>
    </span>
  );
  return (
    <div className="flex h-full flex-col items-center" aria-hidden="true">
      {above ? (
        <>
          {marked}
          {stem}
        </>
      ) : (
        <>
          {stem}
          {marked}
        </>
      )}
    </div>
  );
}

function StageText({ milestone, index, status, today, className = "" }: { milestone: Milestone; index: number; status: Status; today: string | null; className?: string }) {
  return (
    <div className={`px-3 text-center ${className}`}>
      <h3 className="font-display text-xl font-black uppercase leading-tight text-navy-900">
        <span className={stages[index].text}>{number(index)}</span> {milestone.title}
      </h3>
      <p className="mt-1.5 text-sm font-bold text-ink">{milestone.dateLabel}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted">{milestone.description}</p>
      {(status === "current" || status === "next") && (
        <span className="mt-3 inline-flex items-center gap-2 rounded-full bg-brand-50 px-3.5 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-brand-100">
          <span className="relative flex size-2">
            <span className="animate-ping-soft absolute inset-0 rounded-full bg-brand-500" aria-hidden="true" />
            <span className="relative size-2 rounded-full bg-brand-500" />
          </span>
          {badgeText(milestone, status, today)}
        </span>
      )}
      {status === "done" && <span className="mt-3 inline-block text-xs font-bold text-emerald-700">Completed</span>}
    </div>
  );
}
