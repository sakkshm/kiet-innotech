"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { formatNumber } from "@/lib/format";
import { Tooltip, useTooltip } from "./Tooltip";

export type Slice = { key: string; label: string; value: number; color: string; href?: string };

const SIZE = 160;
const R = 62;
const STROKE = 20;
// 2px of white between slices, as an angle on the ring.
const GAP = 2 / R;

function arc(start: number, end: number) {
  const point = (angle: number) => [SIZE / 2 + R * Math.sin(angle), SIZE / 2 - R * Math.cos(angle)];
  const [x1, y1] = point(start);
  const [x2, y2] = point(end);
  return `M ${x1} ${y1} A ${R} ${R} 0 ${end - start > Math.PI ? 1 : 0} 1 ${x2} ${y2}`;
}

/** Part-to-whole for a few (at most six) groups, with the total in the middle and values and shares in the legend. */
export function Donut({ slices, centerLabel }: { slices: Slice[]; centerLabel: string }) {
  const box = useRef<HTMLDivElement>(null);
  const { tip, show, showAt, hide } = useTooltip(box);
  const [active, setActive] = useState<string | null>(null);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const shown = slices.filter((s) => s.value > 0);
  const share = (value: number) => (total ? `${Math.round((value / total) * 100)}%` : "0%");

  // Each slice starts where the ones before it end.
  const sweeps = shown.map((slice) => (slice.value / total) * Math.PI * 2);
  const arcs = shown.map((slice, i) => {
    const start = sweeps.slice(0, i).reduce((sum, sweep) => sum + sweep, 0);
    return { slice, path: shown.length === 1 ? null : arc(start + GAP / 2, start + sweeps[i] - GAP / 2) };
  });

  const readout = (slice: Slice) => [{ color: slice.color, label: `${share(slice.value)} of ${formatNumber(total)}`, value: formatNumber(slice.value) }];
  const enter = (slice: Slice) => setActive(slice.key);
  const leave = () => {
    setActive(null);
    hide();
  };

  return (
    <div ref={box} className="relative flex flex-col items-center gap-4 @lg:flex-row @lg:gap-6" onPointerLeave={leave}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-40 shrink-0" role="img" aria-label={`${centerLabel}: ${slices.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="#efeff3" strokeWidth={STROKE} />
        {arcs.map(({ slice, path }) =>
          path ? (
            <path
              key={slice.key}
              d={path}
              fill="none"
              stroke={slice.color}
              strokeWidth={STROKE}
              opacity={active && active !== slice.key ? 0.35 : 1}
              className="transition-opacity"
              onPointerMove={(e) => {
                enter(slice);
                show(e.clientX, e.clientY, slice.label, readout(slice));
              }}
            />
          ) : (
            <circle key={slice.key} cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={slice.color} strokeWidth={STROKE} />
          ),
        )}
        <text x="50%" y="47%" textAnchor="middle" className="fill-navy-900 font-display text-[26px] font-bold">
          {formatNumber(total)}
        </text>
        <text x="50%" y="60%" textAnchor="middle" className="fill-[#5f6275] text-[10px]">
          {centerLabel}
        </text>
      </svg>
      <ul className="w-full min-w-0 flex-1 space-y-1 text-sm">
        {slices.map((slice) => {
          const content = (
            <>
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px]" style={{ background: slice.color }} />
              <span className="min-w-0 flex-1 truncate text-navy-800">{slice.label}</span>
              <span className="font-semibold tabular-nums text-navy-900">{formatNumber(slice.value)}</span>
              <span className="w-10 text-right text-xs tabular-nums text-muted">{share(slice.value)}</span>
            </>
          );
          const props = {
            className: `flex items-center gap-2 rounded-lg px-2 py-1 ${active === slice.key ? "bg-surface" : ""} ${slice.href ? "hover:bg-surface" : ""}`,
            onPointerEnter: () => enter(slice),
            onFocus: (e: React.FocusEvent<HTMLElement>) => {
              enter(slice);
              showAt(e.currentTarget, slice.label, readout(slice));
            },
            onBlur: leave,
          };
          return <li key={slice.key}>{slice.href ? <Link href={slice.href} {...props}>{content}</Link> : <div {...props}>{content}</div>}</li>;
        })}
      </ul>
      <Tooltip tip={tip} />
    </div>
  );
}
