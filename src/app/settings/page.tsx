"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Briefcase, Check, CheckCircle2, CreditCard, Home, Loader2, Pencil, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  PLAN_CATEGORIES,
  PLAN_CATEGORY_LABELS,
  PRICING,
  type BusinessType,
  type PlanCategory,
  type WorkspaceProfile,
} from "@/lib/schemas";
import { authHeaders, createWorkspace, deleteWorkspace, updatePlanCategory, updateWorkspace } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { ProfileMenu, TierBadge } from "@/components/ProfileMenu";
import { cn, errorMessage, glass, inputCls, primaryBtn, secondaryBtn } from "@/components/ui";

const PLAN_COPY: Record<PlanCategory, { Icon: typeof Home; blurb: string }> = {
  PERSONAL_FAMILY: { Icon: Home, blurb: "Household budgets: rent/mortgage, groceries, subscriptions, utilities, investments and debt, checked against 50/30/20." },
  SMALL_BUSINESS: { Icon: Briefcase, blurb: "Rental property, field service, agency/freelance or a custom business. Margins, deductions and runway." },
};

export default function SettingsPage() {
  const app = useApp();
  const { refreshProfile } = app;
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get("checkout");
    if (!c) return;
    window.history.replaceState(null, "", window.location.pathname);
    void refreshProfile().then(() =>
      setBanner(c === "success" ? "Payment received. Your plan updates within a few seconds." : "Checkout cancelled — you haven't been charged."),
    );
  }, [refreshProfile]);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-950 text-slate-100">
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div className="absolute -top-40 right-1/4 h-[26rem] w-[26rem] rounded-full bg-indigo-600/20 blur-[120px]" />
      </div>

      <main className="relative mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-indigo-300 hover:text-indigo-200">
              <ArrowLeft className="h-4 w-4" /> Back to dashboard
            </Link>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Settings &amp; Subscription</h1>
            <p className="mt-1 text-slate-400">Manage your plan, workspaces and billing.</p>
          </div>
          <ProfileMenu />
        </header>

        {banner && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-3 text-sm" role="status">
            <CheckCircle2 className="h-4 w-4 text-indigo-300" />
            <span className="flex-1">{banner}</span>
            <button onClick={() => setBanner(null)} aria-label="Dismiss" className="text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {!app.ready ? (
          <div className={cn(glass, "flex items-center gap-3 p-6 text-slate-300")}>
            <Loader2 className="h-5 w-5 animate-spin text-indigo-300" /> Loading your account…
          </div>
        ) : !app.user ? (
          <div className={cn(glass, "p-8 text-center")}>
            <h2 className="text-lg font-semibold">Sign in to manage your account</h2>
            <p className="mt-1 text-sm text-slate-400">Plans, workspaces and billing are tied to your LedgerPulse account.</p>
            <div className="mt-5 flex justify-center gap-3">
              <button onClick={() => app.openAuth("signin")} className={primaryBtn}>
                Sign in
              </button>
              <button onClick={() => app.openAuth("signup")} className={secondaryBtn}>
                Create account
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <PlanCategoryCard />
            <SubscriptionCard />
            <WorkspacesCard />
            <PrivacyCard />
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PlanCategoryCard() {
  const { profile, refreshProfile } = useApp();
  const [saving, setSaving] = useState<PlanCategory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = profile?.planCategory ?? "SMALL_BUSINESS";

  const choose = async (c: PlanCategory) => {
    if (c === current) return;
    setSaving(c);
    setError(null);
    try {
      await updatePlanCategory(c);
      await refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className={cn(glass, "p-6")} aria-labelledby="plan-cat">
      <h2 id="plan-cat" className="text-lg font-semibold">
        Default plan type
      </h2>
      <p className="mt-1 text-sm text-slate-400">Sets which mode the dashboard opens in when no workspace is selected.</p>
      <div role="radiogroup" className="mt-4 grid gap-3 sm:grid-cols-2">
        {PLAN_CATEGORIES.map((c) => {
          const { Icon, blurb } = PLAN_COPY[c];
          const active = c === current;
          return (
            <button
              key={c}
              role="radio"
              aria-checked={active}
              onClick={() => choose(c)}
              disabled={!!saving}
              className={cn("rounded-xl border p-4 text-left transition", active ? "border-indigo-400/60 bg-indigo-500/10" : "border-white/10 hover:bg-white/5")}
            >
              <span className="flex items-center gap-2 font-medium">
                <Icon className="h-4 w-4 text-slate-300" /> {PLAN_CATEGORY_LABELS[c]}
                {active && <Check className="ml-auto h-4 w-4 text-indigo-300" />}
                {saving === c && <Loader2 className="ml-auto h-4 w-4 animate-spin" />}
              </span>
              <span className="mt-1.5 block text-sm text-slate-400">{blurb}</span>
            </button>
          );
        })}
      </div>
      {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
    </section>
  );
}

function SubscriptionCard() {
  const { profile } = useApp();
  const [busy, setBusy] = useState<"pro" | "report" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isPro = profile?.tier === "pro";

  const go = async (action: "pro" | "report" | "portal") => {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(action === "portal" ? "/api/billing/portal" : "/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: action === "portal" ? "{}" : JSON.stringify({ kind: action }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      const { url } = (await res.json()) as { url?: string };
      if (!url) throw new Error("Billing is unavailable right now.");
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Billing request failed.");
      setBusy(null);
    }
  };

  return (
    <section className={cn(glass, "p-6")} aria-labelledby="sub">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="sub" className="flex items-center gap-2 text-lg font-semibold">
          <CreditCard className="h-5 w-5 text-indigo-300" /> Subscription
        </h2>
        <TierBadge tier={profile?.tier ?? "free"} />
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Plan</dt>
          <dd className="mt-1 font-medium">{isPro ? `Pro · $${PRICING.proMonthlyUsd}/mo` : "Free"}</dd>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Status</dt>
          <dd className="mt-1 font-medium capitalize">{profile?.subscriptionStatus?.replace(/_/g, " ") ?? (isPro ? "active" : "—")}</dd>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Report unlocks</dt>
          <dd className="mt-1 font-medium tabular-nums">{profile?.reportUnlocks ?? 0}</dd>
        </div>
      </dl>

      {!isPro && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-amber-300/25 bg-gradient-to-br from-amber-400/10 to-transparent p-4">
            <p className="flex items-center gap-2 font-medium">
              <Sparkles className="h-4 w-4 text-amber-200" /> Pro — ${PRICING.proMonthlyUsd}/mo
            </p>
            <ul className="mt-2 space-y-1 text-sm text-slate-300">
              <li>Every audit flag + savings total</li>
              <li>12-month macro-adjusted projections</li>
              <li>Unlimited scenario forecasting</li>
              <li>Executive PDF reports</li>
            </ul>
            <button onClick={() => go("pro")} disabled={!!busy} className={cn(primaryBtn, "mt-4 w-full")}>
              {busy === "pro" && <Loader2 className="h-4 w-4 animate-spin" />} Upgrade to Pro Subscription (${PRICING.proMonthlyUsd}/mo)
            </button>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="font-medium">One-time report — ${PRICING.reportUnlockUsd}</p>
            <p className="mt-2 text-sm text-slate-300">Unlock the full audit, projection and PDF report for a single analysis. No subscription.</p>
            <button onClick={() => go("report")} disabled={!!busy} className={cn(secondaryBtn, "mt-4 w-full")}>
              {busy === "report" && <Loader2 className="h-4 w-4 animate-spin" />} Unlock Full Audit &amp; Report (${PRICING.reportUnlockUsd})
            </button>
          </div>
        </div>
      )}

      {profile?.hasStripeCustomer && (
        <button onClick={() => go("portal")} disabled={!!busy} className={cn(secondaryBtn, "mt-5")}>
          {busy === "portal" && <Loader2 className="h-4 w-4 animate-spin" />} Manage billing in Stripe
        </button>
      )}
      <p className="mt-3 text-xs text-slate-500">Payments are processed by Stripe. LedgerPulse never sees or stores your card details.</p>
      {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
    </section>
  );
}

function WorkspacesCard() {
  const { workspaces, activeWorkspace, refreshWorkspaces, setActiveWorkspaceId } = useApp();
  const [name, setName] = useState("");
  const [type, setType] = useState<BusinessType>("REAL_ESTATE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const ws = await createWorkspace({ name, businessType: type });
      await refreshWorkspaces();
      if (!activeWorkspace) setActiveWorkspaceId(ws.id);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create workspace.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={cn(glass, "p-6")} aria-labelledby="ws">
      <h2 id="ws" className="text-lg font-semibold">
        Workspace profiles
      </h2>
      <p className="mt-1 text-sm text-slate-400">Keep each property, business line or household budget separate.</p>

      <ul className="mt-4 divide-y divide-white/5">
        {workspaces.length === 0 && <li className="py-3 text-sm text-slate-500">No workspaces yet — add your first below.</li>}
        {workspaces.map((w) => (
          <WorkspaceRow key={w.id} ws={w} active={activeWorkspace?.id === w.id} onChanged={refreshWorkspaces} onActivate={() => setActiveWorkspaceId(w.id)} />
        ))}
      </ul>

      <form onSubmit={add} className="mt-4 grid gap-2 sm:grid-cols-[1fr_14rem_auto]">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Lawn Service Q3"' aria-label="New workspace name" maxLength={80} required className={inputCls} />
        <select value={type} onChange={(e) => setType(e.target.value as BusinessType)} aria-label="Workspace type" className={inputCls}>
          {BUSINESS_TYPES.map((t) => (
            <option key={t} value={t}>
              {BUSINESS_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy} className={primaryBtn}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Add
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}
    </section>
  );
}

function WorkspaceRow({ ws, active, onChanged, onActivate }: { ws: WorkspaceProfile; active: boolean; onChanged: () => Promise<unknown>; onActivate: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(ws.name);
  const [type, setType] = useState<BusinessType>(ws.businessType);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = ws.mode === "PERSONAL" ? Home : Briefcase;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="py-3">
      {editing ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_14rem_auto]">
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Workspace name" maxLength={80} className={inputCls} />
          <select value={type} onChange={(e) => setType(e.target.value as BusinessType)} aria-label="Workspace type" className={inputCls}>
            {BUSINESS_TYPES.map((t) => (
              <option key={t} value={t}>
                {BUSINESS_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button onClick={() => run(() => updateWorkspace(ws.id, { name, businessType: type }))} disabled={busy || !name.trim()} className={cn(primaryBtn, "px-3")}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </button>
            <button onClick={() => setEditing(false)} className={cn(secondaryBtn, "px-3")}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <Icon className="h-4 w-4 shrink-0 text-slate-400" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {ws.name} {active && <span className="ml-1 rounded-full bg-indigo-500/20 px-2 py-0.5 text-[11px] text-indigo-200">Active</span>}
            </p>
            <p className="text-xs text-slate-500">{BUSINESS_TYPE_LABELS[ws.businessType]}</p>
          </div>
          {!active && (
            <button onClick={onActivate} className="rounded-lg px-2 py-1 text-xs text-indigo-300 hover:bg-white/5">
              Switch to
            </button>
          )}
          <button onClick={() => setEditing(true)} aria-label={`Edit ${ws.name}`} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white">
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => window.confirm(`Delete "${ws.name}" and its saved scenarios?`) && run(() => deleteWorkspace(ws.id))}
            aria-label={`Delete ${ws.name}`}
            disabled={busy}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-rose-300"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-rose-300">{error}</p>}
    </li>
  );
}

function PrivacyCard() {
  return (
    <section className={cn(glass, "p-6")} aria-labelledby="privacy">
      <h2 id="privacy" className="flex items-center gap-2 text-lg font-semibold">
        <ShieldCheck className="h-5 w-5 text-emerald-300" /> Data &amp; privacy
      </h2>
      <ul className="mt-3 space-y-2 text-sm text-slate-300">
        <li>Uploaded statements are encrypted in transit, parsed in memory and discarded when the request finishes. They are never written to disk or our database.</li>
        <li>Analysis results stay in your browser tab. We store only your account, plan, workspace names and any scenarios you choose to save.</li>
        <li>Statement contents are sent to our AI provider to produce the analysis.</li>
      </ul>
    </section>
  );
}
