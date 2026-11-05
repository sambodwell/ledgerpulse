/**
 * Projection basis: which numbers drive the multi-month projection.
 *
 *  - REPORT: the latest report's line items, exactly as entered / parsed (one statement or form).
 *  - ACTUALS: the average of every month logged in the Fiscal Year Tracker, so uploading several past months moves
 *    the projection — not just goal pace. The report's line mix is kept (scaled to the averages) so categories,
 *    scenarios, seasonality and inflation still apply per line.
 *
 * Pure and deterministic.
 */

import { recurringExpenses, sumMoney, type MonthActual } from "@/lib/fiscal";
import { round2, splitTotals, type ExpenseLine, type FinancialAnalysis, type RevenueLine } from "@/lib/schemas";

export type ProjectionBasis = "AUTO" | "ACTUALS" | "REPORT";

export interface ActualsAggregate {
  /** Number of logged months averaged. */
  months: number;
  /** Average monthly revenue across logged months (exact to the cent). */
  revenue: number;
  /** Average monthly recurring expenses (one-time items excluded). */
  expenses: number;
  /** Total one-time expenses left out of the average. */
  oneTimeExcluded: number;
  first: string;
  last: string;
}

/** Every logged month (any fiscal year), averaged. Null when nothing is logged. */
export function aggregateActuals(actuals: Record<string, MonthActual>): ActualsAggregate | null {
  const keys = Object.keys(actuals)
    .filter((k) => /^\d{4}-\d{2}$/.test(k))
    .sort();
  if (!keys.length) return null;
  return {
    months: keys.length,
    revenue: round2(sumMoney(keys, (k) => actuals[k].revenue) / keys.length),
    expenses: round2(sumMoney(keys, (k) => recurringExpenses(actuals[k])) / keys.length),
    oneTimeExcluded: sumMoney(keys, (k) => actuals[k].expenses - recurringExpenses(actuals[k])),
    first: keys[0],
    last: keys[keys.length - 1],
  };
}

/** AUTO uses actuals once two or more months are logged (one month usually *is* the report). */
export function resolveBasis(basis: ProjectionBasis, agg: ActualsAggregate | null): "ACTUALS" | "REPORT" {
  if (!agg) return "REPORT";
  if (basis === "AUTO") return agg.months >= 2 ? "ACTUALS" : "REPORT";
  return basis;
}

/** Scales `lines` so their amounts total `target`, to the cent (the last line absorbs rounding). */
function scaleTo<T extends { amount: number }>(lines: T[], target: number): T[] {
  const total = lines.reduce((acc, l) => acc + l.amount, 0);
  if (!(total > 0)) return lines;
  const f = target / total;
  let used = 0;
  return lines.map((l, i) => {
    const amount = i === lines.length - 1 ? round2(target - used) : round2(l.amount * f);
    used = round2(used + amount);
    return { ...l, amount };
  });
}

/**
 * The analysis with its recurring line items rescaled to the logged-month averages. Past one-time items and
 * first-month proration are dropped (they already happened), and %-of-revenue expenses become fixed amounts so the
 * expense total matches the actual average exactly.
 */
export function calibrateToActuals(a: FinancialAnalysis, agg: ActualsAggregate): FinancialAnalysis {
  const recurringRevenue: RevenueLine[] = a.itemizedRevenue.filter((r) => !r.oneTime).map((r) => ({ label: r.label, amount: r.amount, margin: r.margin }));
  const recurringExpensesLines: ExpenseLine[] = a.itemizedExpenses
    .filter((e) => !e.oneTime)
    .map((e) => ({ label: e.label, amount: e.amount, category: e.category, ...(e.flag ? { flag: e.flag } : {}) }));

  const itemizedRevenue: RevenueLine[] =
    agg.revenue <= 0
      ? []
      : splitTotals(recurringRevenue).recurring > 0
        ? scaleTo(recurringRevenue, agg.revenue)
        : [{ label: "Average logged revenue", amount: agg.revenue, margin: 0.5 }];
  const itemizedExpenses: ExpenseLine[] =
    agg.expenses <= 0
      ? []
      : splitTotals(recurringExpensesLines).recurring > 0
        ? scaleTo(recurringExpensesLines, agg.expenses)
        : [{ label: "Average logged expenses", amount: agg.expenses, category: "Other" }];

  return { ...a, itemizedRevenue, itemizedExpenses, monthlyRevenue: agg.revenue };
}
