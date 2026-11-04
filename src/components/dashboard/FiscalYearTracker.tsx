"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Cloud, Loader2, PiggyBank, Plus, Target, Trash2, TrendingDown, TrendingUp, Upload } from "lucide-react";
import { MONTH_NAMES, isExtractedLineItems, monthKey, splitTotals, sum, round2, type BusinessType, type FinancialAnalysis } from "@/lib/schemas";
import {
  currentFiscalYearStart,
  defaultTrackerState,
  fiscalYearLabel,
  normalizeTrackerState,
  summarizeFiscalYear,
  type FiscalTrackerState,
  type MonthActual,
  type PaceResult,
} from "@/lib/fiscal";
import { authHeaders, loadFiscalTracker, saveFiscalTracker } from "@/lib/supabase";
import { ChartTooltip, COLOR, axisProps, signedUsd } from "@/components/dashboard/chartKit";
import { MoneyNumberInput } from "@/components/dashboard/MoneyInput";
import { cn, errorMessage, glass, inputCls, secondaryBtn, usd, usdCompact } from "@/components/ui";

const FORECAST_FILL = "rgba(25,158,112,0.35)";

type SaveStatus = "idle" | "loading" | "saving" | "saved" | "error";

const localKey = (userId: string) => `lp:fiscalTracker:${userId}:guest`;

function readLocal(userId: string): unknown {
  try {
    const raw = window.localStorage.getItem(localKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocal(userId: string, state: FiscalTrackerState) {
  try {
    window.localStorage.setItem(localKey(userId), JSON.stringify(state));
  } catch {
    /* storage unavailable: the tracker still works for this session */
  }
}

/**
 * Fiscal Year Tracker: set the fiscal year, log (or import) each month's actuals as it closes, re-forecast the rest
 * of the year from trailing averages or the original plan, and track pace against targets and captured savings.
 */
export function FiscalYearTracker({
  userId,
  workspaceId,
  businessType,
  analysis,
}: {
  userId: string;
  workspaceId: string | null;
  businessType: BusinessType;
  analysis: FinancialAnalysis | null;
}) {
  const [state, setState] = useState<FiscalTrackerState>(() => defaultTrackerState(businessType));
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirty = useRef(false);

  // Load once per workspace.
  useEffect(() => {
    let cancelled = false;
    dirty.current = false;
    (async () => {
      setStatus("loading");
      try {
        const raw = workspaceId ? await loadFiscalTracker(workspaceId) : readLocal(userId);
        if (cancelled) return;
        const s = raw ? normalizeTrackerState(raw, businessType) : defaultTrackerState(businessType);
        if (!raw) s.fyStartYear = currentFiscalYearStart(s.fyStartMonth);
        setState(s);
        setStatus("idle");
      } catch (e) {
        if (cancelled) return;
        setState(defaultTrackerState(businessType));
        setSaveError(e instanceof Error ? e.message : "Couldn't load your tracker.");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, userId, businessType]);

  // Debounced autosave after the owner changes something.
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(async () => {
      setStatus("saving");
      setSaveError(null);
      try {
        if (workspaceId) await saveFiscalTracker(workspaceId, state);
        else writeLocal(userId, state);
        setStatus("saved");
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Couldn't save.");
        setStatus("error");
      }
    }, 800);
    return () => clearTimeout(t);
  }, [state, workspaceId, userId]);

  const update = useCallback((fn: (s: FiscalTrackerState) => FiscalTrackerState) => {
    dirty.current = true;
    setState(fn);
  }, []);

  const summary = useMemo(() => summarizeFiscalYear(state), [state]);
  const currentKey = monthKey(new Date());

  const setActual = (key: string, field: keyof MonthActual, v: number | null) =>
    update((s) => {
      const actuals = { ...s.actuals };
      const prev = actuals[key];
      const next = { revenue: prev?.revenue ?? 0, expenses: prev?.expenses ?? 0, [field]: v ?? 0 };
      if (v == null && !(field === "revenue" ? prev?.expenses : prev?.revenue)) delete actuals[key];
      else actuals[key] = next;
      return { ...s, actuals };
    });

  const clearActual = (key: string) =>
    update((s) => {
      const actuals = { ...s.actuals };
      delete actuals[key];
      return { ...s, actuals };
    });

  // Statement import for one month: reuse the extract endpoint, then total every line (actuals include one-time items).
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importFor = useRef<string | null>(null);
  const importStatement = async (file: File) => {
    const key = importFor.current;
    if (!key) return;
    setImporting(key);
    setImportError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("businessType", state.businessType);
      fd.append("mode", "extract");
      const res = await fetch("/api/analyze", { method: "POST", body: fd, headers: await authHeaders() });
      if (!res.ok) throw new Error(await errorMessage(res));
      const data = (await res.json()) as { items?: unknown };
      if (!isExtractedLineItems(data.items)) throw new Error("Received an unexpected response.");
      const revenue = round2(sum(data.items.revenue, (r) => r.amount));
      const expenses = round2(sum(data.items.expenses, (e) => e.amount));
      update((s) => ({ ...s, actuals: { ...s.actuals, [key]: { revenue, expenses } } }));
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Couldn't read that statement.");
    } finally {
      setImporting(null);
      importFor.current = null;
    }
  };

  const analysisBaseline = analysis ? { revenue: analysis.monthlyRevenue, expenses: splitTotals(analysis.itemizedExpenses).recurring } : null;
  const importableSavings = (analysis?.auditFlags ?? []).filter((f) => f.potentialSavings > 0 && !state.savings.some((s) => s.title === f.title));
  const chartRows = summary.months.map((m) => ({ month: m.label, net: round2(m.revenue - m.expenses), actual: m.status === "ACTUAL" }));
  const noBaseline = state.baseline.revenue === 0 && state.baseline.expenses === 0;

  return (
    <div className={cn(glass, "p-6")}>
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
          <p className="text-sm text-slate-400">Log actuals as each month closes. The rest of the year re-forecasts automatically.</p>
        </div>
        <SaveBadge status={status} workspace={!!workspaceId} error={saveError} />
      </div>

      {status === "loading" ? (
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
              <legend className="px-1 text-xs uppercase tracking-wide text-slate-500">Original baseline (per month)</legend>
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
                  Use current analysis ({usd.format(analysisBaseline.revenue)} / {usd.format(analysisBaseline.expenses)})
                </button>
              )}
              <p className="text-[11px] text-slate-500">Seasonality for your business type is applied month by month.</p>
            </fieldset>

            <fieldset className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm">
              <legend className="px-1 text-xs uppercase tracking-wide text-slate-500">Re-forecast remaining months</legend>
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
                    ? `Forecast = ${usd.format(summary.trailing.revenue)} revenue / ${usd.format(summary.trailing.expenses)} expenses per month (avg of ${summary.trailingKeys.length} month${summary.trailingKeys.length === 1 ? "" : "s"}).`
                    : "No actuals yet: using the original baseline until you log a month."
                  : "Future months follow the original baseline × seasonality."}
              </p>
            </fieldset>
          </div>

          {noBaseline && summary.loggedCount === 0 && (
            <p className="mt-4 rounded-lg border border-amber-300/20 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-100">
              Set a baseline{analysis ? " (or use your current analysis)" : ""} and log your first closed month to start forecasting.
            </p>
          )}

          {/* Goal vs pace */}
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <PaceCard
              title="Annual revenue target"
              value={state.targets.revenue}
              onChange={(v) => update((s) => ({ ...s, targets: { ...s.targets, revenue: v } }))}
              pace={summary.revenuePace}
              kind="revenue"
              ytd={summary.ytd.revenue}
            />
            <PaceCard
              title="Annual expense cap"
              value={state.targets.expenseCap}
              onChange={(v) => update((s) => ({ ...s, targets: { ...s.targets, expenseCap: v } }))}
              pace={summary.expensePace}
              kind="expense"
              ytd={summary.ytd.expenses}
            />
          </div>

          {/* Monthly actuals */}
          <div className="mt-6 grid gap-6 xl:grid-cols-5">
            <div className="xl:col-span-3">
              <h3 className="text-sm font-medium text-slate-300">
                Monthly actuals <span className="text-xs font-normal text-slate-500">· {summary.loggedCount} of 12 logged</span>
              </h3>
              {importError && <p className="mt-2 text-xs text-rose-300">{importError}</p>}
              <div className="mt-2 max-h-[28rem] overflow-auto pr-1">
                <table className="w-full min-w-[34rem] text-sm tabular-nums">
                  <thead className="sticky top-0 bg-slate-950/90 text-left text-[11px] uppercase text-slate-500 backdrop-blur">
                    <tr>
                      <th className="py-2 font-medium">Month</th>
                      <th className="py-2 font-medium">Revenue</th>
                      <th className="py-2 font-medium">Expenses</th>
                      <th className="py-2 text-right font-medium">Net</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {summary.months.map((m) => {
                      const loggable = m.status !== "FUTURE";
                      const net = m.revenue - m.expenses;
                      return (
                        <tr key={m.key} className={cn(m.key === currentKey && "bg-indigo-500/[0.06]")}>
                          <td className="py-1.5 pr-2 text-slate-300">
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
                                <MoneyNumberInput aria-label={`${m.label} revenue`} value={m.actual?.revenue ?? null} placeholder={m.forecastRevenue.toFixed(0)} onChange={(v) => setActual(m.key, "revenue", v)} className="py-1" />
                              </td>
                              <td className="w-36 py-1.5 pr-2">
                                <MoneyNumberInput aria-label={`${m.label} expenses`} value={m.actual?.expenses ?? null} placeholder={m.forecastExpenses.toFixed(0)} onChange={(v) => setActual(m.key, "expenses", v)} className="py-1" />
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="py-1.5 pl-3 text-slate-500">{usd.format(m.forecastRevenue)}</td>
                              <td className="py-1.5 pl-3 text-slate-500">{usd.format(m.forecastExpenses)}</td>
                            </>
                          )}
                          <td className={cn("py-1.5 text-right", net < 0 ? "text-rose-300" : m.status === "ACTUAL" ? "text-slate-100" : "text-slate-500")}>{usd.format(net)}</td>
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
                  <tfoot className="border-t border-white/10 text-sm font-medium">
                    <tr>
                      <td className="py-2 text-slate-300">Projected FY</td>
                      <td className="py-2 pl-3">{usd.format(summary.projectedTotal.revenue)}</td>
                      <td className="py-2 pl-3">{usd.format(summary.projectedTotal.expenses)}</td>
                      <td className={cn("py-2 text-right", summary.projectedTotal.revenue - summary.projectedTotal.expenses < 0 && "text-rose-300")}>
                        {usd.format(summary.projectedTotal.revenue - summary.projectedTotal.expenses)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">Leave a month blank to keep its forecast. Importing reads a statement for that month and totals every line, one-time items included.</p>
            </div>

            <div className="space-y-4 xl:col-span-2">
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

function SaveBadge({ status, workspace, error }: { status: SaveStatus; workspace: boolean; error: string | null }) {
  if (status === "error")
    return (
      <p className="max-w-xs text-right text-xs text-rose-300" role="alert">
        {error ?? "Couldn't save."}
      </p>
    );
  return (
    <p className="inline-flex items-center gap-1.5 text-xs text-slate-500" role="status">
      {status === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : status === "saved" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> : <Cloud className="h-3.5 w-3.5" />}
      {status === "saving" ? "Saving…" : workspace ? "Monthly totals saved to this workspace" : "Saved on this device (create a workspace to sync)"}
    </p>
  );
}

function PaceCard({
  title,
  value,
  onChange,
  pace,
  kind,
  ytd,
}: {
  title: string;
  value: number | null;
  onChange: (v: number | null) => void;
  pace: PaceResult | null;
  kind: "revenue" | "expense";
  ytd: number;
}) {
  // Revenue: above target is good. Expense cap: above cap is bad.
  const good = pace ? (kind === "revenue" ? pace.gap >= 0 : pace.gap <= 0) : true;
  const Icon = good ? TrendingUp : TrendingDown;
  let headline = "";
  if (pace) {
    const amt = usd.format(Math.abs(pace.gap));
    headline =
      kind === "revenue"
        ? pace.gap >= 0
          ? `On pace for +${amt} over target`
          : `Off pace by ${amt}`
        : pace.gap <= 0
          ? `On pace to finish ${amt} under cap`
          : `Off pace: ${amt} over cap`;
  }
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="block min-w-[10rem] flex-1">
          <span className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-500">
            <Target className="h-3.5 w-3.5" /> {title}
          </span>
          <MoneyNumberInput aria-label={title} value={value} onChange={onChange} placeholder="Set a target" className="mt-1" />
        </label>
        {pace && (
          <p className={cn("flex items-center gap-1.5 text-sm font-medium", good ? "text-emerald-300" : "text-rose-300")} role="status">
            <Icon className="h-4 w-4" aria-hidden /> {headline}
          </p>
        )}
      </div>
      {pace && (
        <>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10" aria-hidden>
            <div className={cn("h-full rounded-full", good ? "bg-emerald-400/80" : "bg-rose-400/80")} style={{ width: `${Math.min(100, (ytd / Math.max(1, pace.target)) * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {usd.format(ytd)} logged · projected {usd.format(pace.projected)} of {usd.format(pace.target)}
            {pace.requiredMonthly != null && (
              <>
                {" "}
                · {kind === "revenue" ? "needs" : "room for"} {usd.format(Math.max(0, pace.requiredMonthly))}/mo for the rest of the year
              </>
            )}
          </p>
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
          <dd className="mt-0.5 text-base font-semibold tabular-nums">{usd.format(summary.identifiedMonthly)}/mo</dd>
        </div>
        <div>
          <dt className="text-slate-500">Implemented</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums text-emerald-200">{usd.format(summary.implementedMonthly)}/mo</dd>
        </div>
        <div>
          <dt className="text-slate-500">Captured this FY so far</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{usd.format(summary.realizedYtd)}</dd>
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
              <span className="tabular-nums text-slate-300">{usd.format(x.monthly)}/mo</span>
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
