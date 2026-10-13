import type { Metadata } from "next";
import { EventPass } from "@/components/portal/EventPass";
import { PageHeading } from "@/components/portal/PageHeading";

export const metadata: Metadata = { title: "Event pass" };

export default function PassPage() {
  return (
    <>
      <PageHeading eyebrow="Event day" title="Your event pass">
        Show this QR code at your room&apos;s desk. The organisers scan it to mark you present.
      </PageHeading>
      <EventPass />
    </>
  );
}
