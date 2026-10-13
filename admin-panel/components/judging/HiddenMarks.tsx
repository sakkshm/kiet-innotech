"use client";

import { useState, type ReactNode } from "react";
import { Eye } from "lucide-react";

/**
 * Marks stay hidden so people standing behind a judge cannot read them. They show only while the eye button is
 * hovered (mouse), pressed and held (touch), or held with Space or Enter (keyboard), and hide again on release.
 */
export function useHoldToReveal() {
  const [shown, setShown] = useState(false);
  const show = () => setShown(true);
  const hide = () => setShown(false);
  const bind = {
    onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && show(),
    onPointerLeave: hide,
    onPointerDown: show,
    onPointerUp: (e: React.PointerEvent) => e.pointerType !== "mouse" && hide(),
    onPointerCancel: hide,
    onBlur: hide,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        show();
      }
    },
    onKeyUp: hide,
    // A long press would otherwise open the phone's context menu or select text.
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
  };
  return { shown, bind };
}

export function RevealButton({ shown, bind, label, children }: { shown: boolean; bind: ReturnType<typeof useHoldToReveal>["bind"]; label: string; children?: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={`Hold to show ${label}`}
      title="Hover or hold to show"
      {...bind}
      className={`inline-flex h-8 shrink-0 select-none items-center justify-center gap-1.5 rounded-full text-xs font-semibold ring-1 ring-inset transition [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-brand-500 ${
        children ? "px-3" : "w-8"
      } ${shown ? "bg-navy-900 text-white ring-navy-900" : "bg-white text-navy-800 ring-line hover:bg-surface"}`}
    >
      <Eye aria-hidden="true" className="size-4" />
      {children}
    </button>
  );
}

/** A hidden number ("••") with its own eye button. */
export function HiddenMarks({ value, label, size = "md" }: { value: ReactNode; label: string; size?: "sm" | "md" }) {
  const { shown, bind } = useHoldToReveal();
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex min-w-[2.5rem] justify-end font-display font-bold tabular-nums ${size === "md" ? "text-lg" : "text-sm"} ${
          shown ? "text-navy-900" : "tracking-[0.2em] text-muted"
        }`}
      >
        {shown ? value : <span aria-label="Hidden">••</span>}
      </span>
      <RevealButton shown={shown} bind={bind} label={label} />
    </span>
  );
}
