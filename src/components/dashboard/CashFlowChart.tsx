"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Sparkles } from "lucide-react";
import { curveFromActuals, type FinancialAnalysis, type ForecastSettings } from "@/lib/schemas";
import { exactMoney, type MonthActual } from "@/lib/fiscal";
import type { WorkspaceDocument } from "@/lib/supabase";
import { buildMonthFeed } from "@/components/dashboard/MonthlyBreakdown";
import { actualsByCalendarMonth } from "@/components/dashboard/SeasonalityControls";
import { StatusSwitch } from "@/components/dashboard/ForecastControls";
import { CHART, ChartTooltip, COLOR, axisProps } from "@/components/dashboard/chartKit";
import { InfoTip } from "@/components/InfoTip";
import { GranularityToggle, PaceStrip } from "@/components/dashboard/GranularityToggle";
import { GRANULARITY_LABELS, GRANULARITY_UNIT, labelToKey, paceOf, toPeriods, type Granularity, type MonthInput } from "@/lib/granularity";
import { cn, glass, usdCompact } from "@/components/ui";

/** Months of closed history and of projection shown at each increment (weeks / days of a long window are unreadable). */
const WINDOW: Record<Granularity, { history: number; projected: number }> = {
  MONTHLY: { history: 9, projected: 6 },
  WEEKLY: { history: 3, projected: 3 },
  DAILY: { history: 1, projected: 1 },
};

/**
 * Overview companion to the expense donut: monthly revenue vs expenses — closed months first (tracker actuals, else
 * the saved documents' totals), then the next months of the projection shown faded and labelled "on pace". A
 * Seasonality switch right on the card previews the projection reshaped by the owner's own seasonal history.
 */
export function CashFlowChart({
  analysis,
  actuals,
  docs,
  settings,
  onSettingsChange,
  revenueLabel,
  expensesLabel,
  onOpenForecast,
  granularity = "MONTHLY",
  onGranularityChange,
  className,
}: {
  /** Analysis whose macroProjections already reflect the current forecast settings. */
  analysis: FinancialAnalysis;
  actuals: Record<string, MonthActual>;
  docs: WorkspaceDocument[];
  settings: ForecastSettings;
  onSettingsChange: (s: ForecastSettings) => void;
  revenueLabel: string;
  expensesLabel: string;
  onOpenForecast?: () => void;
  /** Time increment the bars and table are bucketed into. */
  granularity?: Granularity;
  onGranularityChange?: (g: Granularity) => void;
  className?: string;
}) {
  const win = WINDOW[granularity];
  const months = useMemo<MonthInput[]>(() => {
    const hist = new Map<string, MonthActual>();
    for (const m of buildMonthFeed(docs).months) hist.set(m.period, m.totals);
    for (const [k, a] of Object.entries(actuals)) if (/^\d{4}-\d{2}$/.test(k)) hist.set(k, a);
    const past = [...hist.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-win.history)
      .map(([key, a]): MonthInput => ({ key, revenue: a.revenue, expenses: a.expenses, projected: false }));
    const last = past.at(-1)?.key ?? "";
    const future = analysis.macroProjections
      .map((p) => ({ p, key: labelToKey(p.month) }))
      .filter((x): x is { p: FinancialAnalysis["macroProjections"][number]; key: string } => !!x.key && x.key > last)
      .slice(0, win.projected)
      .map(({ p, key }): MonthInput => ({ key, revenue: p.projectedRevenue, expenses: p.projectedExpenses, projected: true }));
    return [...past, ...future];
  }, [actuals, docs, analysis.macroProjections, win]);
  // `key` is the unique period label (table); `label` adds "· on pace" for the chart tooltip.
  const rows = useMemo(
    () => toPeriods(months, granularity).map((r) => ({ ...r, key: r.label, label: r.projected ? `${r.label} · on pace` : r.label })),
    [months, granularity],
  );
  const granular = granularity !== "MONTHLY";
  const unit = GRANULARITY_UNIT[granularity];
  const projectedPace = useMemo(() => (granular ? paceOf(rows.filter((r) => r.projected), granularity) : null), [rows, granular, granularity]);
  const actualPace = useMemo(() => (granular ? paceOf(rows.filter((r) => !r.projected), granularity) : null), [rows, granular, granularity]);
  const ticks = useMemo(() => new Map(rows.map((r) => [r.label, r.tick])), [rows]);

  const fit = useMemo(() => curveFromActuals(actualsByCalendarMonth(actuals)), [actuals]);
  const loggedCalendarMonths = useMemo(() => actualsByCalendarMonth(actuals).length, [actuals]);
  const hasPast = rows.some((r) => !r.projected);
  const hasFuture = rows.some((r) => r.projected);

  const toggleSeasonality = (on: boolean) =>
    onSettingsChange({
      ...settings,
      seasonality: on,
      // Turning it on with 3+ logged months (and no hand-tuned curve): fit the curve to the owner's own history.
      ...(on && fit && !settings.seasonalCustom ? { seasonalCustom: fit } : {}),
    });

  const helper = settings.seasonality
    ? settings.seasonalCustom
      ? "Showing projections reshaped by your seasonal curve — click again to return to a flat baseline."
      : "Showing projections with your business type's typical seasonal curve. Log 3+ months to fit it to your own history."
    : fit
      ? `Click to preview projections adjusted for your historical seasonal flows (fitted to ${loggedCalendarMonths} logged months).`
      : "Click to preview projections adjusted for seasonal flows — uses your business type's typical curve until you've logged 3+ months.";

  return (
    <section aria-label="Monthly cash flow" className={cn(glass, "p-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <BarChart3 className="h-5 w-5 text-indigo-300" aria-hidden /> {GRANULARITY_LABELS[granularity]} cash flow
          <InfoTip label="How cash flow is built" align="left">
            Solid bars are closed months: your Fiscal Year Tracker actuals, or the totals of the documents saved for that month. Faded bars are the next months of
            your projection — where you&apos;re on pace to land, not results yet. Weekly and Daily views spread each month&apos;s total evenly across its calendar
            days (one-time items included), so they show your operating pace rather than the exact day money moved.
          </InfoTip>
        </h2>
        {onGranularityChange && <GranularityToggle value={granularity} onChange={onGranularityChange} />}
      </div>
      <p className="mt-0.5 text-sm text-slate-400">
        {revenueLabel} vs {expensesLabel.toLowerCase()} {hasPast && hasFuture ? "· actuals, then on-pace projection" : hasPast ? "· actuals" : "· on-pace projection"}
      </p>

      {/* Seasonality preview, with the prompt right beside the switch. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-indigo-300/20 bg-indigo-500/[0.06] px-3 py-2">
        <StatusSwitch label="Seasonality" on={settings.seasonality} onChange={toggleSeasonality} title="Preview the projection with seasonal swings applied (the annual total stays the same)" />
        <p className="flex min-w-0 flex-1 items-start gap-1.5 text-[11px] leading-snug text-indigo-100/90 sm:text-xs">
          <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-indigo-300" aria-hidden /> <span>{helper}</span>
        </p>
        {onOpenForecast && settings.seasonality && (
          <button type="button" onClick={onOpenForecast} className="text-[11px] text-indigo-300 hover:text-indigo-200">
            Fine-tune curve →
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">Log a month or upload statements to see cash flow.</p>
      ) : (
        <>
          {(projectedPace ?? actualPace) && (
            <div className="mt-4">
              <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">
                {projectedPace
                  ? `On pace · next ${win.projected === 1 ? "month" : `${win.projected} months`}, per ${unit}`
                  : `Actual pace · last ${win.history === 1 ? "month" : `${win.history} months`}, per ${unit}`}
              </p>
              <PaceStrip pace={(projectedPace ?? actualPace)!} granularity={granularity} revenueLabel={revenueLabel} />
            </div>
          )}
          <div className="mt-4 h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap={granularity === "DAILY" ? "10%" : "22%"} barGap={granularity === "DAILY" ? 0 : 2}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis
                  dataKey="label"
                  {...axisProps}
                  tickFormatter={(m: string) => ticks.get(m) ?? m}
                  interval={granular ? "preserveStartEnd" : 0}
                  minTickGap={granular ? 12 : 5}
                  fontSize={11}
                />
                <YAxis {...axisProps} width={52} tickFormatter={(v: number) => usdCompact.format(v)} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: CHART.cursorFill }} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 12, color: CHART.legend }} />
                <Bar name={revenueLabel} dataKey="revenue" fill={COLOR.revenue} radius={granularity === "DAILY" ? 0 : [4, 4, 0, 0]} isAnimationActive={false}>
                  {rows.map((r) => (
                    <Cell key={r.key} fillOpacity={r.projected ? 0.4 : 1} />
                  ))}
                </Bar>
                <Bar name={expensesLabel} dataKey="expenses" fill={COLOR.expenses} radius={granularity === "DAILY" ? 0 : [4, 4, 0, 0]} isAnimationActive={false}>
                  {rows.map((r) => (
                    <Cell key={r.key} fillOpacity={r.projected ? 0.4 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {(hasFuture || granular) && (
            <p className="mt-1 text-[11px] text-slate-500">
              {hasFuture && "Faded bars = on-pace projection (not closed results). "}
              {granular && "Each month's total is spread evenly over its calendar days."}
            </p>
          )}
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer select-none text-indigo-300 hover:text-indigo-200">View as table</summary>
            <div className={cn(granular && "max-h-72 overflow-auto")}>
            <table className="mt-2 w-full tabular-nums">
              <thead className="text-left text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="py-1 font-medium">{unit[0].toUpperCase() + unit.slice(1)}</th>
                  <th className="py-1 text-right font-medium">{revenueLabel}</th>
                  <th className="py-1 text-right font-medium">{expensesLabel}</th>
                  <th className="py-1 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="py-1 text-slate-300">
                      {r.key}
                      {granularity === "WEEKLY" && r.days < 7 && <span className="text-slate-500"> ({r.days} days)</span>} <span className="text-[10px] uppercase text-slate-500">{r.projected ? "on pace" : "actual"}</span>
                    </td>
                    <td className="py-1 text-right">{exactMoney(r.revenue)}</td>
                    <td className="py-1 text-right">{exactMoney(r.expenses)}</td>
                    <td className={cn("py-1 text-right", r.revenue - r.expenses < 0 ? "text-rose-300" : "text-emerald-300")}>{exactMoney(r.revenue - r.expenses)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
