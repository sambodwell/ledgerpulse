/**
 * Cash runway, break-even pacing and "on pace for" projections. Pure and deterministic.
 *
 *  - Fixed overhead = recurring expenses that don't move with sales (rent, software, salaries, insurance…).
 *    Variable costs = COGS / materials / merchant & shipping fees / subcontractors / commissions and any
 *    %-of-revenue line.
 *  - Contribution margin ratio = 1 − variable costs ÷ recurring revenue (falls back to the revenue lines' weighted
 *    gross margin when no variable costs are itemized).
 *  - Break-even revenue = fixed overhead ÷ contribution margin ratio. Daily / weekly targets use the average month
 *    (365.25 ÷ 12 = 30.44 days; 52.18 weeks ÷ 12 = 4.35 weeks).
 *  - Runway walks the projected monthly net (seasonality / inflation included when switched on) from the cash on hand
 *    and reports the month cash first goes below zero, interpolated within that month. Past the forecast horizon it
 *    extends at the average net of the last three projected months.
 */

import { round2, sum, type ExpenseLine, type MacroProjection, type RevenueLine } from "@/lib/schemas";

export const DAYS_PER_MONTH = 365.25 / 12;
export const WEEKS_PER_MONTH = 365.25 / 7 / 12;

const VARIABLE_COST_RE =
  /cost of goods|cogs|inventory|wholesale|product cost|merchandise|materials|supplies|parts\b|merchant|processing fee|payment fee|transaction fee|marketplace fee|stripe|paypal|shipping|fulfil|freight|postage|commission|subcontract|contractor|freelance|job cost/;

export function isVariableCost(e: Pick<ExpenseLine, "label" | "category" | "percentOf">): boolean {
  return !!e.percentOf || VARIABLE_COST_RE.test(`${e.category} ${e.label}`.toLowerCase());
}

export interface BreakEven {
  monthlyRevenue: number;
  fixedOverhead: number;
  variableCosts: number;
  /** 0..1 */
  contributionMargin: number;
  /** Where the margin came from. */
  marginSource: "ITEMIZED" | "REVENUE_LINES" | "NONE";
  /** Revenue needed per month to cover fixed overhead (null when the contribution margin is ≤ 0). */
  breakEvenMonthly: number | null;
  breakEvenDaily: number | null;
  breakEvenWeekly: number | null;
  /** Gross margin (contribution) dollars needed per day / week to cover fixed overhead. */
  marginDaily: number;
  marginWeekly: number;
  /** Current recurring revenue vs break-even (positive = cushion above it). */
  cushion: number | null;
  /** cushion ÷ revenue: the margin of safety (how far sales can fall before a loss). */
  safetyMargin: number | null;
}

export function breakEven(revenue: Pick<RevenueLine, "amount" | "margin" | "oneTime">[], expenses: Pick<ExpenseLine, "label" | "category" | "amount" | "oneTime" | "percentOf">[]): BreakEven {
  const recRev = revenue.filter((r) => !r.oneTime);
  const monthlyRevenue = round2(sum(recRev, (r) => r.amount));
  const recExp = expenses.filter((e) => !e.oneTime);
  const variableCosts = round2(sum(recExp.filter(isVariableCost), (e) => e.amount));
  const fixedOverhead = round2(sum(recExp.filter((e) => !isVariableCost(e)), (e) => e.amount));

  let contributionMargin = 0;
  let marginSource: BreakEven["marginSource"] = "NONE";
  if (monthlyRevenue > 0 && variableCosts > 0) {
    contributionMargin = 1 - variableCosts / monthlyRevenue;
    marginSource = "ITEMIZED";
  } else if (monthlyRevenue > 0) {
    const weighted = sum(recRev, (r) => r.amount * (Number.isFinite(r.margin) ? r.margin : 1)) / monthlyRevenue;
    contributionMargin = weighted > 0 ? weighted : 1;
    marginSource = "REVENUE_LINES";
  }
  const be = contributionMargin > 0 ? fixedOverhead / contributionMargin : null;
  return {
    monthlyRevenue,
    fixedOverhead,
    variableCosts,
    contributionMargin,
    marginSource,
    breakEvenMonthly: be == null ? null : round2(be),
    breakEvenDaily: be == null ? null : round2(be / DAYS_PER_MONTH),
    breakEvenWeekly: be == null ? null : round2(be / WEEKS_PER_MONTH),
    marginDaily: round2(fixedOverhead / DAYS_PER_MONTH),
    marginWeekly: round2(fixedOverhead / WEEKS_PER_MONTH),
    cushion: be == null ? null : round2(monthlyRevenue - be),
    safetyMargin: be == null || monthlyRevenue <= 0 ? null : (monthlyRevenue - be) / monthlyRevenue,
  };
}

export type RunwayLevel = "CRITICAL" | "WARNING" | "WATCH" | "HEALTHY" | "SELF_FUNDING";

export interface Runway {
  cash: number;
  /** Average monthly net over the horizon (negative = burning). */
  avgNet: number;
  /** Average monthly burn (0 when not burning). */
  avgBurn: number;
  /** Months until cash first drops below zero (fractional); null = never within the 10-year extension. */
  months: number | null;
  /** "Mar 2027"-style label of the month cash runs out, or null. */
  zeroMonth: string | null;
  /** Lowest projected cash balance and when (catches seasonal dips even when the year ends positive). */
  lowPoint: { month: string; balance: number } | null;
  level: RunwayLevel;
  /** Month-by-month balance over the projection. */
  balances: { month: string; balance: number }[];
}

const EXTEND_MONTHS = 120;

export function runwayLevel(months: number | null, avgNet: number): RunwayLevel {
  if (months == null) return avgNet >= 0 ? "SELF_FUNDING" : "HEALTHY";
  if (months < 3) return "CRITICAL";
  if (months < 6) return "WARNING";
  if (months < 12) return "WATCH";
  return "HEALTHY";
}

const MONTH_FMT = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const parseLabel = (m: string) => {
  const d = new Date(`1 ${m} UTC`);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function computeRunway(cash: number, projections: Pick<MacroProjection, "month" | "projectedRevenue" | "projectedExpenses">[]): Runway {
  const nets = projections.map((p) => p.projectedRevenue - p.projectedExpenses);
  const avgNet = nets.length ? sum(nets, (n) => n) / nets.length : 0;
  const tail = nets.slice(-3);
  const tailNet = tail.length ? sum(tail, (n) => n) / tail.length : avgNet;

  let balance = cash;
  let months: number | null = cash < 0 ? 0 : null;
  let zeroMonth: string | null = cash < 0 ? projections[0]?.month ?? null : null;
  const balances: Runway["balances"] = [];
  let lowPoint: Runway["lowPoint"] = null;
  projections.forEach((p, i) => {
    const before = balance;
    balance += nets[i];
    balances.push({ month: p.month, balance: round2(balance) });
    if (!lowPoint || balance < lowPoint.balance) lowPoint = { month: p.month, balance: round2(balance) };
    if (months == null && balance < 0) {
      months = i + (nets[i] < 0 ? before / -nets[i] : 1);
      zeroMonth = p.month;
    }
  });
  // Beyond the horizon: continue at the recent average.
  if (months == null && tailNet < 0 && projections.length) {
    const extra = balance / -tailNet;
    if (extra <= EXTEND_MONTHS) {
      months = projections.length + extra;
      const last = parseLabel(projections[projections.length - 1].month);
      if (last) zeroMonth = MONTH_FMT.format(new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + Math.ceil(extra), 1)));
    }
  }
  const m = months as number | null;
  return {
    cash,
    avgNet: round2(avgNet),
    avgBurn: round2(Math.max(0, -avgNet)),
    months: m == null ? null : Math.round(m * 10) / 10,
    zeroMonth,
    lowPoint,
    level: runwayLevel(m, avgNet),
    balances,
  };
}

export interface PacePeriod {
  key: string;
  /** "This month", "Next month", "Next 3 months", "Fiscal year". */
  label: string;
  /** "Nov 2026" or "Nov 2026 – Jan 2027". */
  range: string;
  revenue: number;
  expenses: number;
  net: number;
  /** Revenue minus break-even revenue for the same span (null when break-even is undefined). */
  vsBreakEven: number | null;
}

/**
 * "On pace for" periods from the projection: the first projected month, the next one, the next quarter, and the full
 * horizon. `breakEvenMonthly` turns each span's revenue into a directional cushion / shortfall.
 */
export function pacePeriods(projections: Pick<MacroProjection, "month" | "projectedRevenue" | "projectedExpenses">[], breakEvenMonthly: number | null, currentMonthLabel: string): PacePeriod[] {
  if (!projections.length) return [];
  const span = (key: string, label: string, from: number, to: number): PacePeriod | null => {
    const rows = projections.slice(from, to);
    if (!rows.length) return null;
    const revenue = round2(sum(rows, (r) => r.projectedRevenue));
    const expenses = round2(sum(rows, (r) => r.projectedExpenses));
    return {
      key,
      label,
      range: rows.length === 1 ? rows[0].month : `${rows[0].month} – ${rows[rows.length - 1].month}`,
      revenue,
      expenses,
      net: round2(revenue - expenses),
      vsBreakEven: breakEvenMonthly == null ? null : round2(revenue - breakEvenMonthly * rows.length),
    };
  };
  const firstIsCurrent = projections[0].month === currentMonthLabel;
  const out = [
    span("m1", firstIsCurrent ? "This month" : "Next month", 0, 1),
    span("m2", firstIsCurrent ? "Next month" : "Following month", 1, 2),
    span("q", "Next 3 months", 0, 3),
    projections.length > 3 ? span("h", `Next ${projections.length} months`, 0, projections.length) : null,
  ];
  return out.filter((p): p is PacePeriod => !!p);
}
