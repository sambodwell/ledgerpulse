/**
 * Fiscal Year Tracker — pure, deterministic math for logged monthly actuals,
 * rolling re-forecasts, goal-vs-pace and the ROI & savings tracker.
 *
 * The tracker stores only monthly totals the owner logs (never statements).
 */

import { MONTH_NAMES, SEASONALITY, isBusinessType, monthKey, round2, type BusinessType } from "@/lib/schemas";

export type TrackerForecastMode = "TRAILING" | "BASELINE";
export type GoalMetric = "NET" | "REVENUE" | "EXPENSE";
export const GOAL_METRICS: readonly GoalMetric[] = ["NET", "REVENUE", "EXPENSE"];

export interface MonthActual {
  revenue: number;
  /** Total expenses for the month, one-time items included. */
  expenses: number;
  /** Part of `expenses` that was one-time (a repair, a single purchase). Excluded from trailing averages. */
  oneTimeExpenses?: number;
}

// ---------------------------------------------------------------------------
// Exact money math: sums are done in integer cents so totals match the rows to the penny.
// ---------------------------------------------------------------------------

export const toCents = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) : 0);
export const fromCents = (c: number) => c / 100;
/** Sum of money values, exact to the cent (no floating-point drift). */
export function sumMoney<T>(items: T[], pick: (t: T) => number): number {
  return fromCents(items.reduce((acc, t) => acc + toCents(pick(t)), 0));
}
/** a − b, exact to the cent. */
export const subMoney = (a: number, b: number) => fromCents(toCents(a) - toCents(b));
/** One-time part of a logged month's expenses (never more than the total). */
export const oneTimeOf = (a: MonthActual) => Math.min(a.expenses, a.oneTimeExpenses ?? 0);
/** Recurring (non-one-time) expenses for a logged month. */
export const recurringExpenses = (a: MonthActual) => subMoney(a.expenses, oneTimeOf(a));

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
  /** Apply the business type's seasonality curve to the baseline plan. Off by default so flat plans stay flat. */
  seasonality: boolean;
  /** Which year-end goal the Goal Tracker paces against. */
  goalMetric: GoalMetric;
  /** How many of the most recent logged months feed the trailing average. */
  trailingWindow: number;
  /** revenue = year-end revenue goal; net = year-end net income goal; expenseCap = annual spending ceiling. */
  targets: { revenue: number | null; expenseCap: number | null; net: number | null };
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
    seasonality: false,
    goalMetric: "NET",
    trailingWindow: 3,
    targets: { revenue: null, expenseCap: null, net: null },
    actuals: {},
    savings: [],
  };
}

const money = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? round2(Math.min(v, 1e10)) : 0);
const moneyOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? round2(Math.min(v, 1e11)) : null);
/** Net income goals may be negative (e.g. "lose no more than $5,000"); zero/absent = no goal. */
const signedMoneyOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v !== 0 ? round2(Math.max(-1e11, Math.min(v, 1e11))) : null);

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
        const expenses = money(a.expenses);
        const oneTime = Math.min(expenses, money(a.oneTimeExpenses));
        actuals[k] = { revenue: money(a.revenue), expenses, ...(oneTime > 0 ? { oneTimeExpenses: oneTime } : {}) };
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
  const targets = { revenue: moneyOrNull(t.revenue), expenseCap: moneyOrNull(t.expenseCap), net: signedMoneyOrNull(t.net) };
  // Older trackers defaulted to REVENUE without the owner choosing it: keep REVENUE only when a revenue goal was actually set.
  const stored = (GOAL_METRICS as readonly unknown[]).includes(r.goalMetric) ? (r.goalMetric as GoalMetric) : null;
  const goalMetric: GoalMetric = stored && (stored !== "REVENUE" || targets.revenue != null) ? stored : "NET";
  return {
    v: 1,
    businessType: isBusinessType(r.businessType) ? r.businessType : fallbackType,
    fyStartMonth: Number.isInteger(fm) && fm >= 0 && fm <= 11 ? fm : d.fyStartMonth,
    fyStartYear: Number.isInteger(fy) && fy >= 2000 && fy <= 2100 ? fy : d.fyStartYear,
    baseline: { revenue: money(b.revenue), expenses: money(b.expenses) },
    forecastMode: r.forecastMode === "BASELINE" ? "BASELINE" : "TRAILING",
    // Older saved trackers always applied seasonality; the new default is off (flat plans stay flat).
    seasonality: r.seasonality === true,
    goalMetric,
    trailingWindow: Number.isInteger(tw) && tw >= 1 && tw <= 12 ? tw : d.trailingWindow,
    targets,
    actuals,
    savings,
  };
}

/** The year-end goal for a metric (null = not set). */
export function goalForMetric(s: Pick<FiscalTrackerState, "targets">, metric: GoalMetric): number | null {
  return metric === "NET" ? s.targets.net : metric === "REVENUE" ? s.targets.revenue : s.targets.expenseCap;
}

export const targetKeyFor = (metric: GoalMetric): keyof FiscalTrackerState["targets"] => (metric === "NET" ? "net" : metric === "REVENUE" ? "revenue" : "expenseCap");

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
  /** One-time expenses inside the trailing window that were left out of the average. */
  trailingOneTimeExcluded: number;
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
 *   BASELINE: the original plan (× that month's seasonality multiplier when seasonality is switched on).
 */
export function summarizeFiscalYear(s: FiscalTrackerState, now = new Date()): FiscalSummary {
  const currentKey = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const season = SEASONALITY[s.businessType];
  const dates = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(s.fyStartYear, s.fyStartMonth + i, 1)));
  const keys = dates.map(monthKey);

  const loggedKeys = keys.filter((k) => s.actuals[k]);
  const trailingKeys = loggedKeys.slice(-Math.max(1, s.trailingWindow));
  // One-time expenses are left out so a single repair or purchase doesn't inflate every forecast month.
  const trailing = trailingKeys.length
    ? {
        revenue: round2(sumMoney(trailingKeys, (k) => s.actuals[k].revenue) / trailingKeys.length),
        expenses: round2(sumMoney(trailingKeys, (k) => recurringExpenses(s.actuals[k])) / trailingKeys.length),
      }
    : null;
  const trailingOneTimeExcluded = sumMoney(trailingKeys, (k) => oneTimeOf(s.actuals[k]));

  const months: FiscalMonth[] = dates.map((d, i) => {
    const key = keys[i];
    const idx = d.getUTCMonth();
    const rs = s.seasonality ? season.revenue[idx] : 1;
    const es = s.seasonality ? season.expenses[idx] : 1;
    const plan = { revenue: round2(s.baseline.revenue * rs), expenses: round2(s.baseline.expenses * es) };
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
  const ytd = { revenue: sumMoney(logged, (m) => m.revenue), expenses: sumMoney(logged, (m) => m.expenses) };
  const projectedTotal = { revenue: sumMoney(months, (m) => m.revenue), expenses: sumMoney(months, (m) => m.expenses) };
  const remainingCount = 12 - logged.length;

  const pace = (target: number | null, projected: number, done: number): PaceResult | null =>
    target == null ? null : { target, projected, gap: subMoney(projected, target), requiredMonthly: remainingCount > 0 ? round2(subMoney(target, done) / remainingCount) : null };

  // Savings: months in effect within this fiscal year, counted from `since` through the current month.
  const fyKeysThroughNow = keys.filter((k) => k <= currentKey);
  const implemented = s.savings.filter((x) => x.status === "IMPLEMENTED");
  const monthsInEffect = (since?: string) => fyKeysThroughNow.filter((k) => !since || k >= since).length;
  const realizedYtd = sumMoney(implemented, (x) => x.monthly * monthsInEffect(x.since));
  const futureMonths = keys.filter((k) => k > currentKey).length;

  return {
    months,
    loggedCount: logged.length,
    remainingCount,
    ytd,
    projectedTotal,
    trailing,
    trailingKeys,
    trailingOneTimeExcluded,
    revenuePace: pace(s.targets.revenue, projectedTotal.revenue, ytd.revenue),
    expensePace: pace(s.targets.expenseCap, projectedTotal.expenses, ytd.expenses),
    savings: {
      identifiedMonthly: sumMoney(s.savings.filter((x) => x.status === "IDENTIFIED"), (x) => x.monthly),
      implementedMonthly: sumMoney(implemented, (x) => x.monthly),
      realizedYtd,
      projectedFy: round2(realizedYtd + sumMoney(implemented, (x) => x.monthly) * futureMonths),
    },
  };
}

// ---------------------------------------------------------------------------
// Goal Tracker: year-end goal vs actual / projected pace
// ---------------------------------------------------------------------------

export const GOAL_METRIC_LABEL: Record<GoalMetric, string> = { NET: "Net income", REVENUE: "Revenue", EXPENSE: "Expenses" };

export interface GoalPaceMonth {
  key: string;
  label: string;
  status: MonthStatus;
  /** Net, revenue or expenses for the month: actual when logged, otherwise the forecast. */
  value: number;
  /** This month's share of the goal (goal ÷ 12, split to the cent so the 12 months add up exactly to the goal). */
  target: number;
  /** Positive = ahead of pace (for an expense budget: under budget). */
  variance: number;
  cumulativeValue: number;
  cumulativeTarget: number;
}

export interface GoalPaceQuarter {
  label: string; // "Q1" … "Q4" of the fiscal year
  months: string; // e.g. "Jan–Mar 2026"
  value: number;
  target: number;
  variance: number;
  /** ACTUAL = every month logged; MIXED = some logged; FORECAST = none logged. */
  basis: "ACTUAL" | "MIXED" | "FORECAST";
}

export interface GoalPace {
  metric: GoalMetric;
  goal: number;
  monthlyTarget: number;
  months: GoalPaceMonth[];
  quarters: GoalPaceQuarter[];
  /** Logged months only, against the target for those same months. */
  ytd: { value: number; target: number; variance: number; months: number };
  /** Full fiscal year: logged actuals + forecast for the rest, against the goal. */
  annual: { projected: number; goal: number; variance: number };
  /** Goal minus logged actuals: what is still needed (or, for an expense budget, still available). */
  remainingToGoal: number;
  /** Per-month amount needed (expense budget: available) over the unlogged months to land exactly on the goal. */
  requiredMonthly: number | null;
  /** One-line summary, e.g. "+$500.00 ahead in Q1, −$200.00 behind in Q2, overall pacing $300.00 below the annual goal". */
  headline: string;
}

const money2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "$1,234.56" — exact to the cent. */
export const exactMoney = (n: number) => money2.format(n);
/** "+$500.00" / "−$200.00" (always signed; exact to the cent). */
export const signedMoney = (n: number) => `${n >= 0 ? "+" : "−"}${money2.format(Math.abs(n))}`;

/** Describes a variance against a goal: "+$500.00 ahead" / "−$200.00 behind" / "on pace" (expense budget: under / over budget). */
export function paceWords(variance: number, metric: GoalMetric = "NET"): string {
  if (Math.abs(variance) < 0.005) return metric === "EXPENSE" ? "on budget" : "on pace";
  if (metric === "EXPENSE") return `${money2.format(Math.abs(variance))} ${variance > 0 ? "under budget" : "over budget"}`;
  return `${signedMoney(variance)} ${variance > 0 ? "ahead" : "behind"}`;
}

/** The headline delta for the summary banner and PDF, e.g. "$1,200.00 ahead of annual target". */
export function annualDeltaWords(p: Pick<GoalPace, "metric" | "annual">): string {
  const v = p.annual.variance;
  if (Math.abs(v) < 0.005) return p.metric === "EXPENSE" ? "Right on the annual budget" : "Right on the annual target";
  const amt = money2.format(Math.abs(v));
  if (p.metric === "EXPENSE") return `${amt} ${v > 0 ? "under" : "over"} annual budget`;
  return `${amt} ${v > 0 ? "ahead of" : "behind"} annual target`;
}

/** Splits a goal across 12 months in whole cents so the months add up exactly to the goal. */
function monthlyTargetCents(goal: number): number[] {
  const total = toCents(goal);
  const base = Math.trunc(total / 12);
  const rem = total - base * 12; // same sign as total, |rem| < 12
  return Array.from({ length: 12 }, (_, i) => base + (i < Math.abs(rem) ? Math.sign(rem) : 0));
}

/** Monthly, quarterly and annual pace against a year-end goal. The goal is spread evenly: goal ÷ 12 per month. */
export function goalPace(summary: FiscalSummary, metric: GoalMetric, goal: number | null): GoalPace | null {
  if (goal == null || !Number.isFinite(goal) || goal === 0) return null;
  // Revenue / net: above the path is good. Expense budget: below the path is good.
  const dir = metric === "EXPENSE" ? -1 : 1;
  const valueCents = (m: FiscalMonth) => (metric === "REVENUE" ? toCents(m.revenue) : metric === "EXPENSE" ? toCents(m.expenses) : toCents(m.revenue) - toCents(m.expenses));
  const targets = monthlyTargetCents(goal);

  let cv = 0;
  let ct = 0;
  const months: GoalPaceMonth[] = summary.months.map((m, i) => {
    const v = valueCents(m);
    const t = targets[i] ?? 0;
    cv += v;
    ct += t;
    return {
      key: m.key,
      label: m.label,
      status: m.status,
      value: fromCents(v),
      target: fromCents(t),
      variance: fromCents(dir * (v - t)),
      cumulativeValue: fromCents(cv),
      cumulativeTarget: fromCents(ct),
    };
  });

  const short = (l: string) => l.split(" ")[0];
  const quarters: GoalPaceQuarter[] = [0, 1, 2, 3].map((q) => {
    const ms = months.slice(q * 3, q * 3 + 3);
    const logged = ms.filter((m) => m.status === "ACTUAL").length;
    const value = sumMoney(ms, (m) => m.value);
    const target = sumMoney(ms, (m) => m.target);
    return {
      label: `Q${q + 1}`,
      months: `${short(ms[0].label)}–${ms.at(-1)!.label}`,
      value,
      target,
      variance: fromCents(dir * (toCents(value) - toCents(target))),
      basis: logged === ms.length ? "ACTUAL" : logged > 0 ? "MIXED" : "FORECAST",
    };
  });

  const logged = months.filter((m) => m.status === "ACTUAL");
  const ytdValue = sumMoney(logged, (m) => m.value);
  const ytdTarget = sumMoney(logged, (m) => m.target);
  const projected = months.at(-1)?.cumulativeValue ?? 0;
  const remaining = months.length - logged.length;
  const remainingToGoal = subMoney(goal, ytdValue);

  const quarterBits = quarters.filter((q) => q.basis !== "FORECAST").map((q) => `${paceWords(q.variance, metric)} in ${q.label}`);
  const annualVariance = fromCents(dir * (toCents(projected) - toCents(goal)));
  const overall =
    Math.abs(annualVariance) < 0.005
      ? metric === "EXPENSE"
        ? "overall pacing right on the annual budget"
        : "overall pacing right on the annual goal"
      : metric === "EXPENSE"
        ? `overall on track to finish ${money2.format(Math.abs(annualVariance))} ${annualVariance > 0 ? "under" : "over"} the annual budget`
        : `overall pacing ${money2.format(Math.abs(annualVariance))} ${annualVariance > 0 ? "above" : "below"} the annual goal`;

  return {
    metric,
    goal,
    monthlyTarget: round2(goal / 12),
    months,
    quarters,
    ytd: { value: ytdValue, target: ytdTarget, variance: fromCents(dir * (toCents(ytdValue) - toCents(ytdTarget))), months: logged.length },
    annual: { projected, goal, variance: annualVariance },
    remainingToGoal,
    requiredMonthly: remaining > 0 ? round2(remainingToGoal / remaining) : null,
    headline: [...quarterBits, overall].join(", "),
  };
}
