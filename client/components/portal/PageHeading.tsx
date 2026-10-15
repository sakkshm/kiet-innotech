import type { ReactNode } from "react";

/** The heading at the top of every portal page, in the same style as the landing page sections. */
export function PageHeading({ eyebrow, title, children, actions }: { eyebrow: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="mb-3 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-accent-600">
          <span className="h-px w-6 bg-current" />
          {eyebrow}
        </p>
        <h1 className="break-words font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">{title}</h1>
        {children && <div className="mt-3 max-w-2xl text-muted">{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-3">{actions}</div>}
    </div>
  );
}

/** A white panel used to group related content on portal pages. */
export function Panel({ title, description, children, className = "" }: { title?: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-3xl bg-white p-5 ring-1 ring-line sm:p-8 ${className}`}>
      {title && <h2 className="font-display text-xl font-bold text-ink">{title}</h2>}
      {description && <div className="mt-1 text-sm text-muted">{description}</div>}
      <div className={title || description ? "mt-6" : ""}>{children}</div>
    </section>
  );
}
