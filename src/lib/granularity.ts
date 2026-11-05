/**
 * Week-by-week and day-by-day views of month-level figures (projections or closed months).
 *
 * Each month's total is paced evenly across its real calendar days (a $3,100 month of 31 days = $100/day), so a
 * 28-day February runs hotter per day than a 31-day March. Weeks are 7-day blocks from the first day of each run of
 * consecutive months; a run's last week can be short and says how many days it covers. Totals are always preserved:
 * the weeks or days of a period add back to its monthly figures (to the cent, before display rounding).
 */

export type Granularity = "MONTHLY" | "WEEKLY" | "DAILY";

export const GRANULARITIES: readonly Granularity[] = ["MONTHLY", "WEEKLY", "DAILY"];

export const GRANULARITY_LABELS: Record<Granularity, string> = { MONTHLY: "Monthly", WEEKLY: "Weekly", DAILY: "Daily" };

/** Singular period noun: "month", "week", "day". */
export const GRANULARITY_UNIT: Record<Granularity, string> = { MONTHLY: "month", WEEKLY: "week", DAILY: "day" };

export const isGranularity = (v: unknown): v is Granularity => typeof v === "string" && (GRANULARITIES as readonly string[]).includes(v);

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;

/** "Dec 2026" (projection label) → "2026-12", or null. */
export function labelToKey(label: string): string | null {
  const [mon, yr] = label.split(" ");
  const i = SHORT.indexOf(mon?.slice(0, 3));
  return i >= 0 && /^\d{4}$/.test(yr ?? "") ? `${yr}-${String(i + 1).padStart(2, "0")}` : null;
}

/** First day (UTC) of a "YYYY-MM" key, or null. */
function keyStart(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)) : null;
}

const daysIn = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();

const nextKey = (key: string) => {
  const d = keyStart(key)!;
  const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}`;
};

export interface MonthInput {
  /** "YYYY-MM". */
  key: string;
  revenue: number;
  expenses: number;
  /** Projection (on pace) rather than a closed month. Runs never mix the two. */
  projected?: boolean;
}

export interface PeriodRow {
  /** Unique, full label — "Dec 2026", "Week of Dec 7, 2026", "Dec 7, 2026". */
  label: string;
  /** Short axis tick — "Dec", "Dec 7". */
  tick: string;
  /** Calendar days this period covers (a short final week has fewer than 7). */
  days: number;
  revenue: number;
  expenses: number;
  net: number;
  cumulative: number;
  projected: boolean;
}

const DAY_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const TICK_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const MONTH_FMT = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

interface Day {
  date: Date;
  revenue: number;
  expenses: number;
}

/** Splits month inputs into runs of consecutive months with the same projected flag (gaps break a run). */
function runs(months: MonthInput[]): MonthInput[][] {
  const out: MonthInput[][] = [];
  for (const m of months) {
    if (!keyStart(m.key)) continue;
    const run = out.at(-1);
    const prev = run?.at(-1);
    if (run && prev && !!prev.projected === !!m.projected && nextKey(prev.key) === m.key) run.push(m);
    else out.push([m]);
  }
  return out;
}

function daysOf(run: MonthInput[]): Day[] {
  const days: Day[] = [];
  for (const m of run) {
    const start = keyStart(m.key)!;
    const n = daysIn(start);
    for (let i = 0; i < n; i++) days.push({ date: new Date(start.getTime() + i * DAY_MS), revenue: m.revenue / n, expenses: m.expenses / n });
  }
  return days;
}

/** Re-buckets month-level figures into months, weeks or days, with a running cumulative net. Input order is kept. */
export function toPeriods(months: MonthInput[], granularity: Granularity): PeriodRow[] {
  const rows: Omit<PeriodRow, "net" | "cumulative">[] = [];
  for (const run of runs(months)) {
    const projected = !!run[0].projected;
    if (granularity === "MONTHLY") {
      for (const m of run) {
        const d = keyStart(m.key)!;
        rows.push({ label: MONTH_FMT.format(d), tick: SHORT[d.getUTCMonth()], days: daysIn(d), revenue: m.revenue, expenses: m.expenses, projected });
      }
      continue;
    }
    const days = daysOf(run);
    const size = granularity === "WEEKLY" ? 7 : 1;
    for (let i = 0; i < days.length; i += size) {
      const chunk = days.slice(i, i + size);
      const first = chunk[0].date;
      rows.push({
        label: granularity === "WEEKLY" ? `Week of ${DAY_FMT.format(first)}` : DAY_FMT.format(first),
        tick: TICK_FMT.format(first),
        days: chunk.length,
        revenue: chunk.reduce((s, d) => s + d.revenue, 0),
        expenses: chunk.reduce((s, d) => s + d.expenses, 0),
        projected,
      });
    }
  }
  let cumulative = 0;
  return rows.map((r) => {
    const net = r.revenue - r.expenses;
    cumulative += net;
    return { ...r, net, cumulative };
  });
}

export interface Pace {
  /** Average per full period (per 7-day week / per day / per month). */
  revenue: number;
  expenses: number;
  net: number;
  /** Revenue needed per period to cover that period's expenses (= average burn). */
  breakEven: number;
  /** Extra revenue needed per period to break even; 0 when already covering costs. */
  shortfall: number;
}

/** Average pace per period, weighted by calendar days so a short final week doesn't drag the average down. */
export function paceOf(rows: PeriodRow[], granularity: Granularity): Pace | null {
  const days = rows.reduce((s, r) => s + r.days, 0);
  if (!rows.length || !days) return null;
  const per = granularity === "MONTHLY" ? days / rows.length : granularity === "WEEKLY" ? 7 : 1;
  const revenue = (rows.reduce((s, r) => s + r.revenue, 0) / days) * per;
  const expenses = (rows.reduce((s, r) => s + r.expenses, 0) / days) * per;
  return { revenue, expenses, net: revenue - expenses, breakEven: expenses, shortfall: Math.max(0, expenses - revenue) };
}
