"use client";

import type { ReactNode } from "react";
import { CheckSquare, Download, X } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { Button } from "./Button";

/** Shown while rows are ticked: how many, select every matching row, clear, export the selection. */
export function SelectionBar({
  count,
  noun,
  matching,
  selectingAll,
  onSelectAll,
  onClear,
  onExport,
  actions,
}: {
  count: number;
  noun: { one: string; many: string };
  matching: number;
  selectingAll: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onExport: () => void;
  /** More buttons for the selection, shown before Export. */
  actions?: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div
      role="status"
      className="sticky top-2 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-navy-900 px-4 py-2.5 text-sm text-white shadow-lg shadow-navy-900/20"
    >
      <p className="flex items-center gap-2 font-semibold">
        <CheckSquare aria-hidden="true" className="size-4 text-brand-300" />
        {formatNumber(count)} {count === 1 ? noun.one : noun.many} selected
      </p>
      {count < matching && (
        <button
          type="button"
          onClick={onSelectAll}
          disabled={selectingAll}
          className="text-brand-300 underline-offset-2 hover:underline disabled:opacity-60"
        >
          {selectingAll ? "Selecting…" : `Select all ${formatNumber(matching)} matching`}
        </button>
      )}
      <div className="ml-auto flex max-w-full flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onClear}
          className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-white transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-brand-300"
        >
          <X aria-hidden="true" className="size-3.5" />
          Clear
        </button>
        {actions}
        <Button size="sm" onClick={onExport}>
          <Download aria-hidden="true" className="size-3.5" />
          Export selected
        </Button>
      </div>
    </div>
  );
}
