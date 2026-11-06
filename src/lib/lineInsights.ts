/**
 * Line-item insights for the statement review screen. Pure and deterministic.
 *
 *  - Review flags (unrecognized merchants, duplicates, unusual charges) are matched to the parsed line they belong to,
 *    so the review can highlight that row inline instead of only listing flags in a summary box.
 *  - Recurrence is cross-checked against every other month the owner has (this upload, plus documents already saved in
 *    the workspace): a vendor seen in two or more months is confirmed recurring; a line that never appears in the other
 *    months is called out as new / likely one-time; and with a single month and no history, lines the parser couldn't
 *    classify are highlighted for the owner to decide.
 */

import type { ReviewFlag } from "@/lib/batchStatements";

export type LineSide = "revenue" | "expense";

export interface RecurrenceInsight {
  /** confirmed = seen in other months; ambiguous = the owner should decide; new = not in the other months. */
  status: "confirmed" | "ambiguous" | "new";
  note: string;
}

export interface LineInsight {
  /** Parser review flags matched to this line. */
  flags: ReviewFlag[];
  recurrence?: RecurrenceInsight;
  /** The owner marked the flags as checked ("Looks fine"). */
  flagsReviewed?: boolean;
  /** The owner picked recurring / one-time themselves, so the recurrence prompt is settled. */
  recurrenceReviewed?: boolean;
}

/** Highlight state of a row: flagged (needs a look), recurrence to confirm, or nothing. */
export function insightTone(i: LineInsight | undefined): "duplicate" | "flag" | "recurrence" | null {
  if (!i) return null;
  if (i.flags.length && !i.flagsReviewed) return i.flags.some((f) => f.kind === "DUPLICATE_TRANSACTION") ? "duplicate" : "flag";
  if (i.recurrence && i.recurrence.status !== "confirmed" && !i.recurrenceReviewed) return "recurrence";
  return null;
}

// ---------------------------------------------------------------------------
// Vendor names
// ---------------------------------------------------------------------------

/** Words that don't identify a vendor: legal suffixes, payment-rail prefixes and statement noise. */
const NOISE = new Set([
  "inc", "llc", "ltd", "co", "corp", "corporation", "company", "the", "and", "of",
  "payment", "payments", "pmt", "ach", "debit", "credit", "pos", "purchase", "online", "www", "com", "net", "org",
  "recurring", "autopay", "auto", "bill", "billing", "card", "visa", "mc", "sq", "tst", "pp", "dd", "ref", "id", "txn",
]);

const tokens = (label: string) =>
  label
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !/^\d+$/.test(t) && !NOISE.has(t))
    // Light plural folding so "Payouts" and "PAYOUT" match ("services" → "service", but "gas" stays "gas").
    .map((t) => (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));

/** Normalized vendor name: "ADOBE *CREATIVE CLD 800-833-6687" → "adobe creative cld". */
export function vendorKey(label: string): string {
  return tokens(label).join(" ");
}

/** Same vendor: identical normalized names, or one name's words all contained in the other's ("Adobe" ⊂ "Adobe Creative Cloud"). */
export function sameVendor(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return a.trim().toLowerCase() === b.trim().toLowerCase();
  if (ta.join(" ") === tb.join(" ")) return true;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const set = new Set(long);
  return short.some((t) => t.length >= 4) && short.every((t) => set.has(t));
}

// ---------------------------------------------------------------------------
// Flags → lines
// ---------------------------------------------------------------------------

function flagScore(f: ReviewFlag, label: string): number {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  if (f.lineLabel && norm(f.lineLabel) === norm(label)) return 4;
  if (f.lineLabel && sameVendor(f.lineLabel, label)) return 3;
  if (sameVendor(f.merchant, label)) return 2;
  const a = new Set(tokens(f.merchant));
  const b = tokens(label);
  if (!a.size || !b.length) return 0;
  const shared = b.filter((t) => a.has(t)).length;
  const overlap = shared / Math.min(a.size, b.length);
  return overlap >= 0.5 ? 1 + overlap / 2 : 0;
}

/**
 * Assigns each flag to the best-matching line (by the label the parser grouped it into, else by merchant name).
 * Returns line index → flags, plus the flags that matched no line (still shown in the summary).
 */
export function matchFlags(flags: ReviewFlag[], lines: { label: string }[]): { byLine: Map<number, ReviewFlag[]>; unmatched: ReviewFlag[] } {
  const byLine = new Map<number, ReviewFlag[]>();
  const unmatched: ReviewFlag[] = [];
  for (const f of flags) {
    let best = -1;
    let bestScore = 0;
    lines.forEach((l, i) => {
      const s = flagScore(f, l.label);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    });
    if (best < 0) unmatched.push(f);
    else byLine.set(best, [...(byLine.get(best) ?? []), f]);
  }
  return { byLine, unmatched };
}

// ---------------------------------------------------------------------------
// Recurrence across months
// ---------------------------------------------------------------------------

export interface VendorHistory {
  entries: { side: LineSide; label: string; month: string; amount: number }[];
  /** Every month with at least one line. */
  months: Set<string>;
}

/** Every line of every month the owner has, for cross-month comparison. Statements without a month are skipped. */
export function buildVendorHistory(sources: { month: string; revenue: { label: string; amount: number }[]; expenses: { label: string; amount: number }[] }[]): VendorHistory {
  const entries: VendorHistory["entries"] = [];
  const months = new Set<string>();
  for (const s of sources) {
    if (!/^\d{4}-\d{2}$/.test(s.month)) continue;
    if (s.revenue.length || s.expenses.length) months.add(s.month);
    for (const r of s.revenue) entries.push({ side: "revenue", label: r.label, month: s.month, amount: r.amount });
    for (const e of s.expenses) entries.push({ side: "expense", label: e.label, month: s.month, amount: e.amount });
  }
  return { entries, months };
}

const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const shortMonth = (k: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(k);
  return m ? SHORT.format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))) : k;
};
const monthList = (keys: string[]) => (keys.length <= 3 ? keys.map(shortMonth).join(", ") : `${keys.length} other months (${shortMonth(keys[0])} – ${shortMonth(keys[keys.length - 1])})`);
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * Recurrence for one parsed line in `month`, checked against the owner's other months. Returns the (possibly corrected)
 * one-time setting and what to tell the owner.
 */
export function classifyLine(
  line: { label: string; amount: number; oneTime?: boolean; uncertain?: boolean },
  side: LineSide,
  month: string,
  history: VendorHistory,
): { oneTime: boolean; recurrence?: RecurrenceInsight } {
  const oneTime = line.oneTime === true;
  const others = history.entries.filter((e) => e.side === side && e.month !== month && sameVendor(e.label, line.label));
  const otherMonths = [...new Set(others.map((e) => e.month))].sort();
  const available = [...history.months].filter((m) => m !== month).length;
  const what = side === "revenue" ? "this income" : "this charge";

  if (otherMonths.length) {
    const perMonth = otherMonths.map((m) => others.filter((e) => e.month === m).reduce((a, e) => a + e.amount, 0));
    const amounts = [line.amount, ...perMonth].filter((n) => n > 0);
    const lo = Math.min(...amounts);
    const hi = Math.max(...amounts);
    const varies = lo > 0 && hi / lo > 1.25 ? ` Amount varies ${money(lo)}–${money(hi)}.` : "";
    if (oneTime && !line.uncertain) {
      return { oneTime: true, recurrence: { status: "ambiguous", note: `Marked one-time, but it also appears in ${monthList(otherMonths)}.${varies} Switch to recurring if it repeats.` } };
    }
    return { oneTime: false, recurrence: { status: "confirmed", note: `Recurring — also in ${monthList(otherMonths)}.${varies}` } };
  }

  if (!month || available === 0) {
    // A single month and nothing saved to compare with: only the parser's own doubts can be raised.
    return line.uncertain
      ? {
          oneTime,
          recurrence: {
            status: "ambiguous",
            note: `Only one month to go on, so we can't tell whether ${what} repeats. ${oneTime ? "Counted as one-time for now" : "Counted as recurring for now"} — change it if that's wrong.`,
          },
        }
      : { oneTime };
  }

  if (line.uncertain) {
    // Absent from every other month: the evidence points to a one-off.
    const settled = available >= 2 ? true : oneTime;
    return {
      oneTime: settled,
      recurrence: { status: "new", note: `Not in your other ${available === 1 ? "month" : `${available} months`}, so it looks one-time${settled ? " and is counted once" : ""}. Switch to recurring if it will repeat.` },
    };
  }
  if (!oneTime && available >= 2) {
    return { oneTime, recurrence: { status: "new", note: `New this month — not in your other ${available} months. Keep it recurring only if it will repeat.` } };
  }
  return { oneTime };
}
