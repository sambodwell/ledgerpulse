/**
 * Vendor price creep & leakage detection. Pure and deterministic (runs client-side, no AI credits).
 *
 * Cross-references recurring vendor / software / utility lines across every month in the workspace's saved statement
 * history and surfaces vendors whose monthly bill has risen from the earliest month it appears to the latest one.
 *
 * Rules:
 *  - Only recurring lines count (one-time charges are never "creep").
 *  - Lines are matched across months by a normalized vendor key (case, punctuation, reference numbers, card suffixes,
 *    phone numbers and corporate suffixes are ignored) plus the line's category, so "ADOBE *CREATIVE CLD #4471" and
 *    "Adobe Creative Cld" are the same vendor but "Google Ads" (Marketing) and "Google Workspace" (Software) are not.
 *  - Several charges from one vendor in the same month are added together — that month's bill.
 *  - A vendor needs at least two distinct months. Creep = latest month's bill vs. the earliest month's bill.
 *  - Usage-driven categories (utilities, fuel, supplies, groceries…) naturally wobble, so they need a bigger rise
 *    before they're flagged.
 */

import { exactMoney } from "@/lib/fiscal";
import { periodLabel } from "@/lib/statementPeriod";
import { round2, type AuditFlag, type ExpenseLine, type Severity } from "@/lib/schemas";

export interface VendorPricePoint {
  /** "YYYY-MM" */
  period: string;
  amount: number;
}

export interface VendorCreep {
  key: string;
  /** Display name (the label used in the most recent month). */
  vendor: string;
  category: string;
  /** Every month the vendor appears in, oldest first. */
  history: VendorPricePoint[];
  from: VendorPricePoint;
  to: VendorPricePoint;
  /** Monthly increase, latest − earliest. */
  increase: number;
  /** Fractional increase, e.g. 0.18 = +18%. */
  pct: number;
  /** Increase × 12: what the creep costs per year at the new rate. */
  annualImpact: number;
  /** Extra paid so far: Σ (each later month's bill − the original bill), counting only months above it. */
  leakedToDate: number;
  severity: Severity;
}

export interface MonthLines {
  /** "YYYY-MM" */
  period: string;
  expenses: Pick<ExpenseLine, "label" | "amount" | "category" | "oneTime">[];
}

/** Categories / labels whose bill is driven by usage, not a fixed price. They need a larger rise to count as creep. */
const VARIABLE_RE = /utilit|electric|water|gas\b|fuel|diesel|groceri|supplies|material|dining|restaurant|transport|uber|lyft|parking|toll|shipping|freight|inventory|cost of goods|cogs|payroll|wage|contractor|subcontract|commission|tax/;

const MIN_PCT_FIXED = 0.05;
const MIN_PCT_VARIABLE = 0.15;
const MIN_INCREASE = 2; // dollars / month — ignore rounding-level wobble

const STOP_WORDS = new Set(["inc", "llc", "ltd", "co", "corp", "corporation", "company", "the", "pos", "debit", "credit", "ach", "purchase", "recurring", "payment", "pmt", "autopay", "online", "www", "com", "card", "visa", "mc"]);

/** "ADOBE *CREATIVE CLD 800-833-6687 #4471" → "adobe creative cld". */
export function vendorKey(label: string): string {
  const tokens = label
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, " ") // phone numbers
    .replace(/#\s*\w+/g, " ") // reference / store numbers
    .replace(/\b(x{2,}|\*{2,})\d+\b/g, " ") // masked card suffixes
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, " ") // dates
    .replace(/[^a-z0-9& ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP_WORDS.has(t) && !/^\d+$/.test(t));
  return tokens.slice(0, 3).join(" ");
}

function severityFor(pct: number, increase: number): Severity {
  if (pct >= 0.2 || increase >= 100) return "HIGH";
  if (pct >= 0.1 || increase >= 25) return "MEDIUM";
  return "LOW";
}

/** Detects price creep across months. Results are sorted by monthly increase, largest first. */
export function detectVendorCreep(months: MonthLines[]): VendorCreep[] {
  // key → period → { amount, label }
  const byVendor = new Map<string, { category: string; perMonth: Map<string, { amount: number; label: string }> }>();
  for (const m of months) {
    if (!/^\d{4}-\d{2}$/.test(m.period)) continue;
    for (const e of m.expenses) {
      if (e.oneTime || !(e.amount > 0)) continue;
      const vk = vendorKey(e.label);
      if (!vk) continue;
      const category = (e.category || "Other").trim();
      const key = `${vk}|${category.toLowerCase()}`;
      const v = byVendor.get(key) ?? { category, perMonth: new Map() };
      const cur = v.perMonth.get(m.period);
      v.perMonth.set(m.period, { amount: round2((cur?.amount ?? 0) + e.amount), label: e.label.trim() });
      byVendor.set(key, v);
    }
  }

  const out: VendorCreep[] = [];
  for (const [key, v] of byVendor) {
    if (v.perMonth.size < 2) continue;
    const history = [...v.perMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, x]) => ({ period, amount: x.amount }));
    const from = history[0];
    const to = history[history.length - 1];
    const increase = round2(to.amount - from.amount);
    const pct = from.amount > 0 ? increase / from.amount : 0;
    const variable = VARIABLE_RE.test(`${v.category} ${key}`.toLowerCase());
    if (increase < MIN_INCREASE || pct < (variable ? MIN_PCT_VARIABLE : MIN_PCT_FIXED)) continue;
    const leakedToDate = round2(history.slice(1).reduce((acc, p) => acc + Math.max(0, p.amount - from.amount), 0));
    out.push({
      key,
      vendor: v.perMonth.get(to.period)!.label,
      category: v.category,
      history,
      from,
      to,
      increase,
      pct,
      annualImpact: round2(increase * 12),
      leakedToDate,
      severity: severityFor(pct, increase),
    });
  }
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.increase - a.increase);
}

/** The alert sentence: "Your Adobe bill went from $52.99 in Mar 2026 to $64.99 in Sep 2026 (+22.6% creep)." */
export function creepHeadline(c: VendorCreep): string {
  return `Your ${c.vendor} bill went from ${exactMoney(c.from.amount)} in ${periodLabel(c.from.period)} to ${exactMoney(c.to.amount)} in ${periodLabel(c.to.period)} (+${(c.pct * 100).toFixed(1)}% creep).`;
}

/** Title used for the audit flag and the ROI & Savings Tracker entry (stable across re-renders, so "Implemented" sticks). */
export const creepTitle = (c: VendorCreep) => `Price creep: ${c.vendor}`;

/** A creep alert as an audit flag, so it can open the audit deep-dive and be marked Implemented (realized ROI). */
export function creepToFlag(c: VendorCreep): AuditFlag {
  return {
    title: creepTitle(c),
    severity: c.severity,
    message: `${creepHeadline(c)} That's ${exactMoney(c.increase)}/mo (${exactMoney(c.annualImpact)}/yr) more than you were paying${c.leakedToDate > 0 ? `, and ${exactMoney(c.leakedToDate)} in extra charges so far` : ""}. Renegotiate, downgrade, or re-quote to win back the increase.`,
    potentialSavings: c.increase,
    source: "PRICE_CREEP",
  };
}
