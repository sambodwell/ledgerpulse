"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CalendarPlus, CalendarRange, Check, CheckCircle2, FileText, FolderOpen, Loader2, Pencil, Trash2, X } from "lucide-react";
import { documentRange, documentSlices, type WorkspaceDocument } from "@/lib/supabase";
import { exactMoney, statementTotals } from "@/lib/fiscal";
import { periodLabel } from "@/lib/statementPeriod";
import { statementMonthOptions } from "@/components/dashboard/StatementMonth";
import { DOC_KIND_GROUP_LABELS, DOC_KIND_ORDER, documentTitle } from "@/lib/documentGroups";
import { cn, glass, inputCls, secondaryBtn } from "@/components/ui";

type SortKey = "month-desc" | "month-asc" | "name" | "uploaded";
type GroupKey = "kind" | "year" | "none";

const GROUP_LABEL: Record<GroupKey, string> = { kind: "Document type", year: "Year", none: "No grouping" };

const SORT_LABEL: Record<SortKey, string> = {
  "month-desc": "Month (newest first)",
  "month-asc": "Month (oldest first)",
  name: "Name (A–Z)",
  uploaded: "Recently uploaded",
};

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

type ParseStatus = { key: "parsed" | "logged" | "needs-month" | "no-lines"; label: string; cls: string; Icon: typeof Check };

/**
 * Where a saved document stands: parsed into line items (and whether every month it covers is logged in the Fiscal
 * Year Tracker), parsed but still missing a month, or saved without readable line items.
 */
function parseStatus(d: WorkspaceDocument, loggedMonths: ReadonlySet<string> | undefined): ParseStatus {
  const lines = lineCount(d);
  if (!lines && !d.totals.revenue && !d.totals.expenses) return { key: "no-lines", label: "No line items", cls: "border-rose-300/30 bg-rose-500/10 text-rose-200", Icon: AlertTriangle };
  const periods = documentSlices(d).map((s) => s.period);
  if (!periods.length) return { key: "needs-month", label: "Parsed · needs a month", cls: "border-amber-300/30 bg-amber-400/10 text-amber-100", Icon: AlertTriangle };
  if (loggedMonths && periods.every((p) => loggedMonths.has(p))) return { key: "logged", label: "Parsed · in tracker", cls: "border-emerald-300/30 bg-emerald-500/10 text-emerald-200", Icon: CheckCircle2 };
  return { key: "parsed", label: "Parsed", cls: "border-indigo-300/30 bg-indigo-500/10 text-indigo-100", Icon: Check };
}

const lineCount = (d: WorkspaceDocument) =>
  d.months.length ? d.months.reduce((acc, m) => acc + m.revenue.length + m.expenses.length, 0) : (d.items?.revenue.length ?? 0) + (d.items?.expenses.length ?? 0);

/** "March 2026", or "January 2026 – June 2026" for a multi-month document. */
function rangeLabel(d: WorkspaceDocument): string | null {
  const r = documentRange(d);
  if (!r) return null;
  return r.months === 1 ? periodLabel(r.from) : `${periodLabel(r.from)} – ${periodLabel(r.to)}`;
}

/**
 * "My Documents": every document analyzed into this workspace — its parse status, the date range it covers (one
 * month, or every month of a multi-month report), totals — with rename, month re-assignment, sorting and delete.
 * Only parsed results are stored (name, months, line items, totals) — never the original file.
 */
export function DocumentsHub({
  workspaceName,
  focusId,
  docs,
  loading,
  error,
  onClose,
  onRename,
  onSetMonth,
  onDelete,
  onLogToTracker,
  loggedMonths,
}: {
  workspaceName: string;
  /** Document to scroll to and highlight (picked from the sidebar's Documents menu). */
  focusId?: string | null;
  docs: WorkspaceDocument[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRename: (id: string, name: string) => Promise<void>;
  onSetMonth: (id: string, period: string | null) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** Logs a document's totals as its month's actuals (every month, for a multi-month document); returns a confirmation line. */
  onLogToTracker?: (doc: WorkspaceDocument) => string | null;
  /** Months that already have actuals in the Fiscal Year Tracker ("YYYY-MM"). */
  loggedMonths?: ReadonlySet<string>;
}) {
  const titleId = useId();
  const [sort, setSort] = useState<SortKey>("month-desc");
  const [groupBy, setGroupBy] = useState<GroupKey>("kind");
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusId || loading) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-doc-id="${CSS.escape(focusId)}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [focusId, loading]);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const sorted = useMemo(() => {
    const out = [...docs];
    // Newest first sorts by the last month a document covers; oldest first by its first month. Undated documents go last.
    const to = (d: WorkspaceDocument) => documentRange(d)?.to ?? "";
    const from = (d: WorkspaceDocument) => documentRange(d)?.from ?? "";
    if (sort === "month-desc") out.sort((a, b) => (!to(a) && !to(b) ? 0 : !to(a) ? 1 : !to(b) ? -1 : to(b).localeCompare(to(a))) || documentTitle(a).localeCompare(documentTitle(b)));
    if (sort === "month-asc") out.sort((a, b) => (!from(a) && !from(b) ? 0 : !from(a) ? 1 : !from(b) ? -1 : from(a).localeCompare(from(b))) || documentTitle(a).localeCompare(documentTitle(b)));
    if (sort === "name") out.sort((a, b) => documentTitle(a).localeCompare(documentTitle(b), undefined, { numeric: true, sensitivity: "base" }));
    if (sort === "uploaded") out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return out;
  }, [docs, sort]);

  const grouped = useMemo((): { key: string; label: string; docs: WorkspaceDocument[] }[] => {
    if (groupBy === "none") return [{ key: "all", label: "", docs: sorted }];
    if (groupBy === "kind") return DOC_KIND_ORDER.map((k) => ({ key: k, label: DOC_KIND_GROUP_LABELS[k], docs: sorted.filter((d) => d.kind === k) })).filter((g) => g.docs.length);
    const years = new Map<string, WorkspaceDocument[]>();
    for (const d of sorted) {
      const y = documentRange(d)?.to.slice(0, 4) ?? "Undated";
      years.set(y, [...(years.get(y) ?? []), d]);
    }
    return [...years.entries()]
      .sort(([a], [b]) => (a === "Undated" ? 1 : b === "Undated" ? -1 : b.localeCompare(a)))
      .map(([k, list]) => ({ key: k, label: k === "Undated" ? "No statement month" : k, docs: list }));
  }, [sorted, groupBy]);

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    setRowError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setRowError(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const renderDoc = (d: WorkspaceDocument): ReactNode => {
                const isEditing = editing?.id === d.id;
                const lines = lineCount(d);
                const status = parseStatus(d, loggedMonths);
                const range = rangeLabel(d);
                const multi = d.months.length > 1;
                return (
                  <li key={d.id} data-doc-id={d.id} className={cn("scroll-mt-4 rounded-xl border bg-white/[0.02] p-3", d.id === focusId ? "border-indigo-400/60 ring-1 ring-indigo-400/40" : "border-white/10")}>
                    <div className="flex flex-wrap items-start gap-3">
                      <FileText className="mt-0.5 h-5 w-5 shrink-0 text-indigo-300" aria-hidden />
                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <form
                            className="flex gap-2"
                            onSubmit={async (e) => {
                              e.preventDefault();
                              if (await run(d.id, () => onRename(d.id, editing.name))) setEditing(null);
                            }}
                          >
                            <input
                              autoFocus
                              value={editing.name}
                              onChange={(e) => setEditing({ id: d.id, name: e.target.value })}
                              maxLength={160}
                              aria-label="Document name"
                              className={cn(inputCls, "py-1.5")}
                            />
                            <button type="submit" disabled={busy === d.id || !editing.name.trim()} className={cn(secondaryBtn, "px-3 py-1.5 text-xs")}>
                              {busy === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                            </button>
                            <button type="button" onClick={() => setEditing(null)} className="rounded-lg px-2 text-xs text-slate-400 hover:text-white">
                              Cancel
                            </button>
                          </form>
                        ) : (
                          <p className="flex min-w-0 items-center gap-2 font-medium text-slate-100">
                            <span className="truncate" title={d.fileName ?? documentTitle(d)}>
                              {documentTitle(d)}
                            </span>
                            <button type="button" onClick={() => setEditing({ id: d.id, name: documentTitle(d) })} aria-label={`Rename ${documentTitle(d)}`} className="shrink-0 text-slate-500 hover:text-white">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </p>
                        )}
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium", status.cls)}>
                            <status.Icon className="h-3 w-3" aria-hidden /> {status.label}
                          </span>
                          <span className={cn("inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5", range ? "text-slate-200" : "text-slate-500")}>
                            <CalendarRange className="h-3 w-3" aria-hidden /> {range ?? "No date range"}
                            {multi ? <span className="text-slate-400"> · {d.months.length} months</span> : null}
                          </span>
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {d.kind === "pasted" ? "Pasted text" : d.kind === "form" ? "Guided form" : d.fileName ?? "Statement"}
                          {d.fileSize ? ` · ${Math.max(1, Math.round(d.fileSize / 1024))} KB` : ""} · added {DATE.format(new Date(d.createdAt))}
                          {lines ? ` · ${lines} line${lines === 1 ? "" : "s"}` : ""}
                        </p>
                        <p className="mt-1 text-xs tabular-nums text-slate-300">
                          {exactMoney(d.totals.revenue)} in · {exactMoney(d.totals.expenses)} out
                          {d.totals.oneTimeExpenses ? <span className="text-slate-500"> ({exactMoney(d.totals.oneTimeExpenses)} one-time)</span> : null}
                          <span className={cn("ml-1", d.totals.revenue - d.totals.expenses < 0 ? "text-rose-300" : "text-emerald-300")}>· net {exactMoney(d.totals.revenue - d.totals.expenses)}</span>
                          {multi ? <span className="text-slate-500"> · all months</span> : null}
                        </p>
                        {multi && (
                          <details className="mt-1.5 text-xs">
                            <summary className="cursor-pointer select-none text-indigo-300 hover:text-indigo-200">Month by month</summary>
                            <ul className="mt-1.5 space-y-1 tabular-nums">
                              {d.months.map((m) => {
                                const t = statementTotals({ revenue: m.revenue, expenses: m.expenses });
                                return (
                                  <li key={m.period} className="flex flex-wrap justify-between gap-x-3 rounded-md bg-white/[0.02] px-2 py-1 text-slate-400">
                                    <span className="text-slate-300">
                                      {periodLabel(m.period)}
                                      {loggedMonths?.has(m.period) ? <span className="ml-1 text-emerald-300">· in tracker</span> : null}
                                    </span>
                                    <span>
                                      {exactMoney(t.revenue)} in · {exactMoney(t.expenses)} out
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          </details>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {/* A multi-month document's months come from its own rows, so there's no single month to pick. */}
                        {!multi && (
                          <select
                            aria-label={`Statement month for ${documentTitle(d)}`}
                            value={d.period ?? ""}
                            disabled={busy === d.id}
                            onChange={(e) => void run(d.id, () => onSetMonth(d.id, e.target.value || null))}
                            className={cn(inputCls, "w-auto py-1.5 pr-8 text-xs", !d.period && "border-amber-300/50")}
                          >
                            <option value="">No month</option>
                            {statementMonthOptions(d.period).map((k) => (
                              <option key={k} value={k}>
                                {periodLabel(k)}
                              </option>
                            ))}
                          </select>
                        )}
                        {onLogToTracker && (d.period || multi) && (
                          <button
                            type="button"
                            onClick={() => setNote(onLogToTracker(d))}
                            title={multi ? `Log each month's totals (${range}) as that month's actuals` : `Log these totals as ${periodLabel(d.period!)} actuals`}
                            className="inline-flex items-center gap-1 rounded-lg border border-indigo-300/30 px-2 py-1.5 text-xs text-indigo-100 hover:bg-indigo-400/10"
                          >
                            <CalendarPlus className="h-3.5 w-3.5" /> {multi ? `Log ${d.months.length} months` : "Log"}
                          </button>
                        )}
                        {confirmDelete === d.id ? (
                          <span className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={async () => {
                                if (await run(d.id, () => onDelete(d.id))) setConfirmDelete(null);
                              }}
                              disabled={busy === d.id}
                              className="inline-flex items-center gap-1 rounded-lg bg-rose-500 px-2 py-1.5 text-xs font-medium text-white hover:bg-rose-400 disabled:opacity-50"
                            >
                              {busy === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete
                            </button>
                            <button type="button" onClick={() => setConfirmDelete(null)} className="rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:text-white">
                              Keep
                            </button>
                          </span>
                        ) : (
                          <button type="button" onClick={() => setConfirmDelete(d.id)} aria-label={`Delete ${documentTitle(d)}`} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-rose-300">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
};

  const months = new Set(docs.flatMap((d) => documentSlices(d).map((s) => s.period))).size;
  const needsMonth = docs.filter((d) => parseStatus(d, loggedMonths).key === "needs-month").length;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn(glass, "flex max-h-[90vh] w-full max-w-3xl flex-col bg-slate-900/95")}>
        <header className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold">
              <FolderOpen className="h-5 w-5 text-indigo-300" /> Documents
            </h2>
            <p className="mt-0.5 truncate text-sm text-slate-400">
              {workspaceName} · {docs.length} document{docs.length === 1 ? "" : "s"}
              {months ? ` across ${months} month${months === 1 ? "" : "s"}` : ""}
              {needsMonth ? ` · ${needsMonth} need${needsMonth === 1 ? "s" : ""} a month` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={!!busy} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
          <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Group by
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupKey)} className={cn(inputCls, "w-auto py-1.5 pr-8 text-xs")}>
              {(Object.keys(GROUP_LABEL) as GroupKey[]).map((k) => (
                <option key={k} value={k}>
                  {GROUP_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={cn(inputCls, "w-auto py-1.5 pr-8 text-xs")}>
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          </div>
          <p className="text-[11px] text-slate-500">Saved to this workspace. Only parsed results are kept, never the original file.</p>
        </div>

        {(error || rowError) && (
          <p role="alert" className="mx-5 mt-3 rounded-lg border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
            {rowError ?? error}
          </p>
        )}
        {note && (
          <p role="status" className="mx-5 mt-3 flex items-start gap-1.5 rounded-lg border border-emerald-300/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {note}
          </p>
        )}

        <div ref={listRef} className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
          {loading ? (
            <p className="flex items-center gap-2 py-8 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading documents…
            </p>
          ) : sorted.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/15 px-4 py-8 text-center text-sm text-slate-400">
              No documents in this workspace yet. Statements and reports you upload here appear in this list with their parse status and the months they cover.
            </p>
          ) : (
            <div className="space-y-5">
              {grouped.map((g) => (
                <section key={g.key} aria-label={g.label || undefined}>
                  {g.label && (
                    <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {g.label} <span className="rounded-full bg-white/10 px-1.5 font-normal tabular-nums text-slate-400">{g.docs.length}</span>
                    </h3>
                  )}
                  <ul className="space-y-2">{g.docs.map(renderDoc)}</ul>
                </section>
              ))}
            </div>
          )}
        </div>
        <p className="border-t border-white/10 px-5 py-3 text-[11px] text-slate-500">
          Deleting a document removes it from this list only; months already logged in the Fiscal Year Tracker keep their totals.
        </p>
      </section>
    </div>
  );
}
