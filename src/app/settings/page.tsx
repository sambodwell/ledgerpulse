"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Briefcase, Check, CheckCircle2, CreditCard, FileText, Home, Infinity as InfinityIcon, KeyRound, Loader2, Pencil, Plus, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import {
  BUSINESS_ONLY_TYPES,
  BUSINESS_TYPE_LABELS,
  PLAN_CATEGORIES,
  PLAN_CATEGORY_LABELS,
  PRICING,
  type BusinessType,
  type PlanCategory,
  type WorkspaceProfile,
} from "@/lib/schemas";
import { authHeaders, updatePlanCategory, updateWorkspace } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { ProfileMenu, TierBadge, creditsLabel } from "@/components/ProfileMenu";
import { AppShell, CreateWorkspaceDialog } from "@/components/WorkspaceSidebar";
import { PlanCard } from "@/components/PlanCard";
import { cn, errorMessage, glass, inputCls, primaryBtn, secondaryBtn } from "@/components/ui";
import { CheckoutModal, type CheckoutBusy, type CheckoutKind } from "@/components/CheckoutModal";
import { Modal } from "@/components/Modal";
import { THEME_KEY } from "@/lib/theme";

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
    <AppShell>
    <div className="relative min-h-screen overflow-x-hidden bg-slate-950 text-slate-100">
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div className="absolute -top-40 right-1/4 h-[26rem] w-[26rem] rounded-full bg-indigo-600/20 blur-[120px]" />
      </div>

      <main className="relative mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Account &amp; Subscription</h1>
            <p className="mt-1 text-slate-400">Manage your plan, workspaces and billing. Financial defaults such as inflation live in each workspace&apos;s settings.</p>
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
            <p className="mt-1 text-sm text-slate-400">Plans, workspaces and billing are tied to your Sumhaven account.</p>
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
            <DangerZoneCard />
          </div>
        )}
      </main>
    </div>
    </AppShell>
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

function planLabel(isPro: boolean, status: string | null | undefined, expiresAt: string | null | undefined): string {
  if (!isPro) return "Free";
  if (status === "admin") return "Pro · Admin";
  if (status === "promo") return "Pro · VIP access";
  if (status === "vip") return expiresAt ? `Pro · VIP until ${new Date(expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "Pro · VIP access";
  return "Pro";
}

function SubscriptionCard() {
  const { profile, refreshProfile, user, openAuth, isPro } = useApp();
  const [busy, setBusy] = useState<CheckoutBusy | "portal">(null);
  const [error, setError] = useState<string | null>(null);
  const [plansOpen, setPlansOpen] = useState(false);

  const go = async (action: CheckoutKind | "portal") => {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(action === "portal" ? "/api/billing/portal" : "/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: action === "portal" ? "{}" : JSON.stringify({ kind: action, from: "settings" }),
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
          <dd className="mt-1 font-medium">{planLabel(isPro, profile?.subscriptionStatus, profile?.proExpiresAt)}</dd>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Status</dt>
          <dd className="mt-1 font-medium capitalize">{profile?.subscriptionStatus?.replace(/_/g, " ") ?? (isPro ? "active" : "—")}</dd>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Full-report credits</dt>
          <dd className="mt-1 flex items-center gap-1.5 font-medium tabular-nums">
            {isPro ? (
              <>
                <InfinityIcon className="h-4 w-4 text-amber-200" aria-hidden /> Unlimited with Pro
              </>
            ) : (
              <>{profile?.reportUnlocks ?? 0} available</>
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-indigo-300/20 bg-indigo-500/[0.06] px-3.5 py-3 text-sm text-slate-300">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" aria-hidden />
        <div>
          <p className="font-medium text-slate-100">What is a full-report credit?</p>
          <p className="mt-0.5 text-slate-400">
            Analyses need Pro or a one-time Executive Report credit. One credit pays for one analysis with the full audit: every flag with
            its savings estimate, the 12-month projection and the downloadable, shareable Executive PDF report. Credits are bought one at a time (${PRICING.reportUnlockUsd}{" "}
            each), never expire and work in any workspace.
            {isPro ? " Pro includes unlimited full reports, so your credits are kept untouched while you're subscribed." : ""}
          </p>
          {!isPro && !!profile?.reportUnlocks && (
            <p className="mt-1 text-xs text-indigo-200">You have {creditsLabel(profile.reportUnlocks)}. It&apos;s used automatically on your next analysis.</p>
          )}
        </div>
      </div>

      {!isPro && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <PlanCard plan="report">
            <button onClick={() => go("report")} disabled={!!busy} className={cn(secondaryBtn, "w-full")}>
              {busy === "report" && <Loader2 className="h-4 w-4 animate-spin" />} Buy 1 full-report credit (${PRICING.reportUnlockUsd})
            </button>
          </PlanCard>
          <PlanCard plan="pro">
            <button onClick={() => setPlansOpen(true)} disabled={!!busy} className={cn(primaryBtn, "w-full")}>
              <Sparkles className="h-4 w-4" /> Upgrade to Pro (${PRICING.proMonthlyUsd}/mo or ${PRICING.proAnnualUsd}/yr)
            </button>
          </PlanCard>
          <button type="button" onClick={() => setPlansOpen(true)} disabled={!!busy} className="inline-flex items-center gap-1.5 text-sm text-amber-200 hover:text-amber-100 sm:col-span-2">
            <KeyRound className="h-4 w-4" aria-hidden /> Have a VIP access code? Redeem it here
          </button>
        </div>
      )}
      {plansOpen && (
        <CheckoutModal
          onClose={() => setPlansOpen(false)}
          onCheckout={(kind) => void go(kind)}
          onUnlocked={async () => {
            await refreshProfile();
            setPlansOpen(false);
          }}
          busy={busy === "portal" ? null : busy}
          message={error}
          signedIn={!!user}
          onSignIn={() => {
            setPlansOpen(false);
            openAuth("signin");
          }}
        />
      )}

      {profile?.hasStripeCustomer && (
        <button onClick={() => go("portal")} disabled={!!busy} className={cn(secondaryBtn, "mt-5")}>
          {busy === "portal" && <Loader2 className="h-4 w-4 animate-spin" />} Manage billing in Stripe
        </button>
      )}
      <p className="mt-3 text-xs text-slate-500">Payments are processed by Stripe and appear on your statement as SUMHAVEN PRO. Sumhaven never sees or stores your card details.</p>
      {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
    </section>
  );
}

function WorkspacesCard() {
  const { workspaces, activeWorkspace, refreshWorkspaces, setActiveWorkspaceId, removeWorkspace } = useApp();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  return (
    <section className={cn(glass, "p-6")} aria-labelledby="ws">
      <h2 id="ws" className="text-lg font-semibold">
        Workspace profiles
      </h2>
      <p className="mt-1 text-sm text-slate-400">
        Keep each property, business line or household budget separate. Every workspace is either Business or Personal, and its data never mixes with another
        workspace&apos;s.
      </p>

      <ul className="mt-4 divide-y divide-white/5">
        {workspaces.length === 0 && <li className="py-3 text-sm text-slate-500">No workspaces yet — add your first below.</li>}
        {workspaces.map((w) => (
          <WorkspaceRow
            key={w.id}
            ws={w}
            active={activeWorkspace?.id === w.id}
            onChanged={refreshWorkspaces}
            onDelete={() => removeWorkspace(w.id)}
            onActivate={() => {
              setActiveWorkspaceId(w.id);
              router.push("/dashboard");
            }}
          />
        ))}
      </ul>

      {/* Same dialog as the sidebar: a new workspace opens on the dashboard's upload screen, completely empty. */}
      <button type="button" onClick={() => setCreating(true)} className={cn(primaryBtn, "mt-4")}>
        <Plus className="h-4 w-4" /> Create New Workspace
      </button>
      {creating && <CreateWorkspaceDialog onClose={() => setCreating(false)} />}
    </section>
  );
}

function WorkspaceRow({
  ws,
  active,
  onChanged,
  onDelete,
  onActivate,
}: {
  ws: WorkspaceProfile;
  active: boolean;
  onChanged: () => Promise<unknown>;
  onDelete: () => Promise<void>;
  onActivate: () => void;
}) {
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
          {ws.mode === "PERSONAL" ? (
            <p className="flex items-center gap-1.5 self-center text-xs text-slate-500">
              <Home className="h-3.5 w-3.5" /> Personal workspace
            </p>
          ) : (
            // Business types only: a business book can't be turned into a personal one (its data would show up there).
            <select value={type} onChange={(e) => setType(e.target.value as BusinessType)} aria-label="Business type" className={inputCls}>
              {BUSINESS_ONLY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {BUSINESS_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          )}
          <div className="flex gap-2">
            <button onClick={() => run(() => updateWorkspace(ws.id, ws.mode === "PERSONAL" ? { name } : { name, businessType: type }))} disabled={busy || !name.trim()} className={cn(primaryBtn, "px-3")}>
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
            <p className="text-xs text-slate-500">{ws.mode === "PERSONAL" ? "Personal · Household budget" : `Business · ${BUSINESS_TYPE_LABELS[ws.businessType]}`}</p>
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
            onClick={() => window.confirm(`Permanently delete "${ws.name}"? Its documents, report, Fiscal Year Tracker (monthly actuals, goals, savings) and saved scenarios are deleted too. This can't be undone.`) && run(onDelete)}
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
        <li>Uploaded statement files are encrypted in transit, parsed in memory and discarded when the request finishes. The files themselves are never written to disk or our database.</li>
        <li>Inside each saved workspace we keep what was parsed from your documents (name, statement month, reviewed line items and totals), the latest report, your tracker and any scenarios you save, so nothing disappears on reload. Deleting a workspace deletes all of it.</li>
        <li>Statement contents are sent to our AI provider to produce the analysis.</li>
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Danger Zone
// ---------------------------------------------------------------------------

const CONFIRM_WORD = "DELETE";

/** Clears this browser's saved app state (drafts, cached preferences, pending unlocks), keeping only the theme choice. */
function clearLocalAppState() {
  try {
    const theme = window.localStorage.getItem(THEME_KEY);
    window.localStorage.clear();
    if (theme) window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage blocked: nothing stored to clear */
  }
  try {
    window.sessionStorage.clear();
  } catch {
    /* storage blocked */
  }
}

function DangerZoneCard() {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const armed = typed.trim() === CONFIRM_WORD;

  const close = () => {
    if (busy) return;
    setConfirming(false);
    setTyped("");
    setError(null);
  };

  const wipe = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!armed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/data", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ confirm: CONFIRM_WORD }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      clearLocalAppState();
      // A full page load (not client navigation) so no in-memory report, document or tracker outlives the deleted rows.
      window.location.assign(new URL("/dashboard", window.location.origin).href);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete your data.");
      setBusy(false);
    }
  };

  return (
    <section className={cn(glass, "border-rose-400/30 p-6")} aria-labelledby="danger">
      <h2 id="danger" className="flex items-center gap-2 text-lg font-semibold text-rose-200">
        <AlertTriangle className="h-5 w-5 text-rose-300" /> Danger Zone
      </h2>
      <div className="mt-3 flex flex-col gap-4 rounded-xl border border-rose-400/25 bg-rose-500/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <p className="font-medium text-slate-100">Delete all workspace &amp; document data</p>
          <p className="mt-1 text-slate-400">
            Permanently removes every workspace, saved document, report and report history, Fiscal Year Tracker, saved scenario and feedback entry, and
            clears data cached in this browser. Your account and subscription stay active. This can&apos;t be undone.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300"
        >
          <Trash2 className="h-4 w-4" /> Delete All Workspace &amp; Document Data
        </button>
      </div>

      {confirming && (
        <Modal tone="danger" title="Delete all workspace data?" subtitle="This permanently erases your saved financial data. It can't be recovered." onClose={close} dismissible={!busy}>
          <form onSubmit={wipe} className="space-y-4 text-sm">
            <ul className="list-disc space-y-1 pl-5 text-slate-300">
              <li>All workspaces (Business and Personal)</li>
              <li>Saved documents, line items and monthly breakdowns</li>
              <li>Reports, report history and Fiscal Year Trackers (actuals, goals, savings)</li>
              <li>Saved scenarios and feedback</li>
              <li>Drafts and cached data in this browser</li>
            </ul>
            <p className="text-slate-400">Your sign-in, plan and billing history are kept.</p>
            <div>
              <label htmlFor="danger-confirm" className="text-xs font-medium text-slate-300">
                Type <span className="font-mono text-rose-200">{CONFIRM_WORD}</span> to confirm
              </label>
              <input
                id="danger-confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                autoFocus
                className={cn(inputCls, "mt-1.5 font-mono focus:border-rose-400")}
              />
            </div>
            {error && <p className="text-rose-300">{error}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={close} disabled={busy} className={secondaryBtn}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={!armed || busy}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-500 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} {busy ? "Deleting…" : "Permanently delete everything"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
