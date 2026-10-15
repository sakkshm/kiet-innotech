import type { ReactNode } from "react";
import { Reveal } from "./Reveal";

type SectionProps = {
  id?: string;
  className?: string;
  children: ReactNode;
};

export function Section({ id, className = "", children }: SectionProps) {
  return (
    <section id={id} className={`py-20 sm:py-24 ${className}`}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">{children}</div>
    </section>
  );
}

type SectionHeadingProps = {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  align?: "center" | "left";
  tone?: "light" | "dark";
};

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  tone = "light",
}: SectionHeadingProps) {
  const isCenter = align === "center";
  const isDark = tone === "dark";

  return (
    <Reveal className={`max-w-3xl ${isCenter ? "mx-auto mb-12 text-center" : "mb-8"}`}>
      <p
        className={`mb-3 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] ${
          isDark ? "text-brand-300" : "text-accent-600"
        }`}
      >
        <span className="h-px w-6 bg-current" />
        {eyebrow}
      </p>
      <h2
        className={`font-display text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl ${
          isDark ? "text-white" : "text-ink"
        }`}
      >
        {title}
      </h2>
      {description && (
        <p className={`mt-4 text-base sm:text-lg ${isDark ? "text-slate-300" : "text-muted"}`}>
          {description}
        </p>
      )}
    </Reveal>
  );
}
