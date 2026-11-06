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
 *  - P&L vs. raw statements: a P&L already summarizes its month, so when a month has both a P&L and a raw credit
 *    card / bank statement, the raw transactions are sub-components of the P&L totals (the fuel card charge is inside
 *    the P&L's fuel line). They're reported as potential duplicates (`overlaps`) and left out of that month's totals
 *    until the owner confirms the statement (`confirmOverlap`). Pairing is by period within the upload, never by file
 *    name: a document the parser called OTHER is classified by `effectiveDocumentKind`, and a statement with no month
 *    yet pairs with the other side when that side covers a single month.
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
  /** What the parser recognized the document as (absent for saved documents, which don't record it). */
  documentKind?: DocumentKind;
  /**
   * A raw card / bank statement in a month that also has a P&L: the owner confirmed its lines are *not* already in
   * the P&L, so they count. Unset = they're treated as potential duplicates and left out of the month's totals.
   */
  confirmOverlap?: boolean;
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

/** Transaction-level documents whose lines a same-month P&L already summarizes. */
export const RAW_DOCUMENT_KINDS: readonly DocumentKind[] = ["CREDIT_CARD_STATEMENT", "BANK_STATEMENT"];
export const isRawDocumentKind = (k: DocumentKind | undefined): boolean => !!k && RAW_DOCUMENT_KINDS.includes(k);

/** One raw statement whose lines overlap a P&L for the same month. */
export interface StatementOverlap {
  month: string;
  statementId: string;
  statementName: string;
  documentKind: DocumentKind;
  /** The P&L statement(s) for that month. */
  pnlNames: string[];
  /** True when the owner confirmed these lines count on top of the P&L. */
  confirmed: boolean;
  /** Each raw line with the P&L line it most likely rolls up into. */
  lines: { side: "revenue" | "expense"; label: string; category: string | null; amount: number; matchedPnlLine: string | null }[];
  revenue: number;
  expenses: number;
}

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
  /** Raw card / bank statements sharing a month with a P&L (left out of the totals unless confirmed). */
  overlaps: StatementOverlap[];
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

const words = (s: string) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2));
const similar = (a: string, b: string) => {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wb = words(b);
  return [...words(a)].some((w) => wb.has(w));
};

/** A raw statement's lines, each matched to the P&L line it most likely rolls up into (same category, else a similar label). */
function overlapOf(raw: ParsedStatement, pnl: ParsedStatement[], month: string): StatementOverlap {
  const pRev = pnl.flatMap((p) => p.items.revenue);
  const pExp = pnl.flatMap((p) => p.items.expenses);
  const lines: StatementOverlap["lines"] = [
    ...raw.items.revenue.map((r) => ({
      side: "revenue" as const,
      label: r.label,
      category: null,
      amount: r.amount,
      matchedPnlLine: (pRev.find((p) => similar(p.label, r.label)) ?? pRev[0])?.label ?? null,
    })),
    ...raw.items.expenses.map((e) => ({
      side: "expense" as const,
      label: e.label,
      category: e.category,
      amount: e.amount,
      matchedPnlLine: (pExp.find((p) => norm(p.category) === norm(e.category)) ?? pExp.find((p) => similar(p.label, e.label) || similar(p.category, e.label)))?.label ?? null,
    })),
  ];
  return {
    month,
    statementId: raw.id,
    statementName: raw.name,
    documentKind: raw.documentKind ?? "OTHER",
    pnlNames: pnl.map((p) => p.name),
    confirmed: !!raw.confirmOverlap,
    lines,
    revenue: sumMoney(raw.items.revenue, (l) => l.amount),
    expenses: sumMoney(raw.items.expenses, (l) => l.amount),
  };
}

const PNL_NAME = /p\s*&\s*l|\bpnl\b|p\s+and\s+l|profit|income\s+statement|operat(?:ing|ions)\s+statement|\bp-l\b/i;
const CARD_NAME = /card|visa|amex|american\s+express|mastercard|discover|capital\s+one/i;
const BANK_NAME = /checking|savings|bank|account\s+activity|transactions?/i;

/**
 * The document kind used to pair P&Ls with raw statements. The parser's reading wins; a document it called OTHER
 * (common for generic or hash-named exports) is classified from its file / display name, else from its shape: a
 * transaction log with spend but no income reads as a raw card statement, one with both as a P&L. Saved documents
 * (no `documentKind` recorded) stay unknown and are never paired.
 */
export function effectiveDocumentKind(s: Pick<ParsedStatement, "documentKind" | "fileName" | "name" | "source" | "items" | "reviewFlags">): DocumentKind | undefined {
  if (!s.documentKind || s.documentKind !== "OTHER") return s.documentKind;
  const name = `${s.fileName ?? ""} ${s.source?.name ?? s.name}`;
  if (PNL_NAME.test(name)) return "PROFIT_AND_LOSS";
  if (CARD_NAME.test(name)) return "CREDIT_CARD_STATEMENT";
  if (BANK_NAME.test(name)) return "BANK_STATEMENT";
  if (!s.items.revenue.length && s.items.expenses.length) return "CREDIT_CARD_STATEMENT";
  // Summarized income + expenses with no flagged transactions (transaction logs carry flags) reads as a P&L.
  if (s.items.revenue.length && s.items.expenses.length && !s.reviewFlags?.length) return "PROFIT_AND_LOSS";
  return "OTHER";
}

export function aggregateStatements(statements: ParsedStatement[], fallbackType: BusinessType): BatchAggregate {
  // Group by assigned month; unassigned statements are each their own group.
  const groups = new Map<string, ParsedStatement[]>();
  for (const s of statements) {
    const g = s.month || `?${s.id}`;
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }

  // P&L ↔ raw pairing is by overlapping period within this upload, not by file name. A statement with no month yet
  // overlaps the batch's other side when that side covers a single month (the only period it can belong to).
  const kinds = new Map(statements.map((s) => [s.id, effectiveDocumentKind(s)]));
  const isPnl = (s: ParsedStatement) => kinds.get(s.id) === "PROFIT_AND_LOSS";
  const isRaw = (s: ParsedStatement) => isRawDocumentKind(kinds.get(s.id));
  const onlyMonth = (pick: (s: ParsedStatement) => boolean) => {
    const months = new Set(statements.filter((s) => s.month && pick(s)).map((s) => s.month));
    return months.size === 1 ? [...months][0] : "";
  };
  const pnlMonth = onlyMonth(isPnl);
  const rawMonth = onlyMonth(isRaw);
  const unassignedPnl = statements.filter((s) => !s.month && isPnl(s));

  let duplicateLines = 0;
  const merged: BatchMonthLines[] = [];
  const overlaps: StatementOverlap[] = [];
  for (const [g, list] of groups) {
    // A P&L already summarizes the month: same-month raw card / bank lines are its sub-components, not extra spend.
    const unassigned = g.startsWith("?");
    const pnl = unassigned
      ? isRaw(list[0]) && pnlMonth
        ? statements.filter((s) => s.month === pnlMonth && isPnl(s))
        : []
      : [...list.filter(isPnl), ...(g === rawMonth ? unassignedPnl : [])];
    const pairedMonth = unassigned ? pnlMonth : g;
    const counted = list.filter((s) => {
      if (!pnl.length || !isRaw(s)) return true;
      overlaps.push({ ...overlapOf(s, pnl, pairedMonth), documentKind: kinds.get(s.id) ?? "OTHER" });
      return !!s.confirmOverlap;
    });
    // A group holding only excluded duplicates (a month-less card statement, or a card month whose P&L has no month
    // yet) isn't a month of its own: keeping it would add an empty month to the baseline average.
    if (!counted.length) continue;
    const rev = mergeMonth(counted.map((s) => s.items.revenue), revKey);
    const exp = mergeMonth(counted.map((s) => s.items.expenses), expKey);
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
  return { businessType, ...baseline, months, monthLines: merged, monthCount: merged.length, duplicateLines, overlaps };
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

/** What the parser learned about a document, used to title it when its file name says nothing. */
export interface DocumentNameHint {
  /** "YYYY-MM" months the document covers (one, or oldest → newest for a multi-month report). */
  months?: string[];
  documentKind?: DocumentKind;
}

const SHORT_MONTH = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const LONG_MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const monthDate = (key: string) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1));

/** Hash / timestamp / id tokens: long digit runs (epoch ms), hex digests, UUID pieces. */
const isHashToken = (t: string) => /^\d{7,}$/.test(t) || (/^[0-9a-f]{12,}$/i.test(t) && /\d/.test(t)) || /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(t);
/** Words export tools and chat apps put in file names that say nothing about the document. */
const GENERIC_WORDS = new Set(
  "gemini chatgpt gpt claude copilot bard ai code file files document doc docs download downloads untitled export exported scan scanned image img upload uploaded attachment data text txt new output report tmp temp print copy final draft version v statement statements".split(" "),
);

/**
 * Whether a tidied file name is just a generated id ("gemini-code-1793995484670", "3f9a1c0e…", "Untitled document").
 * Exported so saved documents already carrying such a name can be re-titled for display.
 */
export function isGeneratedName(name: string): boolean {
  const tokens = name
    .toLowerCase()
    .split(/[^a-z0-9-]+|(?<=[a-z])-|-(?=[a-z])/)
    .filter(Boolean);
  if (!tokens.length) return true;
  const meaningful = tokens.filter((t) => !isHashToken(t) && !GENERIC_WORDS.has(t) && !/^\d{1,2}$/.test(t));
  return meaningful.length === 0;
}

/**
 * The statement's name after the owner moves it to `month`: a name we generated from the old month ("May 2026 P&L")
 * follows the new month; a name taken from the file name is kept.
 */
export function renameForMonth(s: Pick<ParsedStatement, "name" | "fileName" | "month" | "documentKind" | "source">, month: string): string {
  if (!s.fileName || s.source) return s.name;
  const hint = (m: string) => ({ months: m ? [m] : [], documentKind: s.documentKind });
  return s.name === documentName(s.fileName, hint(s.month)) ? documentName(s.fileName, hint(month)) : s.name;
}

/** "May 2026 P&L", "Jan 2026 – Jun 2026 Credit card statement", "Bank statement" — from what the parser detected. */
export function generatedDocumentName(hint: DocumentNameHint, fallback = "Statement"): string {
  const months = [...new Set((hint.months ?? []).filter((k) => /^\d{4}-\d{2}$/.test(k)))].sort();
  const kind = hint.documentKind && hint.documentKind !== "OTHER" ? DOCUMENT_KIND_LABELS[hint.documentKind] : fallback;
  if (!months.length) return kind;
  const when = months.length === 1 ? LONG_MONTH.format(monthDate(months[0])) : `${SHORT_MONTH.format(monthDate(months[0]))} – ${SHORT_MONTH.format(monthDate(months[months.length - 1]))}`;
  return `${when} ${kind}`;
}

/**
 * A tidy display name from a file name: "chase_checking__March-2026 (1).pdf" → "Chase checking March 2026".
 * Underscores and word-separating dashes become spaces, browser duplicate suffixes ("(1)", " copy") are dropped and the
 * first letter is capitalized; numeric dates such as "2026-03" are kept as they are. Hash / timestamp tokens are
 * dropped, and a name left with nothing meaningful ("gemini-code-1793995484670.txt") is titled from the detected
 * period and document type instead ("May 2026 P&L").
 */
export function documentName(fileName: string, hint: DocumentNameHint = {}): string {
  const tidy = fileName
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/\s*\(\d+\)$/, "")
    .replace(/[\s_-]+copy$/i, "")
    .replace(/_+/g, " ")
    .replace(/(?<=[a-z])-+|-+(?=[a-z])/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (isGeneratedName(tidy)) return generatedDocumentName(hint);
  const cleaned = tidy
    .split(" ")
    .filter((t) => !isHashToken(t))
    .join(" ")
    .replace(/[\s-]+$/, "")
    .trim();
  return (cleaned.charAt(0).toUpperCase() + cleaned.slice(1)).slice(0, 160) || generatedDocumentName(hint);
}
