"use client";

import { GRANULARITIES, GRANULARITY_LABELS, GRANULARITY_UNIT, type Granularity, type Pace } from "@/lib/granularity";
import { signedUsd } from "@/components/dashboard/chartKit";
import { cn, usd } from "@/components/ui";

/** Monthly / Weekly / Daily segmented control. */
export function GranularityToggle({ value, onChange, className }: { value: Granularity; onChange: (g: Granularity) => void; className?: string }) {
  return (
    <div role="radiogroup" aria-label="Time increment" className={cn("inline-flex rounded-lg border border-white/10 bg-slate-900/60 p-0.5 text-xs", className)}>
      {GRANULARITIES.map((g) => (
        <button
          key={g}
          type="button"
          role="radio"
          aria-checked={value === g}
          onClick={() => onChange(g)}
          className={cn("rounded-md px-2.5 py-1 font-medium transition", value === g ? "bg-indigo-500/80 text-white" : "text-slate-400 hover:text-slate-200")}
        >
          {GRANULARITY_LABELS[g]}
        </button>
      ))}
    </div>
  );
}

/** Per-week / per-day pacing: revenue pace, burn, the break-even revenue target and the gap to it. */
export function PaceStrip({ pace, granularity, revenueLabel, className }: { pace: Pace; granularity: Granularity; revenueLabel: string; className?: string }) {
  const unit = GRANULARITY_UNIT[granularity];
  const items: { label: string; value: string; tone?: "good" | "bad"; title?: string }[] = [
    { label: `${revenueLabel} / ${unit}`, value: usd.format(pace.revenue) },
    { label: `Burn / ${unit}`, value: usd.format(pace.expenses), title: `Average spend per ${unit}` },
    { label: `Break-even target / ${unit}`, value: usd.format(pace.breakEven), title: `${revenueLabel} needed each ${unit} to cover that ${unit}'s costs` },
    pace.shortfall > 0
      ? { label: `Short of break-even / ${unit}`, value: usd.format(pace.shortfall), tone: "bad", title: `Extra ${revenueLabel.toLowerCase()} needed each ${unit} to break even` }
      : { label: `Net / ${unit}`, value: signedUsd(pace.net), tone: "good" },
  ];
  return (
    <dl className={cn("grid grid-cols-2 gap-2 sm:grid-cols-4", className)} aria-label={`Average pace per ${unit}`}>
      {items.map((i) => (
        <div key={i.label} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2" title={i.title}>
          <dt className="truncate text-[10px] uppercase tracking-wide text-slate-500">{i.label}</dt>
          <dd className={cn("mt-0.5 whitespace-nowrap text-sm font-semibold tabular-nums text-slate-100", i.tone === "good" && "text-emerald-300", i.tone === "bad" && "text-rose-300")}>
            {i.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
