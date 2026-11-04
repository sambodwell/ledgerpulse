"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Flag, TrendingDown, TrendingUp } from "lucide-react";
import { paceWords, signedMoney, type GoalMetric, type GoalPace } from "@/lib/fiscal";
import { InfoTip } from "@/components/InfoTip";
import { ChartTooltip, COLOR, axisProps } from "@/components/dashboard/chartKit";
import { MoneyNumberInput } from "@/components/dashboard/MoneyInput";
import { cn, usd, usdCompact } from "@/components/ui";

const METRIC_LABEL: Record<GoalMetric, string> = { REVENUE: "Revenue", NET: "Net income" };

/** Tone for a pace variance: ahead (≥ 0) is good, behind is bad. Always paired with a sign and the word ahead/behind. */
const toneCls = (v: number) => (Math.abs(v) < 0.5 ? "text-slate-300" : v > 0 ? "text-emerald-300" : "text-rose-300");

/**
 * Year-end goal setter + goal-vs-trajectory chart + monthly / quarterly / annual pace breakdown.
 * The goal is spread evenly across the fiscal year (goal ÷ 12 per month).
 */
export function GoalTracker({
  metric,
  goal,
  pace,
  fyLabel,
  onMetricChange,
  onGoalChange,
}: {
  metric: GoalMetric;
  goal: number | null;
  pace: GoalPace | null;
  fyLabel: string;
  onMetricChange: (m: GoalMetric) => void;
  onGoalChange: (v: number | null) => void;
}) {
  const lastActual = pace ? pace.months.reduce((acc, m, i) => (m.status === "ACTUAL" ? i : acc), -1) : -1;
  const rows =
    pace?.months.map((m, i) => ({
      month: m.label,
      target: m.cumulativeTarget,
      actual: i <= lastActual ? m.cumulativeValue : null,
      // Starts at the last logged month so the projected segment continues the actual line without a gap.
      projected: i >= Math.max(0, lastActual) ? m.cumulativeValue : null,
    })) ?? [];
  const good = pace ? pace.annual.variance >= 0 : true;
  const Icon = good ? TrendingUp : TrendingDown;

  return (
    <div className="rounded-xl border border-indigo-300/20 bg-gradient-to-br from-indigo-500/[0.07] to-transparent p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium text-slate-100">
            <Flag className="h-4 w-4 text-indigo-300" /> Year-end goal · {fyLabel}
            <InfoTip label="How pace is measured" align="left">
              Your goal is spread evenly across the 12 fiscal months (goal ÷ 12). Each month, quarter and the full year compare logged actuals — and the forecast
              for months not yet logged — against that straight-line path.
            </InfoTip>
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">Set a target for the fiscal year and see whether you&apos;re ahead or behind, month by month.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div role="radiogroup" aria-label="Goal metric" className="inline-flex rounded-lg border border-white/10 p-0.5 text-xs">
            {(["REVENUE", "NET"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={metric === m}
                onClick={() => onMetricChange(m)}
                className={cn("rounded-md px-2.5 py-1.5 font-medium transition", metric === m ? "bg-indigo-500/80 text-white" : "text-slate-400 hover:text-slate-200")}
              >
                {METRIC_LABEL[m]}
              </button>
            ))}
          </div>
          <label className="block w-44">
            <span className="sr-only">{METRIC_LABEL[metric]} goal for the year</span>
            <MoneyNumberInput aria-label={`${METRIC_LABEL[metric]} goal for the year`} value={goal} onChange={onGoalChange} placeholder={`Year-end ${METRIC_LABEL[metric].toLowerCase()} goal`} />
          </label>
        </div>
      </div>

      {!pace ? (
        <p className="mt-4 rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs text-slate-400">
          Enter a year-end {METRIC_LABEL[metric].toLowerCase()} goal to see your pace chart and the monthly, quarterly and annual breakdown.
        </p>
      ) : (
        <>
          <p className={cn("mt-4 flex items-start gap-2 text-sm font-medium", good ? "text-emerald-200" : "text-rose-200")} role="status">
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              {pace.headline.charAt(0).toUpperCase() + pace.headline.slice(1)}.
            </span>
          </p>

          <div className="mt-3 grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="month" {...axisProps} tickFormatter={(m: string) => m.split(" ")[0]} minTickGap={8} />
                    <YAxis {...axisProps} width={60} tickFormatter={(v: number) => usdCompact.format(v)} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                    <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(255,255,255,0.25)" }} />
                    <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "#cbd5e1" }} />
                    <Line name="Goal path" type="linear" dataKey="target" stroke={COLOR.baseline} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
                    <Line name="Actual" type="linear" dataKey="actual" stroke={COLOR.cash} strokeWidth={2.5} dot={{ r: 3, strokeWidth: 0, fill: COLOR.cash }} connectNulls={false} isAnimationActive={false} />
                    <Line name="Projected" type="linear" dataKey="projected" stroke={COLOR.cash} strokeOpacity={0.7} strokeWidth={2} strokeDasharray="3 3" dot={false} connectNulls={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">Cumulative {METRIC_LABEL[metric].toLowerCase()} for the fiscal year. Solid = logged actuals, dotted = forecast for the remaining months.</p>
            </div>

            <div className="space-y-3 lg:col-span-2">
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <PaceStat label={`Year-to-date (${pace.ytd.months} mo logged)`} value={pace.ytd.months ? paceWords(pace.ytd.variance) : "—"} tone={pace.ytd.months ? pace.ytd.variance : 0} sub={pace.ytd.months ? `${usd.format(pace.ytd.value)} vs ${usd.format(pace.ytd.target)}` : "Log a month to start"} />
                <PaceStat label="Full year (projected)" value={paceWords(pace.annual.variance)} tone={pace.annual.variance} sub={`${usd.format(pace.annual.projected)} vs ${usd.format(pace.annual.goal)}`} />
              </dl>
              {pace.requiredMonthly != null && (
                <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-300">
                  To land exactly on the goal you need <span className="font-semibold tabular-nums text-slate-100">{usd.format(pace.requiredMonthly)}</span>/mo for each month not yet logged (goal pace is{" "}
                  {usd.format(pace.monthlyTarget)}/mo).
                </p>
              )}
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500">By quarter</p>
                <ul className="mt-1 grid grid-cols-2 gap-2 text-xs">
                  {pace.quarters.map((q) => (
                    <li key={q.label} className="rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2">
                      <p className="flex items-center justify-between text-slate-400">
                        <span className="font-medium text-slate-200">{q.label}</span>
                        <span className="text-[10px] uppercase">{q.basis === "ACTUAL" ? "Actual" : q.basis === "MIXED" ? "Partly actual" : "Forecast"}</span>
                      </p>
                      <p className={cn("mt-0.5 font-semibold tabular-nums", toneCls(q.variance))}>{paceWords(q.variance)}</p>
                      <p className="text-[10px] text-slate-500">{q.months}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <details className="group mt-3 text-xs">
            <summary className="cursor-pointer select-none text-indigo-300 hover:text-indigo-200">Monthly pace</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[30rem] tabular-nums">
                <thead className="text-left text-[11px] uppercase text-slate-500">
                  <tr>
                    <th className="py-1.5 font-medium">Month</th>
                    <th className="py-1.5 text-right font-medium">{METRIC_LABEL[metric]}</th>
                    <th className="py-1.5 text-right font-medium">Goal pace</th>
                    <th className="py-1.5 text-right font-medium">Ahead / behind</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {pace.months.map((m) => (
                    <tr key={m.key}>
                      <td className="py-1.5 text-slate-300">
                        {m.label} <span className="text-[10px] uppercase text-slate-500">{m.status === "ACTUAL" ? "actual" : "forecast"}</span>
                      </td>
                      <td className="py-1.5 text-right text-slate-200">{usd.format(m.value)}</td>
                      <td className="py-1.5 text-right text-slate-400">{usd.format(m.target)}</td>
                      <td className={cn("py-1.5 text-right font-medium", toneCls(m.variance))}>{signedMoney(m.variance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function PaceStat({ label, value, tone, sub }: { label: string; value: string; tone: number; sub: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className={cn("mt-0.5 text-sm font-semibold tabular-nums", toneCls(tone))}>{value}</dd>
      <dd className="text-[10px] tabular-nums text-slate-500">{sub}</dd>
    </div>
  );
}

/** Printable (light paper) pace section for the executive report. */
export function goalPaceReportHtml(pace: GoalPace, fyLabel: string, esc: (s: string) => string): string {
  const cls = (v: number) => (Math.abs(v) < 0.5 ? "" : v > 0 ? "pos" : "neg");
  const metric = METRIC_LABEL[pace.metric];
  const q = pace.quarters
    .map((x) => `<tr><td>${esc(x.label)} <span class="muted">(${esc(x.months)} · ${x.basis === "ACTUAL" ? "actual" : x.basis === "MIXED" ? "partly actual" : "forecast"})</span></td><td>${usd.format(x.value)}</td><td>${usd.format(x.target)}</td><td class="${cls(x.variance)}">${esc(paceWords(x.variance))}</td></tr>`)
    .join("");
  const m = pace.months
    .map((x) => `<tr><td>${esc(x.label)} <span class="muted">${x.status === "ACTUAL" ? "actual" : "forecast"}</span></td><td>${usd.format(x.value)}</td><td>${usd.format(x.target)}</td><td class="${cls(x.variance)}">${esc(signedMoney(x.variance))}</td></tr>`)
    .join("");
  return `<h2>Goal pace · ${esc(fyLabel)}</h2>
<p><strong>${esc(metric)} goal: ${usd.format(pace.goal)}</strong> (${usd.format(pace.monthlyTarget)}/mo straight-line). ${esc(pace.headline.charAt(0).toUpperCase() + pace.headline.slice(1))}.</p>
<div class="kpis" style="grid-template-columns:repeat(3,1fr)">
<div class="kpi">Year-to-date (${pace.ytd.months} mo logged)<b class="${cls(pace.ytd.variance)}">${pace.ytd.months ? esc(paceWords(pace.ytd.variance)) : "—"}</b></div>
<div class="kpi">Full year (projected)<b class="${cls(pace.annual.variance)}">${esc(paceWords(pace.annual.variance))}</b><span class="muted">${usd.format(pace.annual.projected)} vs ${usd.format(pace.annual.goal)}</span></div>
<div class="kpi">Needed per remaining month<b>${pace.requiredMonthly != null ? usd.format(pace.requiredMonthly) : "—"}</b></div>
</div>
<h3 style="font-size:14px;margin:16px 0 6px">Quarterly pace</h3>
<table><thead><tr><th>Quarter</th><th>${esc(metric)}</th><th>Goal</th><th>Ahead / behind</th></tr></thead><tbody>${q}</tbody></table>
<h3 style="font-size:14px;margin:16px 0 6px">Monthly pace</h3>
<table><thead><tr><th>Month</th><th>${esc(metric)}</th><th>Goal pace</th><th>Ahead / behind</th></tr></thead><tbody>${m}</tbody></table>`;
}
