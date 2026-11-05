"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Loader2, MessageSquareText, RotateCw, Search, ShieldAlert, Star } from "lucide-react";
import { authHeaders } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { ProfileMenu } from "@/components/ProfileMenu";
import { cn, errorMessage, glass, inputCls, secondaryBtn } from "@/components/ui";
import type { AdminFeedbackRow } from "@/app/api/admin/feedback/route";

type Context = AdminFeedbackRow["context"];
const CONTEXT_LABEL: Record<Context, string> = { report: "Report", audit: "Audit", tracker: "Tracker" };
const DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

type FetchResult = { ok: true; feedback: AdminFeedbackRow[]; truncated: boolean; at: number } | { ok: false; status: number; message: string };

async function fetchFeedback(): Promise<FetchResult> {
  try {
    const res = await fetch("/api/admin/feedback", { headers: await authHeaders(), cache: "no-store" });
    if (!res.ok) return { ok: false, status: res.status, message: await errorMessage(res) };
    const data = (await res.json()) as { feedback: AdminFeedbackRow[]; truncated: boolean };
    return { ok: true, feedback: data.feedback, truncated: data.truncated, at: Date.now() };
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : "Couldn't load feedback." };
  }
}

/** Creator-only view of every rating and comment from the in-app feedback widget. Access is enforced by the API. */
export default function AdminFeedbackPage() {
  const app = useApp();
  const [rows, setRows] = useState<AdminFeedbackRow[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  /** When the data was fetched (for "last 7 days"); read in the event handler, never during render. */
  const [loadedAt, setLoadedAt] = useState(0);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState<Context | "all">("all");
  const [minRating, setMinRating] = useState<number | "all" | "low">("all");
  const [commentsOnly, setCommentsOnly] = useState(false);
  const [query, setQuery] = useState("");

  const apply = useCallback((r: FetchResult) => {
    if (r.ok) {
      setRows(r.feedback);
      setTruncated(r.truncated);
      setLoadedAt(r.at);
      setError(null);
    } else setError({ status: r.status, message: r.message });
    setLoading(false);
  }, []);
  /** Refresh / retry button. */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    apply(await fetchFeedback());
  }, [apply]);

  const signedIn = app.ready && !!app.user;
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void fetchFeedback().then((r) => !cancelled && apply(r));
    return () => {
      cancelled = true;
    };
  }, [signedIn, apply]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (context === "all" || r.context === context) &&
        (minRating === "all" || (minRating === "low" ? r.rating <= 2 : r.rating === minRating)) &&
        (!commentsOnly || !!r.comment) &&
        (!q || [r.comment, r.userEmail, r.workspaceName].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [rows, context, minRating, commentsOnly, query]);

  const stats = useMemo(() => {
    const list = rows ?? [];
    const avg = (xs: AdminFeedbackRow[]) => (xs.length ? xs.reduce((a, r) => a + r.rating, 0) / xs.length : null);
    const dist = [5, 4, 3, 2, 1].map((n) => ({ n, count: list.filter((r) => r.rating === n).length }));
    const weekAgo = loadedAt - 7 * 86400000;
    return {
      total: list.length,
      avg: avg(list),
      comments: list.filter((r) => r.comment).length,
      lastWeek: list.filter((r) => Date.parse(r.createdAt) >= weekAgo).length,
      byContext: (Object.keys(CONTEXT_LABEL) as Context[]).map((c) => ({ c, count: list.filter((r) => r.context === c).length, avg: avg(list.filter((r) => r.context === c)) })),
      dist,
      maxDist: Math.max(1, ...dist.map((d) => d.count)),
    };
  }, [rows, loadedAt]);

  const exportCsv = () => {
    const cell = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      ["Date", "Context", "Rating", "Comment", "User", "Workspace"].map(cell).join(","),
      ...filtered.map((r) => [r.createdAt, r.context, r.rating, r.comment, r.userEmail, r.workspaceName].map(cell).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `ledgerpulse-feedback-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <MessageSquareText className="h-6 w-6 text-indigo-300" /> Feedback Hub
          </h1>
          <p className="mt-1 text-sm text-slate-400">Every rating and comment from the in-app feedback widget. Visible only to the LedgerPulse team.</p>
        </div>
        <ProfileMenu />
      </header>

      {!app.ready ? (
        <Status>
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your session…
        </Status>
      ) : !app.user ? (
        <Status>
          Sign in with an admin account to view feedback.
          <button type="button" onClick={() => app.openAuth("signin")} className={cn(secondaryBtn, "ml-2 px-3 py-1.5 text-xs")}>
            Sign in
          </button>
        </Status>
      ) : error ? (
        <div role="alert" className={cn(glass, "flex flex-wrap items-center gap-3 border-rose-300/30 p-5 text-sm text-rose-100")}>
          <ShieldAlert className="h-5 w-5 shrink-0 text-rose-300" />
          <span className="flex-1">
            {error.message}
            {error.status === 503 && <span className="mt-1 block text-xs text-rose-200/80">Set ADMIN_EMAILS (comma-separated) and SUPABASE_SERVICE_ROLE_KEY on the server, then reload.</span>}
          </span>
          {error.status !== 403 && (
            <button type="button" onClick={() => void load()} className={cn(secondaryBtn, "px-3 py-1.5 text-xs")}>
              <RotateCw className="h-3.5 w-3.5" /> Retry
            </button>
          )}
        </div>
      ) : !rows ? (
        <Status>
          <Loader2 className="h-4 w-4 animate-spin" /> Loading feedback…
        </Status>
      ) : (
        <>
          {/* Summary */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Summary">
            <Tile label="Average rating" value={stats.avg != null ? stats.avg.toFixed(2) : "—"} sub={<Stars n={Math.round(stats.avg ?? 0)} />} />
            <Tile label="Responses" value={String(stats.total)} sub={`${stats.lastWeek} in the last 7 days${truncated ? " · newest 500 shown" : ""}`} />
            <Tile label="With comments" value={String(stats.comments)} sub={stats.total ? `${Math.round((stats.comments / stats.total) * 100)}% of responses` : undefined} />
            <div className={cn(glass, "p-5")}>
              <p className="text-xs uppercase tracking-wide text-slate-400">By surface</p>
              <ul className="mt-2 space-y-1 text-sm">
                {stats.byContext.map((c) => (
                  <li key={c.c} className="flex justify-between gap-2 tabular-nums">
                    <span className="text-slate-300">{CONTEXT_LABEL[c.c]}</span>
                    <span className="text-slate-400">
                      {c.count} · {c.avg != null ? `${c.avg.toFixed(1)}★` : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className={cn(glass, "mt-4 p-5")} aria-label="Rating distribution">
            <p className="text-xs uppercase tracking-wide text-slate-400">Rating distribution</p>
            <ul className="mt-3 space-y-1.5">
              {stats.dist.map((d) => (
                <li key={d.n}>
                  <button
                    type="button"
                    onClick={() => setMinRating(minRating === d.n ? "all" : d.n)}
                    aria-pressed={minRating === d.n}
                    className={cn("flex w-full items-center gap-3 rounded-md px-1 py-0.5 text-left text-xs transition hover:bg-white/5", minRating === d.n && "bg-white/5")}
                  >
                    <span className="w-8 shrink-0 tabular-nums text-slate-300">{d.n}★</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                      <span className={cn("block h-full rounded-full", d.n >= 4 ? "bg-emerald-400/80" : d.n === 3 ? "bg-amber-300/80" : "bg-rose-400/80")} style={{ width: `${(d.count / stats.maxDist) * 100}%` }} />
                    </span>
                    <span className="w-10 shrink-0 text-right tabular-nums text-slate-400">{d.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Filters */}
          <section className="mt-6 flex flex-wrap items-center gap-2 text-sm" aria-label="Filters">
            <div className="relative min-w-[12rem] flex-1">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search comments, emails, workspaces" aria-label="Search feedback" className={cn(inputCls, "pl-9")} />
            </div>
            <select value={context} onChange={(e) => setContext(e.target.value as Context | "all")} aria-label="Surface" className={cn(inputCls, "w-auto pr-8")}>
              <option value="all">All surfaces</option>
              {(Object.keys(CONTEXT_LABEL) as Context[]).map((c) => (
                <option key={c} value={c}>
                  {CONTEXT_LABEL[c]}
                </option>
              ))}
            </select>
            <select
              value={String(minRating)}
              onChange={(e) => setMinRating(e.target.value === "all" || e.target.value === "low" ? e.target.value : Number(e.target.value))}
              aria-label="Rating"
              className={cn(inputCls, "w-auto pr-8")}
            >
              <option value="all">All ratings</option>
              <option value="low">1–2★ (needs attention)</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n}★ only
                </option>
              ))}
            </select>
            <label className="inline-flex items-center gap-2 text-slate-300">
              <input type="checkbox" checked={commentsOnly} onChange={(e) => setCommentsOnly(e.target.checked)} className="h-4 w-4 accent-indigo-400" /> With comments
            </label>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => void load()} disabled={loading} className={cn(secondaryBtn, "px-3 py-2 text-xs")}>
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />} Refresh
              </button>
              <button type="button" onClick={exportCsv} disabled={!filtered.length} className={cn(secondaryBtn, "px-3 py-2 text-xs")}>
                <Download className="h-3.5 w-3.5" /> CSV
              </button>
            </div>
          </section>

          {/* Feed */}
          <p className="mt-4 text-xs text-slate-500">
            {filtered.length} of {rows.length} shown
          </p>
          {filtered.length === 0 ? (
            <p className={cn(glass, "mt-2 p-8 text-center text-sm text-slate-400")}>{rows.length ? "No feedback matches these filters." : "No feedback yet."}</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {filtered.map((r) => (
                <li key={r.id} className={cn(glass, "p-4", r.rating <= 2 && "border-rose-300/25")}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                    <Stars n={r.rating} />
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">{CONTEXT_LABEL[r.context]}</span>
                    <time dateTime={r.createdAt}>{DATE_FMT.format(new Date(r.createdAt))}</time>
                    <span className="ml-auto truncate">
                      {r.userEmail ?? "Unknown user"}
                      {r.workspaceName ? ` · ${r.workspaceName}` : ""}
                    </span>
                  </div>
                  {r.comment ? <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-200">{r.comment}</p> : <p className="mt-2 text-xs italic text-slate-500">No comment</p>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

function Status({ children }: { children: ReactNode }) {
  return (
    <p className={cn(glass, "flex flex-wrap items-center gap-2 p-5 text-sm text-slate-300")} role="status">
      {children}
    </p>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className={cn(glass, "p-5")}>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-50">{value}</p>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex" aria-label={`${n} out of 5 stars`} role="img">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn("h-3.5 w-3.5", i <= n ? "fill-amber-300 text-amber-300" : "text-slate-600")} />
      ))}
    </span>
  );
}
