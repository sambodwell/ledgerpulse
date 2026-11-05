"use client";

import { useDeferredValue, useId, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RotateCcw, SlidersHorizontal, Zap } from "lucide-react";
import { MODE_COPY, applyScenario, modeOf, projectionOptions, splitTotals, type FinancialAnalysis, type ForecastSettings, type ScenarioAdjustment } from "@/lib/schemas";
import { breakEven, computeRunway } from "@/lib/runway";
import { CHART, COLOR, ChartTooltip, Stat, axisProps, impactColor, monthTick, signedUsd } from "@/components/dashboard/chartKit";
import { InfoTip } from "@/components/InfoTip";
import { cn, glass, inputCls, secondaryBtn, usd, usdCompact } from "@/components/ui";

interface WhatIfState {
  fixedDelta: number;
  fixedLabel: string;
  fixedStart: number;
  revenuePct: number;
  scaleCategory: string; // "" = all recurring expenses
  scalePct: number;
}

const INITIAL: WhatIfState = { fixedDelta: 0, fixedLabel: "", fixedStart: 1, revenuePct: 0, scaleCategory: "", scalePct: 0 };

const ALL = "";

/** Slider + numeric readout, with a center tick at zero for two-sided ranges. */
function Slider({
  id,
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  hint?: string;
}) {
  const zeroAt = min < 0 && max > 0 ? ((0 - min) / (max - min)) * 100 : null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-slate-300">
          {label}
        </label>
        <output htmlFor={id} className={cn("text-sm font-semibold tabular-nums", value === 0 ? "text-slate-500" : "text-slate-50")}>
          {format(value)}
        </output>
      </div>
      <div className="relative mt-2">
        {zeroAt != null && <span aria-hidden className="pointer-events-none absolute top-1/2 h-3 w-px -translate-y-1/2 bg-slate-500" style={{ left: `${zeroAt}%` }} />}
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-indigo-400" />
      </div>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

const signedPct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`;

/**
 * Client-side "What-If" sliders: every change is a deterministic scenario adjustment run through the same projection
 * engine as the baseline, so the overlay updates instantly and costs no AI queries.
 */
export function WhatIfSimulator({ analysis, settings, cash }: { analysis: FinancialAnalysis; settings: ForecastSettings; cash?: number | null }) {
  const uid = useId();
  const copy = MODE_COPY[modeOf(analysis.businessType)];
  const personal = analysis.businessType === "PERSONAL_FAMILY";
  const [s, setS] = useState<WhatIfState>(INITIAL);
  const [view, setView] = useState<"monthly" | "cumulative">("cumulative");
  const set = (patch: Partial<WhatIfState>) => setS((cur) => ({ ...cur, ...patch }));
  // Keep dragging smooth on long horizons: the chart catches up with the slider instead of blocking it.
  const deferred = useDeferredValue(s);

  const months = settings.months;
  const monthlyExpenses = splitTotals(analysis.itemizedExpenses).recurring;
  const categories = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of analysis.itemizedExpenses) if (!e.oneTime) totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [analysis.itemizedExpenses]);
  const scaleBase = s.scaleCategory === ALL ? monthlyExpenses : categories.find(([c]) => c === s.scaleCategory)?.[1] ?? 0;
  const fixedMax = Math.max(5000, Math.ceil((monthlyExpenses * 0.5) / 500) * 500);
  const fixedMin = -Math.min(fixedMax, Math.floor(monthlyExpenses / 100) * 100);

  const adjustments = useMemo<ScenarioAdjustment[]>(() => {
    const out: ScenarioAdjustment[] = [];
    if (deferred.fixedDelta !== 0) {
      const label = deferred.fixedLabel.trim() || (deferred.fixedDelta > 0 ? (personal ? "New monthly bill" : "New fixed cost (e.g. hire)") : "Fixed cost removed");
      out.push({ type: "EXPENSE_ADD", label, amount: deferred.fixedDelta, startMonth: deferred.fixedStart, description: `${deferred.fixedDelta > 0 ? "Add" : "Cut"} ${usd.format(Math.abs(deferred.fixedDelta))}/mo fixed (${label})` });
    }
    if (deferred.revenuePct !== 0) {
      out.push({ type: "REVENUE_PCT", match: null, pct: deferred.revenuePct / 100, startMonth: 1, description: `${signedPct(deferred.revenuePct)} ${copy.revenue.toLowerCase()}` });
    }
    if (deferred.scalePct !== 0) {
      out.push({
        type: "EXPENSE_PCT",
        match: deferred.scaleCategory === ALL ? null : deferred.scaleCategory,
        pct: deferred.scalePct / 100,
        startMonth: 1,
        description: `${signedPct(deferred.scalePct)} ${deferred.scaleCategory || `all ${copy.expenses.toLowerCase()}`}`,
      });
    }
    return out;
  }, [deferred, personal, copy.revenue, copy.expenses]);

  const result = useMemo(
    () =>
      applyScenario(
        { businessType: analysis.businessType, itemizedRevenue: analysis.itemizedRevenue, itemizedExpenses: analysis.itemizedExpenses, inflationRateAssumed: analysis.inflationRateAssumed },
        adjustments,
        projectionOptions(settings),
      ),
    [analysis, adjustments, settings],
  );

  // Break-even and runway on the steady-state "what-if" month (last projected month's adjusted run-rate).
  const be = useMemo(() => breakEven(analysis.itemizedRevenue, analysis.itemizedExpenses), [analysis.itemizedRevenue, analysis.itemizedExpenses]);
  const whatIfBreakEven = useMemo(() => {
    if (be.breakEvenMonthly == null) return null;
    const fixedChange = (s.fixedDelta || 0) + (s.scalePct ? (scaleBase * s.scalePct) / 100 : 0);
    return Math.max(0, (be.fixedOverhead + fixedChange) / be.contributionMargin);
  }, [be, s.fixedDelta, s.scalePct, scaleBase]);
  const runways = useMemo(() => {
    if (cash == null || !Number.isFinite(cash)) return null;
    const toProj = (k: "baseline" | "adjusted") => result.points.map((p) => ({ month: p.month, projectedRevenue: k === "baseline" ? p.baselineRevenue : p.adjustedRevenue, projectedExpenses: k === "baseline" ? p.baselineExpenses : p.adjustedExpenses }));
    return { base: computeRunway(cash, toProj("baseline")), next: computeRunway(cash, toProj("adjusted")) };
  }, [cash, result.points]);

  const active = adjustments.length > 0;
  const long = months > 12;
  const rows = result.points.map((p) =>
    view === "cumulative" ? { month: p.month, Baseline: p.baselineCumulative, "What-if": p.adjustedCumulative } : { month: p.month, Baseline: p.baselineNet, "What-if": p.adjustedNet },
  );
  const runwayText = (r: ReturnType<typeof computeRunway>) => (r.months == null ? (r.avgNet >= 0 ? "Self-funding" : "10+ yrs") : `${r.months.toFixed(1)} mo`);

  return (
    <div className={cn(glass, "p-6")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <SlidersHorizontal className="h-5 w-5 text-indigo-300" /> What-If Simulator
            <InfoTip label="How the simulator works" align="left">
              Drag a slider and the forecast re-runs instantly in your browser with the same projection engine as the baseline (your start month, horizon, seasonality and
              inflation settings apply). It doesn&apos;t use AI, so it never counts against your AI query allowance.
            </InfoTip>
          </h2>
          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-emerald-200">
            <Zap className="h-3.5 w-3.5" aria-hidden /> Instant · runs on your device · no AI queries used
          </p>
        </div>
        <button type="button" onClick={() => setS(INITIAL)} disabled={!active && !s.fixedLabel} className={cn(secondaryBtn, "px-3 py-1.5 text-xs")}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </button>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="space-y-5">
          <fieldset className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <legend className="px-1 text-[11px] uppercase tracking-wide text-slate-500">{personal ? "Fixed bills" : "Fixed monthly costs"}</legend>
            <Slider
              id={`${uid}-fixed`}
              label={personal ? "Add / remove a monthly bill" : "Add / cut fixed expenses"}
              value={s.fixedDelta}
              min={fixedMin}
              max={fixedMax}
              step={50}
              format={(v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${usd.format(Math.abs(v))}/mo`}
              onChange={(v) => set({ fixedDelta: v })}
              hint={personal ? "e.g. a new car payment, or cancelling a bill" : "e.g. hiring staff at $4,000/mo, or dropping an office lease"}
            />
            <input
              value={s.fixedLabel}
              onChange={(e) => set({ fixedLabel: e.target.value.slice(0, 60) })}
              placeholder={personal ? "Name it (e.g. Car payment)" : "Name it (e.g. Junior designer hire)"}
              aria-label="Name for the fixed cost change"
              className={cn(inputCls, "py-1.5 text-xs")}
            />
            <Slider id={`${uid}-start`} label="Starting in" value={Math.min(s.fixedStart, months)} min={1} max={months} step={1} format={(v) => (result.points[v - 1]?.month ?? `Month ${v}`)} onChange={(v) => set({ fixedStart: v })} />
          </fieldset>

          <fieldset className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <legend className="px-1 text-[11px] uppercase tracking-wide text-slate-500">{copy.revenue}</legend>
            <Slider
              id={`${uid}-rev`}
              label={personal ? "Income change" : "Revenue churn / growth"}
              value={s.revenuePct}
              min={-50}
              max={50}
              step={1}
              format={signedPct}
              onChange={(v) => set({ revenuePct: v })}
              hint={`${signedUsd((analysis.monthlyRevenue * s.revenuePct) / 100)}/mo on ${usd.format(analysis.monthlyRevenue)} recurring ${copy.revenue.toLowerCase()}`}
            />
          </fieldset>

          <fieldset className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <legend className="px-1 text-[11px] uppercase tracking-wide text-slate-500">{personal ? "Spending scaling" : "Expense scaling"}</legend>
            <label className="block text-xs text-slate-300">
              Apply to
              <select value={s.scaleCategory} onChange={(e) => set({ scaleCategory: e.target.value })} className={cn(inputCls, "mt-1 py-1.5 text-xs")}>
                <option value={ALL}>All recurring {copy.expenses.toLowerCase()}</option>
                {categories.map(([c, amt]) => (
                  <option key={c} value={c}>
                    {c} ({usd.format(amt)}/mo)
                  </option>
                ))}
              </select>
            </label>
            <Slider
              id={`${uid}-scale`}
              label={personal ? "Cut / raise spending" : "Cut / scale spend"}
              value={s.scalePct}
              min={-50}
              max={50}
              step={1}
              format={signedPct}
              onChange={(v) => set({ scalePct: v })}
              hint={`${signedUsd((scaleBase * s.scalePct) / 100)}/mo on ${usd.format(scaleBase)}`}
            />
          </fieldset>
        </div>

        <div className="min-w-0">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={`Baseline ${months}-mo net`} value={signedUsd(result.baselineAnnualNet)} tone={result.baselineAnnualNet >= 0 ? "good" : "bad"} />
            <Stat label={`What-if ${months}-mo net`} value={signedUsd(result.adjustedAnnualNet)} tone={result.adjustedAnnualNet >= 0 ? "good" : "bad"} />
            <Stat label="Impact" value={active ? signedUsd(result.delta) : "—"} tone={!active ? undefined : result.delta >= 0 ? "good" : "bad"} />
            {runways ? (
              <Stat label="Cash runway" value={active ? `${runwayText(runways.base)} → ${runwayText(runways.next)}` : runwayText(runways.base)} tone={runways.next.level === "CRITICAL" ? "bad" : undefined} />
            ) : (
              <Stat
                label={personal ? "Income to break even" : "Break-even revenue"}
                value={whatIfBreakEven == null ? "—" : active && be.breakEvenMonthly != null && Math.abs(whatIfBreakEven - be.breakEvenMonthly) > 0.5 ? `${usdCompact.format(be.breakEvenMonthly)} → ${usdCompact.format(whatIfBreakEven)}` : `${usd.format(whatIfBreakEven)}/mo`}
              />
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-400" aria-live="polite">
              {active ? adjustments.map((a) => a.description).join(" · ") : "Move a slider to overlay a what-if line on your baseline."}
            </p>
            <div role="radiogroup" aria-label="Chart view" className="inline-flex rounded-lg border border-white/10 bg-slate-900/60 p-0.5 text-xs">
              {(
                [
                  ["cumulative", "Cumulative"],
                  ["monthly", "Monthly net"],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={view === k} onClick={() => setView(k)} className={cn("rounded-md px-2.5 py-1 font-medium", view === k ? "bg-indigo-500/80 text-white" : "text-slate-400 hover:text-slate-200")}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-2 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="month" {...axisProps} tickFormatter={monthTick(long)} minTickGap={16} />
                <YAxis {...axisProps} width={72} tickFormatter={(v: number) => usdCompact.format(v)} />
                <ReferenceLine y={0} stroke={CHART.zero} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: CHART.cursor }} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: CHART.legend }} />
                <Line name="Baseline" type="linear" dataKey="Baseline" stroke={COLOR.baseline} strokeDasharray="5 4" strokeWidth={2} dot={false} isAnimationActive={false} />
                {active && <Line name="What-if" type="linear" dataKey="What-if" stroke={impactColor(result.delta)} strokeWidth={2.5} dot={false} isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.surface }} />}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Dashed = your current baseline. Solid = the what-if ({result.delta >= 0 ? "green when it improves" : "red when it lowers"} your {view === "cumulative" ? "cumulative cash" : "monthly net"}).
            {result.beyondHorizon.length > 0 && " A change starts after the last projected month — extend the horizon to see it."}
          </p>
        </div>
      </div>
    </div>
  );
}
