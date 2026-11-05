"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CheckCircle2, Cloud, Flag, Info, Loader2, PiggyBank, RotateCw, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import { GOAL_METRICS, GOAL_METRIC_LABEL, annualDeltaWords, exactMoney, paceWordsPct, signedMoney, signedPct, targetKeyFor, type GoalMetric, type GoalPace } from "@/lib/fiscal";
import { round2 } from "@/lib/schemas";
import { InfoTip } from "@/components/InfoTip";
import { CHART, ChartTooltip, COLOR, axisProps } from "@/components/dashboard/chartKit";
import { MoneyNumberInput } from "@/components/dashboard/MoneyInput";
import type { FiscalTrackerHandle, SaveStatus } from "@/components/dashboard/useFiscalTracker";
import { cn, usdCompact } from "@/components/ui";

/** Tone for a pace variance (already signed so positive = good): ahead is green, behind is red. Always paired with words. */
const toneCls = (v: number) => (Math.abs(v) < 0.005 ? "text-slate-300" : v > 0 ? "text-emerald-300" : "text-rose-300");

const GOAL_NOUN: Record<GoalMetric, string> = { NET: "net income goal", REVENUE: "revenue goal", EXPENSE: "expense budget" };

/**
 * Goal Tracker: pick Net income (default), Revenue or an Expense budget, set an annual (or monthly) target, and see the
 * year-end delta, the pace chart and the monthly / quarterly breakdown. The goal is spread evenly (goal ÷ 12 per month).
 */
export function GoalTracker({ tracker, id, onViewSavings }: { tracker: FiscalTrackerHandle; id?: string; onViewSavings?: () => void }) {
  const { state, update, pace, goal, fyLabel, status, loadFailed, summary } = tracker;
  const metric = state.goalMetric;
  const label = GOAL_METRIC_LABEL[metric];
  const setGoal = (v: number | null) => update((s) => ({ ...s, targets: { ...s.targets, [targetKeyFor(s.goalMetric)]: v } }));

  const lastActual = pace ? pace.months.reduce((acc, m, i) => (m.status === "ACTUAL" ? i : acc), -1) : -1;
  const rows =
    pace?.months.map((m, i) => ({
      month: m.label,
      target: m.cumulativeTarget,
      actual: i <= lastActual ? m.cumulativeValue : null,
      // Starts at the last logged month so the projected segment continues the actual line without a gap.
      projected: i >= Math.max(0, lastActual) ? m.cumulativeValue : null,
    })) ?? [];

  const disabled = status === "loading" || loadFailed;

  return (
    <section id={id} aria-label="Goal Tracker" className="glass-card scroll-mt-6 rounded-2xl border border-indigo-300/25 bg-gradient-to-br from-indigo-500/[0.09] via-white/[0.02] to-transparent p-5 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-100">
            <Flag className="h-5 w-5 text-indigo-300" /> Goal Tracker
            <span className="text-sm font-normal text-slate-400">· {fyLabel}</span>
            <InfoTip label="How pace is measured" align="left">
              Your annual goal is spread evenly across the 12 fiscal months (goal ÷ 12, split to the cent). Months you&apos;ve logged use actuals; the rest use the
              Fiscal Year Tracker&apos;s forecast. Expense budgets count as &ldquo;ahead&rdquo; when you&apos;re under budget.
            </InfoTip>
          </h2>
          <p className="mt-0.5 text-sm text-slate-400">Set a year-end target and see exactly how far ahead or behind you are.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
          {!loadFailed && status !== "loading" && <RealizedSavingsChip monthly={summary.savings.implementedMonthly} realizedYtd={summary.savings.realizedYtd} onClick={onViewSavings} />}
          <TrackerSaveBadge tracker={tracker} />
        </div>
      </div>

      {loadFailed ? (
        <LoadFailed tracker={tracker} />
      ) : status === "loading" ? (
        <p className="mt-5 flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your goals…
        </p>
      ) : (
        <>
          {/* Goal type + annual / monthly target */}
          <div className="mt-5 grid gap-4 lg:grid-cols-[auto_1fr] lg:items-end">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Goal type</p>
              <div role="radiogroup" aria-label="Goal type" className="mt-1 inline-flex rounded-xl border border-white/10 bg-slate-900/60 p-1 text-sm">
                {GOAL_METRICS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={metric === m}
                    disabled={disabled}
                    onClick={() => update((s) => ({ ...s, goalMetric: m }))}
                    className={cn("rounded-lg px-3 py-1.5 font-medium transition", metric === m ? "bg-indigo-500 text-white shadow" : "text-slate-400 hover:text-slate-200")}
                  >
                    {GOAL_METRIC_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-slate-500">Annual {metric === "EXPENSE" ? "budget" : "target"}</span>
                <MoneyNumberInput aria-label={`Annual ${GOAL_NOUN[metric]}`} value={goal} onChange={setGoal} placeholder={`e.g. ${metric === "REVENUE" ? "250,000.00" : metric === "EXPENSE" ? "180,000.00" : "60,000.00"}`} className="mt-1 text-base font-semibold" />
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-slate-500">
                  Monthly {metric === "EXPENSE" ? "budget" : "target"} <span className="normal-case text-slate-600">(annual ÷ 12)</span>
                </span>
                <MoneyNumberInput
                  aria-label={`Monthly ${GOAL_NOUN[metric]}`}
                  value={goal != null ? round2(goal / 12) : null}
                  onChange={(v) => setGoal(v == null ? null : round2(v * 12))}
                  placeholder="or set it per month"
                  className="mt-1"
                />
              </label>
            </div>
          </div>
          {metric === "NET" && <p className="mt-2 text-[11px] text-slate-500">Net income = revenue − expenses, actuals for logged months plus the forecast for the rest.</p>}

          {!pace ? (
            <p className="mt-5 rounded-xl border border-dashed border-white/15 px-4 py-5 text-center text-sm text-slate-400">
              Enter an annual {GOAL_NOUN[metric]} to see your pace, the year-end delta and the month-by-month breakdown.
            </p>
          ) : (
            <>
              <GoalPaceBanner pace={pace} className="mt-5" />
              <GoalPaceDetail pace={pace} rows={rows} label={label} />
            </>
          )}
          <DataCompletenessNote loggedCount={summary.loggedCount} className="mt-4" />
        </>
      )}
    </section>
  );
}

/** The prominent year-end delta: "$1,200.00 ahead of annual target", with actuals-to-date and what's still needed. */
export function GoalPaceBanner({ pace, fyLabel, className, compact = false }: { pace: GoalPace; fyLabel?: string; className?: string; compact?: boolean }) {
  const good = pace.annual.variance >= -0.004;
  const reached = goalReached(pace);
  const Icon = reached ? Trophy : good ? TrendingUp : TrendingDown;
  const expense = pace.metric === "EXPENSE";
  const label = GOAL_METRIC_LABEL[pace.metric];
  const progress = pace.goal !== 0 ? Math.max(0, Math.min(1, pace.ytd.value / pace.goal)) : 0;
  const remainingMonths = 12 - pace.ytd.months;
  const delta = deltaParts(pace);
  return (
    <div
      role="status"
      className={cn(
        "rounded-xl border px-3 py-2.5 sm:px-4 sm:py-3",
        reached
          ? "border-amber-300/40 bg-gradient-to-r from-amber-400/[0.14] via-emerald-500/[0.10] to-emerald-500/[0.06]"
          : good
            ? "border-emerald-300/30 bg-emerald-500/[0.08]"
            : "border-rose-300/30 bg-rose-500/[0.08]",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        {/* Figure and wording wrap as two units, so a narrow screen breaks "+$10,451.39 (+17.4%)" / "ahead of annual target", never mid-figure. */}
        <p
          className={cn(
            "flex min-w-0 items-start gap-2 font-semibold leading-snug tabular-nums sm:items-center",
            compact ? "text-sm sm:text-base" : "text-lg sm:text-xl",
            reached ? "text-amber-100" : good ? "text-emerald-100" : "text-rose-100",
          )}
        >
          <Icon className={cn("mt-0.5 shrink-0 sm:mt-0", compact ? "h-4 w-4" : "h-5 w-5", reached && "text-amber-300")} aria-hidden />
          {reached ? (
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
              <span className="whitespace-nowrap">Goal Reached!</span>
              <span className="text-[0.85em] font-medium opacity-90">{signedMoney(pace.ytd.value - pace.goal)} past your goal in logged actuals</span>
            </span>
          ) : (
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
              {delta.figure && <span className="whitespace-nowrap">{delta.figure}</span>}
              <span className={cn(delta.figure && "text-[0.85em] font-medium opacity-90")}>{delta.words}</span>
            </span>
          )}
        </p>
        <p className="text-[11px] leading-relaxed text-slate-400 sm:text-xs">
          {label} {expense ? "budget" : "goal"} {exactMoney(pace.goal)}
          {fyLabel ? ` · ${fyLabel}` : ""} · projected {exactMoney(pace.annual.projected)}
        </p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
        <div className={cn("h-full rounded-full", good ? "bg-emerald-400/80" : "bg-rose-400/80")} style={{ width: `${progress * 100}%` }} />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-300 sm:text-xs">
        {pace.ytd.months > 0 ? (
          <>
            Actuals so far: <span className="font-medium tabular-nums text-slate-100">{exactMoney(pace.ytd.value)}</span> over {pace.ytd.months} logged month
            {pace.ytd.months === 1 ? "" : "s"} vs {exactMoney(pace.ytd.target)} goal pace (<span className={toneCls(pace.ytd.variance)}>{paceWordsPct(pace.ytd.variance, pace.ytd.target, pace.metric)}</span>).{" "}
          </>
        ) : (
          <>No months logged yet — this is based on your forecast. Log actuals in the Fiscal Year Tracker to track real pace. </>
        )}
        {reached ? (
          <>Your logged actuals already meet the {exactMoney(pace.goal)} goal — anything more this year is extra.</>
        ) : pace.requiredMonthly != null && (
          <>
            {expense ? (
              <>
                {exactMoney(Math.max(0, pace.remainingToGoal))} of budget left: up to <span className="font-medium tabular-nums text-slate-100">{exactMoney(Math.max(0, pace.requiredMonthly))}/mo</span>{" "}
                for the remaining {remainingMonths} month{remainingMonths === 1 ? "" : "s"}.
              </>
            ) : (
              <>
                {exactMoney(pace.remainingToGoal)} to go: <span className="font-medium tabular-nums text-slate-100">{exactMoney(pace.requiredMonthly)}/mo</span> needed for the remaining{" "}
                {remainingMonths} month{remainingMonths === 1 ? "" : "s"}.
              </>
            )}
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Revenue / net goals are "reached" only when the cumulative total of logged (closed) months meets or exceeds the
 * goal. Forecast months never count: a projection that beats the goal shows as "ahead of annual target", never as
 * reached. Compared in cents so a float sum a hair under the goal can't flip it. Expense budgets are never "reached"
 * (staying under them is shown as "under budget").
 */
export function goalReached(pace: GoalPace): boolean {
  if (pace.metric === "EXPENSE" || !(pace.goal > 0)) return false;
  const actual = pace.months.filter((m) => m.status === "ACTUAL");
  if (!actual.length) return false;
  const actualCents = actual.reduce((acc, m) => acc + Math.round(m.value * 100), 0);
  return actualCents >= Math.round(pace.goal * 100);
}

/** Projections firm up as more months are logged: shown under the goal and projection views. */
export function DataCompletenessNote({ loggedCount, className }: { loggedCount: number; className?: string }) {
  if (loggedCount >= 12) return null;
  return (
    <p className={cn("flex items-start gap-1.5 rounded-lg border border-sky-300/20 bg-sky-500/[0.06] px-3 py-2 text-[11px] leading-relaxed text-sky-100/90 sm:text-xs", className)}>
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" aria-hidden />
      <span>
        {loggedCount === 0
          ? "Pace and projections are estimates from your plan until you log real months."
          : `Based on ${loggedCount} logged month${loggedCount === 1 ? "" : "s"} of actuals.`}{" "}
        They get more accurate with every month you add — upload several past statements (or a full year) so seasonal swings and one-off months average out.
      </span>
    </p>
  );
}

/** Splits the headline into its money figure and wording: "+$1,200.00 (+2.0%)" + "ahead of annual target". */
function deltaParts(pace: GoalPace): { figure: string; words: string } {
  const full = annualDeltaWords(pace);
  const m = full.match(/^(.*?)\s+((?:ahead of|behind|under|over)\s+annual\s+\w+)$/);
  return m ? { figure: m[1], words: m[2] } : { figure: "", words: full };
}

/** Vibrant running total of implemented (user-executed) recurring savings: the platform's realized ROI at a glance. */
export function RealizedSavingsChip({ monthly, realizedYtd, onClick, className }: { monthly: number; realizedYtd?: number; onClick?: () => void; className?: string }) {
  if (!(monthly > 0)) return null;
  const label = `+${exactMoney(monthly)}/mo saved`;
  const title = `Recurring savings you've implemented${realizedYtd ? ` · ${exactMoney(realizedYtd)} captured this fiscal year` : ""}${onClick ? " · View in the ROI & Savings Tracker" : ""}`;
  const cls = cn(
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-1 text-sm font-semibold tabular-nums text-emerald-200 shadow-[0_0_18px_rgba(16,185,129,0.25)]",
    onClick && "transition hover:bg-emerald-500/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400",
    className,
  );
  const body = (
    <>
      <PiggyBank className="h-4 w-4 shrink-0" aria-hidden />
      {label}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} title={title} aria-label={`${label}. View the ROI and Savings Tracker`} className={cls}>
      {body}
    </button>
  ) : (
    <span title={title} className={cls}>
      {body}
    </span>
  );
}

function GoalPaceDetail({ pace, rows, label }: { pace: GoalPace; rows: { month: string; target: number; actual: number | null; projected: number | null }[]; label: string }) {
  return (
    <>
      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="month" {...axisProps} tickFormatter={(m: string) => m.split(" ")[0]} minTickGap={8} />
                <YAxis {...axisProps} width={60} tickFormatter={(v: number) => usdCompact.format(v)} />
                <ReferenceLine y={0} stroke={CHART.zero} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: CHART.cursor }} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: CHART.legend }} />
                <Line name={pace.metric === "EXPENSE" ? "Budget path" : "Goal path"} type="linear" dataKey="target" stroke={COLOR.baseline} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
                <Line name="Actual" type="linear" dataKey="actual" stroke={COLOR.cash} strokeWidth={2.5} dot={{ r: 3, strokeWidth: 0, fill: COLOR.cash }} connectNulls={false} isAnimationActive={false} />
                <Line name="Projected" type="linear" dataKey="projected" stroke={COLOR.cash} strokeOpacity={0.7} strokeWidth={2} strokeDasharray="3 3" dot={false} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Cumulative {label.toLowerCase()} for the fiscal year. Solid = logged actuals, dotted = forecast for the remaining months.</p>
        </div>

        <div className="lg:col-span-2">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">By quarter</p>
          <ul className="mt-1 grid grid-cols-2 gap-2 text-xs">
            {pace.quarters.map((q) => (
              <li key={q.label} className="rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2">
                <p className="flex items-center justify-between text-slate-400">
                  <span className="font-medium text-slate-200">{q.label}</span>
                  <span className="text-[10px] uppercase">{q.basis === "ACTUAL" ? "Actual" : q.basis === "MIXED" ? "Partly actual" : "Forecast"}</span>
                </p>
                <p className={cn("mt-0.5 font-semibold tabular-nums", toneCls(q.variance))}>{paceWordsPct(q.variance, q.target, pace.metric)}</p>
                <p className="text-[10px] tabular-nums text-slate-500">
                  {exactMoney(q.value)} vs {exactMoney(q.target)}
                </p>
                <p className="text-[10px] text-slate-500">{q.months}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <details className="group mt-3 text-xs">
        <summary className="cursor-pointer select-none text-indigo-300 hover:text-indigo-200">Monthly pace</summary>
        <div className="mt-2 overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-[34rem] tabular-nums">
            <thead className="text-left text-[11px] uppercase text-slate-500">
              <tr>
                <th className="py-1.5 font-medium">Month</th>
                <th className="py-1.5 text-right font-medium">{label}</th>
                <th className="py-1.5 text-right font-medium">{pace.metric === "EXPENSE" ? "Budget" : "Goal pace"}</th>
                <th className="py-1.5 text-right font-medium">{pace.metric === "EXPENSE" ? "Under / over" : "Ahead / behind"}</th>
                <th className="py-1.5 text-right font-medium">% of target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {pace.months.map((m) => (
                <tr key={m.key}>
                  <td className="py-1.5 text-slate-300">
                    {m.label} <span className="text-[10px] uppercase text-slate-500">{m.status === "ACTUAL" ? "actual" : "forecast"}</span>
                  </td>
                  <td className="py-1.5 text-right text-slate-200">{exactMoney(m.value)}</td>
                  <td className="py-1.5 text-right text-slate-400">{exactMoney(m.target)}</td>
                  <td className={cn("py-1.5 text-right font-medium", toneCls(m.variance))}>{signedMoney(m.variance)}</td>
                  <td className={cn("py-1.5 text-right", toneCls(m.variance))}>{signedPct(m.variance, m.target) || "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-white/10 font-medium">
              <tr>
                <td className="py-1.5 text-slate-300">Full year</td>
                <td className="py-1.5 text-right">{exactMoney(pace.annual.projected)}</td>
                <td className="py-1.5 text-right text-slate-400">{exactMoney(pace.goal)}</td>
                <td className={cn("py-1.5 text-right", toneCls(pace.annual.variance))}>{signedMoney(pace.annual.variance)}</td>
                <td className={cn("py-1.5 text-right", toneCls(pace.annual.variance))}>{signedPct(pace.annual.variance, pace.goal) || "—"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </details>
    </>
  );
}

function LoadFailed({ tracker }: { tracker: FiscalTrackerHandle }) {
  return (
    <div role="alert" className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
      <span className="flex-1">{tracker.error ?? "Couldn't load your tracker."} Your saved numbers are safe — nothing is overwritten until it loads.</span>
      <button type="button" onClick={tracker.retry} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200/30 px-3 py-1.5 text-xs hover:bg-rose-400/10">
        <RotateCw className="h-3.5 w-3.5" /> Retry
      </button>
    </div>
  );
}

const SAVE_TEXT: Record<SaveStatus, string> = { idle: "", loading: "Loading…", saving: "Saving…", saved: "Saved", error: "" };

/** Save state for the tracker (shared by the Goal Tracker and the Fiscal Year Tracker). */
export function TrackerSaveBadge({ tracker }: { tracker: FiscalTrackerHandle }) {
  const { status, error, workspaceId, loadFailed } = tracker;
  if (status === "error" && !loadFailed)
    return (
      <p className="flex max-w-xs items-center gap-2 text-right text-xs text-rose-300" role="alert">
        {error ?? "Couldn't save."}
        <button type="button" onClick={tracker.retry} className="shrink-0 rounded-md border border-rose-300/30 px-2 py-0.5 text-rose-100 hover:bg-rose-400/10">
          Retry
        </button>
      </p>
    );
  if (loadFailed) return null;
  return (
    <p className="inline-flex items-center gap-1.5 text-xs text-slate-500" role="status">
      {status === "saving" || status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : status === "saved" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> : <Cloud className="h-3.5 w-3.5" />}
      {SAVE_TEXT[status] || (workspaceId ? "Saved to this workspace" : "Saved on this device — create a workspace to sync")}
      {status === "saved" && workspaceId ? " to this workspace" : ""}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Executive report (light paper)
// ---------------------------------------------------------------------------

/** Prominent pace summary for the top of the executive PDF. */
export function goalPaceBannerHtml(pace: GoalPace, fyLabel: string, esc: (s: string) => string): string {
  const good = pace.annual.variance >= -0.004;
  const label = GOAL_METRIC_LABEL[pace.metric];
  const expense = pace.metric === "EXPENSE";
  const ytd =
    pace.ytd.months > 0
      ? `Actuals so far: <b>${exactMoney(pace.ytd.value)}</b> over ${pace.ytd.months} logged month${pace.ytd.months === 1 ? "" : "s"} vs ${exactMoney(pace.ytd.target)} goal pace (${esc(paceWordsPct(pace.ytd.variance, pace.ytd.target, pace.metric))}).`
      : "No months logged yet — based on the tracker forecast.";
  const reached = goalReached(pace);
  const need = reached
    ? " Logged actuals already meet the goal."
    : pace.requiredMonthly == null
      ? ""
      : expense
        ? ` ${exactMoney(Math.max(0, pace.remainingToGoal))} of budget left (up to ${exactMoney(Math.max(0, pace.requiredMonthly))}/mo).`
        : ` ${exactMoney(pace.remainingToGoal)} to go (${exactMoney(pace.requiredMonthly)}/mo needed).`;
  return `<div class="pace-banner ${good ? "pace-good" : "pace-bad"}">
<div class="pace-head">${reached ? `Goal Reached! ${esc(signedMoney(pace.ytd.value - pace.goal))} past the goal in logged actuals` : esc(annualDeltaWords(pace))}</div>
<div class="muted">${esc(label)} ${expense ? "budget" : "goal"} ${exactMoney(pace.goal)} · ${esc(fyLabel)} · projected year-end ${exactMoney(pace.annual.projected)}</div>
<div style="margin-top:4px">${ytd}${need}</div>
</div>`;
}

/** Printable (light paper) pace section for the executive report. */
export function goalPaceReportHtml(pace: GoalPace, fyLabel: string, esc: (s: string) => string): string {
  const cls = (v: number) => (Math.abs(v) < 0.005 ? "" : v > 0 ? "pos" : "neg");
  const metric = GOAL_METRIC_LABEL[pace.metric];
  const words = (v: number, t: number) => esc(paceWordsPct(v, t, pace.metric));
  const q = pace.quarters
    .map((x) => `<tr><td>${esc(x.label)} <span class="muted">(${esc(x.months)} · ${x.basis === "ACTUAL" ? "actual" : x.basis === "MIXED" ? "partly actual" : "forecast"})</span></td><td>${exactMoney(x.value)}</td><td>${exactMoney(x.target)}</td><td class="${cls(x.variance)}">${words(x.variance, x.target)}</td></tr>`)
    .join("");
  const m = pace.months
    .map((x) => `<tr><td>${esc(x.label)} <span class="muted">${x.status === "ACTUAL" ? "actual" : "forecast"}</span></td><td>${exactMoney(x.value)}</td><td>${exactMoney(x.target)}</td><td class="${cls(x.variance)}">${esc(signedMoney(x.variance))}</td><td class="${cls(x.variance)}">${esc(signedPct(x.variance, x.target) || "—")}</td></tr>`)
    .join("");
  return `<h2>Goal pace detail · ${esc(fyLabel)}</h2>
<p><strong>${esc(metric)} ${pace.metric === "EXPENSE" ? "budget" : "goal"}: ${exactMoney(pace.goal)}</strong> (${exactMoney(pace.monthlyTarget)}/mo straight-line). ${esc(pace.headline.charAt(0).toUpperCase() + pace.headline.slice(1))}.</p>
<h3 style="font-size:14px;margin:16px 0 6px">Quarterly pace</h3>
<table><thead><tr><th>Quarter</th><th>${esc(metric)}</th><th>${pace.metric === "EXPENSE" ? "Budget" : "Goal"}</th><th>${pace.metric === "EXPENSE" ? "Under / over" : "Ahead / behind"}</th></tr></thead><tbody>${q}</tbody></table>
<h3 style="font-size:14px;margin:16px 0 6px">Monthly pace</h3>
<table><thead><tr><th>Month</th><th>${esc(metric)}</th><th>${pace.metric === "EXPENSE" ? "Budget" : "Goal pace"}</th><th>${pace.metric === "EXPENSE" ? "Under / over" : "Ahead / behind"}</th><th>% of target</th></tr></thead><tbody>${m}</tbody></table>`;
}
