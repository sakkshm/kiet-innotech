"use client";

import { useDateRows } from "@/lib/schedule-content";

/** The event timeline as a list, with the registration dates following what organisers have set. */
export function ImportantDates({ exclude = [] }: { exclude?: string[] }) {
  const timeline = useDateRows();
  return (
    <ol className="divide-y divide-line rounded-2xl bg-white ring-1 ring-line">
      {timeline.filter((item) => !exclude.includes(item.title)).map((item) => (
        <li key={item.title} className="grid gap-1 p-5 sm:grid-cols-[10rem_1fr] sm:gap-6">
          <span className="font-display font-bold text-accent-600">{item.dateLabel}</span>
          <span>
            <span className="block font-semibold text-ink">{item.title}</span>
            <span className="text-sm text-muted">{item.description}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
