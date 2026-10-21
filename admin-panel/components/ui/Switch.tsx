"use client";

/** An on/off switch for a row of a table or list (role="switch"). Off is shown in red so a change is easy to see. */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  pending = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** What it switches, for screen readers: "Present: Aarav Sharma". */
  label: string;
  disabled?: boolean;
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={pending}
      disabled={disabled || pending}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed ${
        checked ? "bg-emerald-500" : "bg-red-400"
      } ${disabled && !pending ? "opacity-50" : ""} ${pending ? "animate-pulse" : ""}`}
    >
      <span
        aria-hidden="true"
        className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`}
      />
    </button>
  );
}
