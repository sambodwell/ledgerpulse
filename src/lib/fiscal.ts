/**
 * Fiscal Year Tracker — pure, deterministic math for logged monthly actuals,
 * rolling re-forecasts, goal-vs-pace and the ROI & savings tracker.
 *
 * The tracker stores only monthly totals the owner logs (never statements).
 */

import { MONTH_NAMES, SEASONALITY, isBusinessType, monthKey, round2, sum, type BusinessType } from "@/lib/schemas";

export type TrackerForecastMode = "TRAILING" | "BASELINE";

export interface MonthActual {
  revenue: number;
  expenses: number;
}

export interface SavingsItem {
  id: string;
  title: string;
  /** Monthly savings in USD. */
  monthly: number;
  status: "IDENTIFIED" | "IMPLEMENTED";
  /** "YYYY-MM" the saving took effect (IMPLEMENTED only). */
  since?: string;
}

export interface FiscalTrackerState {
  v: 1;
  businessType: BusinessType;
  /** 0 = January … 11 = December. */
  fyStartMonth: number;
  /** Calendar year in which the tracked fiscal year starts. */
  fyStartYear: number;
  /** The original plan: recurring monthly revenue and expenses (seasonality is applied per month). */
  baseline: MonthActual;
  forecastMode: TrackerForecastMode;
  /** How many of the most recent logged months feed the trailing average. */
  trailingWindow: number;
  targets: { revenue: number | null; expenseCap: number | null };
  /** Keyed by "YYYY-MM". */
  actuals: Record<string, MonthActual>;
  savings: SavingsItem[];
}

export function defaultTrackerState(businessType: BusinessType, now = new Date()): FiscalTrackerState {
  return {
    v: 1,
    businessType,
    fyStartMonth: 0,
    fyStartYear: now.getUTCFullYear(),
    baseline: { revenue: 0, expenses: 0 },
    forecastMode: "TRAILING",
    trailingWindow: 3,
    targets: { revenue: null, expenseCap: null },
    actuals: {},
    savings: [],
  };
}

const money = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? round2(Math.min(v, 1e10)) : 0);
const moneyOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? round2(Math.min(v, 1e11)) : null);

/** Validates stored/remote state; anything malformed falls back to defaults field by field. */
export function normalizeTrackerState(raw: unknown, fallbackType: BusinessType, now = new Date()): FiscalTrackerState {
  const d = defaultTrackerState(fallbackType, now);
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const actuals: Record<string, MonthActual> = {};
  if (r.actuals && typeof r.actuals === "object") {
    for (const [k, v] of Object.entries(r.actuals as Record<string, unknown>).slice(0, 240)) {
      if (/^\d{4}-\d{2}$/.test(k) && v && typeof v === "object") {
        const a = v as Record<string, unknown>;
        actuals[k] = { revenue: money(a.revenue), expenses: money(a.expenses) };
      }
    }
  }
  const savings: SavingsItem[] = Array.isArray(r.savings)
    ? r.savings
        .slice(0, 100)
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && typeof (s as Record<string, unknown>).title === "string")
        .map((s, i) => ({
          id: typeof s.id === "string" ? s.id.slice(0, 64) : `s${i}`,
          title: String(s.title).slice(0, 160),
          monthly: money(s.monthly),
          status: s.status === "IMPLEMENTED" ? "IMPLEMENTED" : "IDENTIFIED",
          ...(typeof s.since === "string" && /^\d{4}-\d{2}$/.test(s.since) ? { since: s.since } : {}),
        }))
    : [];
  const t = (r.targets ?? {}) as Record<string, unknown>;
  const b = (r.baseline ?? {}) as Record<string, unknown>;
  const fm = Number(r.fyStartMonth);
  const fy = Number(r.fyStartYear);
  const tw = Number(r.trailingWindow);
  return {
    v: 1,
    businessType: isBusinessType(r.businessType) ? r.businessType : fallbackType,
    fyStartMonth: Number.isInteger(fm) && fm >= 0 && fm <= 11 ? fm : d.fyStartMonth,
    fyStartYear: Number.isInteger(fy) && fy >= 2000 && fy <= 2100 ? fy : d.fyStartYear,
    baseline: { revenue: money(b.revenue), expenses: money(b.expenses) },
    forecastMode: r.forecastMode === "BASELINE" ? "BASELINE" : "TRAILING",
    trailingWindow: Number.isInteger(tw) && tw >= 1 && tw <= 12 ? tw : d.trailingWindow,
    targets: { revenue: moneyOrNull(t.revenue), expenseCap: moneyOrNull(t.expenseCap) },
    actuals,
    savings,
  };
}

/** The fiscal year containing `now` for a given start month. */
export function currentFiscalYearStart(fyStartMonth: number, now = new Date()): number {
  return now.getUTCMonth() >= fyStartMonth ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

export function fiscalYearLabel(s: Pick<FiscalTrackerState, "fyStartMonth" | "fyStartYear">): string {
  if (s.fyStartMonth === 0) return `FY ${s.fyStartYear}`;
  return `FY ${s.fyStartYear}–${String((s.fyStartYear + 1) % 100).padStart(2, "0")} (${MONTH_NAMES[s.fyStartMonth].slice(0, 3)}–${MONTH_NAMES[(s.fyStartMonth + 11) % 12].slice(0, 3)})`;
}

export type MonthStatus = "ACTUAL" | "OPEN" | "FUTURE";

export interface FiscalMonth {
  key: string;
  label: string;
  /** ACTUAL = logged; OPEN = current or past month not logged yet (can be logged); FUTURE = not yet loggable. */
  status: MonthStatus;
  actual: MonthActual | null;
  /** What the tracker counts for this month: the actual when logged, otherwise the forecast. */
  revenue: number;
  expenses: number;
  forecastRevenue: number;
  forecastExpenses: number;
}

export interface PaceResult {
  target: number;
  projected: number;
  /** projected − target. Revenue: positive is good. Expense cap: positive is bad. */
  gap: number;
  /** Monthly amount needed over the remaining months to land exactly on target. */
  requiredMonthly: number | null;
}

export interface FiscalSummary {
  months: FiscalMonth[];
  loggedCount: number;
  remainingCount: number;
  ytd: MonthActual;
  projectedTotal: MonthActual;
  /** Trailing average of the most recent logged months (null when none are logged). */
  trailing: MonthActual | null;
  trailingKeys: string[];
  revenuePace: PaceResult | null;
  expensePace: PaceResult | null;
  savings: {
    identifiedMonthly: number;
    implementedMonthly: number;
    /** Implemented savings × months in effect so far this fiscal year. */
    realizedYtd: number;
    /** realizedYtd + implemented savings over the remaining months. */
    projectedFy: number;
  };
}

const LABEL = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Builds the 12 fiscal months. Logged months use actuals. Unlogged months use either
 *   TRAILING: the average of the last `trailingWindow` logged months (falls back to baseline until one is logged), or
 *   BASELINE: the original plan × that month's seasonality multiplier.
 */
export function summarizeFiscalYear(s: FiscalTrackerState, now = new Date()): FiscalSummary {
  const currentKey = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const season = SEASONALITY[s.businessType];
  const dates = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(s.fyStartYear, s.fyStartMonth + i, 1)));
  const keys = dates.map(monthKey);

  const loggedKeys = keys.filter((k) => s.actuals[k]);
  const trailingKeys = loggedKeys.slice(-Math.max(1, s.trailingWindow));
  const trailing = trailingKeys.length
    ? {
        revenue: round2(sum(trailingKeys, (k) => s.actuals[k].revenue) / trailingKeys.length),
        expenses: round2(sum(trailingKeys, (k) => s.actuals[k].expenses) / trailingKeys.length),
      }
    : null;

  const months: FiscalMonth[] = dates.map((d, i) => {
    const key = keys[i];
    const idx = d.getUTCMonth();
    const plan = { revenue: round2(s.baseline.revenue * season.revenue[idx]), expenses: round2(s.baseline.expenses * season.expenses[idx]) };
    const forecast = s.forecastMode === "TRAILING" && trailing ? trailing : plan;
    const actual = s.actuals[key] ?? null;
    const status: MonthStatus = actual ? "ACTUAL" : key <= currentKey ? "OPEN" : "FUTURE";
    return {
      key,
      label: LABEL.format(d),
      status,
      actual,
      revenue: actual ? actual.revenue : forecast.revenue,
      expenses: actual ? actual.expenses : forecast.expenses,
      forecastRevenue: forecast.revenue,
      forecastExpenses: forecast.expenses,
    };
  });

  const logged = months.filter((m) => m.status === "ACTUAL");
  const ytd = { revenue: round2(sum(logged, (m) => m.revenue)), expenses: round2(sum(logged, (m) => m.expenses)) };
  const projectedTotal = { revenue: round2(sum(months, (m) => m.revenue)), expenses: round2(sum(months, (m) => m.expenses)) };
  const remainingCount = 12 - logged.length;

  const pace = (target: number | null, projected: number, done: number): PaceResult | null =>
    target == null ? null : { target, projected, gap: round2(projected - target), requiredMonthly: remainingCount > 0 ? round2((target - done) / remainingCount) : null };

  // Savings: months in effect within this fiscal year, counted from `since` through the current month.
  const fyKeysThroughNow = keys.filter((k) => k <= currentKey);
  const implemented = s.savings.filter((x) => x.status === "IMPLEMENTED");
  const monthsInEffect = (since?: string) => fyKeysThroughNow.filter((k) => !since || k >= since).length;
  const realizedYtd = round2(sum(implemented, (x) => x.monthly * monthsInEffect(x.since)));
  const futureMonths = keys.filter((k) => k > currentKey).length;

  return {
    months,
    loggedCount: logged.length,
    remainingCount,
    ytd,
    projectedTotal,
    trailing,
    trailingKeys,
    revenuePace: pace(s.targets.revenue, projectedTotal.revenue, ytd.revenue),
    expensePace: pace(s.targets.expenseCap, projectedTotal.expenses, ytd.expenses),
    savings: {
      identifiedMonthly: round2(sum(s.savings.filter((x) => x.status === "IDENTIFIED"), (x) => x.monthly)),
      implementedMonthly: round2(sum(implemented, (x) => x.monthly)),
      realizedYtd,
      projectedFy: round2(realizedYtd + sum(implemented, (x) => x.monthly) * futureMonths),
    },
  };
}
