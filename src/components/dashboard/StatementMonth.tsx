"use client";

import { CalendarCheck2, CalendarSearch } from "lucide-react";
import { monthKey } from "@/lib/schemas";
import { periodLabel, type StatementPeriod } from "@/lib/statementPeriod";
import { cn, inputCls } from "@/components/ui";

/** The last 36 months through next month (newest first), plus `include` if it falls outside that range. */
export function statementMonthOptions(include?: string | null, now = new Date()): string[] {
  const out = Array.from({ length: 37 }, (_, i) => monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1 - i, 1))));
  if (include && !out.includes(include)) out.push(include);
  return out.sort().reverse();
}

const SOURCE_TEXT: Record<StatementPeriod["source"], string> = {
  text: "read from the statement's dates",
  model: "read by the AI from the document",
};

/**
 * "Detected statement month: March 2026" with a manual override dropdown. Used by the upload review and the
 * Fiscal Year Tracker's auto-detect import.
 */
export function StatementMonthPicker({
  detected,
  value,
  onChange,
  className,
  id,
}: {
  detected: StatementPeriod | null;
  value: string;
  onChange: (key: string) => void;
  className?: string;
  id?: string;
}) {
  const overridden = !!detected && value !== detected.key;
  const Icon = detected ? CalendarCheck2 : CalendarSearch;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 text-sm", className)}>
      <Icon className={cn("h-4 w-4 shrink-0", detected ? "text-emerald-300" : "text-amber-300")} aria-hidden />
      <span className="min-w-0 flex-1 text-slate-300">
        {detected ? (
          <>
            Detected statement month: <strong className="font-semibold text-slate-50">{detected.label}</strong>
            <span className="block text-xs text-slate-500">
              {SOURCE_TEXT[detected.source]}
              {detected.confidence === "medium" ? " · best guess, please confirm" : ""}
              {overridden ? ` · you picked ${periodLabel(value)}` : ""}
            </span>
          </>
        ) : (
          <>
            We couldn&apos;t tell which month this statement covers.
            <span className="block text-xs text-slate-500">Pick the month to log these totals against.</span>
          </>
        )}
      </span>
      <label className="shrink-0">
        <span className="sr-only">Statement month</span>
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, "w-auto py-1.5 pr-8 text-xs [color-scheme:dark]")}>
          {!value && <option value="">Choose month…</option>}
          {statementMonthOptions(detected?.key ?? value).map((k) => (
            <option key={k} value={k}>
              {periodLabel(k)}
              {detected?.key === k ? " (detected)" : ""}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
