"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { CalendarPlus, Check, FileText, FolderOpen, Loader2, Pencil, Trash2, X } from "lucide-react";
import type { WorkspaceDocument } from "@/lib/supabase";
import { exactMoney } from "@/lib/fiscal";
import { periodLabel } from "@/lib/statementPeriod";
import { statementMonthOptions } from "@/components/dashboard/StatementMonth";
import { cn, glass, inputCls, secondaryBtn } from "@/components/ui";

type SortKey = "month-desc" | "month-asc" | "name" | "uploaded";

const SORT_LABEL: Record<SortKey, string> = {
  "month-desc": "Month (newest first)",
  "month-asc": "Month (oldest first)",
  name: "Name (A–Z)",
  uploaded: "Recently uploaded",
};

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * "My Documents": every document analyzed into this workspace, with rename, month re-assignment, sorting and delete.
 * Only parsed results are stored (name, month, line items, totals) — never the original file.
 */
export function DocumentsHub({
  workspaceName,
  docs,
  loading,
  error,
  onClose,
  onRename,
  onSetMonth,
  onDelete,
  onLogToTracker,
}: {
  workspaceName: string;
  docs: WorkspaceDocument[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRename: (id: string, name: string) => Promise<void>;
  onSetMonth: (id: string, period: string | null) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** Logs a document's totals as its month's actuals; returns a confirmation line. */
  onLogToTracker?: (doc: WorkspaceDocument) => string | null;
}) {
  const titleId = useId();
  const [sort, setSort] = useState<SortKey>("month-desc");
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
    const byMonth = (a: WorkspaceDocument, b: WorkspaceDocument) => (a.period ?? "").localeCompare(b.period ?? "");
    if (sort === "month-desc") out.sort((a, b) => (!a.period ? 1 : !b.period ? -1 : -byMonth(a, b)) || a.name.localeCompare(b.name));
    if (sort === "month-asc") out.sort((a, b) => (!a.period ? 1 : !b.period ? -1 : byMonth(a, b)) || a.name.localeCompare(b.name));
    if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    if (sort === "uploaded") out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return out;
  }, [docs, sort]);

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

  const months = new Set(docs.map((d) => d.period).filter(Boolean)).size;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn(glass, "flex max-h-[90vh] w-full max-w-3xl flex-col bg-slate-900/95")}>
        <header className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold">
              <FolderOpen className="h-5 w-5 text-indigo-300" /> My Documents
            </h2>
            <p className="mt-0.5 truncate text-sm text-slate-400">
              {workspaceName} · {docs.length} document{docs.length === 1 ? "" : "s"}
              {months ? ` across ${months} month${months === 1 ? "" : "s"}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={!!busy} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
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
          <p className="text-[11px] text-slate-500">Only parsed results are kept — never the original file.</p>
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

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
          {loading ? (
            <p className="flex items-center gap-2 py-8 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading documents…
            </p>
          ) : sorted.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/15 px-4 py-8 text-center text-sm text-slate-400">
              No documents yet. Statements you analyze in this workspace appear here, so you can find, rename and organize them by month.
            </p>
          ) : (
            <ul className="space-y-2">
              {sorted.map((d) => {
                const isEditing = editing?.id === d.id;
                const lines = (d.items?.revenue.length ?? 0) + (d.items?.expenses.length ?? 0);
                return (
                  <li key={d.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
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
                            <span className="truncate" title={d.name}>
                              {d.name}
                            </span>
                            <button type="button" onClick={() => setEditing({ id: d.id, name: d.name })} aria-label={`Rename ${d.name}`} className="shrink-0 text-slate-500 hover:text-white">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </p>
                        )}
                        <p className="mt-0.5 text-xs text-slate-500">
                          {d.kind === "pasted" ? "Pasted text" : d.kind === "form" ? "Guided form" : d.fileName ?? "Statement"}
                          {d.fileSize ? ` · ${Math.max(1, Math.round(d.fileSize / 1024))} KB` : ""} · added {DATE.format(new Date(d.createdAt))}
                          {lines ? ` · ${lines} line${lines === 1 ? "" : "s"}` : ""}
                        </p>
                        <p className="mt-1 text-xs tabular-nums text-slate-300">
                          {exactMoney(d.totals.revenue)} in · {exactMoney(d.totals.expenses)} out
                          {d.totals.oneTimeExpenses ? <span className="text-slate-500"> ({exactMoney(d.totals.oneTimeExpenses)} one-time)</span> : null}
                          <span className={cn("ml-1", d.totals.revenue - d.totals.expenses < 0 ? "text-rose-300" : "text-emerald-300")}>· net {exactMoney(d.totals.revenue - d.totals.expenses)}</span>
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label={`Statement month for ${d.name}`}
                          value={d.period ?? ""}
                          disabled={busy === d.id}
                          onChange={(e) => void run(d.id, () => onSetMonth(d.id, e.target.value || null))}
                          className={cn(inputCls, "w-auto py-1.5 pr-8 text-xs")}
                        >
                          <option value="">No month</option>
                          {statementMonthOptions(d.period).map((k) => (
                            <option key={k} value={k}>
                              {periodLabel(k)}
                            </option>
                          ))}
                        </select>
                        {onLogToTracker && d.period && (
                          <button
                            type="button"
                            onClick={() => setNote(onLogToTracker(d))}
                            title={`Log these totals as ${periodLabel(d.period)} actuals`}
                            className="inline-flex items-center gap-1 rounded-lg border border-indigo-300/30 px-2 py-1.5 text-xs text-indigo-100 hover:bg-indigo-400/10"
                          >
                            <CalendarPlus className="h-3.5 w-3.5" /> Log
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
                          <button type="button" onClick={() => setConfirmDelete(d.id)} aria-label={`Delete ${d.name}`} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-rose-300">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <p className="border-t border-white/10 px-5 py-3 text-[11px] text-slate-500">
          Deleting a document removes it from this list only; months already logged in the Fiscal Year Tracker keep their totals.
        </p>
      </section>
    </div>
  );
}
