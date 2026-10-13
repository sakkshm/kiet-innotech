"use client";

import { categories, rubrics } from "@/lib/content";

/** Nine marks: two parts of 5 for each of the first four criteria, then Query Addressing out of 10 (server: rules.RUBRIC_PARTS). */
export const PARTS = [5, 5, 5, 5, 5, 5, 5, 5, 10];
export const TOTAL = PARTS.reduce((a, b) => a + b, 0);

export function rubricFor(category: number) {
  const entry = categories.find((c) => c.number === category);
  return entry ? rubrics[entry.rubric] : null;
}

/** Which marks belong to criterion `c`: the first four have two parts, Query Addressing one. */
export function partIndexes(c: number) {
  return c < 4 ? [c * 2, c * 2 + 1] : [8];
}

function MarkPicker({ id, max, value, onChange, disabled }: { id: string; max: number; value: number | null; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-1.5">
      {Array.from({ length: max + 1 }, (_, mark) => (
        <button
          key={mark}
          type="button"
          role="radio"
          aria-checked={value === mark}
          disabled={disabled}
          onClick={() => onChange(mark)}
          className={`size-10 rounded-xl text-base font-bold tabular-nums ring-1 ring-inset transition disabled:cursor-not-allowed sm:size-11 ${
            value === mark
              ? "bg-navy-900 text-white shadow-md shadow-navy-900/20 ring-navy-900"
              : "bg-white text-navy-800 ring-line hover:bg-brand-50 hover:ring-brand-300 disabled:hover:bg-white"
          }`}
        >
          {mark}
        </button>
      ))}
    </div>
  );
}

/** The category's rubric as tap targets, with a running subtotal for each criterion. */
export function RubricForm({
  category,
  marks,
  onChange,
  disabled = false,
}: {
  category: number;
  marks: (number | null)[];
  onChange: (index: number, value: number) => void;
  disabled?: boolean;
}) {
  const rubric = rubricFor(category);
  if (!rubric) return null;
  return (
    <div className="space-y-4">
      {rubric.criteria.map((criterion, c) => {
        const indexes = partIndexes(c);
        const parts = criterion.parts ?? [criterion.title];
        const done = indexes.every((i) => marks[i] !== null);
        const subtotal = indexes.reduce((sum, i) => sum + (marks[i] ?? 0), 0);
        const out = indexes.reduce((sum, i) => sum + PARTS[i], 0);
        return (
          <fieldset key={criterion.title} className={`rounded-2xl p-4 ring-1 ring-inset transition ${done ? "bg-emerald-50/50 ring-emerald-200" : "bg-white ring-line"}`}>
            <legend className="sr-only">{criterion.title}</legend>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <p className="text-sm font-bold text-navy-900">
                <span className="mr-1.5 inline-flex size-6 items-center justify-center rounded-full bg-navy-900 text-xs text-white">{c + 1}</span>
                {criterion.title}
              </p>
              <p className="shrink-0 font-display text-sm font-bold tabular-nums text-navy-900">
                {subtotal}
                <span className="text-muted"> / {out}</span>
              </p>
            </div>
            <div className="space-y-3">
              {indexes.map((index, p) => {
                const labelId = `mark-${index}`;
                return (
                  <div key={index} className="space-y-1.5">
                    <p id={labelId} className="text-xs font-semibold text-navy-800">
                      {parts[p]} <span className="font-normal text-muted">(out of {PARTS[index]})</span>
                    </p>
                    <MarkPicker id={labelId} max={PARTS[index]} value={marks[index]} onChange={(v) => onChange(index, v)} disabled={disabled} />
                  </div>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

/** Criterion subtotals as a compact table, for reviewing marks before they are submitted (or after, while revealed). */
export function RubricSummary({ category, marks }: { category: number; marks: number[] }) {
  const rubric = rubricFor(category);
  if (!rubric) return null;
  return (
    <table className="w-full text-sm">
      <tbody>
        {rubric.criteria.map((criterion, c) => {
          const indexes = partIndexes(c);
          const parts = criterion.parts ?? [criterion.title];
          return (
            <tr key={criterion.title} className="border-b border-line last:border-0">
              <td className="py-2 pr-3 align-top">
                <span className="font-semibold text-navy-900">{criterion.title}</span>
                <span className="block text-xs text-muted">{indexes.map((i, p) => `${parts[p]}: ${marks[i]}/${PARTS[i]}`).join(" · ")}</span>
              </td>
              <td className="py-2 text-right align-top font-display font-bold tabular-nums text-navy-900">
                {indexes.reduce((sum, i) => sum + marks[i], 0)}
                <span className="text-xs text-muted">/{indexes.reduce((sum, i) => sum + PARTS[i], 0)}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
