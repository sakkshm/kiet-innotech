"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { EventPass } from "@/components/portal/EventPass";
import { PageHeading } from "@/components/portal/PageHeading";
import { attendanceEnabled } from "@/lib/features";

/** The event pass (rotating QR) is switched off for now: this page sends students back to their dashboard. */
export default function PassPage() {
  const router = useRouter();
  useEffect(() => {
    if (!attendanceEnabled) router.replace("/dashboard");
  }, [router]);
  if (!attendanceEnabled) return null;
  return (
    <>
      <PageHeading eyebrow="Event day" title="Your event pass">
        Show this QR code at your room&apos;s desk. The organisers scan it to mark you present.
      </PageHeading>
      <EventPass />
    </>
  );
}
