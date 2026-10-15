import Image from "next/image";

/** KIET logo and InnoTech emblem lockup. `tone` picks colours for dark or light backgrounds. */
export function Brand({ tone = "dark", subtitle = "Admin panel" }: { tone?: "dark" | "light"; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Image
        src="/images/brand/innotech-emblem.png"
        alt=""
        width={219}
        height={219}
        priority
        // The emblem's charcoal half disappears on the dark sidebar without a light disc behind it.
        className={`size-9 shrink-0 ${tone === "dark" ? "rounded-full bg-white p-0.5" : ""}`}
      />
      <div className="leading-tight">
        <p className={`font-display text-base font-bold ${tone === "dark" ? "text-white" : "text-navy-900"}`}>
          InnoTech<span className="text-brand-500">26</span>
        </p>
        <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${tone === "dark" ? "text-white/55" : "text-muted"}`}>{subtitle}</p>
      </div>
    </div>
  );
}

export function KietLogo({ className = "h-9 w-auto" }: { className?: string }) {
  return <Image src="/images/brand/kiet-logo.png" alt="KIET Deemed to be University" width={624} height={269} priority className={className} />;
}
