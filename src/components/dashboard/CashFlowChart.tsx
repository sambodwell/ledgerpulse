"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Sparkles } from "lucide-react";
import { curveFromActuals, type FinancialAnalysis, type ForecastSettings } from "@/lib/schemas";
import { exactMoney, type MonthActual } from "@/lib/fiscal";
import { periodLabel } from "@/lib/statementPeriod";
import type { WorkspaceDocument } from "@/lib/supabase";
import { buildMonthFeed } from "@/components/dashboard/MonthlyBreakdown";
import { actualsByCalendarMonth } from "@/components/dashboard/SeasonalityControls";
import { StatusSwitch } from "@/components/dashboard/ForecastControls";
import { CHART, ChartTooltip, COLOR, axisProps } from "@/components/dashboard/chartKit";
import { InfoTip } from "@/components/InfoTip";
import { cn, glass, usdCompact } from "@/components/ui";

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HISTORY_MONTHS = 9;
const PROJECTED_MONTHS = 6;

/** "Dec 2026" → "2026-12" (projection labels), or null. */
function labelToKey(label: string): string | null {
  const [mon, yr] = label.split(" ");
  const i = SHORT.indexOf(mon?.slice(0, 3));
  return i >= 0 && /^\d{4}$/.test(yr ?? "") ? `${yr}-${String(i + 1).padStart(2, "0")}` : null;
}

interface Row {
  key: string;
  label: string;
  revenue: number;
  expenses: number;
  projected: boolean;
}

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
  className?: string;
}) {
  const rows = useMemo<Row[]>(() => {
    const hist = new Map<string, MonthActual>();
    for (const m of buildMonthFeed(docs).months) hist.set(m.period, m.totals);
    for (const [k, a] of Object.entries(actuals)) if (/^\d{4}-\d{2}$/.test(k)) hist.set(k, a);
    const past = [...hist.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-HISTORY_MONTHS)
      .map(([key, a]): Row => ({ key, label: periodLabel(key), revenue: a.revenue, expenses: a.expenses, projected: false }));
    const last = past.at(-1)?.key ?? "";
    const future = analysis.macroProjections
      .map((p) => ({ p, key: labelToKey(p.month) }))
      .filter((x): x is { p: FinancialAnalysis["macroProjections"][number]; key: string } => !!x.key && x.key > last)
      .slice(0, PROJECTED_MONTHS)
      .map(({ p, key }): Row => ({ key, label: `${p.month} · on pace`, revenue: p.projectedRevenue, expenses: p.projectedExpenses, projected: true }));
    return [...past, ...future];
  }, [actuals, docs, analysis.macroProjections]);

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
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <BarChart3 className="h-5 w-5 text-indigo-300" aria-hidden /> Monthly cash flow
        <InfoTip label="How monthly cash flow is built" align="left">
          Solid bars are closed months: your Fiscal Year Tracker actuals, or the totals of the documents saved for that month. Faded bars are the next months of
          your projection — where you&apos;re on pace to land, not results yet.
        </InfoTip>
      </h2>
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
        <p className="mt-4 text-sm text-slate-400">Log a month or upload statements to see monthly cash flow.</p>
      ) : (
        <>
          <div className="mt-4 h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%" barGap={2}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="label" {...axisProps} tickFormatter={(m: string) => m.split(" ")[0]} interval={0} fontSize={11} />
                <YAxis {...axisProps} width={52} tickFormatter={(v: number) => usdCompact.format(v)} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: CHART.cursorFill }} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 12, color: CHART.legend }} />
                <Bar name={revenueLabel} dataKey="revenue" fill={COLOR.revenue} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {rows.map((r) => (
                    <Cell key={r.key} fillOpacity={r.projected ? 0.4 : 1} />
                  ))}
                </Bar>
                <Bar name={expensesLabel} dataKey="expenses" fill={COLOR.expenses} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {rows.map((r) => (
                    <Cell key={r.key} fillOpacity={r.projected ? 0.4 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {hasFuture && <p className="mt-1 text-[11px] text-slate-500">Faded bars = on-pace projection (not closed results).</p>}
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer select-none text-indigo-300 hover:text-indigo-200">View as table</summary>
            <table className="mt-2 w-full tabular-nums">
              <thead className="text-left text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="py-1 font-medium">Month</th>
                  <th className="py-1 text-right font-medium">{revenueLabel}</th>
                  <th className="py-1 text-right font-medium">{expensesLabel}</th>
                  <th className="py-1 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="py-1 text-slate-300">
                      {periodLabel(r.key)} <span className="text-[10px] uppercase text-slate-500">{r.projected ? "on pace" : "actual"}</span>
                    </td>
                    <td className="py-1 text-right">{exactMoney(r.revenue)}</td>
                    <td className="py-1 text-right">{exactMoney(r.expenses)}</td>
                    <td className={cn("py-1 text-right", r.revenue - r.expenses < 0 ? "text-rose-300" : "text-emerald-300")}>{exactMoney(r.revenue - r.expenses)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
