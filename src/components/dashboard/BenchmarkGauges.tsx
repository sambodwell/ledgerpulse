"use client";

import { useMemo } from "react";
import { BarChart3 } from "lucide-react";
import {
  BENCHMARK_PROFILE_LABELS,
  BENCHMARK_STATUS_LABEL,
  BUSINESS_BENCHMARK_PROFILES,
  benchmarkTone,
  evaluateBenchmarks,
  type BenchmarkProfile,
  type BenchmarkResult,
} from "@/lib/benchmarks";
import type { FinancialAnalysis } from "@/lib/schemas";
import { exactMoney } from "@/lib/fiscal";
import { InfoTip } from "@/components/InfoTip";
import { cn, glass, inputCls } from "@/components/ui";

const TONE_CHIP = {
  good: "border-emerald-400/30 bg-emerald-500/15 text-emerald-100",
  warn: "border-amber-400/35 bg-amber-500/15 text-amber-100",
  bad: "border-rose-400/40 bg-rose-500/15 text-rose-100",
  muted: "border-white/10 bg-white/[0.03] text-slate-400",
} as const;

const TONE_MARK = { good: "bg-emerald-300", warn: "bg-amber-300", bad: "bg-rose-300", muted: "bg-slate-500" } as const;

const p1 = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Status chip, e.g. "(Healthy)". */
export function BenchmarkChip({ r, className }: { r: BenchmarkResult; className?: string }) {
  const tone = benchmarkTone(r);
  return <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", TONE_CHIP[tone], className)}>({BENCHMARK_STATUS_LABEL[r.status]})</span>;
}

/** Horizontal gauge: the healthy band shaded, your value as a marker. */
function GaugeBar({ r }: { r: BenchmarkResult }) {
  const max = Math.max(r.hi * 1.6, r.value * 1.1, 0.1);
  const at = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  const tone = benchmarkTone(r);
  return (
    <div className="relative mt-2 h-2 rounded-full bg-white/[0.06]" aria-hidden>
      <div className="absolute inset-y-0 rounded-full bg-emerald-400/25" style={{ left: at(r.lo), width: `calc(${at(r.better === "HIGHER" ? max : r.hi)} - ${at(r.lo)})` }} />
      {r.status !== "NO_DATA" && <div className={cn("absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-slate-900", TONE_MARK[tone])} style={{ left: at(Math.max(0, r.value)) }} />}
    </div>
  );
}

export function BenchmarkGauges({
  analysis,
  profile,
  onProfileChange,
  compact = false,
}: {
  analysis: FinancialAnalysis;
  profile: BenchmarkProfile;
  onProfileChange?: (p: BenchmarkProfile) => void;
  compact?: boolean;
}) {
  const results = useMemo(() => evaluateBenchmarks(profile, analysis.itemizedRevenue, analysis.itemizedExpenses), [profile, analysis.itemizedRevenue, analysis.itemizedExpenses]);
  const personal = profile === "HOUSEHOLD";
  const attention = results.filter((r) => r.status === "HIGH" || (r.status === "LOW" && r.better === "HIGHER"));

  return (
    <div className={cn(glass, "p-6")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <BarChart3 className="h-5 w-5 text-indigo-300" /> {personal ? "Budget Benchmarks" : "Industry Benchmarks"}
            <InfoTip label="About these benchmarks" align="left">
              Each ratio is a share of your recurring monthly {personal ? "income" : "revenue"}, compared with typical ranges for {personal ? "the 50/30/20 budgeting rule" : "small operators in this peer group"}.
              Ranges are general rules of thumb, not audited industry statistics. Lines are matched by category and name, so keep categories accurate in Line Items.
            </InfoTip>
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            {attention.length ? `${attention.length} metric${attention.length === 1 ? "" : "s"} outside the typical range for` : "Compared against"} {BENCHMARK_PROFILE_LABELS[profile].toLowerCase()} peers
          </p>
        </div>
        {onProfileChange && !personal && (
          <label className="text-xs text-slate-400">
            <span className="sr-only">Peer group</span>
            <select value={profile} onChange={(e) => onProfileChange(e.target.value as BenchmarkProfile)} className={cn(inputCls, "w-auto py-1.5 text-xs")} aria-label="Peer group">
              {BUSINESS_BENCHMARK_PROFILES.map((p) => (
                <option key={p} value={p}>
                  {BENCHMARK_PROFILE_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {results.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">Add recurring {personal ? "income" : "revenue"} to compare against benchmarks.</p>
      ) : (
        <ul className={cn("mt-4 grid gap-3", !compact && "sm:grid-cols-2")}>
          {results.map((r) => (
            <li key={r.key} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-sm text-slate-200">
                  {r.label}
                  <InfoTip label={r.label}>{r.help}</InfoTip>
                </span>
                <BenchmarkChip r={r} />
              </div>
              <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                <span className="text-base font-semibold tabular-nums text-slate-50">{r.status === "NO_DATA" ? "—" : p1(r.value)}</span>
                <span className="text-slate-500">{r.typical}</span>
              </div>
              <GaugeBar r={r} />
              {r.excess > 0 && (r.status === "HIGH" || r.status === "WATCH") && (
                <p className="mt-1.5 text-[11px] text-amber-200/90">{exactMoney(r.excess)}/mo above the top of the typical range.</p>
              )}
              {r.status === "NO_DATA" && <p className="mt-1.5 text-[11px] text-slate-500">No matching lines found.</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Benchmark table for the executive report. */
export function benchmarksReportHtml(results: BenchmarkResult[], profile: BenchmarkProfile, esc: (s: string) => string): string {
  if (!results.length) return "";
  const cls = (r: BenchmarkResult) => ({ good: "pos", warn: "warn", bad: "neg", muted: "muted" })[benchmarkTone(r)];
  const rows = results
    .map(
      (r) =>
        `<tr><td>${esc(r.label)}</td><td>${r.status === "NO_DATA" ? "—" : p1(r.value)}</td><td>${esc(r.typical)}</td><td class="${cls(r)}">(${esc(BENCHMARK_STATUS_LABEL[r.status])})</td></tr>`,
    )
    .join("");
  return `<h2>${profile === "HOUSEHOLD" ? "Budget benchmarks" : "Industry benchmarks"} · ${esc(BENCHMARK_PROFILE_LABELS[profile])}</h2>
<table><thead><tr><th>Metric</th><th>You</th><th>Typical</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
<p class="muted" style="font-size:11px">Shares of recurring monthly revenue versus general rules of thumb for this peer group — not audited industry statistics.</p>`;
}
