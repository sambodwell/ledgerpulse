"use client";

import { useMemo } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Flame, Gauge, Landmark, ShieldCheck } from "lucide-react";
import { MODE_COPY, modeOf, type FinancialAnalysis } from "@/lib/schemas";
import { breakEven, computeRunway, pacePeriods, type BreakEven, type PacePeriod, type Runway, type RunwayLevel } from "@/lib/runway";
import { exactMoney, signedMoney } from "@/lib/fiscal";
import { periodLabel } from "@/lib/statementPeriod";
import { InfoTip } from "@/components/InfoTip";
import { MoneyNumberInput } from "@/components/dashboard/MoneyInput";
import { cn, glass, pct } from "@/components/ui";

export const RUNWAY_STYLE: Record<RunwayLevel, { tone: string; chip: string; label: string }> = {
  CRITICAL: { tone: "border-rose-400/40 bg-rose-500/10", chip: "border-rose-400/40 bg-rose-500/15 text-rose-100", label: "Critical burn" },
  WARNING: { tone: "border-amber-400/40 bg-amber-500/10", chip: "border-amber-400/40 bg-amber-500/15 text-amber-100", label: "Burn warning" },
  WATCH: { tone: "border-amber-300/25 bg-amber-400/[0.05]", chip: "border-amber-300/30 bg-amber-400/10 text-amber-100", label: "Watch burn" },
  HEALTHY: { tone: "border-emerald-400/25 bg-emerald-500/[0.06]", chip: "border-emerald-400/30 bg-emerald-500/15 text-emerald-100", label: "Healthy runway" },
  SELF_FUNDING: { tone: "border-emerald-400/25 bg-emerald-500/[0.06]", chip: "border-emerald-400/30 bg-emerald-500/15 text-emerald-100", label: "Cash-flow positive" },
};

const MONTH_FMT = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** Runway, break-even and pacing figures shared by the card and the executive report. */
export function runwayFigures(analysis: FinancialAnalysis, cash: number | null, now = new Date()) {
  const be = breakEven(analysis.itemizedRevenue, analysis.itemizedExpenses);
  const runway = cash == null ? null : computeRunway(cash, analysis.macroProjections);
  const paces = pacePeriods(analysis.macroProjections, be.breakEvenMonthly, MONTH_FMT.format(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))));
  return { be, runway, paces };
}

export function runwaySentence(r: Runway, personal: boolean): string {
  if (r.months == null) {
    return r.avgNet >= 0
      ? `${personal ? "Income covers spending" : "The business is cash-flow positive"} over the forecast — cash grows by about ${exactMoney(r.avgNet)}/mo, so there's no burn.`
      : `Cash stays positive for more than 10 years at the current pace (${exactMoney(r.avgBurn)}/mo burn).`;
  }
  if (r.months === 0) return "Cash on hand is already below zero.";
  return `At the projected pace, cash on hand lasts about ${r.months.toFixed(1)} months${r.zeroMonth ? ` — it runs out in ${r.zeroMonth}` : ""}.`;
}

export function breakEvenSentence(be: BreakEven, personal: boolean): string {
  if (personal) return `To cover fixed bills (${exactMoney(be.fixedOverhead)}/mo), your household needs at least ${exactMoney(be.marginDaily)} per day in income.`;
  return `To cover fixed overhead (${exactMoney(be.fixedOverhead)}/mo), your business must generate at least ${exactMoney(be.marginDaily)} per day in gross margin${
    be.breakEvenDaily != null && be.contributionMargin < 0.999 ? ` — about ${exactMoney(be.breakEvenDaily)}/day in sales at your ${pct(be.contributionMargin)} contribution margin` : ""
  }.`;
}

function PaceRow({ p, personal }: { p: PacePeriod; personal: boolean }) {
  const up = p.net >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-sm">
      <span className="min-w-[7.5rem] text-slate-300">
        {p.label}
        <span className="block text-[11px] text-slate-500">{p.range}</span>
      </span>
      <span className={cn("inline-flex items-center gap-1 font-semibold tabular-nums", up ? "text-emerald-300" : "text-rose-300")}>
        <Icon className="h-4 w-4" aria-hidden />
        On pace for {signedMoney(p.net)} {up ? (personal ? "left over" : "profit") : personal ? "shortfall" : "loss"}
      </span>
      {p.vsBreakEven != null && !personal && (
        <span className={cn("ml-auto text-xs tabular-nums", p.vsBreakEven >= 0 ? "text-emerald-200/80" : "text-rose-200/80")}>
          {p.vsBreakEven >= 0 ? `${exactMoney(p.vsBreakEven)} above break-even` : `${exactMoney(-p.vsBreakEven)} short of break-even`}
        </span>
      )}
    </li>
  );
}

/**
 * Cash runway, burn warning, daily / weekly break-even targets and directional "On Pace For" labels. Runs on the
 * current projection (the forecast settings and projection basis the owner picked).
 */
export function RunwayCard({
  analysis,
  cash,
  onCashChange,
  detected,
}: {
  analysis: FinancialAnalysis;
  cash: number | null;
  onCashChange: (v: number | null) => void;
  /** A closing balance read from the latest uploaded bank statement, offered as a one-click fill. */
  detected?: { amount: number; period: string | null } | null;
}) {
  const personal = analysis.businessType === "PERSONAL_FAMILY";
  const copy = MODE_COPY[modeOf(analysis.businessType)];
  const { be, runway, paces } = useMemo(() => runwayFigures(analysis, cash), [analysis, cash]);
  const style = runway ? RUNWAY_STYLE[runway.level] : null;
  const burning = runway ? runway.avgNet < 0 : analysis.macroProjections.some((p) => p.projectedRevenue < p.projectedExpenses);

  return (
    <div className={cn(glass, "p-6")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Gauge className="h-5 w-5 text-indigo-300" /> Cash Runway &amp; Break-Even
          <InfoTip label="How runway and break-even are calculated" align="left">
            Runway walks your projected monthly net (with any seasonality / inflation you switched on) forward from the cash on hand. Fixed overhead is recurring{" "}
            {copy.expenses.toLowerCase()} that doesn&apos;t move with sales; variable costs (COGS, materials, merchant / shipping fees, subcontractors, %-of-revenue lines) set the
            contribution margin. Daily targets use the average month of 30.44 days.
          </InfoTip>
        </h2>
        {style && runway && (
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", style.chip)}>
            {runway.level === "CRITICAL" || runway.level === "WARNING" ? <Flame className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />} {style.label}
          </span>
        )}
      </div>

      {/* Cash on hand */}
      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-end">
        <label className="block text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <Landmark className="h-3.5 w-3.5" aria-hidden /> Cash on hand today
          </span>
          <MoneyNumberInput value={cash} onChange={onCashChange} placeholder="e.g. 25,000.00" aria-label="Cash on hand today" className="mt-1" />
        </label>
        <div className="text-xs text-slate-500">
          {detected && Math.abs((cash ?? -1) - detected.amount) > 0.004 ? (
            <button type="button" onClick={() => onCashChange(detected.amount)} className="rounded-lg border border-indigo-300/30 bg-indigo-500/10 px-2.5 py-1.5 text-left text-indigo-100 hover:bg-indigo-500/20">
              Use the closing balance from your {detected.period ? `${periodLabel(detected.period)} ` : ""}statement: <b className="tabular-nums">{exactMoney(detected.amount)}</b>
            </button>
          ) : (
            "Enter the combined balance of your operating accounts. It stays on this device and is only used for runway math."
          )}
        </div>
      </div>

      {/* Runway */}
      {runway ? (
        <div className={cn("mt-4 rounded-xl border p-4", style?.tone)}>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="text-3xl font-semibold tabular-nums text-slate-50">
              {runway.months == null ? (runway.avgNet >= 0 ? "∞" : "10+ yrs") : `${runway.months.toFixed(1)}`}
              {runway.months != null && <span className="ml-1 text-base font-normal text-slate-400">months of runway</span>}
            </p>
            {runway.avgBurn > 0 && <p className="text-sm tabular-nums text-rose-200">Avg burn {exactMoney(runway.avgBurn)}/mo</p>}
          </div>
          <p className="mt-1 text-sm text-slate-300">{runwaySentence(runway, personal)}</p>
          {(runway.level === "CRITICAL" || runway.level === "WARNING") && (
            <p className="mt-2 flex items-start gap-2 text-sm text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {runway.level === "CRITICAL"
                ? "Under 3 months of cash. Cut or defer non-essential spend now, chase receivables, and line up a credit facility before you need it."
                : "Under 6 months of cash. Use the What-If Simulator on the Forecast tab to test cuts or price changes that extend the runway."}
            </p>
          )}
          {runway.lowPoint && runway.lowPoint.balance < runway.cash && runway.months == null && runway.lowPoint.balance >= 0 && (
            <p className="mt-2 text-xs text-slate-400">
              Lowest projected balance: {exactMoney(runway.lowPoint.balance)} in {runway.lowPoint.month}.
            </p>
          )}
        </div>
      ) : (
        <p className={cn("mt-4 rounded-xl border px-4 py-3 text-sm", burning ? "border-amber-300/30 bg-amber-400/[0.06] text-amber-100" : "border-white/10 bg-white/[0.02] text-slate-400")}>
          {burning ? "Your projection has months where expenses exceed revenue. Enter cash on hand to see exactly how long it lasts." : "Enter cash on hand to see your exact runway."}
        </p>
      )}

      {/* Break-even */}
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          [personal ? "Fixed bills / mo" : "Fixed overhead / mo", exactMoney(be.fixedOverhead)],
          [personal ? "Needed per day" : "Gross margin / day", exactMoney(be.marginDaily)],
          [personal ? "Needed per week" : "Gross margin / week", exactMoney(be.marginWeekly)],
          personal ? ["Income / mo", exactMoney(be.monthlyRevenue)] : ["Break-even sales / day", be.breakEvenDaily == null ? "—" : exactMoney(be.breakEvenDaily)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-100">{value}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-sm text-slate-300">{breakEvenSentence(be, personal)}</p>
      {!personal && be.cushion != null && (
        <p className={cn("mt-1 text-xs", be.cushion >= 0 ? "text-emerald-200/80" : "text-rose-200")}>
          {be.cushion >= 0
            ? `Current ${copy.revenue.toLowerCase()} is ${exactMoney(be.cushion)}/mo above break-even${be.safetyMargin != null ? ` — sales could fall ${pct(be.safetyMargin)} before you lose money` : ""}.`
            : `Current ${copy.revenue.toLowerCase()} is ${exactMoney(-be.cushion)}/mo below break-even (${exactMoney(be.breakEvenMonthly ?? 0)}/mo needed).`}
          {be.marginSource === "REVENUE_LINES" && " Contribution margin estimated from your revenue lines' gross margins (no variable costs itemized)."}
        </p>
      )}

      {/* On pace for */}
      {paces.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">On pace for</h3>
          <ul className="mt-2 space-y-2">
            {paces.map((p) => (
              <PaceRow key={p.key} p={p} personal={personal} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
