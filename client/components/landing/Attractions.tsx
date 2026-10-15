import type { CSSProperties } from "react";
import { ArrowRight } from "lucide-react";
import { attractions } from "@/lib/content";
import { Icon } from "@/components/ui/Icon";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { Slider } from "@/components/ui/Slider";
import { Celebrate } from "./Celebrate";
import { tones } from "./tones";

/*
 * Desktop diagram: three attractions either side of a "Finale Day" centre card, joined by curved lines.
 * Placed on a 1540 x 545 design grid and sized in container units, so it scales as one piece.
 * Smaller screens get the centre card followed by a grid of attractions.
 */
const W = 1540;
const H = 545;
const u = (n: number) => `${(n / W) * 100}cqw`;
const place = ([x, y, w, h]: readonly number[]): CSSProperties => ({
  left: `${(x / W) * 100}%`,
  top: `${(y / H) * 100}%`,
  width: `${(w / W) * 100}%`,
  height: `${(h / H) * 100}%`,
});

const CENTRE = [595, 45, 345, 420] as const;
const ROWS = [5, 194, 383];

/** A curve from a card edge to the centre card, leaving and arriving horizontally. */
const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const pull = x2 > x1 ? 50 : -50;
  return { path: `M${x1} ${y1} C${x1 + pull} ${y1} ${x2 - pull} ${y2} ${x2} ${y2}`, dots: [[x1, y1], [x2, y2]] };
};

// One entry per attraction, in content order: three on the left, then three on the right.
const layout = [
  { box: [0, ROWS[0], 497, 155], line: curve(507, 75, 590, 201) },
  { box: [0, ROWS[1], 497, 155], line: curve(507, 255, 590, 255) },
  { box: [0, ROWS[2], 497, 155], line: curve(507, 443, 590, 307) },
  { box: [1039, ROWS[0], 498, 155], line: curve(1029, 75, 945, 201) },
  { box: [1039, ROWS[1], 498, 155], line: curve(1029, 255, 945, 255) },
  { box: [1039, ROWS[2], 498, 155], line: curve(1029, 443, 945, 307) },
] as const;

type Unit = (n: number) => string;
/** Stacked layout on smaller screens: the same proportions at about 70% of the desktop size. */
const px: Unit = (n) => `${n * 0.72}px`;

export function Attractions() {
  return (
    <Section id="attractions" className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -left-40 -top-20 h-[28rem] w-[28rem] rounded-full bg-brand-50 blur-2xl" />
        <div className="absolute -left-24 top-40 h-72 w-72 rounded-full bg-accent-100/50 blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 h-80 w-[40rem] rounded-full bg-brand-100/50 blur-3xl" />
        <div className="absolute -bottom-32 -right-20 h-80 w-80 rounded-full bg-accent-100/60 blur-3xl" />
        <div className="absolute right-[6%] top-12 hidden h-28 w-44 bg-[radial-gradient(#c9cad3_1.5px,transparent_1.5px)] bg-[length:22px_22px] lg:block" />
      </div>

      <div className="relative">
        <Reveal className="mx-auto mb-12 max-w-3xl text-center">
          <p className="mb-3 inline-flex items-center gap-4 text-xs font-bold uppercase tracking-[0.3em] text-accent-600 sm:text-sm">
            <span className="h-px w-12 bg-current" />
            Special attractions
            <span className="h-px w-12 bg-current" />
          </p>
          <h2 className="relative inline-block font-display text-4xl font-black tracking-tight text-ink sm:text-5xl lg:text-6xl">
            More than a{" "}
            <span className="relative inline-block bg-gradient-to-r from-brand-500 via-brand-600 to-navy-900 bg-clip-text pb-1 text-transparent">
              competition
              <svg viewBox="0 0 200 12" className="absolute -bottom-1 left-[18%] h-2.5 w-[58%] text-brand-500" preserveAspectRatio="none" aria-hidden="true">
                <path d="M2 9 C 60 3, 140 3, 198 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </span>
            <Sparks className="absolute -right-10 -top-2 hidden h-9 w-9 sm:block" />
          </h2>
          <p className="mt-4 text-base text-muted sm:text-lg">On finale day the campus turns into an innovation exhibition.</p>
        </Reveal>

        {/* Desktop: connected diagram */}
        <Reveal className="@container relative mx-auto hidden aspect-[1540/545] w-full max-w-[1540px] xl:block">
          <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden="true" fill="none">
            {layout.map(({ line }, index) => {
              const stroke = tones[attractions[index].tone].stroke;
              return (
                <g key={index}>
                  <path d={line.path} stroke={stroke} strokeWidth={2} strokeLinecap="round" fill="none" opacity={0.85} />
                  {line.dots.map(([cx, cy]) => (
                    <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={5.5} fill={stroke} />
                  ))}
                </g>
              );
            })}
          </svg>

          <CentreCard style={place(CENTRE)} unit={u} />
          {attractions.map((item, index) => (
            <AttractionCard key={item.title} item={item} number={index + 1} style={place(layout[index].box)} unit={u} />
          ))}
        </Reveal>

        {/* Phones and tablets */}
        <div className="xl:hidden">
          <Reveal className="mx-auto max-w-sm pt-16">
            <CentreCard unit={px} flow />
          </Reveal>
          <div className="mt-4 md:mt-8">
            <Slider
              label="Finale attractions"
              gridClassName="md:grid-cols-2 md:gap-4"
              slides={attractions.map((item, index) => ({
                key: item.title,
                className: "flex",
                content: (
                  <Reveal delay={(index % 2) * 80} className="flex w-full">
                    <AttractionCard item={item} number={index + 1} unit={px} flow />
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

function CentreCard({ style, unit, flow = false }: { style?: CSSProperties; unit: Unit; flow?: boolean }) {
  return (
    <div
      className={`${flow ? "relative" : "absolute"} flex flex-col items-center rounded-[2rem] bg-gradient-to-b from-orange-50 via-white to-orange-50/70 text-center shadow-[0_30px_60px_-30px_rgb(232_85_36/0.45)] ring-1 ring-orange-100`}
      style={{ ...style, paddingInline: unit(20), paddingBottom: unit(28), paddingTop: unit(198) }}
    >
      {/* Soft glow behind the trophy */}
      <div
        className="absolute left-1/2 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgb(255_222_196/0.9),transparent_70%)]"
        style={{ top: unit(-10), width: unit(270), height: unit(250) }}
        aria-hidden="true"
      />
      {/* The trophy floats, twinkles, and throws confetti once when it scrolls into view (and again when touched). */}
      <Celebrate glow={false} className="absolute left-1/2 -translate-x-1/2" style={{ top: unit(-40), width: unit(230), height: unit(220) }}>
        <Trophy id={flow ? "stacked" : "diagram"} className="animate-bob h-full w-full" />
      </Celebrate>
      <p className="relative font-bold uppercase tracking-[0.3em] text-accent-600" style={{ fontSize: unit(15) }}>
        Finale day
      </p>
      <h3 className="relative font-display font-black leading-[1.05] tracking-tight text-navy-900" style={{ fontSize: unit(42), marginTop: unit(10) }}>
        Innovation Exhibition
      </h3>
      <p className="relative leading-relaxed text-muted" style={{ fontSize: unit(15), marginTop: unit(16) }}>
        A vibrant showcase of ideas, projects and technologies from across the campus.
      </p>
    </div>
  );
}

type AttractionCardProps = {
  item: (typeof attractions)[number];
  number: number;
  unit: Unit;
  style?: CSSProperties;
  flow?: boolean;
};

function AttractionCard({ item, number, unit, style, flow = false }: AttractionCardProps) {
  const tone = tones[item.tone];
  if (flow) return <FlowAttractionCard item={item} number={number} unit={unit} />;
  return (
    <div
      className={`absolute flex items-center overflow-hidden rounded-[1.75rem] bg-gradient-to-r ${tone.wash} to-white shadow-[0_20px_45px_-28px_rgb(41_43_56/0.35)] ring-1 ring-line/70`}
      style={{ ...style, padding: `${unit(24)} ${unit(84)} ${unit(24)} ${unit(24)}`, columnGap: unit(26) }}
    >
      <span className={`flex shrink-0 items-center justify-center rounded-[22%] ${tone.badge}`} style={{ width: unit(96), height: unit(96) }}>
        <Icon name={item.icon} strokeWidth={1.75} style={{ width: unit(44), height: unit(44) }} />
      </span>
      <div className="min-w-0">
        <h3 className="font-display font-bold leading-tight text-navy-900" style={{ fontSize: unit(23) }}>
          {item.title}
        </h3>
        <p className="leading-relaxed text-muted" style={{ fontSize: unit(16.5), marginTop: unit(8) }}>
          {item.text}
        </p>
      </div>
      <span
        className={`absolute font-display font-black leading-none opacity-[0.12] ${tone.title}`}
        style={{ top: unit(18), right: unit(26), fontSize: unit(46) }}
        aria-hidden="true"
      >
        {String(number).padStart(2, "0")}
      </span>
      <span
        className={`absolute flex items-center justify-center rounded-full ${tone.badge}`}
        style={{ bottom: unit(24), right: unit(22), width: unit(48), height: unit(48) }}
        aria-hidden="true"
      >
        <ArrowRight style={{ width: unit(22), height: unit(22) }} />
      </span>
    </div>
  );
}

/**
 * The card in the page flow. Phones (inside the slider) stack the icon above the text, since a slide is too
 * narrow for the side-by-side card. From md up it is the diagram card at the scale `unit` gives, passed in as
 * CSS variables because inline styles cannot change per breakpoint.
 */
function FlowAttractionCard({ item, number, unit }: { item: (typeof attractions)[number]; number: number; unit: Unit }) {
  const tone = tones[item.tone];
  const sizes = {
    "--pad": `${unit(24)} ${unit(84)} ${unit(24)} ${unit(24)}`,
    "--gap": unit(26),
    "--icon": unit(96),
    "--glyph": unit(44),
    "--title": unit(23),
    "--text": unit(16.5),
    "--text-gap": unit(8),
    "--num-top": unit(18),
    "--num-right": unit(26),
    "--num": unit(46),
    "--arrow-bottom": unit(24),
    "--arrow-right": unit(22),
    "--arrow": unit(48),
    "--arrow-glyph": unit(22),
  } as CSSProperties;
  return (
    <div
      className={`relative flex h-full w-full flex-col items-start gap-4 overflow-hidden rounded-[1.75rem] bg-gradient-to-r p-5 ${tone.wash} to-white shadow-[0_20px_45px_-28px_rgb(41_43_56/0.35)] ring-1 ring-line/70 md:flex-row md:items-center md:gap-0 md:[column-gap:var(--gap)] md:[padding:var(--pad)]`}
      style={sizes}
    >
      <span
        className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[22%] ${tone.badge} md:h-[var(--icon)] md:w-[var(--icon)]`}
      >
        <Icon name={item.icon} strokeWidth={1.75} className="h-7 w-7 md:h-[var(--glyph)] md:w-[var(--glyph)]" />
      </span>
      <div className="min-w-0">
        <h3 className="font-display text-xl font-bold leading-tight text-navy-900 md:text-[length:var(--title)]">{item.title}</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-muted md:mt-[var(--text-gap)] md:text-[length:var(--text)]">{item.text}</p>
      </div>
      <span
        className={`absolute right-5 top-4 font-display text-4xl font-black leading-none opacity-[0.12] ${tone.title} md:right-[var(--num-right)] md:top-[var(--num-top)] md:text-[length:var(--num)]`}
        aria-hidden="true"
      >
        {String(number).padStart(2, "0")}
      </span>
      <span
        className={`absolute hidden items-center justify-center rounded-full ${tone.badge} md:bottom-[var(--arrow-bottom)] md:right-[var(--arrow-right)] md:flex md:h-[var(--arrow)] md:w-[var(--arrow)]`}
        aria-hidden="true"
      >
        <ArrowRight className="md:h-[var(--arrow-glyph)] md:w-[var(--arrow-glyph)]" />
      </span>
    </div>
  );
}

function Sparks({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <g stroke="#e85524" strokeWidth="3.5" strokeLinecap="round">
        <path d="M10 18 L16 4" />
        <path d="M18 24 L33 14" />
        <path d="M20 33 L36 34" />
      </g>
    </svg>
  );
}

/**
 * A golden trophy with a star, drawn in SVG so it stays sharp at any size.
 * `id` keeps the gradient ids unique: the page renders one trophy per layout, and a gradient
 * referenced from a hidden layout would not paint.
 */
function Trophy({ id, className, style }: { id: string; className?: string; style?: CSSProperties }) {
  const gold = `trophy-gold-${id}`;
  const base = `trophy-base-${id}`;
  return (
    <svg viewBox="0 0 200 190" className={className} style={style} aria-hidden="true">
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="0.45" stopColor="#fbb82e" />
          <stop offset="1" stopColor="#e07b00" />
        </linearGradient>
        <linearGradient id={base} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#41445a" />
          <stop offset="1" stopColor="#1c1d26" />
        </linearGradient>
      </defs>
      {/* Orbit ring behind the cup */}
      <ellipse cx="100" cy="118" rx="86" ry="17" fill="none" stroke="#f7a07a" strokeWidth="3" opacity="0.7" />
      {/* Spark lines, mirrored on both sides */}
      <g stroke="#e85524" strokeWidth="3.5" strokeLinecap="round">
        <path d="M40 22 L50 36" />
        <path d="M58 10 L60 26" />
        <path d="M26 42 L42 46" />
        <path d="M160 22 L150 36" />
        <path d="M142 10 L140 26" />
        <path d="M174 42 L158 46" />
      </g>
      {/* Handles */}
      <path d="M58 44 C 26 42, 26 86, 62 92" fill="none" stroke={`url(#${gold})`} strokeWidth="10" strokeLinecap="round" />
      <path d="M142 44 C 174 42, 174 86, 138 92" fill="none" stroke={`url(#${gold})`} strokeWidth="10" strokeLinecap="round" />
      {/* Cup */}
      <path d="M54 30 H146 V66 C146 102 126 124 100 127 C74 124 54 102 54 66 Z" fill={`url(#${gold})`} />
      <rect x="50" y="24" width="100" height="11" rx="5.5" fill="#ffe7a3" />
      <path d="M100 52 L106.5 65 L121 67 L110.5 77 L113 91.5 L100 84.5 L87 91.5 L89.5 77 L79 67 L93.5 65 Z" fill="#fff4cf" />
      {/* Front of the orbit ring */}
      <path d="M14 118 C 30 132, 170 132, 186 118" fill="none" stroke="#f07a48" strokeWidth="3" opacity="0.8" />
      {/* Stem and base */}
      <rect x="91" y="125" width="18" height="18" fill={`url(#${gold})`} />
      <rect x="72" y="140" width="56" height="10" rx="4" fill="#e89a1c" />
      <path d="M62 150 H138 L146 182 H54 Z" fill={`url(#${base})`} />
      <rect x="84" y="160" width="32" height="10" rx="2.5" fill="#e7e8ee" />
    </svg>
  );
}
