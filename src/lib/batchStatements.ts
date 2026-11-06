/**
 * Multi-statement uploads: combine several parsed statements into one reviewable set of line items plus one actual
 * per month, without double counting. Pure and deterministic.
 *
 * Rules:
 *  - The same file selected twice (same SHA-256) is only read once (handled by the uploader).
 *  - A multi-month document (H1, quarterly, annual report) arrives already split into one statement per calendar
 *    month it lists, so a single file seeds several months.
 *  - Statements are grouped by the month they cover. Within a month, statements are added together (e.g. a checking
 *    account + a credit card), but a line that appears identically in two different statements for that month
 *    (same label, category, amount and recurrence) is counted once — that's an overlapping or re-exported statement.
 *  - Each month's total becomes that month's actual for the Fiscal Year Tracker.
 *  - The forward baseline averages recurring lines across months (sum ÷ months covered), so three months of
 *    statements don't triple the monthly figures. Past one-time items are logged in their month but left out of the
 *    forward baseline. A single month keeps its lines exactly as parsed.
 */

import { statementTotals, sumMoney, type MonthActual } from "@/lib/fiscal";
import { isExtractedLineItems, round2, type BusinessType, type ExpenseLine, type ExtractedLineItems, type RevenueLine } from "@/lib/schemas";
import { isStatementPeriod, type StatementPeriod } from "@/lib/statementPeriod";

export interface ParsedStatement {
  /** Local id for this batch. */
  id: string;
  name: string;
  fileName: string | null;
  fileSize: number | null;
  contentHash: string | null;
  kind: "statement" | "pasted";
  items: ExtractedLineItems;
  /** Month detected from the document ("" = not found). */
  detected: string;
  /** Month the owner assigned ("" = unassigned). */
  month: string;
  /**
   * Set when this statement is one month of a multi-month document (an H1 / quarterly / annual report): the id
   * shared by every month read from that one file, and the file's display name. One file → one saved document.
   */
  source?: { id: string; name: string };
  /** Raw transactions the parser asked the owner to double-check (unrecognized merchants, duplicates, unusual charges). */
  reviewFlags?: ReviewFlag[];
}

/** What the parser recognized the document as. */
export const DOCUMENT_KINDS = ["BANK_STATEMENT", "CREDIT_CARD_STATEMENT", "PROFIT_AND_LOSS", "OTHER"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const REVIEW_FLAG_KINDS = ["UNRECOGNIZED_MERCHANT", "DUPLICATE_TRANSACTION", "UNUSUAL_CHARGE"] as const;
export type ReviewFlagKind = (typeof REVIEW_FLAG_KINDS)[number];

export const REVIEW_FLAG_LABELS: Record<ReviewFlagKind, string> = {
  UNRECOGNIZED_MERCHANT: "Unrecognized merchant",
  DUPLICATE_TRANSACTION: "Possible duplicate",
  UNUSUAL_CHARGE: "Unusual charge",
};

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  BANK_STATEMENT: "Bank statement",
  CREDIT_CARD_STATEMENT: "Credit card statement",
  PROFIT_AND_LOSS: "P&L",
  OTHER: "Document",
};

export interface ReviewFlag {
  kind: ReviewFlagKind;
  merchant: string;
  /** Label of the parsed line the transaction was grouped into ("" / absent = unknown; matched by merchant name instead). */
  lineLabel?: string;
  amount: number;
  /** "YYYY-MM-DD" or "". */
  date: string;
  transactionId: string;
  note: string;
}

/** What `/api/analyze` mode "extract" returns, validated. */
export interface ExtractResult {
  items: ExtractedLineItems;
  period: StatementPeriod | null;
  /** Two or more calendar months when the document spans several (oldest first); otherwise empty. */
  months: { period: StatementPeriod; items: ExtractedLineItems }[];
  documentKind: DocumentKind;
  /** Closing balance of a bank (checking / savings) statement; null otherwise. */
  endingBalance: number | null;
  reviewFlags: ReviewFlag[];
}

function isReviewFlag(v: unknown): v is ReviewFlag {
  if (!v || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  return (REVIEW_FLAG_KINDS as readonly unknown[]).includes(f.kind) && typeof f.merchant === "string" && typeof f.amount === "number" && typeof f.note === "string";
}

export function parseExtractResponse(data: unknown): ExtractResult | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { items?: unknown; period?: unknown; months?: unknown; documentKind?: unknown; endingBalance?: unknown; reviewFlags?: unknown };
  if (!isExtractedLineItems(d.items)) return null;
  const months = Array.isArray(d.months)
    ? d.months.filter((m): m is ExtractResult["months"][number] => !!m && typeof m === "object" && isStatementPeriod((m as { period?: unknown }).period) && isExtractedLineItems((m as { items?: unknown }).items))
    : [];
  return {
    items: d.items,
    period: isStatementPeriod(d.period) ? d.period : null,
    months: months.length >= 2 ? months : [],
    documentKind: (DOCUMENT_KINDS as readonly unknown[]).includes(d.documentKind) ? (d.documentKind as DocumentKind) : "OTHER",
    endingBalance: typeof d.endingBalance === "number" && Number.isFinite(d.endingBalance) ? d.endingBalance : null,
    reviewFlags: Array.isArray(d.reviewFlags)
      ? d.reviewFlags.filter(isReviewFlag).map((f) => ({
          ...f,
          date: typeof f.date === "string" ? f.date : "",
          transactionId: typeof f.transactionId === "string" ? f.transactionId : "",
          lineLabel: typeof f.lineLabel === "string" ? f.lineLabel : "",
        }))
      : [],
  };
}

export interface BatchMonth {
  /** "YYYY-MM", or "" for statements without a month (each is its own group). */
  key: string;
  statementIds: string[];
  actual: MonthActual;
}

/** One month's merged lines (statements for the same month added together, overlapping lines counted once). */
export interface BatchMonthLines {
  /** "YYYY-MM", or "" for a statement without a month. */
  key: string;
  statementIds: string[];
  revenue: RevenueLine[];
  expenses: ExpenseLine[];
}

export interface BatchAggregate {
  businessType: BusinessType;
  /** The forward baseline: one month's lines as parsed, or recurring lines averaged across several months. */
  revenue: RevenueLine[];
  expenses: ExpenseLine[];
  months: BatchMonth[];
  /** Each month's own itemized lines, oldest first (same order as `months`). */
  monthLines: BatchMonthLines[];
  /** Distinct month groups averaged into the baseline. */
  monthCount: number;
  /** Identical lines found in two statements for the same month and counted once. */
  duplicateLines: number;
  /** Past one-time lines left out of the forward baseline (they're still in that month's actual). */
  excludedOneTime: number;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const cents = (n: number) => Math.round(n * 100);
const revKey = (r: RevenueLine) => `${norm(r.label)}|${r.oneTime ? 1 : 0}`;
const expKey = (e: ExpenseLine) => `${norm(e.label)}|${norm(e.category)}|${e.oneTime ? 1 : 0}`;

/** Lines from several statements for one month; exact duplicates across *different* statements are kept once. */
function mergeMonth<T extends { amount: number }>(perStatement: T[][], key: (t: T) => string): { lines: T[]; dupes: number } {
  const seen = new Map<string, number>(); // key|cents → statement index that contributed it
  const lines: T[] = [];
  let dupes = 0;
  perStatement.forEach((list, si) => {
    for (const l of list) {
      const k = `${key(l)}|${cents(l.amount)}`;
      const from = seen.get(k);
      if (from !== undefined && from !== si) {
        dupes++;
        continue;
      }
      seen.set(k, si);
      lines.push(l);
    }
  });
  return { lines, dupes };
}

/** Recurring lines across months → one line per label with the monthly average. */
function averageLines<T extends { amount: number; label: string; oneTime?: boolean }>(groups: T[][], key: (t: T) => string, combine: (first: T, all: T[], avg: number) => T) {
  const byKey = new Map<string, T[]>();
  const order: string[] = [];
  for (const g of groups)
    for (const l of g) {
      if (l.oneTime) continue;
      const k = key(l);
      if (!byKey.has(k)) {
        byKey.set(k, []);
        order.push(k);
      }
      byKey.get(k)!.push(l);
    }
  return order.map((k) => {
    const all = byKey.get(k)!;
    return combine(all[0], all, round2(sumMoney(all, (l) => l.amount) / groups.length));
  });
}

export function aggregateStatements(statements: ParsedStatement[], fallbackType: BusinessType): BatchAggregate {
  // Group by assigned month; unassigned statements are each their own group.
  const groups = new Map<string, ParsedStatement[]>();
  for (const s of statements) {
    const g = s.month || `?${s.id}`;
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }

  let duplicateLines = 0;
  const merged: BatchMonthLines[] = [];
  for (const [g, list] of groups) {
    const rev = mergeMonth(list.map((s) => s.items.revenue), revKey);
    const exp = mergeMonth(list.map((s) => s.items.expenses), expKey);
    duplicateLines += rev.dupes + exp.dupes;
    merged.push({ key: g.startsWith("?") ? "" : g, statementIds: list.map((s) => s.id), revenue: rev.lines, expenses: exp.lines });
  }
  merged.sort((a, b) => (a.key || "9999").localeCompare(b.key || "9999"));

  const months: BatchMonth[] = merged.map((m) => ({ key: m.key, statementIds: m.statementIds, actual: statementTotals({ revenue: m.revenue, expenses: m.expenses }) }));

  // Most common detected business type wins.
  const counts = new Map<BusinessType, number>();
  for (const s of statements) counts.set(s.items.businessType, (counts.get(s.items.businessType) ?? 0) + 1);
  const businessType = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallbackType;

  const baseline = monthlyBaseline(merged);
  return { businessType, ...baseline, months, monthLines: merged, monthCount: merged.length, duplicateLines };
}

/**
 * Several months' itemized lines → the forward monthly baseline. One month is kept exactly as given; for two or more,
 * recurring lines are averaged per label over every month (sum ÷ months, so a line missing from a month pulls its
 * average down) and past one-time lines are left out (they're still in their own month's actual).
 */
export function monthlyBaseline(months: { revenue: RevenueLine[]; expenses: ExpenseLine[] }[]): { revenue: RevenueLine[]; expenses: ExpenseLine[]; excludedOneTime: number } {
  if (months.length <= 1) return { revenue: months[0]?.revenue ?? [], expenses: months[0]?.expenses ?? [], excludedOneTime: 0 };
  const revenue = averageLines(
    months.map((m) => m.revenue),
    revKey,
    (first, all, avg) => {
      const total = all.reduce((acc, l) => acc + l.amount, 0);
      const margin = total > 0 ? all.reduce((acc, l) => acc + l.margin * l.amount, 0) / total : first.margin;
      return { label: first.label, amount: avg, margin: Math.round(margin * 1000) / 1000 };
    },
  );
  const expenses = averageLines(
    months.map((m) => m.expenses),
    expKey,
    (first, _all, avg) => ({ label: first.label, amount: avg, category: first.category }),
  );
  const excludedOneTime = months.reduce((acc, m) => acc + m.revenue.filter((r) => r.oneTime).length + m.expenses.filter((e) => e.oneTime).length, 0);
  return { revenue, expenses, excludedOneTime };
}

/** SHA-256 of a file's bytes, hex. Null when Web Crypto isn't available (e.g. an insecure origin). */
export async function hashFile(file: Blob): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/**
 * A tidy display name from a file name: "chase_checking__March-2026 (1).pdf" → "Chase checking March 2026".
 * Underscores and word-separating dashes become spaces, browser duplicate suffixes ("(1)", " copy") are dropped and the
 * first letter is capitalized; numeric dates such as "2026-03" are kept as they are.
 */
export function documentName(fileName: string): string {
  const tidy = fileName
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/\s*\(\d+\)$/, "")
    .replace(/[\s_-]+copy$/i, "")
    .replace(/_+/g, " ")
    .replace(/(?<=[a-z])-+|-+(?=[a-z])/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (tidy.charAt(0).toUpperCase() + tidy.slice(1)).slice(0, 160) || "Statement";
}
