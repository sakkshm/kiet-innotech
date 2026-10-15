"use client";

import { useRef } from "react";
import { formatNumber } from "@/lib/format";
import { accent } from "./palette";
import { Tooltip, useTooltip } from "./Tooltip";

export type Column = { key: string; label: string; value: number; note?: string };

/** Vertical columns for one series over a few ordered groups (year of study, team size). Values sit on the caps. */
export function Columns({
  columns,
  unit,
  axisLabel,
  color = accent,
  height = 150,
}: {
  columns: Column[];
  unit: string;
  /** What the column labels are, when they are bare numbers. */
  axisLabel?: string;
  color?: string;
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const { tip, show, showAt, hide } = useTooltip(box);
  const max = Math.max(1, ...columns.map((c) => c.value));
  return (
    <div ref={box} className="relative" onPointerLeave={hide}>
      <ol className="flex items-end justify-around gap-2 border-b border-[#cbccd4] px-2" style={{ height: height + 22 }}>
        {columns.map((column) => {
          const readout = [{ color, label: unit, value: formatNumber(column.value) }];
          return (
            <li
              key={column.key}
              tabIndex={0}
              aria-label={`${column.label}: ${formatNumber(column.value)} ${unit}`}
              className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end outline-none"
              onPointerMove={(e) => show(e.clientX, e.clientY, column.note ?? column.label, readout)}
              onFocus={(e) => showAt(e.currentTarget, column.note ?? column.label, readout)}
              onBlur={hide}
            >
              <span className="mb-1 text-xs font-semibold tabular-nums text-navy-900">{formatNumber(column.value)}</span>
              <span
                className="w-6 rounded-t-[4px] transition group-hover:brightness-110 group-focus-visible:ring-2 group-focus-visible:ring-brand-500"
                style={{ height: `${(column.value / max) * height}px`, minHeight: column.value ? 2 : 0, background: color }}
              />
            </li>
          );
        })}
      </ol>
      <ol className="flex justify-around gap-2 px-2 pt-1.5" aria-hidden="true">
        {columns.map((column) => (
          <li key={column.key} className="min-w-0 flex-1 truncate text-center text-[11px] text-muted">
            {column.label}
          </li>
        ))}
      </ol>
      {axisLabel && <p className="mt-1 text-center text-[11px] text-muted">{axisLabel}</p>}
      <Tooltip tip={tip} />
    </div>
  );
}
