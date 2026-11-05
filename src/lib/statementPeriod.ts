/**
 * Statement month detection: finds which calendar month a bank statement / P&L covers from its text, so parsed
 * totals can be logged into the right Fiscal Year Tracker slot. Pure and deterministic (no I/O).
 *
 * Signals, strongest first:
 *   1. Date ranges ("Statement Period 03/01/2026 – 03/31/2026", "March 1 - March 31, 2026") → the month holding most days
 *   2. Period keywords ("for the month ended March 31, 2026", "closing date 03/31/26", "Statement date: Mar 2026")
 *   3. Plain "Month YYYY" mentions ("March 2026") and dated transactions ("03/14/2026"), by frequency
 */

export interface StatementPeriod {
  /** "YYYY-MM" */
  key: string;
  /** "March 2026" */
  label: string;
  /** How the month was found. */
  source: "text" | "model";
  /** "high" = an explicit statement period / range; "medium" = most frequent month in the text. */
  confidence: "high" | "medium";
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const LABEL = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

const monthIndex = (name: string) => MONTHS.findIndex((m) => m.startsWith(name.toLowerCase().replace(".", "").slice(0, 3)));
const fullYear = (y: string) => {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
};
const validYear = (y: number) => y >= 2000 && y <= 2100;

export const periodKey = (year: number, monthIdx: number) => `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
export function periodLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  return m ? LABEL.format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))) : key;
}
export function makePeriod(key: string, source: StatementPeriod["source"], confidence: StatementPeriod["confidence"]): StatementPeriod | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m || !validYear(Number(m[1])) || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return { key, label: periodLabel(key), source, confidence };
}

interface Ymd {
  y: number;
  m: number; // 0-based
  d: number;
}

/** Numeric date "03/31/2026", "3-31-26", "2026-03-31" (US month-first order for slashed dates). */
const NUM_DATE = "(\\d{4})-(\\d{1,2})-(\\d{1,2})|(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{2,4})";
/** Written date "March 31, 2026" / "Mar 31 2026" / "31 March 2026". */
const WORD_DATE = `${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})|(\\d{1,2})\\s+${MONTH_RE},?\\s+(\\d{4})`;

function parseNumDate(m: RegExpExecArray, offset = 0): Ymd | null {
  if (m[offset + 1]) {
    const v = { y: Number(m[offset + 1]), m: Number(m[offset + 2]) - 1, d: Number(m[offset + 3]) };
    return v.m >= 0 && v.m <= 11 && v.d >= 1 && v.d <= 31 && validYear(v.y) ? v : null;
  }
  const a = Number(m[offset + 4]);
  const b = Number(m[offset + 5]);
  const y = fullYear(m[offset + 6]);
  // Month-first unless the first number can't be a month.
  const [mm, dd] = a > 12 ? [b, a] : [a, b];
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && validYear(y) ? { y, m: mm - 1, d: dd } : null;
}

function parseWordDate(m: RegExpExecArray, offset = 0): Ymd | null {
  const v = m[offset + 1]
    ? { y: Number(m[offset + 3]), m: monthIndex(m[offset + 1]), d: Number(m[offset + 2]) }
    : { y: Number(m[offset + 6]), m: monthIndex(m[offset + 5]), d: Number(m[offset + 4]) };
  return v.m >= 0 && v.d >= 1 && v.d <= 31 && validYear(v.y) ? v : null;
}

/** All dates in a string, in order. */
function datesIn(s: string): Ymd[] {
  const out: { i: number; v: Ymd }[] = [];
  for (const m of s.matchAll(new RegExp(NUM_DATE, "g"))) {
    const v = parseNumDate(m as RegExpExecArray);
    if (v) out.push({ i: m.index ?? 0, v });
  }
  for (const m of s.matchAll(new RegExp(WORD_DATE, "gi"))) {
    const v = parseWordDate(m as RegExpExecArray);
    if (v) out.push({ i: m.index ?? 0, v });
  }
  return out.sort((a, b) => a.i - b.i).map((x) => x.v);
}

/** The calendar month containing most of the days in [a, b]. */
function dominantMonth(a: Ymd, b: Ymd): string | null {
  const start = Date.UTC(a.y, a.m, a.d);
  const end = Date.UTC(b.y, b.m, b.d);
  if (!(end >= start) || end - start > 400 * 86400000) return null;
  const counts = new Map<string, number>();
  for (let t = start; t <= end; t += 86400000) {
    const d = new Date(t);
    const k = periodKey(d.getUTCFullYear(), d.getUTCMonth());
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  // Ties (e.g. a 2-month range) go to the later month: statements are named by their closing month.
  return [...counts.entries()].reduce((best, cur) => (cur[1] >= best[1] ? cur : best))[0];
}

const PERIOD_WORDS = /(statement\s+(?:period|date|for)|billing\s+(?:period|cycle)|for\s+the\s+(?:month|period)\s+(?:ended|ending|of)|month\s+(?:ended|ending)|period\s+(?:ended|ending|covered|from)|closing\s+date|period:|as\s+of)/i;

/**
 * Detects the statement month from text. Returns null when nothing month-like is found.
 * Only the first ~6,000 characters are searched for headers; the whole text is used for frequency.
 */
export function detectStatementPeriod(text: string): StatementPeriod | null {
  if (!text) return null;
  const head = text.slice(0, 6000);
  const lines = head.split(/\r?\n/);

  // 1 + 2: lines with period keywords — a range wins, otherwise the closing date / "Month YYYY" on that line.
  for (let i = 0; i < lines.length; i++) {
    if (!PERIOD_WORDS.test(lines[i])) continue;
    const window = `${lines[i]} ${lines[i + 1] ?? ""}`;
    const dates = datesIn(window);
    if (dates.length >= 2) {
      const k = dominantMonth(dates[0], dates[1]);
      if (k) return makePeriod(k, "text", "high");
    }
    // "March 1 - 31, 2026"
    const sameMonth = new RegExp(`${MONTH_RE}\\s+\\d{1,2}\\s*[-–—to]+\\s*\\d{1,2},?\\s+(\\d{4})`, "i").exec(window);
    if (sameMonth) {
      const idx = monthIndex(sameMonth[1]);
      if (idx >= 0) return makePeriod(periodKey(Number(sameMonth[2]), idx), "text", "high");
    }
    if (dates.length === 1) return makePeriod(periodKey(dates[0].y, dates[0].m), "text", "high");
    const my = new RegExp(`${MONTH_RE},?\\s+(\\d{4})`, "i").exec(window);
    if (my) {
      const idx = monthIndex(my[1]);
      if (idx >= 0 && validYear(Number(my[2]))) return makePeriod(periodKey(Number(my[2]), idx), "text", "high");
    }
  }

  // Any explicit date range in the header ("03/01/2026 - 03/31/2026").
  const range = new RegExp(`(?:${NUM_DATE})\\s*(?:-|–|—|to|through|thru)\\s*(?:${NUM_DATE})`, "i").exec(head);
  if (range) {
    const a = parseNumDate(range, 0);
    const b = parseNumDate(range, 6);
    const k = a && b ? dominantMonth(a, b) : null;
    if (k) return makePeriod(k, "text", "high");
  }

  // 3: most frequent month across "Month YYYY" mentions and dated transactions.
  const votes = new Map<string, number>();
  const vote = (k: string, w: number) => votes.set(k, (votes.get(k) ?? 0) + w);
  for (const m of text.matchAll(new RegExp(`\\b${MONTH_RE},?\\s+(\\d{4})\\b`, "gi"))) {
    const idx = monthIndex(m[1]);
    const y = Number(m[2]);
    if (idx >= 0 && validYear(y)) vote(periodKey(y, idx), 3);
  }
  for (const d of datesIn(text)) vote(periodKey(d.y, d.m), 1);
  if (votes.size === 0) return null;
  const [best, n] = [...votes.entries()].reduce((a, b) => (b[1] > a[1] || (b[1] === a[1] && b[0] > a[0]) ? b : a));
  const total = [...votes.values()].reduce((a, b) => a + b, 0);
  // A clear majority of mentions → medium confidence; a scattered multi-month document → no guess.
  return n / total >= 0.5 ? makePeriod(best, "text", "medium") : null;
}

/** Validates a "YYYY-MM" period returned by the model (empty / malformed → null). */
export function periodFromModel(v: unknown): StatementPeriod | null {
  return typeof v === "string" ? makePeriod(v.trim(), "model", "medium") : null;
}

export function isStatementPeriod(v: unknown): v is StatementPeriod {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.key === "string" && /^\d{4}-\d{2}$/.test(r.key) && typeof r.label === "string" && (r.source === "text" || r.source === "model") && (r.confidence === "high" || r.confidence === "medium");
}
