"use client";

import { extendedMilestone, liveUpdates, timeline, type Milestone } from "./content";
import { dateRange, longDate } from "./format";
import { useDisplayedRegistrationState, useRegistrationDates } from "./registration";

/** The timeline exactly as written in content.ts: dates are edited by hand and never follow the server's window. */
export function useTimeline(): Milestone[] {
  return timeline;
}

/** The date lists (not the timeline graphic): the timeline with the startups and COE KIET deadline after the general one. */
export function useDateRows(): Milestone[] {
  const index = timeline.findIndex((item) => item.title === "Registrations Close");
  return [...timeline.slice(0, index + 1), extendedMilestone, ...timeline.slice(index + 1)];
}

/** "3 - 12 Oct 2026": the opening and the closing date, as displayed. */
export function useRegistrationRange(): string {
  const { opens, closes } = useRegistrationDates();
  return dateRange(opens, closes);
}

/** One sentence about where registration stands, e.g. "Registration open until 12 October 2026". */
export function useRegistrationSentence(): string {
  const { opens, closes } = useRegistrationDates();
  const state = useDisplayedRegistrationState() ?? "open";
  if (state === "upcoming") return `Registration opens on ${longDate(opens)} and closes on ${longDate(closes)}`;
  if (state === "closed") return `Registration closed on ${longDate(closes)}`;
  return `Registration open until ${longDate(closes)}`;
}

/** The ticker, with its first line following the live registration window. */
export function useLiveUpdates(): string[] {
  const sentence = useRegistrationSentence();
  return liveUpdates.map((item, index) => (index === 0 ? sentence.replace("Registration open until", "Registrations are open until").replace("Registration opens on", "Registrations open on") : item));
}
