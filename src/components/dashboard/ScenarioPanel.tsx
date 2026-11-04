"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Bookmark, Calculator, Download, Loader2, MessageSquareText, Send, TrendingDown, TrendingUp } from "lucide-react";
import {
  BUSINESS_TYPE_LABELS,
  HORIZON_OPTIONS,
  applyScenario,
  clampMonth,
  explainScenario,
  modeOf,
  monthKey,
  resolveForecastStart,
  scenarioShortLabel,
  type FinancialAnalysis,
  type ForecastSettings,
  type SavedScenario,
  type ScenarioBaseline,
  type ScenarioBreakdown,
  type ScenarioPlan,
  type ScenarioResult,
  type WorkspaceMode,
} from "@/lib/schemas";
import { authHeaders, listScenarios, saveScenario } from "@/lib/supabase";
import { LEGAL_DISCLAIMER } from "@/components/Footer";
import { ChartTooltip, COLOR, Stat, axisProps, esc, impactColor, monthTick, printHtml, scenarioSvg, signedUsd } from "@/components/dashboard/chartKit";
import { cn, errorMessage, glass, inputCls, pct, secondaryBtn, usd, usdCompact } from "@/components/ui";

const MAX_PROMPT = 1000;

export function scenarioExamples(mode: WorkspaceMode, months = 12) {
  const long = months >= 36 ? [mode === "PERSONAL" ? "What if my income rises 10% starting month 30?" : "Add a 10% revenue increase starting month 30"] : [];
  return mode === "PERSONAL"
    ? ["What if groceries go up 10% and I put an extra $300/month into investments?", "What if rent rises 5% in month 6?", ...long, "What if I pay off my car loan in 4 months?"]
    : ["What if fuel costs increase by 15% and I gain 2 new clients next quarter?", "What if I hire a $4,000/month technician starting in month 3?", ...long, "What if revenue drops 20% for the next 3 months?"];
}

interface ScenarioEntry {
  id: number;
  /** 1-based number shown in the archive tabs ("Scenario 3"). */
  n: number;
  prompt: string;
  plan?: ScenarioPlan;
  error?: string;
  saved?: boolean;
}

interface Computed {
  result: ScenarioResult;
  breakdown: ScenarioBreakdown;
}

export function ScenarioPanel({
  analysis,
  workspaceId,
  settings,
  onSettingsChange,
}: {
  analysis: FinancialAnalysis;
  workspaceId: string | null;
  settings: ForecastSettings;
  onSettingsChange: (s: ForecastSettings) => void;
}) {
  const mode = modeOf(analysis.businessType);
  const [entries, setEntries] = useState<ScenarioEntry[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SavedScenario[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const counter = useRef(0);

  const baseline: ScenarioBaseline = useMemo(
    () => ({
      businessType: analysis.businessType,
      itemizedRevenue: analysis.itemizedRevenue.map(({ label, amount, oneTime, firstMonthShare }) => ({ label, amount, oneTime, firstMonthShare })),
      itemizedExpenses: analysis.itemizedExpenses.map(({ label, amount, category, oneTime, firstMonthShare }) => ({ label, amount, category, oneTime, firstMonthShare })),
      inflationRateAssumed: analysis.inflationRateAssumed,
    }),
    [analysis],
  );

  const start = useMemo(() => resolveForecastStart(settings), [settings]);
  const months = settings.months;

  // Every archived scenario is recomputed from its stored adjustments, so edits to line items or the horizon apply everywhere
  // and switching tabs never loses state.
  const computed = useMemo(() => {
    const out = new Map<number, Computed>();
    for (const e of entries) {
      if (!e.plan) continue;
      const opts = { start, months };
      out.set(e.id, { result: applyScenario(baseline, e.plan.adjustments, opts), breakdown: explainScenario(baseline, e.plan.adjustments, opts) });
    }
    return out;
  }, [entries, baseline, start, months]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    listScenarios(workspaceId)
      .then((s) => !cancelled && setSaved(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [entries.length]);

  // Auto-expanding prompt box: grows with its content up to ~8 lines, then scrolls.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [draft]);

  const ask = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    const id = Date.now();
    const n = ++counter.current;
    setEntries((e) => [...e, { id, n, prompt }]);
    setDraft("");
    setBusy(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ mode: "scenario", prompt, baseline, horizon: months, start: monthKey(start) }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      const { scenario } = (await res.json()) as { scenario: ScenarioPlan };
      setEntries((e) => e.map((x) => (x.id === id ? { ...x, plan: scenario } : x)));
      setSelected(id);
    } catch (err) {
      setEntries((e) => e.map((x) => (x.id === id ? { ...x, error: err instanceof Error ? err.message : "Scenario failed." } : x)));
    } finally {
      setBusy(false);
    }
  };

  const loadSaved = (s: SavedScenario) => {
    const existing = entries.find((e) => e.saved && e.prompt === s.prompt && e.plan && JSON.stringify(e.plan.adjustments) === JSON.stringify(s.adjustments));
    if (existing) return setSelected(existing.id);
    const id = Date.now();
    const plan: ScenarioPlan = { prompt: s.prompt, adjustments: s.adjustments, assumptions: [], explanation: s.summary.explanation };
    setEntries((e) => [...e, { id, n: ++counter.current, prompt: s.prompt, plan, saved: true }]);
    setSelected(id);
  };

  const save = async (entry: ScenarioEntry, c: Computed) => {
    if (!workspaceId || !entry.plan) return;
    setSaveError(null);
    try {
      await saveScenario({
        workspaceId,
        prompt: entry.prompt,
        adjustments: entry.plan.adjustments,
        summary: { baselineAnnualNet: c.result.baselineAnnualNet, adjustedAnnualNet: c.result.adjustedAnnualNet, delta: c.result.delta, explanation: entry.plan.explanation },
      });
      setEntries((e) => e.map((x) => (x.id === entry.id ? { ...x, saved: true } : x)));
      setSaved(await listScenarios(workspaceId));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save.");
    }
  };

  const modeled = entries.filter((e) => e.plan);
  const active = modeled.find((e) => e.id === selected) ?? modeled.at(-1);
  const activeComputed = active ? computed.get(active.id) : undefined;
  const firstNegative = activeComputed?.result.points.find((p) => p.adjustedCumulative < 0)?.month ?? null;
  const latestStart = active?.plan ? Math.max(1, ...active.plan.adjustments.map((a) => clampMonth(a.startMonth))) : 1;
  const extendTo = HORIZON_OPTIONS.find((h) => h >= latestStart);
  const long = months > 12;

  return (
    <div className={cn(glass, "p-6")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <MessageSquareText className="h-5 w-5 text-indigo-300" /> Scenario Forecasting
          </h2>
          <p className="text-sm text-slate-400">Describe a change in plain English. We model it on top of your {months}-month baseline projection.</p>
        </div>
      </div>

      {months === 12 && (
        <p className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-indigo-400/20 bg-indigo-500/[0.07] px-3 py-2 text-xs text-indigo-100">
          Want to project over 24 or 60 months?
          {([24, 60] as const).map((m) => (
            <button key={m} type="button" onClick={() => onSettingsChange({ ...settings, months: m })} className="rounded-md border border-indigo-300/30 px-2 py-0.5 font-medium hover:bg-indigo-400/15">
              {m}M
            </button>
          ))}
        </p>
      )}

      <div className="mt-5 grid gap-6 lg:grid-cols-5">
        {/* Chat */}
        <div className="flex flex-col lg:col-span-2">
          <div ref={listRef} className="max-h-96 min-h-40 flex-1 space-y-3 overflow-y-auto pr-1 text-sm" aria-live="polite">
            {entries.length === 0 && (
              <div className="space-y-2">
                <p className="text-slate-500">Try one of these:</p>
                {scenarioExamples(mode, months).map((ex) => (
                  <button key={ex} onClick={() => ask(ex)} className="block w-full rounded-xl border border-white/10 px-3 py-2 text-left text-slate-300 hover:bg-white/5">
                    {ex}
                  </button>
                ))}
              </div>
            )}
            {entries.map((e) => {
              const c = computed.get(e.id);
              return (
                <div key={e.id} className="space-y-2">
                  <p className="ml-auto max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-indigo-500/80 px-3 py-2 text-white">{e.prompt}</p>
                  {e.error ? (
                    <p className="max-w-[90%] rounded-2xl rounded-bl-sm bg-rose-500/10 px-3 py-2 text-rose-200">{e.error}</p>
                  ) : e.plan && c ? (
                    <button
                      onClick={() => setSelected(e.id)}
                      className={cn("block max-w-[90%] rounded-2xl rounded-bl-sm px-3 py-2 text-left", active?.id === e.id ? "bg-white/[0.1] ring-1 ring-indigo-400/40" : "bg-white/[0.06] hover:bg-white/[0.08]")}
                    >
                      <span className="block text-[11px] uppercase tracking-wide text-slate-500">Scenario {e.n}</span>
                      <span className="text-slate-200">{e.plan.explanation || "Scenario modeled."}</span>
                      <DeltaLine delta={c.result.delta} months={months} className="mt-1" />
                    </button>
                  ) : (
                    <p className="inline-flex items-center gap-2 rounded-2xl bg-white/[0.06] px-3 py-2 text-slate-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Modeling…
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(draft);
            }}
            className="mt-3"
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={draft}
                rows={1}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void ask(draft);
                  }
                }}
                maxLength={MAX_PROMPT}
                placeholder="What if… (Shift+Enter for a new line)"
                aria-label="Scenario"
                className={cn(inputCls, "max-h-48 min-h-[2.375rem] resize-none overflow-y-auto leading-5")}
              />
              <button type="submit" disabled={busy || !draft.trim()} aria-label="Run scenario" className="grid h-[2.375rem] w-10 shrink-0 place-items-center rounded-lg bg-indigo-500 text-white hover:bg-indigo-400 disabled:opacity-40">
                <Send className="h-4 w-4" />
              </button>
            </div>
            {draft.length > MAX_PROMPT * 0.8 && (
              <p className="mt-1 text-right text-[11px] tabular-nums text-slate-500">
                {draft.length}/{MAX_PROMPT}
              </p>
            )}
          </form>

          {saved.length > 0 && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Saved in this workspace</p>
              <ul className="mt-2 space-y-1 text-sm">
                {saved.slice(0, 6).map((s) => (
                  <li key={s.id}>
                    <button onClick={() => loadSaved(s)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-slate-300 hover:bg-white/5">
                      <Bookmark className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                      <span className="flex-1 truncate">{s.prompt}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Chart */}
        <div className="min-w-0 lg:col-span-3">
          {active?.plan && activeComputed ? (
            <>
              {/* Scenario archive: switch between every scenario modeled this session */}
              <div role="tablist" aria-label="Scenario archive" className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
                {modeled.map((e) => {
                  const c = computed.get(e.id);
                  const on = e.id === active.id;
                  return (
                    <button
                      key={e.id}
                      role="tab"
                      aria-selected={on}
                      onClick={() => setSelected(e.id)}
                      title={e.prompt}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition",
                        on ? "border-indigo-400/50 bg-indigo-500/15 text-white" : "border-white/10 text-slate-400 hover:bg-white/5 hover:text-slate-200",
                      )}
                    >
                      {c && <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: impactColor(c.result.delta) }} />}
                      <span className="font-medium">Scenario {e.n}:</span> {scenarioShortLabel(e.plan!)}
                    </button>
                  );
                })}
              </div>

              <ScenarioResultView
                entry={active}
                plan={active.plan}
                c={activeComputed}
                long={long}
                firstNegative={firstNegative}
                onDownload={() => printHtml(scenarioReportHtml({ analysis, entry: active, plan: active.plan!, c: activeComputed, start }))}
              />

              {activeComputed.result.beyondHorizon.length > 0 && (
                <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-amber-200">
                  <AlertTriangle className="h-3 w-3" /> Starts after month {months}: {activeComputed.result.beyondHorizon.join("; ")}.
                  {extendTo && extendTo > months && (
                    <button type="button" onClick={() => onSettingsChange({ ...settings, months: extendTo })} className="rounded-md border border-amber-300/30 px-2 py-0.5 hover:bg-amber-400/10">
                      Extend to {extendTo}M
                    </button>
                  )}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                {workspaceId ? (
                  <button onClick={() => save(active, activeComputed)} disabled={active.saved} className={cn(secondaryBtn, "py-1.5 text-xs")}>
                    <Bookmark className="h-3.5 w-3.5" /> {active.saved ? "Saved" : "Save scenario"}
                  </button>
                ) : (
                  <p className="text-xs text-slate-500">Create a workspace to save scenarios.</p>
                )}
                {saveError && <p className="text-xs text-rose-300">{saveError}</p>}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">Saving stores only the question, the adjustment parameters and the headline totals — never your statements.</p>
            </>
          ) : (
            <div className="grid h-full min-h-64 place-items-center rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-500">
              Your baseline vs adjusted runway will appear here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DeltaLine({ delta, months, className }: { delta: number; months: number; className?: string }) {
  const Icon = delta >= 0 ? TrendingUp : TrendingDown;
  return (
    <span className={cn("flex items-center gap-1 text-xs font-medium tabular-nums", delta >= 0 ? "text-emerald-300" : "text-rose-300", className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {signedUsd(delta)} over {months} months <span className="sr-only">({delta >= 0 ? "net gain" : "net loss"})</span>
    </span>
  );
}

function ScenarioResultView({
  entry,
  plan,
  c,
  long,
  firstNegative,
  onDownload,
}: {
  entry: ScenarioEntry;
  plan: ScenarioPlan;
  c: Computed;
  long: boolean;
  firstNegative: string | null;
  onDownload: () => void;
}) {
  const { result } = c;
  const lineColor = impactColor(result.delta);
  const m = result.months;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm text-slate-300">
          <span className="text-slate-500">Scenario {entry.n}:</span> {plan.explanation || entry.prompt}
        </p>
        <button type="button" onClick={onDownload} className={cn(secondaryBtn, "shrink-0 py-1.5 text-xs")}>
          <Download className="h-3.5 w-3.5" /> Download Chart / Summary PDF
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
        <Stat label={`Baseline ${m}-mo net`} value={usd.format(result.baselineAnnualNet)} />
        <Stat label={`Adjusted ${m}-mo net`} value={usd.format(result.adjustedAnnualNet)} tone={result.adjustedAnnualNet < 0 ? "bad" : undefined} />
        <Stat label={result.delta >= 0 ? "Net gain" : "Net loss"} value={signedUsd(result.delta)} tone={result.delta >= 0 ? "good" : "bad"} />
      </div>
      <div className="mt-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={result.points} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="month" {...axisProps} tickFormatter={monthTick(long)} minTickGap={16} />
            <YAxis {...axisProps} width={64} tickFormatter={(v: number) => usdCompact.format(v)} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.3)" />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(255,255,255,0.25)" }} />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "#cbd5e1" }} />
            <Line name="Baseline runway" type="monotone" dataKey="baselineCumulative" stroke={COLOR.baseline} strokeDasharray="5 4" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line
              name={`Adjusted runway (${result.delta >= 0 ? "gain" : "loss"})`}
              type="monotone"
              dataKey="adjustedCumulative"
              stroke={lineColor}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "#0f172a" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {firstNegative && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-rose-300">
          <AlertTriangle className="h-3 w-3" /> Under this scenario, cumulative cash turns negative in {firstNegative}.
        </p>
      )}
      <div className="mt-4 space-y-2 text-sm">
        <ul className="space-y-1">
          {plan.adjustments.map((a, i) => (
            <li key={i} className="flex items-start gap-2 text-slate-300">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-300" />
              {a.description} <span className="text-slate-500">(from month {clampMonth(a.startMonth)})</span>
            </li>
          ))}
        </ul>
        {result.unmatched.length > 0 && <p className="text-xs text-amber-200">No matching line items for: {result.unmatched.join("; ")}. Those changes had no effect.</p>}
        {plan.assumptions.length > 0 && (
          <details className="text-xs text-slate-400">
            <summary className="cursor-pointer text-slate-300">Assumptions</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {plan.assumptions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <CalculationBreakdown b={c.breakdown} />
    </>
  );
}

/** Expandable audit trail that reconciles the headline change to the cent. */
function CalculationBreakdown({ b }: { b: ScenarioBreakdown }) {
  const monthlyNet = b.monthlyRevenueDelta - b.monthlyExpenseDelta;
  const row = (label: string, value: number, note?: string, strong = false) => (
    <tr className={cn(strong && "font-semibold text-slate-100")}>
      <td className="py-1.5 pr-3 text-slate-300">
        {label}
        {note && <span className="block text-[11px] font-normal text-slate-500">{note}</span>}
      </td>
      <td className={cn("py-1.5 text-right tabular-nums", value < 0 ? "text-rose-300" : value > 0 ? "text-emerald-300" : "text-slate-400")}>{signedUsd(value)}</td>
    </tr>
  );
  return (
    <details className="group mt-4 rounded-xl border border-white/10 bg-white/[0.02] text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm text-slate-200 [&::-webkit-details-marker]:hidden">
        <Calculator className="h-4 w-4 text-indigo-300" /> Calculation breakdown
        <span className="ml-auto text-xs text-slate-500 group-open:hidden">Show the math</span>
      </summary>
      <div className="space-y-3 border-t border-white/10 px-4 py-3 text-slate-400">
        <p className="rounded-lg bg-slate-900/60 px-3 py-2 font-mono text-[11px] text-slate-300">
          Base Projected + [(Monthly Revenue Δ − Monthly Expense Δ) × Remaining Months]
        </p>
        <p>
          Monthly net change once every change is active: <span className="tabular-nums text-slate-200">{usd.format(b.monthlyRevenueDelta)}/mo</span> revenue −{" "}
          <span className="tabular-nums text-slate-200">{usd.format(b.monthlyExpenseDelta)}/mo</span> expenses ={" "}
          <span className={cn("font-medium tabular-nums", monthlyNet >= 0 ? "text-emerald-300" : "text-rose-300")}>{signedUsd(monthlyNet)}/mo net</span>
        </p>

        {b.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] tabular-nums">
              <thead className="text-left text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="py-1 font-medium">Change</th>
                  <th className="py-1 text-right font-medium">Monthly Δ</th>
                  <th className="py-1 text-right font-medium">× Months</th>
                  <th className="py-1 text-right font-medium">Effect on net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {b.items.map((i, k) => (
                  <tr key={k}>
                    <td className="py-1.5 pr-3 text-slate-300">
                      {i.description}
                      <span className="block text-[11px] text-slate-500">
                        {i.side === "revenue" ? "Revenue" : "Expense"} · {i.basis}
                      </span>
                    </td>
                    <td className="py-1.5 text-right">{signedUsd(i.monthlyDelta)}</td>
                    <td className="py-1.5 text-right text-slate-300">
                      {i.activeMonths}
                      <span className="block text-[11px] text-slate-500">{i.activeMonths > 0 ? `M${i.startMonth}–M${b.months}` : "after horizon"}</span>
                    </td>
                    <td className={cn("py-1.5 text-right", i.netEffect < 0 ? "text-rose-300" : "text-emerald-300")}>{signedUsd(i.netEffect)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <table className="w-full">
          <tbody className="divide-y divide-white/5">
            <tr>
              <td className="py-1.5 pr-3 text-slate-300">Base projected ({b.months}-mo net)</td>
              <td className="py-1.5 text-right tabular-nums text-slate-200">{usd.format(b.baseProjected)}</td>
            </tr>
            {row("Straight-line change", b.linearTotal, "Σ monthly Δ × months active (today's dollars)")}
            {row("Compounding & first-month proration", b.compounding, "Overlapping % changes on the same line multiply (1+a)(1+b) instead of adding; partial-month lines are pro-rated in month 1")}
            {row(
              "Seasonality & inflation",
              b.seasonalityInflation,
              `Each changed amount × that month's seasonal multiplier (revenue ${b.seasonalRange.revenue[0].toFixed(2)}–${b.seasonalRange.revenue[1].toFixed(2)}, expenses ${b.seasonalRange.expenses[0].toFixed(2)}–${b.seasonalRange.expenses[1].toFixed(2)}) × inflation (1 + ${pct(b.inflationRate)})^(month/12) on costs; revenue passes through ${Math.round(b.revenuePassThrough * 100)}% of inflation`,
            )}
            {row("Total change", b.delta, undefined, true)}
            <tr className="font-semibold">
              <td className="py-1.5 pr-3 text-slate-100">Adjusted projected</td>
              <td className={cn("py-1.5 text-right tabular-nums", b.adjustedProjected < 0 ? "text-rose-300" : "text-slate-100")}>{usd.format(b.adjustedProjected)}</td>
            </tr>
          </tbody>
        </table>
        <p className="text-[11px] text-slate-500">
          {usd.format(b.baseProjected)} {b.delta >= 0 ? "+" : "−"} {usd.format(Math.abs(b.delta))} = {usd.format(b.adjustedProjected)}. Monthly values are rounded to the cent before
          they are summed, so every line above reconciles exactly to the chart.
        </p>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Printable scenario summary (browser print → "Save as PDF")
// ---------------------------------------------------------------------------

function scenarioReportHtml({ analysis, entry, plan, c, start }: { analysis: FinancialAnalysis; entry: ScenarioEntry; plan: ScenarioPlan; c: Computed; start: Date }) {
  const { result: r, breakdown: b } = c;
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + r.months - 1, 1));
  const cls = (n: number) => (n < 0 ? "neg" : n > 0 ? "pos" : "");
  const items = b.items
    .map(
      (i) =>
        `<tr><td>${esc(i.description)}<div class="muted">${esc(i.side === "revenue" ? "Revenue" : "Expense")} · ${esc(i.basis)}</div></td><td>${signedUsd(i.monthlyDelta)}</td><td>${i.activeMonths}</td><td class="${cls(i.netEffect)}">${signedUsd(i.netEffect)}</td></tr>`,
    )
    .join("");
  const monthRows = r.points
    .map(
      (p) =>
        `<tr><td>${esc(p.month)}</td><td>${usd.format(p.baselineNet)}</td><td>${usd.format(p.adjustedNet)}</td><td class="${cls(p.adjustedNet - p.baselineNet)}">${signedUsd(p.adjustedNet - p.baselineNet)}</td><td class="${p.adjustedCumulative < 0 ? "neg" : ""}">${usd.format(p.adjustedCumulative)}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LedgerPulse Scenario ${entry.n} ${new Date().toISOString().slice(0, 10)}</title>
<style>
body{font:13px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;max-width:860px;margin:32px auto;padding:0 20px}
h1{font-size:22px;margin:0}h2{font-size:15px;margin:24px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
.muted{color:#666;font-size:11px}.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:16px}
.kpi{border:1px solid #ddd;border-radius:8px;padding:10px}.kpi b{display:block;font-size:17px;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}td,th{padding:5px 8px;border-bottom:1px solid #eee;text-align:right;vertical-align:top}
td:first-child,th:first-child{text-align:left}.neg{color:#b42318}.pos{color:#047857}.formula{font-family:ui-monospace,monospace;background:#f3f4f6;padding:6px 10px;border-radius:6px}
@page{margin:14mm}@media print{body{margin:0;max-width:none}tr{break-inside:avoid}}
</style></head><body>
<h1>Scenario ${entry.n}: ${esc(scenarioShortLabel(plan))}</h1>
<p class="muted">${esc(BUSINESS_TYPE_LABELS[analysis.businessType])} · ${esc(fmt.format(start))} – ${esc(fmt.format(end))} (${r.months} months) · Generated ${esc(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }))}</p>
<p><strong>Question:</strong> ${esc(entry.prompt)}</p>
${plan.explanation ? `<p>${esc(plan.explanation)}</p>` : ""}
<div class="kpis">
<div class="kpi">Baseline ${r.months}-mo net<b>${usd.format(r.baselineAnnualNet)}</b></div>
<div class="kpi">Adjusted ${r.months}-mo net<b class="${r.adjustedAnnualNet < 0 ? "neg" : ""}">${usd.format(r.adjustedAnnualNet)}</b></div>
<div class="kpi">${r.delta >= 0 ? "Net gain" : "Net loss"}<b class="${cls(r.delta)}">${signedUsd(r.delta)}</b></div>
</div>
<h2>Cumulative runway</h2>${scenarioSvg(r.points, r.delta)}
<h2>Calculation breakdown</h2>
<p class="formula">Base Projected + [(Monthly Revenue Δ − Monthly Expense Δ) × Remaining Months]</p>
<p>Monthly net change once active: ${usd.format(b.monthlyRevenueDelta)}/mo revenue − ${usd.format(b.monthlyExpenseDelta)}/mo expenses = <strong>${signedUsd(b.monthlyRevenueDelta - b.monthlyExpenseDelta)}/mo</strong></p>
${items ? `<table><thead><tr><th>Change</th><th>Monthly Δ</th><th>× Months</th><th>Effect on net</th></tr></thead><tbody>${items}</tbody></table>` : ""}
<table style="margin-top:10px"><tbody>
<tr><td>Base projected</td><td>${usd.format(b.baseProjected)}</td></tr>
<tr><td>Straight-line change</td><td class="${cls(b.linearTotal)}">${signedUsd(b.linearTotal)}</td></tr>
<tr><td>Compounding &amp; first-month proration</td><td class="${cls(b.compounding)}">${signedUsd(b.compounding)}</td></tr>
<tr><td>Seasonality &amp; inflation (${pct(b.inflationRate)}/yr on costs, ${Math.round(b.revenuePassThrough * 100)}% passed through to revenue)</td><td class="${cls(b.seasonalityInflation)}">${signedUsd(b.seasonalityInflation)}</td></tr>
<tr><td><strong>Adjusted projected</strong></td><td><strong>${usd.format(b.adjustedProjected)}</strong></td></tr>
</tbody></table>
${plan.assumptions.length ? `<h2>Assumptions</h2><ul>${plan.assumptions.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
${r.unmatched.length ? `<p class="neg">No matching line items for: ${esc(r.unmatched.join("; "))}.</p>` : ""}
<h2>Month by month</h2>
<table><thead><tr><th>Month</th><th>Baseline net</th><th>Adjusted net</th><th>Change</th><th>Adjusted cumulative</th></tr></thead><tbody>${monthRows}</tbody></table>
<p class="muted" style="margin-top:20px">${esc(LEGAL_DISCLAIMER)}</p>
</body></html>`;
}
