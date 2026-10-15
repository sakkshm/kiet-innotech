"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useDisplayedRegistrationState, useExtendedNote, useRegistrationDates, useRegistrationState } from "@/lib/registration";
import { useRegistrationRange } from "@/lib/schedule-content";
import { useSession } from "@/lib/auth/session";
import { longDate } from "@/lib/format";

/**
 * The main call to action on the landing page: register until registration closes, then sign in to see your team.
 * Uses the browser's clock; the page is prerendered, so the register link shows until the browser has checked.
 */
export function RegisterCta({ label, className }: { label: string; className: string }) {
  const closed = useRegistrationState() === "closed";
  // Signed-in students already registered: take them to their dashboard instead.
  const signedIn = Boolean(useSession());
  const href = signedIn ? "/dashboard" : closed ? "/login?next=/team" : "/register";
  return (
    <Link href={href} className={className}>
      {signedIn ? "Go to your dashboard" : closed ? "View your team" : label}
      <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" aria-hidden="true" />
    </Link>
  );
}

/** One line about the registration window, in the past tense once it has closed. */
export function RegistrationNote() {
  const state = useDisplayedRegistrationState();
  const { opens, closes } = useRegistrationDates();
  const extended = useExtendedNote();
  const note = extended ? ` ${extended}` : "";
  if (state === "closed") return `Registration closed on ${longDate(closes)}.${note} Registered students can sign in to see their team and results.`;
  if (state === "upcoming") return `Registration opens on ${longDate(opens)} and closes on ${longDate(closes)}.${note} It is free, and it takes just a few minutes.`;
  return `Registrations are open until ${longDate(closes)}.${note} It is free, and it takes just a few minutes.`;
}

/** "3 - 12 Oct 2026": opening and closing date as displayed. */
export function RegistrationRange() {
  return useRegistrationRange();
}
