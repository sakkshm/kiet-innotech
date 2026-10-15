"use client";

import { useSyncExternalStore } from "react";
import { send } from "./api/http";
import { extendedNote, registrationDisplay } from "./content";
import { apiMode } from "./auth/session";
import { registrationState, type RegistrationState } from "./rules";
import type { RegistrationWindow } from "./types";

/*
 * The registration window is controlled by organisers (Schedule page in the admin panel), so the pages never
 * trust dates baked in at build time. The server's answer comes from GET /me (signed in) or GET /config (public
 * pages) and is what everything below reads. Until it arrives, and in the demo mode, the planned dates and the
 * browser's clock are used.
 */
let server: RegistrationWindow | null = null;
const listeners = new Set<() => void>();

/** Called with the window from GET /me or GET /config. The server is the authority on it. */
export function setServerRegistration(next: RegistrationWindow | null | undefined) {
  if (
    !next ||
    (server && server.state === next.state && server.opens === next.opens && server.closes === next.closes && server.extended === next.extended)
  )
    return;
  server = next;
  listeners.forEach((listener) => listener());
}

const REFRESH_AFTER_MS = 30_000;
let lastFetch = 0;
let wired = false;

/** Fetches GET /config (no sign-in needed), at most every 30 seconds. A failure just keeps what is known. */
export async function refreshRegistration() {
  if (apiMode !== "live" || typeof window === "undefined" || Date.now() - lastFetch < REFRESH_AFTER_MS) return;
  lastFetch = Date.now();
  try {
    const config = (await send("GET", "/config")) as { registration?: RegistrationWindow } | undefined;
    setServerRegistration(config?.registration);
  } catch {
    // Offline or the server is busy: the planned dates stay in place.
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!wired && typeof document !== "undefined") {
    wired = true;
    // A page left open picks up an organiser's change when the visitor comes back to it.
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void refreshRegistration());
  }
  void refreshRegistration();
  return () => {
    listeners.delete(onChange);
  };
}

const stateSnapshot = () => server?.state ?? registrationState();

/**
 * The registration state: the server's answer once known, otherwise the planned dates against the browser's clock.
 * Null while rendering on the server, so pages never show a stale state.
 */
export function useRegistrationState(): RegistrationState | null {
  return useSyncExternalStore(subscribe, stateSnapshot, () => null);
}

/**
 * The opening and closing dates VISITORS SEE: fixed in content.ts, edited by hand, and never taken from the
 * server. The server's window (above) still decides whether registration actually works; it can open earlier
 * or close later for operations without a visitor ever seeing a different date.
 */
export function useRegistrationDates(): { opens: string; closes: string } {
  // Startups and COE KIET clubs are told their own, later deadline.
  const extended = useSyncExternalStore(subscribe, extendedSnapshot, () => false);
  return extended ? extendedDisplay : registrationDisplay;
}

/** Whether this signed-in student's own deadline is the later one (startups and COE KIET). */
export function useIsExtended(): boolean {
  return useSyncExternalStore(subscribe, extendedSnapshot, () => false);
}

/**
 * "Startups and COE KIET clubs can register until 21 October 2026." for everyone who does NOT already see that date
 * as their own, until it has passed. Empty on the server, so the prerendered page never differs.
 */
export function useExtendedNote(): string {
  const extended = useIsExtended();
  const open = useSyncExternalStore(
    () => () => {},
    () => new Date() <= new Date(registrationDisplay.extendedCloses),
    () => false,
  );
  return open && !extended ? extendedNote : "";
}

const extendedDisplay = { opens: registrationDisplay.opens, closes: registrationDisplay.extendedCloses };
const extendedSnapshot = () => server?.extended === true;

/** Whether registration is upcoming, open or closed by the DISPLAYED dates, so the wording on the page never disagrees with them. Null on the server. */
export function useDisplayedRegistrationState(): RegistrationState | null {
  return useSyncExternalStore(
    () => () => {},
    () => {
      const now = new Date();
      if (now < new Date(registrationDisplay.opens)) return "upcoming";
      if (now > new Date(registrationDisplay.closes)) return "closed";
      return "open";
    },
    () => null,
  );
}
