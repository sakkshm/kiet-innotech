"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { FinalistSummary, QuotaCell } from "@/lib/admin-types";
import { categories } from "@/lib/content";
import { finalistQuota } from "@/lib/rules";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Notice } from "@/components/ui/Notice";
import { numClass, tdClass, Th } from "@/components/ui/Table";

/** Super admin: how many teams each department may nominate in each category (problem statement). */
export function QuotaDialog({ summary, onClose, onSaved }: { summary: FinalistSummary; onClose: () => void; onSaved: (summary: FinalistSummary) => void }) {
  const initial = Object.fromEntries(summary.matrix.flatMap((row) => row.categories.map((c) => [`${row.department}|${c.category}`, c.quota])));
  const [values, setValues] = useState<Record<string, number>>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed: QuotaCell[] = Object.entries(values)
    .filter(([key, quota]) => initial[key] !== quota)
    .map(([key, quota]) => {
      const [department, category] = key.split("|");
      return { department, category: Number(category), quota };
    });
  const total = Object.values(values).reduce((a, b) => a + b, 0);

  async function save() {
    setPending(true);
    setError(null);
    try {
      onSaved(await api.saveQuotas(changed));
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <Dialog
      title="Finalist quotas"
      description="The most teams each department can nominate for the Grand Finale in each category. Department admins cannot nominate more than this. A quota cannot go below what a department has already nominated."
      onClose={onClose}
      busy={pending}
      size="xl"
      footer={
        <>
          <span className="mr-auto self-center text-sm text-muted">
            Up to {total} finalists · {changed.length} {changed.length === 1 ? "change" : "changes"}
          </span>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} pending={pending} disabled={changed.length === 0}>
            Save quotas
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setValues(Object.fromEntries(Object.keys(initial).map((key) => [key, finalistQuota(key.split("|")[0], Number(key.split("|")[1]))])))}
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            Event document numbers
          </Button>
        </div>
        <div className="max-h-[58dvh] overflow-auto rounded-xl ring-1 ring-line">
          <table aria-label="Finalist quota per department and category" className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-white">
            <tr>
              <Th>Department</Th>
              {categories.map((c) => (
                <Th key={c.number} className="text-center" title={c.title}>
                  Cat {c.number}
                </Th>
              ))}
              <Th className={numClass}>Max</Th>
            </tr>
          </thead>
          <tbody>
            {summary.matrix.map((row) => (
              <tr key={row.department}>
                <td className={`${tdClass} font-semibold text-navy-900`}>{row.department}</td>
                {row.categories.map((c) => {
                  const key = `${row.department}|${c.category}`;
                  const value = values[key];
                  return (
                    <td key={key} className={`${tdClass} text-center`}>
                      <input
                        type="number"
                        min={Math.max(0, c.nominated)}
                        max={10}
                        value={value}
                        aria-label={`${row.department}, Category ${c.category}`}
                        onChange={(e) => {
                          const next = Math.max(0, Math.min(10, Math.round(Number(e.target.value) || 0)));
                          setValues((v) => ({ ...v, [key]: next }));
                        }}
                        className={`h-9 w-14 rounded-lg text-center font-semibold tabular-nums ring-1 ring-inset focus:outline-2 focus:outline-brand-500 ${
                          value !== initial[key] ? "bg-accent-50 text-accent-600 ring-accent-100" : "bg-white text-navy-900 ring-line"
                        }`}
                      />
                    </td>
                  );
                })}
                <td className={`${tdClass} ${numClass} font-semibold`}>{row.categories.reduce((sum, c) => sum + values[`${row.department}|${c.category}`], 0)}</td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  );
}
