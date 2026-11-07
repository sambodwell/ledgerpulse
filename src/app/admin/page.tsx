"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BarChart3, Loader2, MessageSquareText, RotateCw, ShieldAlert, Star, Users } from "lucide-react";
import { authHeaders } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { ProfileMenu } from "@/components/ProfileMenu";
import { cn, errorMessage, glass, secondaryBtn } from "@/components/ui";
import type { AdminStats } from "@/app/api/admin/stats/route";

const DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const DAY_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");
const CONTEXT_LABEL: Record<string, string> = { report: "Report", audit: "Audit", tracker: "Tracker" };

type FetchResult = { ok: true; stats: AdminStats } | { ok: false; status: number; message: string };

async function fetchStats(): Promise<FetchResult> {
  try {
    const res = await fetch("/api/admin/stats", { headers: await authHeaders(), cache: "no-store" });
    if (!res.ok) return { ok: false, status: res.status, message: await errorMessage(res) };
    return { ok: true, stats: (await res.json()) as AdminStats };
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : "Couldn't load analytics." };
  }
}

/** Creator-only overview: signups, conversion by origin and a feedback summary. Access is enforced by the API. */
export default function AdminOverviewPage() {
  const app = useApp();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const apply = useCallback((r: FetchResult) => {
    if (r.ok) {
      setStats(r.stats);
      setError(null);
    } else setError({ status: r.status, message: r.message });
    setLoading(false);
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    apply(await fetchStats());
  }, [apply]);

  const signedIn = app.ready && !!app.user;
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void fetchStats().then((r) => !cancelled && apply(r));
    return () => {
      cancelled = true;
    };
  }, [signedIn, apply]);

  const t = stats?.totals;
  const maxDay = Math.max(1, ...(stats?.daily.map((d) => d.signups) ?? [0]));

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <BarChart3 className="h-6 w-6 text-indigo-300" /> Admin overview
          </h1>
          <p className="mt-1 text-sm text-slate-400">Signups, conversions by origin and user feedback. Visible only to the Sumhaven team; team accounts are excluded.</p>
          <nav className="mt-3 flex gap-2 text-sm" aria-label="Admin">
            <span className="rounded-lg bg-white/10 px-3 py-1.5 text-slate-100">Overview</span>
            <Link href="/admin/feedback" className="rounded-lg px-3 py-1.5 text-slate-400 hover:bg-white/5 hover:text-slate-200">
              Feedback Hub
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {stats && (
            <button type="button" onClick={() => void load()} disabled={loading} className={cn(secondaryBtn, "px-3 py-1.5 text-xs")}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />} Refresh
            </button>
          )}
          <ProfileMenu />
        </div>
      </header>

      {!app.ready ? (
        <Status>
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your session…
        </Status>
      ) : !app.user ? (
        <Status>
          Sign in with an admin account to view analytics.
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
      ) : !stats || !t ? (
        <Status>
          <Loader2 className="h-4 w-4 animate-spin" /> Loading analytics…
        </Status>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Signups">
            <Tile label="Total signups" value={t.signups.toLocaleString()} sub={`${t.confirmed.toLocaleString()} confirmed (${pct(t.confirmed, t.signups)})${stats.truncated ? " · first 20k" : ""}`} />
            <Tile label="New signups" value={t.last7.toLocaleString()} sub={`last 7 days · ${t.last30} in 30 days · ${t.today} today`} />
            <Tile label="Paid Pro" value={t.pro.toLocaleString()} sub={`${pct(t.pro, t.signups)} of signups · +${t.proViaCode} via code`} />
            <Tile label="Paying customers" value={t.paidCustomers.toLocaleString()} sub={`${pct(t.paidCustomers, t.signups)} converted · ${t.reportCredits} unused report credit${t.reportCredits === 1 ? "" : "s"}`} />
          </section>

          <section className={cn(glass, "mt-4 p-5")} aria-labelledby="daily-heading">
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="daily-heading" className="text-xs uppercase tracking-wide text-slate-400">
                Signups per day · last 30 days (UTC)
              </h2>
              <span className="text-xs tabular-nums text-slate-500">peak {maxDay}</span>
            </div>
            <div className="mt-4 flex h-32 items-end gap-[3px]" role="img" aria-label={`Daily signups for the last 30 days, ${t.last30} in total.`}>
              {stats.daily.map((d) => (
                <div key={d.day} className="group relative flex h-full flex-1 items-end" title={`${DAY_FMT.format(new Date(d.day))}: ${d.signups}`}>
                  <div className={cn("w-full rounded-t-sm", d.signups ? "bg-indigo-400/80 group-hover:bg-indigo-300" : "bg-white/5")} style={{ height: d.signups ? `${Math.max(4, (d.signups / maxDay) * 100)}%` : "2px" }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-slate-500">
              <span>{DAY_FMT.format(new Date(stats.daily[0].day))}</span>
              <span>{DAY_FMT.format(new Date(stats.daily[stats.daily.length - 1].day))}</span>
            </div>
          </section>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <section className={cn(glass, "overflow-hidden")} aria-labelledby="origin-heading">
              <h2 id="origin-heading" className="flex items-center gap-2 px-5 pt-5 text-xs uppercase tracking-wide text-slate-400">
                <Users className="h-4 w-4" /> Conversion by origin
              </h2>
              <p className="px-5 pt-1 text-xs text-slate-500">First touch: utm_source, ?ref=, the referring site, or direct. &ldquo;unknown&rdquo; = signed up before tracking.</p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-xs text-slate-400">
                      <th className="px-5 py-2 font-medium">Origin</th>
                      <th className="px-3 py-2 text-right font-medium">Signups</th>
                      <th className="px-3 py-2 text-right font-medium">Confirmed</th>
                      <th className="px-3 py-2 text-right font-medium">Pro</th>
                      <th className="px-5 py-2 text-right font-medium">Paid conv.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.origins.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-6 text-center text-slate-500">
                          No signups yet.
                        </td>
                      </tr>
                    ) : (
                      stats.origins.map((o) => (
                        <tr key={o.source} className="border-b border-white/5 tabular-nums">
                          <td className="max-w-[12rem] truncate px-5 py-2 text-slate-200">{o.source}</td>
                          <td className="px-3 py-2 text-right">{o.signups}</td>
                          <td className="px-3 py-2 text-right text-slate-400">{o.confirmed}</td>
                          <td className="px-3 py-2 text-right">{o.pro}</td>
                          <td className="px-5 py-2 text-right text-emerald-200">{pct(o.paid, o.signups)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={cn(glass, "flex flex-col p-5")} aria-labelledby="fb-heading">
              <h2 id="fb-heading" className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400">
                <MessageSquareText className="h-4 w-4" /> Reviews &amp; feedback
              </h2>
              <p className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-semibold tabular-nums">{stats.feedback.average != null ? stats.feedback.average.toFixed(2) : "—"}</span>
                <Star className="h-5 w-5 fill-amber-300 text-amber-300" aria-hidden />
                <span className="text-sm text-slate-400">
                  {stats.feedback.total} response{stats.feedback.total === 1 ? "" : "s"} · {stats.feedback.last7} this week
                </span>
              </p>
              <ul className="mt-3 space-y-1 text-sm">
                {stats.feedback.byContext.map((c) => (
                  <li key={c.context} className="flex justify-between gap-2 tabular-nums">
                    <span className="text-slate-300">{CONTEXT_LABEL[c.context] ?? c.context}</span>
                    <span className="text-slate-400">
                      {c.count} · {c.average != null ? `${c.average.toFixed(1)}★` : "—"}
                    </span>
                  </li>
                ))}
              </ul>
              <Link href="/admin/feedback" className={cn(secondaryBtn, "mt-auto self-start px-3 py-1.5 text-xs")}>
                Read every comment <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </section>
          </div>

          <section className={cn(glass, "mt-4 overflow-hidden")} aria-labelledby="recent-heading">
            <h2 id="recent-heading" className="px-5 pt-5 text-xs uppercase tracking-wide text-slate-400">
              Latest signups
            </h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs text-slate-400">
                    <th className="px-5 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium">Signed up</th>
                    <th className="px-3 py-2 font-medium">Origin</th>
                    <th className="px-5 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recent.map((u) => (
                    <tr key={`${u.email}-${u.createdAt}`} className="border-b border-white/5">
                      <td className="max-w-[16rem] truncate px-5 py-2 text-slate-200">{u.email ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-400">{DATE_FMT.format(new Date(u.createdAt))}</td>
                      <td className="max-w-[10rem] truncate px-3 py-2 text-slate-300">{u.source}</td>
                      <td className="whitespace-nowrap px-5 py-2 text-xs">
                        <span className={cn("rounded-full px-2 py-0.5", u.tier === "pro" ? "bg-amber-400/15 text-amber-200" : "bg-white/5 text-slate-400")}>{u.tier === "pro" ? "Pro" : "Free"}</span>
                        {!u.confirmed && <span className="ml-1.5 text-slate-500">unconfirmed</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <p className="mt-3 text-right text-xs text-slate-500">Updated {DATE_FMT.format(new Date(stats.generatedAt))}</p>
        </>
      )}
    </main>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className={cn(glass, "p-5")}>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function Status({ children }: { children: ReactNode }) {
  return <div className={cn(glass, "flex items-center gap-2 p-5 text-sm text-slate-300")}>{children}</div>;
}
