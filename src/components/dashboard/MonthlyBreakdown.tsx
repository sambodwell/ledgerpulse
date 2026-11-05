"use client";

import { useMemo, useState } from "react";
import { CalendarRange, CheckCircle2, ChevronDown, FileText, Loader2, RefreshCcw, Repeat, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { documentSlices, type WorkspaceDocument } from "@/lib/supabase";
import { exactMoney, statementTotals, type MonthActual } from "@/lib/fiscal";
import { periodLabel } from "@/lib/statementPeriod";
import type { ExpenseLine, RevenueLine } from "@/lib/schemas";
import { cn, glass, secondaryBtn } from "@/components/ui";

export type LineSide = "revenue" | "expenses";

/** Where a line lives, so it can be removed from the right document and month. */
export interface LineRef {
  doc: WorkspaceDocument;
  period: string;
  side: LineSide;
  index: number;
}

interface FeedLine<T> {
  ref: LineRef;
  line: T;
}

interface FeedMonth {
  period: string;
  revenue: FeedLine<RevenueLine>[];
  expenses: FeedLine<ExpenseLine>[];
  docs: WorkspaceDocument[];
  totals: MonthActual;
}

/** Every dated document slice → one entry per calendar month, oldest first (Jan → Oct …). */
export function buildMonthFeed(docs: WorkspaceDocument[]): { months: FeedMonth[]; undated: number } {
  const byMonth = new Map<string, FeedMonth>();
  let undated = 0;
  for (const doc of docs) {
    const slices = documentSlices(doc);
    if (!slices.length) {
      undated++;
      continue;
    }
    for (const sl of slices) {
      const m = byMonth.get(sl.period) ?? { period: sl.period, revenue: [], expenses: [], docs: [], totals: { revenue: 0, expenses: 0 } };
      sl.items.revenue.forEach((line, index) => m.revenue.push({ line, ref: { doc, period: sl.period, side: "revenue", index } }));
      sl.items.expenses.forEach((line, index) => m.expenses.push({ line, ref: { doc, period: sl.period, side: "expenses", index } }));
      if (!m.docs.includes(doc)) m.docs.push(doc);
      byMonth.set(sl.period, m);
    }
  }
  const months = [...byMonth.values()]
    .map((m) => ({ ...m, totals: statementTotals({ revenue: m.revenue.map((r) => r.line), expenses: m.expenses.map((e) => e.line) }) }))
    .sort((a, b) => a.period.localeCompare(b.period));
  return { months, undated };
}

const sameCents = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

/**
 * Monthly breakdown: every month the workspace's documents cover, in calendar order, each split into two columns —
 * revenue on the left, expenses on the right — with inline inspection (click a line) and remove controls. Removing a
 * line updates the saved document; the month can then be re-synced to the tracker and the report re-analyzed.
 */
export function MonthlyBreakdown({
  docs,
  revenueLabel,
  expensesLabel,
  loggedActuals,
  onRemoveLine,
  onSyncMonth,
  onReanalyze,
  reanalyzing,
  stale,
  className,
}: {
  docs: WorkspaceDocument[];
  revenueLabel: string;
  expensesLabel: string;
  /** Tracker actuals, to flag months whose logged totals differ from their documents. */
  loggedActuals?: Record<string, MonthActual>;
  onRemoveLine: (ref: LineRef) => Promise<void>;
  /** Logs a month's document totals into the tracker; undefined while the tracker isn't ready. */
  onSyncMonth?: (period: string, actual: MonthActual) => void;
  /** Re-runs the analysis across every saved month. */
  onReanalyze?: () => void;
  reanalyzing?: boolean;
  /** Documents changed since the current report was generated. */
  stale?: boolean;
  className?: string;
}) {
  const { months, undated } = useMemo(() => buildMonthFeed(docs), [docs]);
  const years = useMemo(() => [...new Set(months.map((m) => m.period.slice(0, 4)))], [months]);
  const [year, setYear] = useState<string>("all");
  const shown = year === "all" ? months : months.filter((m) => m.period.startsWith(year));
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!months.length) return null;

  const remove = async (key: string, ref: LineRef) => {
    setBusy(key);
    setError(null);
    try {
      await onRemoveLine(ref);
      setOpen(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove that line.");
    } finally {
      setBusy(null);
    }
  };

  const range = months.length === 1 ? periodLabel(months[0].period) : `${periodLabel(months[0].period)} – ${periodLabel(months[months.length - 1].period)}`;

  return (
    <section aria-label="Monthly breakdown" className={cn(glass, "p-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <CalendarRange className="h-5 w-5 text-indigo-300" aria-hidden /> Monthly breakdown
          </h2>
          <p className="mt-0.5 text-sm text-slate-400">
            {months.length} month{months.length === 1 ? "" : "s"} from your saved documents · {range}
            {undated ? ` · ${undated} undated document${undated === 1 ? "" : "s"} not shown` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {years.length > 1 && (
            <div role="radiogroup" aria-label="Year" className="inline-flex rounded-lg border border-white/10 p-0.5 text-xs">
              {["all", ...years].map((y) => (
                <button
                  key={y}
                  type="button"
                  role="radio"
                  aria-checked={year === y}
                  onClick={() => setYear(y)}
                  className={cn("rounded-md px-2.5 py-1 font-medium tabular-nums", year === y ? "bg-indigo-500/80 text-white" : "text-slate-400 hover:text-slate-200")}
                >
                  {y === "all" ? "All" : y}
                </button>
              ))}
            </div>
          )}
          {onReanalyze && (
            <button type="button" onClick={onReanalyze} disabled={reanalyzing} className={cn(secondaryBtn, "px-3 py-1.5 text-xs", stale && "border-amber-300/40 text-amber-100")}>
              {reanalyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Repeat className="h-3.5 w-3.5" />}
              Re-analyze all {months.length} months
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {error}
        </p>
      )}

      {/* Column headings once, so every month below reads Revenue | Expenses. */}
      <div className="mt-5 hidden grid-cols-2 gap-4 px-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 md:grid" aria-hidden>
        <span>{revenueLabel}</span>
        <span>{expensesLabel}</span>
      </div>

      <ol className="mt-2 space-y-4">
        {shown.map((m) => {
          const logged = loggedActuals?.[m.period];
          const differs = !!logged && (!sameCents(logged.revenue, m.totals.revenue) || !sameCents(logged.expenses, m.totals.expenses));
          const net = m.totals.revenue - m.totals.expenses;
          return (
            <li key={m.period} className="rounded-xl border border-white/10 bg-white/[0.02]">
              <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-white/5 px-4 py-2.5">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                  {periodLabel(m.period)}
                  {logged && !differs && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
                      <CheckCircle2 className="h-3 w-3" aria-hidden /> In tracker
                    </span>
                  )}
                </h3>
                <p className="flex flex-wrap items-center gap-x-3 text-xs tabular-nums text-slate-400">
                  <span>{exactMoney(m.totals.revenue)} in</span>
                  <span>{exactMoney(m.totals.expenses)} out</span>
                  <span className={cn("inline-flex items-center gap-1 font-medium", net < 0 ? "text-rose-300" : "text-emerald-300")}>
                    {net < 0 ? <TrendingDown className="h-3 w-3" aria-hidden /> : <TrendingUp className="h-3 w-3" aria-hidden />} net {exactMoney(net)}
                  </span>
                </p>
              </header>
              {(differs || (!logged && onSyncMonth)) && onSyncMonth && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-4 py-2 text-[11px] text-slate-400">
                  <span>
                    {differs
                      ? `Tracker has ${exactMoney(logged!.revenue)} in · ${exactMoney(logged!.expenses)} out for this month.`
                      : "Not logged in the Fiscal Year Tracker yet."}
                  </span>
                  <button type="button" onClick={() => onSyncMonth(m.period, m.totals)} className="inline-flex items-center gap-1 rounded-md border border-indigo-300/30 px-2 py-0.5 text-indigo-100 hover:bg-indigo-400/10">
                    <RefreshCcw className="h-3 w-3" aria-hidden /> {differs ? "Sync tracker to documents" : "Log in tracker"}
                  </button>
                </div>
              )}
              <div className="grid gap-4 p-3 md:grid-cols-2">
                <LineColumn
                  title={revenueLabel}
                  lines={m.revenue}
                  empty="No revenue lines this month."
                  open={open}
                  setOpen={setOpen}
                  busy={busy}
                  onRemove={remove}
                  detail={(l) => [Number.isFinite(l.margin) && l.margin !== 1 ? `${Math.round(l.margin * 100)}% margin` : null]}
                />
                <LineColumn
                  title={expensesLabel}
                  lines={m.expenses}
                  empty="No expense lines this month."
                  open={open}
                  setOpen={setOpen}
                  busy={busy}
                  onRemove={remove}
                  detail={(l) => [l.category && l.category.toLowerCase() !== l.label.toLowerCase() ? l.category : null, l.flag ?? null]}
                />
              </div>
              {m.docs.length > 1 && (
                <p className="border-t border-white/5 px-4 py-2 text-[11px] text-slate-500">
                  Combined from {m.docs.length} documents: {m.docs.map((d) => d.name).join(", ")}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function LineColumn<T extends RevenueLine | ExpenseLine>({
  title,
  lines,
  empty,
  open,
  setOpen,
  busy,
  onRemove,
  detail,
}: {
  title: string;
  lines: FeedLine<T>[];
  empty: string;
  open: string | null;
  setOpen: (k: string | null) => void;
  busy: string | null;
  onRemove: (key: string, ref: LineRef) => Promise<void>;
  detail: (l: T) => (string | null)[];
}) {
  const total = statementTotals({ revenue: [], expenses: lines.map((l) => l.line) }).expenses;
  return (
    <div className="min-w-0">
      <p className="mb-1 flex items-center justify-between px-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 md:hidden">
        {title} <span className="tabular-nums normal-case">{exactMoney(total)}</span>
      </p>
      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-xs text-slate-500">{empty}</p>
      ) : (
        <ul className="max-h-72 divide-y divide-white/5 overflow-y-auto overscroll-contain rounded-lg border border-white/5 text-sm [scrollbar-gutter:stable]">
          {lines.map(({ line, ref }) => {
            const key = `${ref.doc.id}|${ref.period}|${ref.side}|${ref.index}`;
            const isOpen = open === key;
            const extra = detail(line).filter(Boolean);
            return (
              <li key={key}>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : key)}
                    aria-expanded={isOpen}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white/[0.03]"
                  >
                    <ChevronDown className={cn("h-3 w-3 shrink-0 text-slate-500 transition", isOpen && "rotate-180")} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-slate-300" title={line.label}>
                      {line.label}
                      {line.oneTime && <span className="ml-1.5 rounded bg-amber-400/15 px-1 text-[10px] text-amber-200">one-time</span>}
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-100">{exactMoney(line.amount)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void onRemove(key, ref)}
                    disabled={busy !== null}
                    aria-label={`Remove ${line.label} from ${periodLabel(ref.period)}`}
                    title="Remove this line from the saved document"
                    className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded text-slate-500 hover:bg-white/5 hover:text-rose-300 disabled:opacity-40"
                  >
                    {busy === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
                {isOpen && (
                  <dl className="space-y-0.5 bg-white/[0.02] px-8 pb-2 pt-1 text-[11px] text-slate-400">
                    {extra.map((x) => (
                      <dd key={x}>{x}</dd>
                    ))}
                    <dd className="flex items-center gap-1">
                      <FileText className="h-3 w-3 shrink-0" aria-hidden /> From “{ref.doc.name}”
                    </dd>
                    <dd>{line.oneTime ? "One-time — counted in this month, left out of the monthly baseline." : "Recurring — feeds the monthly baseline."}</dd>
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
