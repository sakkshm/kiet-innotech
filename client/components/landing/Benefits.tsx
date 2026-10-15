import type { CSSProperties } from "react";
import { benefits } from "@/lib/content";
import { Icon } from "@/components/ui/Icon";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { Slider } from "@/components/ui/Slider";
import { tones } from "./tones";

/*
 * Desktop diagram: a title card with the benefit cards around it, each joined to it by a coloured line.
 * Everything is placed on a 1200 x 740 design grid and sized in container units, so the diagram
 * scales as one piece. Smaller screens get a stacked layout instead.
 */
const W = 1200;
const H = 760;
const u = (n: number) => `${(n / W) * 100}cqw`;
const place = (x: number, y: number, w: number, h: number): CSSProperties => ({
  left: `${(x / W) * 100}%`,
  top: `${(y / H) * 100}%`,
  width: `${(w / W) * 100}%`,
  height: `${(h / H) * 100}%`,
});

// Three cards above the title card, four below, on a symmetric grid; every connector is a straight run with
// at most one rounded corner, leaving the title card from its nearest side.
const TITLE = { x: 350, y: 300, w: 500, h: 180 };

// One entry per benefit, in content order: card box, connector path, and the two dot positions.
const layout = [
  { box: [60, 40, 330, 200], path: "M350 345 H239 Q225 345 225 331 V240", dots: [[350, 345], [225, 240]] },
  { box: [435, 40, 330, 200], path: "M600 300 V240", dots: [[600, 300], [600, 240]] },
  { box: [810, 40, 330, 200], path: "M850 345 H961 Q975 345 975 331 V240", dots: [[850, 345], [975, 240]] },
  { box: [60, 550, 255, 200], path: "M350 435 H202 Q188 435 188 449 V550", dots: [[350, 435], [188, 550]] },
  { box: [345, 550, 255, 200], path: "M473 480 V550", dots: [[473, 480], [473, 550]] },
  { box: [630, 550, 255, 200], path: "M758 480 V550", dots: [[758, 480], [758, 550]] },
  { box: [915, 550, 255, 200], path: "M850 435 H1029 Q1043 435 1043 449 V550", dots: [[850, 435], [1043, 550]] },
] as const;

const words = ["Learn", "Connect", "Create", "Make an impact"];

export function Benefits() {
  return (
    <Section id="benefits">
      {/* Desktop: connected diagram */}
      <Reveal className="@container relative mx-auto hidden aspect-[1200/760] w-full max-w-[1200px] xl:block">
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden="true" fill="none">
          {layout.map((item, index) => {
            const stroke = tones[benefits[index].tone].stroke;
            return (
              <g key={index} stroke={stroke} fill={stroke}>
                <path d={item.path} fill="none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                {item.dots.map(([cx, cy]) => (
                  <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={5} stroke="none" />
                ))}
              </g>
            );
          })}
        </svg>

        <div
          className="absolute flex flex-col items-center justify-center rounded-3xl bg-white text-center shadow-[0_20px_50px_-20px_rgb(41_43_56/0.25)] ring-1 ring-line"
          style={{ ...place(TITLE.x, TITLE.y, TITLE.w, TITLE.h), paddingInline: u(44) }}
        >
          <h2 className="font-display font-bold leading-[1.05] tracking-tight text-ink" style={{ fontSize: u(46) }}>
            Participation Benefits
          </h2>
          <Words size={u(12.5)} gap={u(11)} className="mt-[1.4cqw] flex-nowrap justify-center whitespace-nowrap" />
        </div>

        {benefits.map((benefit, index) => {
          const [x, y, w, h] = layout[index].box;
          return <BenefitCard key={benefit.title} benefit={benefit} style={place(x, y, w, h)} unit={u} />;
        })}
      </Reveal>

      {/* Phones and tablets: title, then the cards in a grid */}
      <div className="xl:hidden">
        <Reveal className="mx-auto max-w-2xl rounded-3xl bg-white px-6 py-8 text-center shadow-[0_20px_50px_-20px_rgb(41_43_56/0.25)] ring-1 ring-line sm:px-10">
          <h2 className="font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">Participation Benefits</h2>
          <Words size="0.8rem" gap="0.75rem" className="mt-4 justify-center" />
        </Reveal>
        {/* Phones: a slider (the badges stick out above the cards, hence the extra top padding). Tablets: a grid. */}
        <div className="mt-8 md:mt-14">
          <Slider
            label="Participation benefits"
            padTop="pt-10"
            gridClassName="md:grid-cols-2 md:gap-x-5 md:gap-y-12 lg:grid-cols-3"
            slides={benefits.map((benefit, index) => ({
              key: benefit.title,
              className: "flex",
              content: (
                <Reveal delay={(index % 3) * 80} className="flex w-full">
                  <BenefitCard benefit={benefit} unit={(n) => `${n}px`} flow />
                </Reveal>
              ),
            }))}
          />
        </div>
      </div>
    </Section>
  );
}

function Words({ size, gap, className = "" }: { size: string; gap: string; className?: string }) {
  return (
    <ul className={`flex flex-wrap items-center font-bold uppercase tracking-[0.08em] text-navy-800 ${className}`} style={{ fontSize: size, columnGap: gap }}>
      {words.map((word, index) => (
        <li key={word} className="flex items-center" style={{ columnGap: gap }}>
          {index > 0 && <span className="h-[1em] w-px bg-line" aria-hidden="true" />}
          {word}
        </li>
      ))}
    </ul>
  );
}

type BenefitCardProps = {
  benefit: (typeof benefits)[number];
  unit: (n: number) => string;
  style?: CSSProperties;
  /** In the stacked layout the card sits in the page flow instead of on the diagram. */
  flow?: boolean;
};

function BenefitCard({ benefit, unit, style, flow = false }: BenefitCardProps) {
  const tone = tones[benefit.tone];
  return (
    <div
      className={`${flow ? "relative h-full w-full" : "absolute"} rounded-3xl ${tone.card} shadow-[0_18px_40px_-24px_rgb(41_43_56/0.35)]`}
      style={{ ...style, padding: `${unit(42)} ${unit(24)} ${unit(20)}` }}
    >
      <span
        className={`absolute left-1/2 flex -translate-x-1/2 items-center justify-center rounded-full ring-4 ring-white ${tone.badge}`}
        style={{ top: unit(-29), width: unit(58), height: unit(58) }}
      >
        <Icon name={benefit.icon} style={{ width: unit(26), height: unit(26) }} />
      </span>
      <h3 className={`font-display font-extrabold uppercase leading-tight tracking-wide ${tone.title}`} style={{ fontSize: unit(17) }}>
        {benefit.title}
      </h3>
      <p className="mt-[0.5em] leading-normal text-navy-800" style={{ fontSize: unit(15) }}>
        {benefit.text}
      </p>
    </div>
  );
}
