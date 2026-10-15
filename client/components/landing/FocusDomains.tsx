import type { CSSProperties } from "react";
import { event, focusDomains } from "@/lib/content";
import { Icon } from "@/components/ui/Icon";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { Slider } from "@/components/ui/Slider";
import { tones } from "./tones";

/*
 * Desktop diagram: the domains around a centre card, each joined to it by a curved coloured line.
 * Placed on a 1440 x 650 design grid and sized in container units, so it scales as one piece.
 * Smaller screens get the centre card followed by a grid of domains.
 */
const W = 1440;
const H = 650;
const u = (n: number) => `${(n / W) * 100}cqw`;
const place = ([x, y, w, h]: readonly number[]): CSSProperties => ({
  left: `${(x / W) * 100}%`,
  top: `${(y / H) * 100}%`,
  width: `${(w / W) * 100}%`,
  height: `${(h / H) * 100}%`,
});

const CENTRE = [540, 182, 358, 208] as const;

/** A horizontal S-curve from a card to the centre card. */
const sideways = (x1: number, y1: number, x2: number, y2: number) => {
  const mid = (x1 + x2) / 2;
  return { path: `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`, dots: [[x1, y1], [x2, y2]] };
};
/** A vertical S-curve, used for the cards above and below the centre card. */
const upright = (x1: number, y1: number, x2: number, y2: number) => {
  const mid = (y1 + y2) / 2;
  return { path: `M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`, dots: [[x1, y1], [x2, y2]] };
};

// One entry per domain, in content order.
const layout = [
  { box: [102, 12, 356, 143], line: sideways(463, 117, 538, 204) },
  { box: [556, 12, 324, 123], line: upright(719, 137, 719, 180) },
  { box: [980, 12, 352, 143], line: sideways(977, 117, 900, 204) },
  { box: [10, 178, 387, 132], line: sideways(402, 236, 538, 268) },
  { box: [10, 333, 387, 135], line: sideways(402, 384, 538, 312) },
  { box: [1038, 178, 387, 132], line: sideways(1033, 236, 900, 268) },
  { box: [1038, 333, 387, 135], line: sideways(1033, 384, 900, 312) },
  { box: [162, 488, 368, 152], line: upright(470, 486, 580, 392) },
  { box: [545, 488, 348, 155], line: upright(719, 486, 719, 392) },
  { box: [935, 488, 365, 152], line: upright(968, 486, 858, 392) },
] as const;

export function FocusDomains() {
  return (
    <Section id="domains" className="relative overflow-hidden">
      {/* Soft background shapes */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -left-32 top-40 h-80 w-80 rounded-full bg-accent-100/60 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 h-96 w-96 rounded-full bg-brand-100/70 blur-3xl" />
        <div className="absolute -right-24 top-10 h-96 w-96 rounded-full bg-brand-50 blur-2xl" />
        <div className="absolute left-[12%] top-16 hidden h-24 w-40 bg-[radial-gradient(#c9cad3_1.5px,transparent_1.5px)] bg-[length:18px_18px] lg:block" />
        <div className="absolute bottom-24 right-[6%] hidden h-24 w-24 bg-[radial-gradient(#c9cad3_1.5px,transparent_1.5px)] bg-[length:18px_18px] lg:block" />
      </div>

      <div className="relative">
        <Reveal className="mx-auto mb-12 max-w-3xl text-center">
          <p className="mb-3 inline-flex items-center gap-3 text-xs font-bold uppercase tracking-[0.2em] text-accent-600">
            <span className="h-px w-8 bg-current" />
            Focus domains
            <span className="h-px w-8 bg-current" />
          </p>
          <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl lg:text-5xl">
            Build in the areas that <br className="hidden sm:block" />
            shape{" "}
            <span className="relative inline-block text-accent-500">
              the future
              <svg viewBox="0 0 200 12" className="absolute -bottom-2 left-0 h-3 w-full" preserveAspectRatio="none" aria-hidden="true">
                <path d="M2 9 C 60 2, 140 2, 198 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </span>
          </h2>
          <p className="mt-5 text-base text-muted sm:text-lg">Students can explore these domains, but ideas are not limited to them.</p>
        </Reveal>

        {/* Desktop: connected diagram */}
        <Reveal className="@container relative mx-auto hidden aspect-[1440/650] w-full max-w-[1440px] xl:block">
          <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden="true" fill="none">
            {layout.map(({ line }, index) => {
              const stroke = tones[focusDomains[index].tone].stroke;
              return (
                <g key={index}>
                  <path d={line.path} stroke={stroke} strokeWidth={2.5} strokeLinecap="round" fill="none" />
                  {line.dots.map(([cx, cy]) => (
                    <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={5} fill={stroke} />
                  ))}
                </g>
              );
            })}
          </svg>

          <CentreCard style={place(CENTRE)} unit={u} />
          {focusDomains.map((domain, index) => (
            <DomainCard key={domain.title} domain={domain} style={place(layout[index].box)} unit={u} />
          ))}
        </Reveal>

        {/* Phones and tablets */}
        <div className="xl:hidden">
          <Reveal className="mx-auto max-w-md">
            <CentreCard unit={(n) => `${n}px`} flow />
          </Reveal>
          <div className="mt-4 md:mt-8">
            <Slider
              label="Focus domains"
              gridClassName="md:grid-cols-2 md:gap-4 lg:grid-cols-3"
              slides={focusDomains.map((domain, index) => ({
                key: domain.title,
                className: "flex",
                content: (
                  <Reveal delay={(index % 3) * 70} className="flex w-full">
                    <DomainCard domain={domain} unit={(n) => `${n}px`} flow />
                  </Reveal>
                ),
              }))}
            />
          </div>
        </div>
      </div>
    </Section>
  );
}

type Unit = (n: number) => string;

function CentreCard({ style, unit, flow = false }: { style?: CSSProperties; unit: Unit; flow?: boolean }) {
  return (
    <div
      className={`${flow ? "relative" : "absolute"} flex flex-col items-center justify-center rounded-3xl bg-white text-center shadow-[0_24px_60px_-24px_rgb(41_43_56/0.3)] ring-1 ring-line`}
      style={{ ...style, padding: unit(22) }}
    >
      <p className="font-bold uppercase tracking-[0.18em] text-accent-600" style={{ fontSize: unit(13) }}>
        {event.name}
      </p>
      <p className="font-display font-black uppercase leading-none tracking-tight text-navy-900" style={{ fontSize: unit(46), marginTop: unit(10) }}>
        Focus
      </p>
      <p
        className="bg-gradient-to-r from-brand-500 to-navy-900 bg-clip-text font-display font-black uppercase leading-none tracking-tight text-transparent"
        style={{ fontSize: unit(46), marginTop: unit(4) }}
      >
        Domains
      </p>
      <p className="text-muted" style={{ fontSize: unit(13.5), marginTop: unit(14), maxWidth: unit(260) }}>
        Explore diverse domains and build solutions for a better tomorrow.
      </p>
    </div>
  );
}

function DomainCard({ domain, style, unit, flow = false }: { domain: (typeof focusDomains)[number]; style?: CSSProperties; unit: Unit; flow?: boolean }) {
  const tone = tones[domain.tone];
  return (
    <div
      className={`${flow ? "relative h-full w-full" : "absolute"} flex items-center rounded-2xl border ${tone.card} shadow-[0_14px_30px_-22px_rgb(41_43_56/0.4)]`}
      style={{ ...style, padding: unit(16), columnGap: unit(16) }}
    >
      <span
        className={`flex shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-black/5 ${tone.title}`}
        style={{ width: unit(62), height: unit(62) }}
      >
        <Icon name={domain.icon} style={{ width: unit(30), height: unit(30) }} />
      </span>
      <div className="min-w-0">
        <h3 className="font-display font-bold leading-snug text-navy-900" style={{ fontSize: unit(17) }}>
          {domain.title}
        </h3>
        <p className="leading-snug text-muted" style={{ fontSize: unit(14), marginTop: unit(5) }}>
          {domain.text}
        </p>
      </div>
    </div>
  );
}
