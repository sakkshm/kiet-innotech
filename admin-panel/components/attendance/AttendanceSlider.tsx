"use client";

import { useRef } from "react";
import { Check, Minus, X, type LucideIcon } from "lucide-react";
import type { AttendanceState } from "@/lib/admin-types";

/** Left to right: absent, not marked, present. Absent is on the left, present on the right, unmarked in the middle. */
const order: AttendanceState[] = ["absent", "not_marked", "present"];

const look: Record<AttendanceState, { label: string; Icon: LucideIcon; thumb: string; help: string }> = {
  absent: { label: "Absent", Icon: X, thumb: "bg-red-500 text-white", help: "Marked absent" },
  not_marked: { label: "Unmarked", Icon: Minus, thumb: "bg-amber-400 text-navy-900", help: "Not marked yet: counts as absent until marked present" },
  present: { label: "Present", Icon: Check, thumb: "bg-emerald-500 text-white", help: "Marked present" },
};

/**
 * A three-position slider for a student's attendance: slide left for Absent, right for Present, and the middle is Unmarked
 * (nobody has marked them). Tap a position, or use the arrow keys. It is a radio group, so screen readers read it as one choice
 * of three. The thumb is coloured by what is chosen: red, amber, green. Big enough to hit with a thumb.
 */
export function AttendanceSlider({
  value,
  onChange,
  name,
  pending = false,
  disabled = false,
  className = "min-w-[15rem] max-w-sm",
}: {
  value: AttendanceState;
  onChange: (next: AttendanceState) => void;
  /** Whose attendance, for screen readers. */
  name: string;
  pending?: boolean;
  disabled?: boolean;
  /** Its size limits. It always fills the width it is given; below 17rem the icons give way to the words. */
  className?: string;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const index = order.indexOf(value);
  const blocked = disabled || pending;

  function move(by: number) {
    const next = order[Math.min(order.length - 1, Math.max(0, index + by))];
    if (next === value) return;
    onChange(next);
    buttons.current[order.indexOf(next)]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={`Attendance of ${name}`}
      aria-busy={pending || undefined}
      className={`@container relative grid h-11 w-full ${className} grid-cols-3 rounded-full bg-slate-100 p-1 ring-1 ring-inset ring-line ${pending ? "animate-pulse" : ""} ${disabled ? "opacity-60" : ""}`}
    >
      {/* The thumb that slides under the chosen position. */}
      <span
        aria-hidden="true"
        className={`absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full shadow-md transition-[transform,background-color] duration-200 ease-out motion-reduce:transition-none ${look[value].thumb}`}
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {order.map((state, i) => {
        const { label, Icon, help } = look[state];
        const active = state === value;
        return (
          <button
            key={state}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={blocked}
            title={help}
            onClick={() => !active && onChange(state)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                move(1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                move(-1);
              }
            }}
            className={`relative z-10 flex min-w-0 items-center justify-center gap-1 rounded-full text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed ${
              active ? "" : "text-muted hover:text-navy-900"
            }`}
          >
            <Icon aria-hidden="true" className="hidden size-3.5 shrink-0 @[17rem]:block" strokeWidth={3} />
            <span className="whitespace-nowrap">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
