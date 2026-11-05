"use client";

import { useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, FileSearch, Loader2, PiggyBank, Plus, Repeat1, RotateCw, Trash2, Upload, X } from "lucide-react";
import { MONTH_NAMES, isExtractedLineItems, monthKey, splitTotals, type FinancialAnalysis } from "@/lib/schemas";
import {
  currentFiscalYearStart,
  exactMoney,
  fiscalYearLabel,
  oneTimeOf,
  statementTotals,
  subMoney,
  sumMoney,
  summarizeFiscalYear,
  withLoggedActual,
  type FiscalTrackerState,
  type GoalPace,
  type MonthActual,
} from "@/lib/fiscal";
import { isStatementPeriod, periodLabel, type StatementPeriod } from "@/lib/statementPeriod";
import { StatementMonthPicker } from "@/components/dashboard/StatementMonth";
import { SeasonalityControls } from "@/components/dashboard/SeasonalityControls";
import { authHeaders } from "@/lib/supabase";
import { InfoTip } from "@/components/InfoTip";
import { ChartTooltip, COLOR, axisProps, signedUsd } from "@/components/dashboard/chartKit";
import { TrackerSaveBadge } from "@/components/dashboard/GoalTracker";
import { MoneyNumberInput } from "@/components/dashboard/MoneyInput";
import { StatusSwitch } from "@/components/dashboard/ForecastControls";
import type { FiscalTrackerHandle } from "@/components/dashboard/useFiscalTracker";
import { cn, errorMessage, glass, inputCls, secondaryBtn, usdCompact } from "@/components/ui";

export { clearLocalTracker, readLocalTracker } from "@/components/dashboard/useFiscalTracker";

const FORECAST_FILL = "rgba(25,158,112,0.35)";
/** importFor marker for the "auto-detect month" import (row imports use the row's month key). */
const AUTO_IMPORT = "auto";

/** Goal pace + label, reported up so the executive PDF can include it. */
export interface GoalReport {
  pace: GoalPace;
  fyLabel: string;
}

/**
 * Fiscal Year Tracker: set the fiscal year, log (or import) each month's actuals as it closes, re-forecast the rest
 * of the year from trailing averages or the original plan, and track captured savings. State, loading and autosave
 * live in `useFiscalTracker` (shared with the Goal Tracker at the top of the dashboard).
 */
export function FiscalYearTracker({ tracker, analysis, id }: { tracker: FiscalTrackerHandle; analysis: FinancialAnalysis | null; id?: string }) {
  const { state, update, summary, status, loadFailed } = tracker;
  const currentKey = monthKey(new Date());

  const setActual = (key: string, field: keyof MonthActual, v: number | null) =>
    update((s) => {
      const actuals = { ...s.actuals };
      const prev = actuals[key];
      const next: MonthActual = { revenue: prev?.revenue ?? 0, expenses: prev?.expenses ?? 0, ...(prev?.oneTimeExpenses ? { oneTimeExpenses: prev.oneTimeExpenses } : {}), [field]: v ?? 0 };
      if (!next.oneTimeExpenses) delete next.oneTimeExpenses;
      if (!next.revenue && !next.expenses && !next.oneTimeExpenses && v == null) delete actuals[key];
      else actuals[key] = next;
      return { ...s, actuals };
    });

  const clearActual = (key: string) =>
    update((s) => {
      const actuals = { ...s.actuals };
      delete actuals[key];
      return { ...s, actuals };
    });

  // Statement import: reuse the extract endpoint and total every line to the cent. One-time expenses are recorded
  // separately so they don't skew the trailing average. The statement month is detected from the document: a row's
  // import button logs into that row (offering to move it if the statement looks like another month); the
  // "auto-detect" import asks the owner to confirm the detected month first.
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<{ text: string; moveTo?: { from: string; to: string } } | null>(null);
  const [pending, setPending] = useState<{ period: StatementPeriod | null; month: string; actual: MonthActual } | null>(null);
  const importFor = useRef<string | null>(null);

  const logMonth = (key: string, actual: MonthActual, extra?: string) => {
    const replaced = !!state.actuals[key];
    update((s) => withLoggedActual(s, key, actual));
    const oneTime = actual.oneTimeExpenses ? ` ${exactMoney(actual.oneTimeExpenses)} of one-time expenses kept out of the trailing average.` : "";
    return `${replaced ? "Replaced" : "Logged"} ${periodLabel(key)}: ${exactMoney(actual.revenue)} revenue / ${exactMoney(actual.expenses)} expenses.${oneTime}${extra ?? ""}`;
  };

  const importStatement = async (file: File) => {
    const key = importFor.current;
    if (!key) return;
    setImporting(key);
    setImportError(null);
    setImportNote(null);
    setPending(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("businessType", state.businessType);
      fd.append("mode", "extract");
      const res = await fetch("/api/analyze", { method: "POST", body: fd, headers: await authHeaders() });
      if (!res.ok) throw new Error(await errorMessage(res));
      const data = (await res.json()) as { items?: unknown; period?: unknown };
      if (!isExtractedLineItems(data.items)) throw new Error("Received an unexpected response.");
      const actual = statementTotals(data.items);
      const period = isStatementPeriod(data.period) ? data.period : null;
      if (key === AUTO_IMPORT) {
        setPending({ period, month: period?.key ?? "", actual });
      } else if (period && period.key !== key) {
        setImportNote({ text: logMonth(key, actual, ` This statement looks like ${period.label}.`), moveTo: { from: key, to: period.key } });
      } else {
        setImportNote({ text: logMonth(key, actual) });
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Couldn't read that statement.");
    } finally {
      setImporting(null);
      importFor.current = null;
    }
  };

  const moveActual = (from: string, to: string) => {
    const a = state.actuals[from];
    if (!a) return;
    update((s) => {
      const actuals = { ...s.actuals };
      delete actuals[from];
      return withLoggedActual({ ...s, actuals }, to, a);
    });
    setImportNote({ text: `Moved to ${periodLabel(to)}.` });
  };

  const analysisBaseline = analysis ? { revenue: analysis.monthlyRevenue, expenses: splitTotals(analysis.itemizedExpenses).recurring } : null;
  const importableSavings = (analysis?.auditFlags ?? []).filter((f) => f.potentialSavings > 0 && !state.savings.some((s) => s.title === f.title));
  const chartRows = summary.months.map((m) => ({ month: m.label, net: subMoney(m.revenue, m.expenses), actual: m.status === "ACTUAL" }));
  const noBaseline = state.baseline.revenue === 0 && state.baseline.expenses === 0;
  const projectedNet = subMoney(summary.projectedTotal.revenue, summary.projectedTotal.expenses);
  const projectedOneTime = sumMoney(summary.months, (m) => (m.actual ? oneTimeOf(m.actual) : 0));

  return (
    <div id={id} className={cn(glass, "scroll-mt-6 p-6")}>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.txt,.csv,application/pdf,text/plain,text/csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void importStatement(f);
        }}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <CalendarDays className="h-5 w-5 text-indigo-300" /> Fiscal Year Tracker
          </h2>
          <p className="text-sm text-slate-400">Log actuals as each month closes. The rest of the year re-forecasts automatically and feeds the Goal Tracker above.</p>
        </div>
        <TrackerSaveBadge tracker={tracker} />
      </div>

      {loadFailed ? (
        <div role="alert" className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          <span className="flex-1">{tracker.error ?? "Couldn't load your tracker."} Nothing is overwritten until it loads.</span>
          <button type="button" onClick={tracker.retry} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200/30 px-3 py-1.5 text-xs hover:bg-rose-400/10">
            <RotateCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      ) : status === "loading" ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading tracker…
        </p>
      ) : (
        <>
          {/* Fiscal year + forecast settings */}
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <fieldset className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm">
              <legend className="px-1 text-xs uppercase tracking-wide text-slate-500">Fiscal year</legend>
              <label className="block">
                <span className="text-xs text-slate-400">Starts in</span>
                <select
                  value={state.fyStartMonth}
                  onChange={(e) => {
                    const fyStartMonth = Number(e.target.value);
                    update((s) => ({ ...s, fyStartMonth, fyStartYear: currentFiscalYearStart(fyStartMonth) }));
                  }}
                  className={cn(inputCls, "mt-1")}
                >
                  {MONTH_NAMES.map((n, i) => (
                    <option key={n} value={i}>
                      {n} ({n.slice(0, 3)}–{MONTH_NAMES[(i + 11) % 12].slice(0, 3)})
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-center justify-between gap-2">
                <button type="button" aria-label="Previous fiscal year" onClick={() => update((s) => ({ ...s, fyStartYear: s.fyStartYear - 1 }))} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/5">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-center text-sm font-medium">{fiscalYearLabel(state)}</span>
                <button type="button" aria-label="Next fiscal year" onClick={() => update((s) => ({ ...s, fyStartYear: s.fyStartYear + 1 }))} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/5">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </fieldset>

            <fieldset className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm">
              <legend className="flex items-center gap-1.5 px-1 text-xs uppercase tracking-wide text-slate-500">
                Original baseline (per month)
                <InfoTip label="Original baseline" align="left">
                  Your planned monthly revenue and expenses for the year. It fills every month you haven&apos;t logged yet when the forecast method is &ldquo;Maintain Original
                  Baseline&rdquo;, and until your first month is logged under &ldquo;Use Trailing Average&rdquo;.
                </InfoTip>
              </legend>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs text-slate-400">Revenue</span>
                  <MoneyNumberInput aria-label="Baseline monthly revenue" value={state.baseline.revenue || null} onChange={(v) => update((s) => ({ ...s, baseline: { ...s.baseline, revenue: v ?? 0 } }))} />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-400">Expenses</span>
                  <MoneyNumberInput aria-label="Baseline monthly expenses" value={state.baseline.expenses || null} onChange={(v) => update((s) => ({ ...s, baseline: { ...s.baseline, expenses: v ?? 0 } }))} />
                </label>
              </div>
              {analysisBaseline && (analysisBaseline.revenue !== state.baseline.revenue || analysisBaseline.expenses !== state.baseline.expenses) && (
                <button type="button" onClick={() => update((s) => ({ ...s, baseline: analysisBaseline, businessType: analysis!.businessType }))} className="text-xs text-indigo-300 hover:text-indigo-200">
                  Use current analysis ({exactMoney(analysisBaseline.revenue)} / {exactMoney(analysisBaseline.expenses)} recurring)
                </button>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <StatusSwitch
                  label="Seasonality"
                  on={state.seasonality}
                  onChange={(seasonality) => update((s) => ({ ...s, seasonality }))}
                  title="Apply your business type's seasonal curve to the baseline plan"
                />
                <span className="text-[11px] text-slate-500">{state.seasonality ? "Baseline follows the seasonal curve below." : "Every month uses the same baseline."}</span>
              </div>
              {state.seasonality && (
                <SeasonalityControls
                  businessType={state.businessType}
                  strength={state.seasonalityStrength}
                  custom={state.seasonalCustom}
                  actuals={state.actuals}
                  onChange={(patch) => update((s) => ({ ...s, ...patch }))}
                  compact
                />
              )}
            </fieldset>

            <fieldset className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm">
              <legend className="flex items-center gap-1.5 px-1 text-xs uppercase tracking-wide text-slate-500">
                Re-forecast remaining months
                <InfoTip label="Trailing average vs. baseline">
                  <span className="block">
                    <strong className="font-medium text-slate-100">Use Trailing Average</strong> forecasts each unlogged month as the average of your most recent logged
                    months — best when recent results reflect your real run-rate. One-time expenses are left out of the average.
                  </span>
                  <span className="mt-1 block">
                    <strong className="font-medium text-slate-100">Maintain Original Baseline</strong> keeps the plan you set — best when recent months were unusual.
                  </span>
                </InfoTip>
              </legend>
              <div role="radiogroup" aria-label="Forecast method" className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 p-0.5 text-xs">
                {(
                  [
                    ["TRAILING", "Use Trailing Average"],
                    ["BASELINE", "Maintain Original Baseline"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={state.forecastMode === k}
                    onClick={() => update((s) => ({ ...s, forecastMode: k }))}
                    className={cn("rounded-md px-2 py-1.5 transition", state.forecastMode === k ? "bg-indigo-500/80 text-white" : "text-slate-400 hover:text-slate-200")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {state.forecastMode === "TRAILING" && (
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  Average of the last
                  <select value={state.trailingWindow} onChange={(e) => update((s) => ({ ...s, trailingWindow: Number(e.target.value) }))} className={cn(inputCls, "w-auto py-1 pr-7 text-xs")}>
                    {[1, 2, 3, 6, 12].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  logged month{state.trailingWindow === 1 ? "" : "s"}
                </label>
              )}
              <p className="text-[11px] text-slate-500">
                {state.forecastMode === "TRAILING"
                  ? summary.trailing
                    ? `Forecast = ${exactMoney(summary.trailing.revenue)} revenue / ${exactMoney(summary.trailing.expenses)} recurring expenses per month (avg of ${summary.trailingKeys.length} month${summary.trailingKeys.length === 1 ? "" : "s"}).`
                    : "No actuals yet: using the original baseline until you log a month."
                  : state.seasonality
                    ? "Future months follow the original baseline × seasonality."
                    : "Future months follow the original baseline as entered."}
              </p>
              {state.forecastMode === "TRAILING" && summary.trailingOneTimeExcluded > 0 && (
                <p className="flex items-start gap-1.5 rounded-md border border-amber-300/25 bg-amber-400/[0.07] px-2 py-1.5 text-[11px] text-amber-100">
                  <Repeat1 className="mt-0.5 h-3 w-3 shrink-0" />
                  {exactMoney(summary.trailingOneTimeExcluded)} of one-time expenses excluded from the average so they don&apos;t skew your recurring run-rate.
                </p>
              )}
            </fieldset>
          </div>

          {noBaseline && summary.loggedCount === 0 && (
            <p className="mt-4 rounded-lg border border-amber-300/20 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-100">
              Set a baseline{analysis ? " (or use your current analysis)" : ""} and log your first closed month to start forecasting.
            </p>
          )}

          {/* Monthly actuals */}
          <div className="mt-6 grid gap-6 xl:grid-cols-5">
            <div className="min-w-0 xl:col-span-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-slate-300">
                  Monthly actuals <span className="text-xs font-normal text-slate-500">· {summary.loggedCount} of 12 logged · exact to the cent</span>
                </h3>
                <button
                  type="button"
                  disabled={!!importing}
                  onClick={() => {
                    importFor.current = AUTO_IMPORT;
                    fileRef.current?.click();
                  }}
                  className={cn(secondaryBtn, "px-3 py-1.5 text-xs")}
                  title="Upload a statement or P&L — we detect which month it covers and ask you to confirm"
                >
                  {importing === AUTO_IMPORT ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSearch className="h-3.5 w-3.5" />}
                  {importing === AUTO_IMPORT ? "Reading statement…" : "Import statement · auto-detect month"}
                </button>
              </div>
              {importError && <p className="mt-2 text-xs text-rose-300">{importError}</p>}
              {importNote && (
                <p role="status" className="mt-2 flex flex-wrap items-center gap-2 text-xs text-emerald-200">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {importNote.text}
                  {importNote.moveTo && (
                    <button type="button" onClick={() => moveActual(importNote.moveTo!.from, importNote.moveTo!.to)} className="rounded-md border border-amber-300/30 px-2 py-0.5 text-amber-100 hover:bg-amber-400/10">
                      Move to {periodLabel(importNote.moveTo.to)}
                    </button>
                  )}
                </p>
              )}
              {pending && (
                <div role="group" aria-label="Confirm statement month" className="mt-3 rounded-xl border border-indigo-300/30 bg-indigo-500/[0.08] p-3">
                  <StatementMonthPicker detected={pending.period} value={pending.month} onChange={(month) => setPending((p) => p && { ...p, month })} />
                  <p className="mt-2 text-xs tabular-nums text-slate-400">
                    {exactMoney(pending.actual.revenue)} revenue · {exactMoney(pending.actual.expenses)} expenses
                    {pending.actual.oneTimeExpenses ? ` (${exactMoney(pending.actual.oneTimeExpenses)} one-time)` : ""}
                    {pending.month && state.actuals[pending.month] ? ` · replaces what's logged for ${periodLabel(pending.month)}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    <button type="button" onClick={() => setPending(null)} className={cn(secondaryBtn, "px-3 py-1.5 text-xs")}>
                      <X className="h-3.5 w-3.5" /> Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!pending.month}
                      onClick={() => {
                        setImportNote({ text: logMonth(pending.month, pending.actual) });
                        setPending(null);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Confirm &amp; log {pending.month ? periodLabel(pending.month) : ""}
                    </button>
                  </div>
                </div>
              )}
              {/*
                Sticky header: the inputs below are positioned (relative wrappers for the $ prefix), so without its own
                stacking layer and an opaque fill the header would be painted under the scrolling rows.
              */}
              <div className="relative mt-2 max-h-[30rem] overflow-auto overscroll-contain rounded-lg border border-white/5 [scrollbar-gutter:stable]">
                <table className="w-full min-w-[44rem] text-sm tabular-nums">
                  <thead className="sticky top-0 z-20 bg-slate-900 text-left text-[11px] uppercase text-slate-400 shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                    <tr>
                      <th className="bg-slate-900 py-2 pl-2 font-medium">Month</th>
                      <th className="bg-slate-900 py-2 font-medium">Revenue</th>
                      <th className="bg-slate-900 py-2 font-medium">Expenses (total)</th>
                      <th className="bg-slate-900 py-2 font-medium">
                        <span className="inline-flex items-center gap-1">
                          of which one-time
                          <InfoTip label="One-time expenses">Part of the month&apos;s expenses that won&apos;t repeat (a repair, a single purchase). It counts toward the month&apos;s total but is left out of the trailing average.</InfoTip>
                        </span>
                      </th>
                      <th className="bg-slate-900 py-2 pr-2 text-right font-medium">Net</th>
                      <th className="bg-slate-900 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {summary.months.map((m) => {
                      const loggable = m.status !== "FUTURE";
                      const net = subMoney(m.revenue, m.expenses);
                      return (
                        <tr key={m.key} className={cn(m.key === currentKey && "bg-indigo-500/[0.06]")}>
                          <td className="whitespace-nowrap py-1.5 pl-2 pr-2 text-slate-300">
                            {m.label}
                            <span
                              className={cn(
                                "ml-1.5 rounded px-1 py-0.5 text-[10px] uppercase",
                                m.status === "ACTUAL" ? "bg-emerald-500/15 text-emerald-200" : m.status === "OPEN" ? "bg-amber-400/10 text-amber-200" : "text-slate-500",
                              )}
                            >
                              {m.status === "ACTUAL" ? "Actual" : m.status === "OPEN" ? (m.key === currentKey ? "Open" : "Not logged") : "Forecast"}
                            </span>
                          </td>
                          {loggable ? (
                            <>
                              <td className="w-36 py-1.5 pr-2">
                                <MoneyNumberInput aria-label={`${m.label} revenue`} value={m.actual?.revenue ?? null} placeholder={m.forecastRevenue.toFixed(2)} onChange={(v) => setActual(m.key, "revenue", v)} className="py-1" />
                              </td>
                              <td className="w-36 py-1.5 pr-2">
                                <MoneyNumberInput aria-label={`${m.label} expenses`} value={m.actual?.expenses ?? null} placeholder={m.forecastExpenses.toFixed(2)} onChange={(v) => setActual(m.key, "expenses", v)} className="py-1" />
                              </td>
                              <td className="w-32 py-1.5 pr-2">
                                <MoneyNumberInput
                                  aria-label={`${m.label} one-time expenses`}
                                  value={m.actual?.oneTimeExpenses ?? null}
                                  placeholder="0.00"
                                  onChange={(v) => setActual(m.key, "oneTimeExpenses", v)}
                                  className={cn("py-1", m.actual?.oneTimeExpenses ? "border-amber-300/40 text-amber-100" : "")}
                                />
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="py-1.5 pl-3 text-slate-500">{exactMoney(m.forecastRevenue)}</td>
                              <td className="py-1.5 pl-3 text-slate-500">{exactMoney(m.forecastExpenses)}</td>
                              <td className="py-1.5 pl-3 text-slate-600">—</td>
                            </>
                          )}
                          <td className={cn("py-1.5 pr-2 text-right", net < 0 ? "text-rose-300" : m.status === "ACTUAL" ? "text-slate-100" : "text-slate-500")}>{exactMoney(net)}</td>
                          <td className="w-16 py-1.5 pl-2 text-right">
                            {loggable && (
                              <span className="inline-flex gap-0.5">
                                <button
                                  type="button"
                                  title="Import this month from a statement"
                                  aria-label={`Import ${m.label} from a statement`}
                                  disabled={!!importing}
                                  onClick={() => {
                                    importFor.current = m.key;
                                    fileRef.current?.click();
                                  }}
                                  className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-white/5 hover:text-indigo-200 disabled:opacity-40"
                                >
                                  {importing === m.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                                </button>
                                {m.actual && (
                                  <button type="button" aria-label={`Clear ${m.label}`} onClick={() => clearActual(m.key)} className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-white/5 hover:text-rose-300">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="sticky bottom-0 z-20 border-t border-white/10 bg-slate-900 text-sm font-medium">
                    <tr>
                      <td className="py-2 pl-2 text-slate-300">Projected FY</td>
                      <td className="py-2 pl-3">{exactMoney(summary.projectedTotal.revenue)}</td>
                      <td className="py-2 pl-3">{exactMoney(summary.projectedTotal.expenses)}</td>
                      <td className="py-2 pl-3 text-slate-400">{projectedOneTime > 0 ? exactMoney(projectedOneTime) : "—"}</td>
                      <td className={cn("py-2 pr-2 text-right", projectedNet < 0 && "text-rose-300")}>{exactMoney(projectedNet)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Leave a month blank to keep its forecast. Importing reads a statement for that month and totals every line to the cent; one-time items are recorded in their own column and
                excluded from the trailing average.
              </p>
            </div>

            <div className="min-w-0 space-y-4 xl:col-span-2">
              <div>
                <h3 className="text-sm font-medium text-slate-300">Monthly net · actual vs forecast</h3>
                <div className="mt-2 h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis dataKey="month" {...axisProps} tickFormatter={(m: string) => m.split(" ")[0].slice(0, 1)} interval={0} />
                      <YAxis {...axisProps} width={56} tickFormatter={(v: number) => usdCompact.format(v)} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.3)" />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                      <Bar dataKey="net" name="Net" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                        {chartRows.map((r) => (
                          <Cell key={r.month} fill={r.actual ? COLOR.cash : FORECAST_FILL} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-1 flex items-center justify-center gap-4 text-xs text-slate-300">
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR.cash }} /> Actual
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: FORECAST_FILL }} /> Forecast
                  </span>
                </p>
              </div>

              <SavingsTracker state={state} update={update} summary={summary.savings} importable={importableSavings} currentKey={currentKey} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SavingsTracker({
  state,
  update,
  summary,
  importable,
  currentKey,
}: {
  state: FiscalTrackerState;
  update: (fn: (s: FiscalTrackerState) => FiscalTrackerState) => void;
  summary: ReturnType<typeof summarizeFiscalYear>["savings"];
  importable: FinancialAnalysis["auditFlags"];
  currentKey: string;
}) {
  const [title, setTitle] = useState("");
  const [monthly, setMonthly] = useState<number | null>(null);
  const add = () => {
    if (!title.trim() || !monthly) return;
    update((s) => ({ ...s, savings: [...s.savings, { id: `m${Date.now()}`, title: title.trim().slice(0, 160), monthly, status: "IDENTIFIED" }] }));
    setTitle("");
    setMonthly(null);
  };
  return (
    <div className="rounded-xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/[0.07] to-transparent p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium text-emerald-100">
        <PiggyBank className="h-4 w-4" /> ROI &amp; Savings Tracker
      </h3>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="text-slate-500">Identified (not yet acted on)</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums">{exactMoney(summary.identifiedMonthly)}/mo</dd>
        </div>
        <div>
          <dt className="text-slate-500">Implemented</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums text-emerald-200">{exactMoney(summary.implementedMonthly)}/mo</dd>
        </div>
        <div>
          <dt className="text-slate-500">Captured this FY so far</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{exactMoney(summary.realizedYtd)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Projected FY savings</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{signedUsd(summary.projectedFy)}</dd>
        </div>
      </dl>

      {importable.length > 0 && (
        <button
          type="button"
          onClick={() =>
            update((s) => ({
              ...s,
              savings: [...s.savings, ...importable.map((f, i) => ({ id: `a${Date.now()}${i}`, title: f.title, monthly: f.potentialSavings, status: "IDENTIFIED" as const }))],
            }))
          }
          className={cn(secondaryBtn, "mt-3 w-full border-emerald-300/30 py-1.5 text-xs text-emerald-100 hover:bg-emerald-400/10")}
        >
          <Plus className="h-3.5 w-3.5" /> Import {importable.length} cost optimization{importable.length === 1 ? "" : "s"} from your latest audit
        </button>
      )}

      {state.savings.length > 0 && (
        <ul className="mt-3 max-h-56 space-y-1.5 overflow-y-auto pr-1 text-xs">
          {state.savings.map((x) => (
            <li key={x.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1.5">
              <button
                type="button"
                role="switch"
                aria-checked={x.status === "IMPLEMENTED"}
                aria-label={`Mark "${x.title}" implemented`}
                title={x.status === "IMPLEMENTED" ? `Implemented since ${x.since ?? "the start of the year"}. Click to undo.` : "Mark implemented (counts from this month)"}
                onClick={() =>
                  update((s) => ({
                    ...s,
                    savings: s.savings.map((y) =>
                      y.id === x.id ? (y.status === "IMPLEMENTED" ? { ...y, status: "IDENTIFIED", since: undefined } : { ...y, status: "IMPLEMENTED", since: currentKey }) : y,
                    ),
                  }))
                }
                className={cn("grid h-5 w-5 shrink-0 place-items-center rounded border", x.status === "IMPLEMENTED" ? "border-emerald-300/60 bg-emerald-500/30" : "border-white/20")}
              >
                {x.status === "IMPLEMENTED" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-200" />}
              </button>
              <span className={cn("min-w-0 flex-1 truncate", x.status === "IMPLEMENTED" ? "text-slate-200" : "text-slate-400")} title={x.title}>
                {x.title}
              </span>
              <span className="tabular-nums text-slate-300">{exactMoney(x.monthly)}/mo</span>
              <button type="button" aria-label={`Remove "${x.title}"`} onClick={() => update((s) => ({ ...s, savings: s.savings.filter((y) => y.id !== x.id) }))} className="text-slate-500 hover:text-rose-300">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a saving (e.g. Switched insurer)" aria-label="Saving description" className={cn(inputCls, "min-w-0 flex-1 py-1.5 text-xs")} />
        <div className="w-28">
          <MoneyNumberInput aria-label="Monthly saving" value={monthly} onChange={setMonthly} placeholder="/mo" className="py-1.5 text-xs" />
        </div>
        <button type="button" onClick={add} disabled={!title.trim() || !monthly} aria-label="Add saving" className="grid w-9 shrink-0 place-items-center rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-40">
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
