"use client";

import { Component, useCallback, useEffect, useId, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Briefcase,
  CheckCircle2,
  ClipboardList,
  Download,
  FileText,
  Home,
  Info,
  Loader2,
  Lock,
  MessageSquareText,
  Plus,
  Repeat,
  Repeat1,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Trophy,
  Upload,
  X,
} from "lucide-react";
import {
  BUSINESS_ONLY_TYPES,
  BUSINESS_TYPE_LABELS,
  CATEGORY_HELP,
  CATEGORY_LINE_HINTS,
  CATEGORY_TEMPLATES,
  MODE_COPY,
  PRICING,
  applyScenario,
  isAnalysisResponse,
  isExtractedLineItems,
  isBusinessType,
  modeOf,
  splitTotals,
  sum,
  type AnalysisAccess,
  type AnalysisResponse,
  type BusinessType,
  type ExpenseLine,
  type RevenueLine,
  type FinancialAnalysis,
  type SavedScenario,
  type ScenarioBaseline,
  type ScenarioPlan,
  type ScenarioResult,
  type Severity,
  type WorkspaceMode,
} from "@/lib/schemas";
import { authHeaders, listScenarios, saveScenario } from "@/lib/supabase";
import { clearDraft, draftKey, loadDraft, saveDraft } from "@/lib/formDraft";
import { DEV_UNLOCK } from "@/lib/devUnlock";
import { useApp } from "@/components/AppProvider";
import { fromMode, useWorkspace } from "@/context/WorkspaceContext";
import { ProfileMenu } from "@/components/ProfileMenu";
import { PlanCard } from "@/components/PlanCard";
import { LEGAL_DISCLAIMER } from "@/components/Footer";
import { cn, errorMessage, glass, inputCls, pct, primaryBtn, secondaryBtn, usd, usdCompact } from "@/components/ui";

// Chart colors: validated categorical slots 1–3 for a dark surface.
const COLOR = { revenue: "#3987e5", expenses: "#d95926", cash: "#199e70", baseline: "#94a3b8" } as const;

const PRIVACY_BADGE = "🔒 256-Bit Encrypted | Zero File Retention — Your financial data is parsed in memory and never stored.";
const PENDING_UNLOCK_KEY = "lp:pendingUnlock";

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------

class PanelBoundary extends Component<{ title: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.title}]`, error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className={cn(glass, "p-6 text-sm text-slate-300")} role="alert">
          <p className="font-medium text-slate-100">{this.props.title} couldn&apos;t be displayed.</p>
          <p className="mt-1 text-slate-400">The rest of your dashboard is unaffected.</p>
          <button onClick={() => this.setState({ error: null })} className="mt-3 rounded-lg border border-white/15 px-3 py-1.5 text-slate-200 hover:bg-white/10">
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Paywall plumbing
// ---------------------------------------------------------------------------

interface Paywall {
  access: AnalysisAccess;
  isPro: boolean;
  busy: "report" | "pro" | "unlock" | null;
  message: string | null;
  checkout: (kind: "report" | "pro") => void;
  unlock: () => void;
}

function safeSession<T>(fn: (s: Storage) => T): T | null {
  try {
    return fn(window.sessionStorage);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type InputTab = "form" | "upload";

export default function DashboardPage() {
  const app = useApp();
  const router = useRouter();
  const wsKey = app.activeWorkspace?.id ?? "guest";
  const { mode, setActiveWorkspace } = useWorkspace();
  const setMode = (m: WorkspaceMode) => setActiveWorkspace(fromMode(m));

  // Gate: financial inputs require an account (the API enforces this too).
  const mustSignIn = app.ready && !app.user;
  useEffect(() => {
    if (mustSignIn) router.replace(`/signup?next=${encodeURIComponent("/dashboard")}`);
  }, [mustSignIn, router]);

  // Results live in memory only, per workspace, for this browser tab.
  const [results, setResults] = useState<Record<string, AnalysisResponse>>({});
  const current = results[wsKey] ?? null;

  const [tab, setTab] = useState<InputTab>("form");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paywallBusy, setPaywallBusy] = useState<Paywall["busy"]>(null);
  const [paywallMsg, setPaywallMsg] = useState<string | null>(null);
  const [pendingUnlock, setPendingUnlock] = useState<{ sealed: string; wsKey: string } | null>(null);
  const [confirmingCheckout, setConfirmingCheckout] = useState(false);
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const { setUiHints, refreshProfile } = app;
  useEffect(() => setUiHints({ mode, hasAnalysis: !!current }), [mode, current, setUiHints]);

  const post = useCallback(async (init: RequestInit) => {
    const auth = await authHeaders();
    return fetch("/api/analyze", { method: "POST", ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...auth } });
  }, []);

  const runAnalysis = useCallback(
    async (init: RequestInit): Promise<boolean> => {
      setLoading(true);
      setError(null);
      setPaywallMsg(null);
      try {
        const res = await post(init);
        if (!res.ok) throw new Error(await errorMessage(res));
        const data: unknown = await res.json();
        if (!isAnalysisResponse(data)) throw new Error("Received an unexpected response from the analysis service.");
        setResults((r) => ({ ...r, [wsKey]: data }));
        requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
        return false;
      } finally {
        setLoading(false);
      }
    },
    [post, wsKey],
  );

  /** Exchanges a sealed teaser for the full analysis. `retries` covers a webhook that lands a moment after the redirect. */
  const unlockSealed = useCallback(
    async (sealed: string, targetWs: string, retries = 0) => {
      setPaywallBusy("unlock");
      setPaywallMsg(null);
      try {
        for (let attempt = 0; ; attempt++) {
          const res = await post({ headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "unlock", sealed }) });
          if (res.status === 402 && attempt < retries) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          if (res.status === 402) throw new Error("Your payment is still processing. Give it a few seconds and try again.");
          if (!res.ok) throw new Error(await errorMessage(res));
          const data: unknown = await res.json();
          if (!isAnalysisResponse(data)) throw new Error("Received an unexpected response.");
          setResults((r) => ({ ...r, [targetWs]: data }));
          safeSession((s) => s.removeItem(PENDING_UNLOCK_KEY));
          setPendingUnlock(null);
          void refreshProfile();
          return;
        }
      } catch (e) {
        setPaywallMsg(e instanceof Error ? e.message : "Couldn't unlock.");
      } finally {
        setPaywallBusy(null);
      }
    },
    [post, refreshProfile],
  );

  // Returning from Stripe Checkout (or the dev bypass): confirm the purchase server-side, refresh the
  // profile so the new tier / credit is reflected, then unlock the analysis that was run before leaving.
  const checkoutHandled = useRef(false);
  useEffect(() => {
    if (checkoutHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("checkout");
    if (!status) return;
    checkoutHandled.current = true;
    const sessionId = params.get("session_id");
    window.history.replaceState(null, "", window.location.pathname);
    if (status !== "success") return;

    let parsed: { sealed: string; wsKey: string } | null = null;
    try {
      const stored = safeSession((s) => s.getItem(PENDING_UNLOCK_KEY));
      const v: unknown = stored ? JSON.parse(stored) : null;
      if (v && typeof v === "object" && typeof (v as { sealed?: unknown }).sealed === "string" && typeof (v as { wsKey?: unknown }).wsKey === "string") {
        parsed = v as { sealed: string; wsKey: string };
      }
    } catch {
      /* ignore malformed */
    }

    void (async () => {
      setConfirmingCheckout(true);
      if (sessionId) {
        try {
          const res = await fetch("/api/billing/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(await authHeaders()) },
            body: JSON.stringify({ sessionId }),
          });
          // Not fatal: the webhook may still fulfill it; the unlock below retries on 402.
          if (!res.ok) console.warn("[checkout] confirm failed", res.status, await errorMessage(res));
        } catch (e) {
          console.warn("[checkout] confirm request failed", e);
        }
      }
      await refreshProfile();
      setConfirmingCheckout(false);
      if (parsed) {
        setPendingUnlock(parsed);
        await unlockSealed(parsed.sealed, parsed.wsKey, 5);
        setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
      } else {
        setCheckoutNotice("Payment received — your plan is active. Run an analysis to see your full report.");
      }
    })();
  }, [refreshProfile, unlockSealed]);

  const checkout = useCallback(
    async (kind: "report" | "pro") => {
      if (!app.user) {
        app.openAuth("signup");
        return;
      }
      setPaywallBusy(kind);
      setPaywallMsg(null);
      try {
        const res = await fetch("/api/billing/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify({ kind }),
        });
        if (!res.ok) throw new Error(await errorMessage(res));
        const { url } = (await res.json()) as { url?: string };
        if (!url) throw new Error("Checkout is unavailable right now.");
        // Keep only the encrypted token across the redirect — never the plaintext analysis.
        if (current?.access.sealed) safeSession((s) => s.setItem(PENDING_UNLOCK_KEY, JSON.stringify({ sealed: current.access.sealed, wsKey })));
        window.location.assign(url);
      } catch (e) {
        setPaywallMsg(e instanceof Error ? e.message : "Checkout failed.");
        setPaywallBusy(null);
      }
    },
    [app, current, wsKey],
  );

  const isPro = DEV_UNLOCK || app.profile?.tier === "pro";
  const paywall: Paywall | null = current
    ? {
        access: current.access,
        isPro,
        busy: paywallBusy,
        message: paywallMsg,
        checkout,
        unlock: () => {
          if (!app.user) return app.openAuth("signin");
          if (current.access.sealed) void unlockSealed(current.access.sealed, wsKey);
          else setPaywallMsg("Run the analysis again to unlock it.");
        },
      }
    : null;

  const analysis = current?.analysis ?? null;
  const teaser = current?.access.level === "teaser";
  const copy = MODE_COPY[mode];
  const ws = app.activeWorkspace;
  const formDefaultType: BusinessType = mode === "PERSONAL" ? "PERSONAL_FAMILY" : ws && ws.mode === "BUSINESS" ? ws.businessType : "REAL_ESTATE";

  if (!app.ready || !app.user) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 text-sm text-slate-400" role="status">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-indigo-300" /> {app.ready ? "Redirecting to sign up…" : "Checking your session…"}
        </span>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-950 text-slate-100">
      {/* Ambient glow */}
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div className="absolute -top-40 left-1/4 h-[28rem] w-[28rem] rounded-full bg-indigo-600/20 blur-[120px]" />
        <div className="absolute top-1/3 -right-24 h-[24rem] w-[24rem] rounded-full bg-emerald-500/10 blur-[120px]" />
      </div>

      <main className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium tracking-wide text-indigo-300">LedgerPulse</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{mode === "PERSONAL" ? "Household budget & savings forecast" : "Cash flow & runway forecast"}</h1>
            <p className="mt-2 max-w-2xl text-slate-400">
              {mode === "PERSONAL"
                ? "Enter your household income and spending or upload a bank statement. We'll audit your budget and project the next 12 months."
                : "Enter your numbers or upload a bank statement / P&L. We'll audit it and project the next 12 months with seasonality and inflation."}
            </p>
            <p className="mt-3 inline-flex items-center gap-2 text-sm text-slate-300">
              {ws ? (
                <>
                  {ws.mode === "PERSONAL" ? <Home className="h-4 w-4 text-slate-400" /> : <Briefcase className="h-4 w-4 text-slate-400" />}
                  Workspace: <span className="font-medium text-slate-100">{ws.name}</span>
                  <span className="text-slate-500">· {BUSINESS_TYPE_LABELS[ws.businessType]}</span>
                </>
              ) : (
                <span className="text-slate-500">No saved workspace selected — create one from the profile menu.</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3 self-end sm:self-start">
            <ModeToggle mode={mode} onChange={setMode} />
            <ProfileMenu />
          </div>
        </header>

        <div className="mb-6 flex items-start gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.07] px-4 py-2.5 text-sm text-emerald-100" role="note">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
          <span>{PRIVACY_BADGE}</span>
        </div>

        {confirmingCheckout && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-3 text-sm" role="status">
            <Loader2 className="h-4 w-4 animate-spin text-indigo-300" /> Confirming your payment…
          </div>
        )}
        {checkoutNotice && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm" role="status">
            <CheckCircle2 className="h-4 w-4 text-emerald-300" />
            <span className="flex-1">{checkoutNotice}</span>
            <button onClick={() => setCheckoutNotice(null)} aria-label="Dismiss" className="text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {pendingUnlock && (
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-3 text-sm" role="status">
            <CheckCircle2 className="h-4 w-4 text-indigo-300" />
            <span className="flex-1">
              {paywallBusy === "unlock" ? "Thanks for your purchase! Unlocking your full audit…" : "Thanks for your purchase! Unlock the full audit for the analysis you ran before checkout."}
            </span>
            <button onClick={() => unlockSealed(pendingUnlock.sealed, pendingUnlock.wsKey, 2)} disabled={paywallBusy === "unlock"} className={primaryBtn}>
              {paywallBusy === "unlock" && <Loader2 className="h-4 w-4 animate-spin" />} {paywallBusy === "unlock" ? "Unlocking" : "Unlock now"}
            </button>
            <button
              onClick={() => {
                safeSession((s) => s.removeItem(PENDING_UNLOCK_KEY));
                setPendingUnlock(null);
              }}
              aria-label="Dismiss"
              className="text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
            {paywallMsg && <p className="w-full text-amber-200">{paywallMsg}</p>}
          </div>
        )}

        {/* Input selector: tabs on small screens, side-by-side on large */}
        <div role="tablist" aria-label="Input method" className={cn(glass, "mb-4 inline-flex p-1 lg:hidden")}>
          {(
            [
              ["form", "Guided Input Form", ClipboardList],
              ["upload", "Upload Statement", Upload],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn("inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm transition", tab === key ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200")}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className={cn(tab !== "form" && "hidden lg:block")}>
            <PanelBoundary title="Guided form">
              <GuidedForm
                key={`${wsKey}-${mode}`}
                draftKey={draftKey(app.user.id, wsKey, mode)}
                mode={mode}
                defaultType={formDefaultType}
                disabled={loading}
                onSubmit={(payload) => runAnalysis({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })}
              />
            </PanelBoundary>
          </div>
          <div className={cn(tab !== "upload" && "hidden lg:block")}>
            <PanelBoundary title="Statement upload">
              <StatementUploader key={`${wsKey}-${mode}`} mode={mode} disabled={loading} onSubmit={runAnalysis} />
            </PanelBoundary>
          </div>
        </section>

        {loading && (
          <div className={cn(glass, "mt-6 flex items-center gap-3 p-5 text-slate-300")} role="status">
            <Loader2 className="h-5 w-5 animate-spin text-indigo-300" />
            Analyzing in memory — large statements can take a minute.
          </div>
        )}
        {error && (
          <div role="alert" className="mt-6 flex items-start gap-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-rose-100">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="flex-1 text-sm">{error}</p>
            <button onClick={() => setError(null)} aria-label="Dismiss error" className="text-rose-200 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {analysis && paywall && (
          <div ref={resultsRef} className="mt-10 scroll-mt-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">Results</h2>
              {teaser ? (
                <button onClick={() => paywall.checkout("report")} className={cn(secondaryBtn, "text-slate-300")} title="Unlock the full audit to download">
                  <Lock className="h-4 w-4" /> Download Executive PDF Report
                </button>
              ) : (
                <button onClick={() => printExecutiveReport(analysis)} className={cn(primaryBtn, "shadow-lg shadow-indigo-500/25")}>
                  <Download className="h-4 w-4" /> Download Executive PDF Report
                </button>
              )}
            </div>

            {teaser && <TeaserBanner paywall={paywall} />}

            <PanelBoundary title="Summary">
              <KpiRow analysis={analysis} mode={modeOf(analysis.businessType)} locked={teaser} />
            </PanelBoundary>
            <div className="grid gap-6 xl:grid-cols-3">
              <div className="space-y-6 xl:col-span-2">
                <PanelBoundary title="Projection chart">
                  {teaser ? (
                    <LockedSection title="12-Month Macro-Adjusted Projection" paywall={paywall} placeholder={<FakeChart />} />
                  ) : (
                    <ProjectionCharts analysis={analysis} />
                  )}
                </PanelBoundary>
                <PanelBoundary title="Scenario forecasting">
                  {isPro && !teaser ? (
                    <ScenarioPanel analysis={analysis} workspaceId={ws?.id ?? null} />
                  ) : (
                    <LockedSection title="Interactive Scenario Forecasting" paywall={paywall} proOnly placeholder={<FakeScenarioChat mode={mode} />} />
                  )}
                </PanelBoundary>
                <PanelBoundary title="Line items">
                  <LineItems analysis={analysis} />
                </PanelBoundary>
              </div>
              <div className="space-y-6">
                <PanelBoundary title="Audit Mode">
                  <AuditPanel analysis={analysis} paywall={paywall} />
                </PanelBoundary>
                <PanelBoundary title="Winner insight">
                  <WinnerCard analysis={analysis} label={copy.revenue} />
                </PanelBoundary>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode toggle
// ---------------------------------------------------------------------------

function ModeToggle({ mode, onChange }: { mode: WorkspaceMode; onChange: (m: WorkspaceMode) => void }) {
  return (
    <div role="radiogroup" aria-label="Finance mode" className={cn(glass, "inline-flex rounded-xl p-1 text-sm")}>
      {(
        [
          ["BUSINESS", "Business", Briefcase],
          ["PERSONAL", "Personal", Home],
        ] as const
      ).map(([m, label, Icon]) => (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          onClick={() => onChange(m)}
          className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition", mode === m ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200")}
        >
          <Icon className="h-4 w-4" /> {label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guided form
// ---------------------------------------------------------------------------

interface FormRevenue {
  id: number;
  label: string;
  amount: string;
  margin: string; // percent, 0–100
  /** Every line starts recurring; the owner can flip single amounts (a bonus, a refund) to one-time. */
  oneTime: boolean;
}
interface FormExpense {
  id: number;
  label: string;
  amount: string;
  category: string;
  /** Every line starts recurring; the owner can flip single charges (a late fee, one purchase) to one-time. */
  oneTime: boolean;
}

type FormPayload = {
  mode: "form";
  businessType: BusinessType;
  revenue: { label: string; amount: number; margin?: number; oneTime?: true }[];
  expenses: { label: string; amount: number; category: string; oneTime?: true }[];
  /** "statement" = parsed from an upload and reviewed by the owner. */
  origin?: "manual" | "statement";
};

let nextId = 1;
const newId = () => nextId++;

const blankRevenue = (label = ""): FormRevenue => ({ id: newId(), label, amount: "", margin: "", oneTime: false });
const blankExpense = (category = ""): FormExpense => ({ id: newId(), label: "", amount: "", category, oneTime: false });

const validRevenueRows = (rows: FormRevenue[]) => rows.filter((r) => r.label.trim() && Number(r.amount) > 0);
const validExpenseRows = (rows: FormExpense[]) => rows.filter((e) => expenseLabel(e) && Number(e.amount) > 0);

/** Form rows → API payload lines. Only valid rows are sent; `oneTime` is sent only when set. */
function toPayloadLines(revenue: FormRevenue[], expenses: FormExpense[], personal: boolean): Pick<FormPayload, "revenue" | "expenses"> {
  return {
    revenue: validRevenueRows(revenue).map((r) => ({
      label: r.label.trim(),
      amount: Number(r.amount),
      ...(!personal && r.margin !== "" && Number.isFinite(Number(r.margin)) ? { margin: Math.min(100, Math.max(0, Number(r.margin))) / 100 } : {}),
      ...(r.oneTime ? { oneTime: true as const } : {}),
    })),
    expenses: validExpenseRows(expenses).map((e) => ({
      label: expenseLabel(e),
      amount: Number(e.amount),
      category: e.category.trim() || "Uncategorized",
      ...(e.oneTime ? { oneTime: true as const } : {}),
    })),
  };
}

/** Recurring-per-month and one-time totals of the valid rows. */
function rowTotals(rows: { amount: string; oneTime: boolean }[]) {
  return splitTotals(rows.map((r) => ({ amount: Number(r.amount) || 0, oneTime: r.oneTime })));
}

function templateRows(bt: BusinessType) {
  const t = CATEGORY_TEMPLATES[bt];
  const essentials = t.expenses.filter((e) => e.essential);
  // Custom businesses have no essentials: start with two blank lines to fill in.
  const seed = bt === "OTHER_CUSTOM" ? [{ category: "" }, { category: "" }] : bt === "PERSONAL_FAMILY" ? t.expenses.slice(0, 6) : essentials;
  return {
    revenue: t.revenue.slice(0, bt === "OTHER_CUSTOM" ? 1 : 2).map((label) => blankRevenue(bt === "OTHER_CUSTOM" ? "" : label)),
    // Category is chosen first; the line item is a distinct description (left blank, with an example placeholder).
    expenses: seed.map((e) => blankExpense(e.category)),
  };
}

/** What gets sent as the line label: the user's description, or the category when they left it blank. */
const expenseLabel = (e: FormExpense) => e.label.trim() || e.category.trim();

const STEPS = ["Type", "Income", "Expenses", "Review"] as const;

/** Drafts saved before the recurring toggle existed have no `oneTime`; those rows load as recurring. */
const optionalBool = (v: unknown) => v === undefined || typeof v === "boolean";
const isFormRevenue = (r: unknown): r is FormRevenue =>
  !!r &&
  typeof r === "object" &&
  typeof (r as FormRevenue).id === "number" &&
  ["label", "amount", "margin"].every((k) => typeof (r as unknown as Record<string, unknown>)[k] === "string") &&
  optionalBool((r as FormRevenue).oneTime);
const isFormExpense = (e: unknown): e is FormExpense =>
  !!e &&
  typeof e === "object" &&
  typeof (e as FormExpense).id === "number" &&
  ["label", "amount", "category"].every((k) => typeof (e as unknown as Record<string, unknown>)[k] === "string") &&
  optionalBool((e as FormExpense).oneTime);

/** Reads a saved draft for this form, validating its shape and keeping row ids unique. Client-only (the form never SSRs). */
function restoreDraft(key: string, mode: WorkspaceMode) {
  const d = loadDraft<unknown, unknown>(key);
  if (!d || !isBusinessType(d.businessType) || modeOf(d.businessType) !== mode) return null;
  if (!d.revenue.every(isFormRevenue) || !d.expenses.every(isFormExpense)) return null;
  const revenue = (d.revenue as FormRevenue[]).map((r) => ({ ...r, oneTime: r.oneTime === true }));
  const expenses = (d.expenses as FormExpense[]).map((e) => ({ ...e, oneTime: e.oneTime === true }));
  nextId = Math.max(nextId, ...revenue.map((r) => r.id + 1), ...expenses.map((e) => e.id + 1));
  return { step: Math.min(Math.max(0, Math.trunc(d.step)), STEPS.length - 1), businessType: d.businessType, revenue, expenses };
}

function GuidedForm({
  draftKey: storageKey,
  mode,
  defaultType,
  disabled,
  onSubmit,
}: {
  draftKey: string;
  mode: WorkspaceMode;
  defaultType: BusinessType;
  disabled: boolean;
  onSubmit: (p: FormPayload) => Promise<boolean>;
}) {
  const personal = mode === "PERSONAL";
  const copy = MODE_COPY[mode];
  // Hydrate once from the saved draft (if any) so a refresh lands on the same step with the same inputs.
  const [initial] = useState(() => restoreDraft(storageKey, mode));
  const [restored, setRestored] = useState(!!initial);
  const [step, setStep] = useState(initial?.step ?? 0);
  const [businessType, setBusinessType] = useState<BusinessType>(initial?.businessType ?? defaultType);
  const [revenue, setRevenue] = useState<FormRevenue[]>(() => initial?.revenue ?? templateRows(defaultType).revenue);
  const [expenses, setExpenses] = useState<FormExpense[]>(() => initial?.expenses ?? templateRows(defaultType).expenses);

  // Auto-save every change once the user has interacted with the form (an untouched template isn't stored).
  const touched = useRef(!!initial);
  const markTouched = () => {
    touched.current = true;
  };
  useEffect(() => {
    if (touched.current) saveDraft(storageKey, { step, businessType, revenue, expenses });
  }, [storageKey, step, businessType, revenue, expenses]);

  const startOver = () => {
    clearDraft(storageKey);
    const rows = templateRows(defaultType);
    touched.current = false;
    setStep(0);
    setBusinessType(defaultType);
    setRevenue(rows.revenue);
    setExpenses(rows.expenses);
    setRestored(false);
  };

  const chooseType = (bt: BusinessType) => {
    setBusinessType(bt);
    // Re-seed templates only while no amounts have been entered.
    if ([...revenue, ...expenses].every((r) => !r.amount)) {
      const rows = templateRows(bt);
      setRevenue(rows.revenue);
      setExpenses(rows.expenses);
    }
  };

  const custom = businessType === "OTHER_CUSTOM";
  const validRevenue = validRevenueRows(revenue);
  const validExpenses = validExpenseRows(expenses);

  // Household tab: each category chip toggles its expense line on or off.
  const isCategoryOn = (c: string) => expenses.some((e) => e.category === c);
  const toggleCategory = (c: string) => setExpenses((rows) => (rows.some((e) => e.category === c) ? rows.filter((e) => e.category !== c) : [...rows, blankExpense(c)]));
  const canNext = step === 0 || (step === 1 ? validRevenue.length > 0 : true);
  const stepLabels = STEPS.map((s, i) => (i === 0 ? (personal ? "Household" : "Business") : i === 1 ? copy.revenue : s));

  const submit = async () => {
    const ok = await onSubmit({ mode: "form", businessType, ...toPayloadLines(revenue, expenses, personal) });
    // The report was generated: the draft has served its purpose. Further edits start a new draft.
    if (ok) {
      clearDraft(storageKey);
      touched.current = false;
      setRestored(false);
    }
  };

  return (
    <div className={cn(glass, "flex h-full flex-col p-6")} onClickCapture={markTouched} onChangeCapture={markTouched}>
      <div className="flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-indigo-300" />
        <h2 className="text-lg font-semibold">Guided Input Form</h2>
      </div>
      {restored && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-slate-400" role="status">
          <Bookmark className="h-3 w-3 text-indigo-300" /> Restored your unsaved progress from this device.
          <button type="button" onClick={startOver} className="text-indigo-300 underline-offset-2 hover:underline">
            Start over
          </button>
        </p>
      )}

      <ol className="mt-5 flex gap-2" aria-label="Progress">
        {stepLabels.map((s, i) => (
          <li key={s} className="flex-1">
            <div className={cn("h-1 rounded-full", i <= step ? "bg-indigo-400" : "bg-white/10")} />
            <span className={cn("mt-1.5 block text-xs", i === step ? "text-slate-100" : "text-slate-500")}>{s}</span>
          </li>
        ))}
      </ol>

      <div className="mt-6 flex-1">
        {step === 0 &&
          (personal ? (
            <fieldset className="space-y-3 text-sm">
              <legend className="mb-2 text-slate-400">
                Which spending categories apply to your household? Selected categories become lines you fill in on the Spending step. Personal Finance mode uses the 50/30/20 budgeting guideline.
              </legend>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_TEMPLATES.PERSONAL_FAMILY.expenses.map((e) => {
                  const on = isCategoryOn(e.category);
                  const help = CATEGORY_HELP[e.category];
                  return (
                    <button
                      key={e.category}
                      type="button"
                      aria-pressed={on}
                      title={help}
                      onClick={() => toggleCategory(e.category)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300",
                        on ? "border-indigo-400/60 bg-indigo-500/15 text-white" : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]",
                      )}
                    >
                      {on ? <CheckCircle2 className="h-3.5 w-3.5 text-indigo-300" /> : <Plus className="h-3.5 w-3.5 text-slate-500" />}
                      {e.category}
                    </button>
                  );
                })}
              </div>
              {isCategoryOn("Investments") && CATEGORY_HELP.Investments && (
                <p className="flex items-start gap-1.5 text-xs text-slate-400">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" /> <span>
                    <span className="text-slate-300">Investments:</span> {CATEGORY_HELP.Investments}
                  </span>
                </p>
              )}
              <p className="text-xs text-slate-500">
                {new Set(expenses.map((e) => e.category).filter(Boolean)).size} selected · you can add custom lines later.
              </p>
            </fieldset>
          ) : (
            <fieldset className="space-y-3">
              <legend className="mb-2 text-sm text-slate-400">What kind of business is this?</legend>
              {BUSINESS_ONLY_TYPES.map((bt) => (
                <label
                  key={bt}
                  className={cn("flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition", businessType === bt ? "border-indigo-400/60 bg-indigo-500/10" : "border-white/10 hover:bg-white/5")}
                >
                  <input type="radio" name="bt" className="accent-indigo-400" checked={businessType === bt} onChange={() => chooseType(bt)} />
                  <span className="text-sm">
                    {BUSINESS_TYPE_LABELS[bt]}
                    {bt === "OTHER_CUSTOM" && <span className="block text-xs text-slate-500">Define your own revenue and expense line items.</span>}
                  </span>
                </label>
              ))}
            </fieldset>
          ))}

        {step === 1 && (
          <RevenueRowsEditor
            rows={revenue}
            setRows={setRevenue}
            mode={mode}
            custom={custom}
            hint={personal ? "Take-home income from each source. Lines repeat monthly unless you mark them one-time." : "Monthly amounts; mark single payments one-time. Margin is optional — we'll estimate it if blank."}
          />
        )}

        {step === 2 && (
          <ExpenseRowsEditor
            rows={expenses}
            setRows={setExpenses}
            mode={mode}
            businessType={businessType}
            hint={
              custom
                ? "Add your own expense lines and name the categories however you like. Mark single charges (a late fee, one purchase) as one-time."
                : personal
                  ? "Pick a category, then optionally describe the specific item (e.g. which card or service). Lines repeat monthly unless you mark them one-time."
                  : "We pre-filled the essential categories for your business type. Describe each line item, or leave a line at 0 if it truly doesn't apply — we'll flag it. Mark single charges as one-time."
            }
          />
        )}

        {step === 3 && <ReviewSummary mode={mode} businessType={businessType} revenue={validRevenue} expenses={validExpenses} />}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-30">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        {step < STEPS.length - 1 ? (
          <button onClick={() => setStep((s) => s + 1)} disabled={!canNext} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/15 disabled:opacity-40">
            Next <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button onClick={submit} disabled={disabled || validRevenue.length === 0} className={primaryBtn}>
            {disabled && <Loader2 className="h-4 w-4 animate-spin" />} Analyze
          </button>
        )}
      </div>
    </div>
  );
}

/** Editable revenue / income lines. Shared by the guided form and the post-upload review. */
function RevenueRowsEditor({
  rows,
  setRows,
  mode,
  custom = false,
  hint,
}: {
  rows: FormRevenue[];
  setRows: (fn: (rows: FormRevenue[]) => FormRevenue[]) => void;
  mode: WorkspaceMode;
  custom?: boolean;
  hint: string;
}) {
  const personal = mode === "PERSONAL";
  const copy = MODE_COPY[mode];
  return (
    <RowEditor
      hint={hint}
      columns={personal ? [copy.revenueLines, "Amount", "Recurring / one-time"] : [copy.revenueLines, "Amount", "Margin %", "Recurring / one-time"]}
      rows={rows}
      onAdd={() => setRows((r) => [...r, blankRevenue()])}
      onRemove={(id) => setRows((r) => r.filter((x) => x.id !== id))}
      render={(row, removeButton) => {
        const update = (patch: Partial<FormRevenue>) => setRows((r) => r.map((x) => (x.id === row.id ? { ...x, ...patch } : x)));
        return (
          <>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <TextInput aria-label={copy.revenueLines} value={row.label} placeholder={custom ? "e.g. Catering orders" : "Describe the source"} onChange={(v) => update({ label: v })} />
              </div>
              {removeButton}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-[7.5rem]">
                <MoneyInput aria-label={row.oneTime ? "One-time amount" : "Monthly amount"} value={row.amount} onChange={(v) => update({ amount: v })} />
              </div>
              {!personal && (
                <div className="w-[7.5rem]">
                  <NumInput aria-label="Margin percent" value={row.margin} placeholder="Margin % (auto)" onChange={(v) => update({ margin: v })} />
                </div>
              )}
              <RecurrenceToggle oneTime={row.oneTime} onChange={(oneTime) => update({ oneTime })} />
            </div>
          </>
        );
      }}
    />
  );
}

/** Editable expense / spending lines. Shared by the guided form and the post-upload review. */
function ExpenseRowsEditor({
  rows,
  setRows,
  mode,
  businessType,
  hint,
}: {
  rows: FormExpense[];
  setRows: (fn: (rows: FormExpense[]) => FormExpense[]) => void;
  mode: WorkspaceMode;
  businessType: BusinessType;
  hint: string;
}) {
  const personal = mode === "PERSONAL";
  const custom = businessType === "OTHER_CUSTOM";
  const datalistId = useId();
  const templateCategories = CATEGORY_TEMPLATES[businessType].expenses.map((e) => e.category);
  // Parsed statements can carry categories outside the template; keep them selectable.
  const categoryOptions = Array.from(new Set([...templateCategories, ...rows.map((r) => r.category.trim()).filter(Boolean)]));
  return (
    <>
      <RowEditor
        hint={hint}
        columns={["Category", personal ? "What it's for" : "Line item", "Amount", "Recurring / one-time"]}
        rows={rows}
        onAdd={() => setRows((r) => [...r, blankExpense()])}
        onRemove={(id) => setRows((r) => r.filter((x) => x.id !== id))}
        render={(row, removeButton) => {
          const update = (patch: Partial<FormExpense>) => setRows((r) => r.map((x) => (x.id === row.id ? { ...x, ...patch } : x)));
          const help = personal ? CATEGORY_HELP[row.category] : undefined;
          return (
            <>
              <div className="flex items-center gap-2">
                {custom ? (
                  <input aria-label="Category" list={datalistId} value={row.category} placeholder="Your category" title={row.category || undefined} onChange={(ev) => update({ category: ev.target.value })} className={cn(inputCls, "min-w-0 flex-1")} />
                ) : (
                  <select aria-label="Category" value={row.category} title={row.category || "Auto-classify"} onChange={(ev) => update({ category: ev.target.value })} className={cn(inputCls, "min-w-0 flex-1 pr-8")}>
                    <option value="">Auto-classify from description</option>
                    {categoryOptions.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                    {!categoryOptions.includes("Other") && <option>Other</option>}
                  </select>
                )}
                {removeButton}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-[10rem] flex-1">
                  <TextInput
                    aria-label={personal ? "What it's for" : "Line item"}
                    value={row.label}
                    placeholder={CATEGORY_LINE_HINTS[row.category] ?? (row.category ? "Optional description" : "Describe the expense")}
                    onChange={(v) => update({ label: v })}
                  />
                </div>
                <div className="w-[7.5rem]">
                  <MoneyInput aria-label={row.oneTime ? "One-time amount" : "Monthly amount"} value={row.amount} onChange={(v) => update({ amount: v })} />
                </div>
                <RecurrenceToggle oneTime={row.oneTime} onChange={(oneTime) => update({ oneTime })} />
              </div>
              {help && (
                <p className="flex items-start gap-1.5 text-xs text-slate-400">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" /> {help}
                </p>
              )}
            </>
          );
        }}
      />
      {custom && (
        <datalist id={datalistId}>
          {categoryOptions.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      )}
    </>
  );
}

/** Recurring (default) ↔ one-time switch for a single line item. */
function RecurrenceToggle({ oneTime, onChange }: { oneTime: boolean; onChange: (oneTime: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={oneTime}
      aria-label="One-time amount"
      title={oneTime ? "One-time: counted once, in the first projected month. Click to make it recurring." : "Recurring: repeats every month. Click to mark it one-time."}
      onClick={() => onChange(!oneTime)}
      className={cn(
        "inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300",
        oneTime ? "border-amber-300/40 bg-amber-400/10 text-amber-100 hover:bg-amber-400/15" : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]",
      )}
    >
      {oneTime ? <Repeat1 className="h-3.5 w-3.5" /> : <Repeat className="h-3.5 w-3.5 text-slate-400" />}
      {oneTime ? "One-time" : "Recurring"}
    </button>
  );
}

/** Totals before submitting: recurring per month, with one-time amounts listed separately. */
function ReviewSummary({ mode, businessType, revenue, expenses }: { mode: WorkspaceMode; businessType: BusinessType; revenue: FormRevenue[]; expenses: FormExpense[] }) {
  const copy = MODE_COPY[mode];
  const rev = rowTotals(revenue);
  const exp = rowTotals(expenses);
  const oneTimeRev = revenue.filter((r) => r.oneTime).length;
  const oneTimeExp = expenses.filter((e) => e.oneTime).length;
  return (
    <dl className="space-y-3 text-sm">
      <ReviewRow label={mode === "PERSONAL" ? "Mode" : "Business type"} value={BUSINESS_TYPE_LABELS[businessType]} />
      <ReviewRow label={`${copy.revenue} / month (${revenue.length - oneTimeRev} recurring)`} value={usd.format(rev.recurring)} />
      <ReviewRow label={`${copy.expenses} / month (${expenses.length - oneTimeExp} recurring)`} value={usd.format(exp.recurring)} />
      <ReviewRow label={copy.net} value={usd.format(rev.recurring - exp.recurring)} />
      {(oneTimeRev > 0 || oneTimeExp > 0) && (
        <ReviewRow
          label={`One-time (${oneTimeRev + oneTimeExp} line${oneTimeRev + oneTimeExp === 1 ? "" : "s"}, first month only)`}
          value={`${rev.oneTime - exp.oneTime >= 0 ? "+" : ""}${usd.format(rev.oneTime - exp.oneTime)}`}
        />
      )}
    </dl>
  );
}

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function RowEditor<T extends { id: number }>(props: {
  hint: string;
  columns: string[];
  rows: T[];
  onAdd: () => void;
  onRemove: (id: number) => void;
  /** Rendered inside a stacked card per line, so long labels (e.g. category names) get full width. */
  render: (row: T, removeButton: ReactNode) => ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const scrollToNew = useRef(false);
  const count = props.rows.length;

  // After "Add line": bring the new (last) row into view inside the scrolling list and the page, then focus its first field.
  useEffect(() => {
    if (!scrollToNew.current) return;
    scrollToNew.current = false;
    const row = listRef.current?.lastElementChild as HTMLElement | null;
    if (!row) return;
    row.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "nearest" });
    row.querySelector<HTMLElement>("input, select")?.focus({ preventScroll: true });
  }, [count]);

  const add = () => {
    scrollToNew.current = true;
    props.onAdd();
  };

  const remove = (id: number) => (
    <button type="button" onClick={() => props.onRemove(id)} aria-label="Remove line" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-rose-300">
      <Trash2 className="h-4 w-4" />
    </button>
  );
  return (
    <div>
      <p className="mb-3 text-sm text-slate-400">{props.hint}</p>
      <p className="px-1 pb-1 text-xs uppercase tracking-wide text-slate-500">{props.columns.join(" → ")}</p>
      <div ref={listRef} className="max-h-80 space-y-3 overflow-y-auto scroll-py-2 pr-1">
        {props.rows.map((row) => (
          <div key={row.id} className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            {props.render(row, remove(row.id))}
          </div>
        ))}
      </div>
      <button type="button" onClick={add} className="mt-3 inline-flex items-center gap-1.5 text-sm text-indigo-300 hover:text-indigo-200">
        <Plus className="h-4 w-4" /> Add line
      </button>
    </div>
  );
}

function TextInput({ value, onChange, ...rest }: { value: string; onChange: (v: string) => void; placeholder?: string; "aria-label": string }) {
  return <input {...rest} value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />;
}

function NumInput({ value, onChange, placeholder = "0", ...rest }: { value: string; onChange: (v: string) => void; placeholder?: string; "aria-label": string }) {
  return <input {...rest} type="number" inputMode="decimal" min={0} step="any" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, "tabular-nums")} />;
}

/**
 * Normalizes typed/pasted money to a plain decimal string: digits, at most one decimal point,
 * up to 2 decimals, no redundant leading zeros ("$1,00.0.5" → "100.05", "007" → "7", "." → "0.").
 */
const cleanMoney =(raw: string) => {
  const [rawWhole, ...rest] = raw.replace(/[^\d.]/g, "").split(".");
  const whole = rawWhole.replace(/^0+(?=\d)/, "");
  if (!rest.length) return whole;
  return `${whole || "0"}.${rest.join("").slice(0, 2)}`;
};

/** On blur: "12" → "12.00", "12.5" → "12.50", "12." → "12.00". Empty stays empty so the placeholder shows. */
const padMoney = (v: string) => (v === "" || !Number.isFinite(Number(v)) ? v : Number(v).toFixed(2));

/**
 * Text input (not type=number) so the bound value is exactly the normalized string, with a static $ prefix
 * and a faded 0.00 placeholder that typing replaces.
 */
function MoneyInput({ value, onChange, placeholder = "0.00", ...rest }: { value: string; onChange: (v: string) => void; placeholder?: string; "aria-label": string }) {
  return (
    <div className="group relative">
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500 transition group-focus-within:text-indigo-300">
        $
      </span>
      <input
        {...rest}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(cleanMoney(e.target.value))}
        onBlur={() => {
          const padded = padMoney(value);
          if (padded !== value) onChange(padded);
        }}
        className={cn(inputCls, "pl-7 tabular-nums placeholder:text-slate-600/80")}
      />
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-white/5 pb-2">
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Statement uploader
// ---------------------------------------------------------------------------

const ACCEPT = ".pdf,.txt,.csv,application/pdf,text/plain,text/csv";

interface UploadReviewState {
  businessType: BusinessType;
  revenue: FormRevenue[];
  expenses: FormExpense[];
}

/** Parsed statement lines → editable form rows. Amounts are shown with cents; margins as percents. */
function toReviewState(items: { businessType: BusinessType; revenue: RevenueLine[]; expenses: ExpenseLine[] }, mode: WorkspaceMode): UploadReviewState {
  const personal = mode === "PERSONAL";
  // A business workspace always gets a business analysis, even if the statement looked personal.
  const businessType: BusinessType = personal ? "PERSONAL_FAMILY" : items.businessType === "PERSONAL_FAMILY" ? "OTHER_CUSTOM" : items.businessType;
  return {
    businessType,
    revenue: items.revenue.map((r) => ({
      ...blankRevenue(r.label),
      amount: r.amount.toFixed(2),
      margin: personal || !Number.isFinite(r.margin) ? "" : String(Math.round(r.margin * 100)),
      oneTime: r.oneTime === true,
    })),
    expenses: items.expenses.map((e) => ({ ...blankExpense(e.category), label: e.label, amount: e.amount.toFixed(2), oneTime: e.oneTime === true })),
  };
}

function StatementUploader({ mode, disabled, onSubmit }: { mode: WorkspaceMode; disabled: boolean; onSubmit: (init: RequestInit) => Promise<boolean> }) {
  const personal = mode === "PERSONAL";
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [input, setInput] = useState<"file" | "paste">("file");
  const [businessType, setBusinessType] = useState<BusinessType | "">(personal ? "PERSONAL_FAMILY" : "");
  const [dragOver, setDragOver] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [review, setReview] = useState<UploadReviewState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const ready = input === "file" ? !!file : pasted.trim().length > 0;
  const busy = disabled || extracting;

  /** Same document payload for both paths; "extract" returns line items only, "text"/file runs the full analysis. */
  const documentInit = (extract: boolean): RequestInit => {
    if (input === "file" && file) {
      const fd = new FormData();
      fd.append("file", file);
      if (businessType) fd.append("businessType", businessType);
      if (extract) fd.append("mode", "extract");
      return { body: fd };
    }
    return {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: extract ? "extract" : "text", rawText: pasted, ...(businessType ? { businessType } : {}) }),
    };
  };

  const extract = async () => {
    setExtracting(true);
    setExtractError(null);
    try {
      const init = documentInit(true);
      const res = await fetch("/api/analyze", { method: "POST", ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...(await authHeaders()) } });
      if (!res.ok) throw new Error(await errorMessage(res));
      const data = (await res.json()) as { items?: unknown };
      if (!isExtractedLineItems(data.items)) throw new Error("Received an unexpected response from the analysis service.");
      setReview(toReviewState(data.items, mode));
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : "Couldn't read the statement.");
    } finally {
      setExtracting(false);
    }
  };

  if (review) {
    return (
      <UploadReview
        mode={mode}
        review={review}
        setReview={setReview}
        disabled={disabled}
        onBack={() => setReview(null)}
        onGenerate={(payload) => onSubmit({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })}
      />
    );
  }

  return (
    <div className={cn(glass, "flex h-full flex-col p-6")}>
      <div className="flex items-center gap-2">
        <Upload className="h-5 w-5 text-indigo-300" />
        <h2 className="text-lg font-semibold">{personal ? "Upload Bank / Card Statement" : "Upload Bank / P&L Statement"}</h2>
      </div>
      <p className="mt-1 text-sm text-slate-400">PDF, CSV or plain text. Scanned PDFs work too.</p>

      <div className="mt-5 inline-flex self-start rounded-lg border border-white/10 p-0.5 text-sm">
        {(["file", "paste"] as const).map((m) => (
          <button key={m} onClick={() => setInput(m)} className={cn("rounded-md px-3 py-1.5", input === m ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200")}>
            {m === "file" ? "Upload file" : "Paste text"}
          </button>
        ))}
      </div>

      <div className="mt-4 flex-1">
        {input === "file" ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files[0];
              if (f) setFile(f);
            }}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
            role="button"
            tabIndex={0}
            className={cn(
              "grid h-full min-h-48 cursor-pointer place-items-center rounded-xl border-2 border-dashed p-6 text-center transition",
              dragOver ? "border-indigo-400 bg-indigo-500/10" : "border-white/15 hover:border-white/30 hover:bg-white/[0.03]",
            )}
          >
            <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file ? (
              <div className="flex items-center gap-3 text-left">
                <FileText className="h-8 w-8 text-indigo-300" />
                <div>
                  <p className="text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(0)} KB · click to replace</p>
                </div>
              </div>
            ) : (
              <div>
                <Upload className="mx-auto h-8 w-8 text-slate-500" />
                <p className="mt-2 text-sm text-slate-300">Drop a statement here or click to browse</p>
                <p className="mt-1 text-xs text-slate-500">Up to 15 MB</p>
              </div>
            )}
          </div>
        ) : (
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={personal ? "Paste transactions…\n03/01  PAYROLL DEPOSIT  3,250.00\n03/04  KROGER  -142.18" : "Paste transactions or a P&L…\n03/02  Home Depot   -412.18\n03/05  Rent - Unit 2B  2,150.00"}
            className={cn(inputCls, "h-full min-h-48 resize-y font-mono text-xs")}
          />
        )}
      </div>

      {!personal && (
        <label className="mt-4 block text-sm">
          <span className="text-slate-400">Business type (optional)</span>
          <select value={businessType} onChange={(e) => setBusinessType(e.target.value as BusinessType | "")} className={cn(inputCls, "mt-1")}>
            <option value="">Detect automatically</option>
            {BUSINESS_ONLY_TYPES.map((bt) => (
              <option key={bt} value={bt}>
                {BUSINESS_TYPE_LABELS[bt]}
              </option>
            ))}
          </select>
        </label>
      )}

      <p className="mt-4 flex items-start gap-1.5 text-xs text-slate-500">
        <Lock className="mt-0.5 h-3 w-3 shrink-0" /> Encrypted in transit and parsed in memory. LedgerPulse never writes your file to disk or a database.
      </p>

      {extractError && (
        <p role="alert" className="mt-4 flex items-start gap-1.5 text-sm text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {extractError}
        </p>
      )}

      <button onClick={extract} disabled={busy || !ready} className={cn(primaryBtn, "mt-4 py-2.5")}>
        {extracting && <Loader2 className="h-4 w-4 animate-spin" />} {extracting ? "Reading line items…" : "Extract & review line items"}
      </button>
      <button type="button" onClick={() => void onSubmit(documentInit(false))} disabled={busy || !ready} className="mt-2 self-center text-xs text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline disabled:opacity-40">
        Skip review and analyze directly
      </button>
    </div>
  );
}

/** Post-upload step: the owner edits, re-categorizes, deletes or adds parsed lines, then generates the report. */
function UploadReview({
  mode,
  review,
  setReview,
  disabled,
  onBack,
  onGenerate,
}: {
  mode: WorkspaceMode;
  review: UploadReviewState;
  setReview: (fn: (r: UploadReviewState | null) => UploadReviewState | null) => void;
  disabled: boolean;
  onBack: () => void;
  onGenerate: (payload: FormPayload) => Promise<boolean>;
}) {
  const personal = mode === "PERSONAL";
  const copy = MODE_COPY[mode];
  const { businessType, revenue, expenses } = review;
  const validRevenue = validRevenueRows(revenue);
  const validExpenses = validExpenseRows(expenses);
  const setRevenue = (fn: (rows: FormRevenue[]) => FormRevenue[]) => setReview((r) => r && { ...r, revenue: fn(r.revenue) });
  const setExpenses = (fn: (rows: FormExpense[]) => FormExpense[]) => setReview((r) => r && { ...r, expenses: fn(r.expenses) });

  return (
    <div className={cn(glass, "flex h-full flex-col p-6")}>
      <div className="flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-indigo-300" />
        <h2 className="text-lg font-semibold">Review parsed line items</h2>
      </div>
      <p className="mt-1 text-sm text-slate-400">
        We read {revenue.length + expenses.length} line{revenue.length + expenses.length === 1 ? "" : "s"} from your statement. Fix amounts or categories, delete anything that doesn&apos;t belong,
        add what&apos;s missing, and mark single charges one-time — then generate the report.
      </p>

      {!personal && (
        <label className="mt-4 block text-sm">
          <span className="text-slate-400">Business type</span>
          <select value={businessType} onChange={(e) => setReview((r) => r && { ...r, businessType: e.target.value as BusinessType })} className={cn(inputCls, "mt-1")}>
            {BUSINESS_ONLY_TYPES.map((bt) => (
              <option key={bt} value={bt}>
                {BUSINESS_TYPE_LABELS[bt]}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="mt-5 flex-1 space-y-6">
        <section aria-label={copy.revenue}>
          <h3 className="mb-2 text-sm font-medium text-slate-200">{copy.revenue}</h3>
          <RevenueRowsEditor rows={revenue} setRows={setRevenue} mode={mode} custom={businessType === "OTHER_CUSTOM"} hint="Recurring lines are average monthly amounts; one-time lines are the full single amount." />
        </section>
        <section aria-label={copy.expenses}>
          <h3 className="mb-2 text-sm font-medium text-slate-200">{copy.expenses}</h3>
          <ExpenseRowsEditor rows={expenses} setRows={setExpenses} mode={mode} businessType={businessType} hint="Change a category if it was misread; a blank category is auto-classified." />
        </section>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <ReviewSummary mode={mode} businessType={businessType} revenue={validRevenue} expenses={validExpenses} />
        </div>
      </div>

      {validRevenue.length === 0 && (
        <p className="mt-4 text-sm text-amber-200">Add at least one {personal ? "income" : "revenue"} line with an amount to generate the report.</p>
      )}

      <div className="mt-6 flex items-center justify-between">
        <button type="button" onClick={onBack} disabled={disabled} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-30">
          <ArrowLeft className="h-4 w-4" /> Back to upload
        </button>
        <button
          type="button"
          onClick={() => void onGenerate({ mode: "form", businessType, origin: "statement", ...toPayloadLines(revenue, expenses, personal) })}
          disabled={disabled || validRevenue.length === 0}
          className={primaryBtn}
        >
          {disabled && <Loader2 className="h-4 w-4 animate-spin" />} Generate report
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paywall UI
// ---------------------------------------------------------------------------

function PaywallButtons({ paywall, proOnly = false }: { paywall: Paywall; proOnly?: boolean }) {
  const { access, busy } = paywall;
  const canSpendCredit = !proOnly && access.signedIn && access.reportUnlocks > 0 && !!access.sealed;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
      {canSpendCredit ? (
        <button onClick={paywall.unlock} disabled={!!busy} className={primaryBtn}>
          {busy === "unlock" && <Loader2 className="h-4 w-4 animate-spin" />} Use 1 of {access.reportUnlocks} report unlocks
        </button>
      ) : (
        !proOnly &&
        !paywall.isPro && (
          <button onClick={() => paywall.checkout("report")} disabled={!!busy} className={primaryBtn}>
            {busy === "report" && <Loader2 className="h-4 w-4 animate-spin" />} Unlock Full Audit &amp; Report (${PRICING.reportUnlockUsd})
          </button>
        )
      )}
      {!paywall.isPro && (
        <button
          onClick={() => paywall.checkout("pro")}
          disabled={!!busy}
          className={cn(proOnly ? primaryBtn : secondaryBtn, !proOnly && "border-amber-300/30 text-amber-100 hover:bg-amber-400/10")}
        >
          {busy === "pro" && <Loader2 className="h-4 w-4 animate-spin" />} Upgrade to Pro Subscription (${PRICING.proMonthlyUsd}/mo)
        </button>
      )}
      {paywall.isPro && access.level === "teaser" && (
        <button onClick={paywall.unlock} disabled={!!busy} className={primaryBtn}>
          {busy === "unlock" && <Loader2 className="h-4 w-4 animate-spin" />} Unlock with Pro
        </button>
      )}
    </div>
  );
}

function TeaserBanner({ paywall }: { paywall: Paywall }) {
  const { access } = paywall;
  return (
    <div className={cn(glass, "flex flex-col gap-4 border-indigo-400/20 bg-gradient-to-r from-indigo-500/10 to-transparent p-5 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between")}>
      <div>
        <p className="flex items-center gap-2 font-medium">
          <Sparkles className="h-4 w-4 text-indigo-300" /> You&apos;re viewing the free preview
        </p>
        <p className="mt-1 text-sm text-slate-400">
          {access.lockedFlagCount > 0 ? `${access.lockedFlagCount} more audit flag${access.lockedFlagCount === 1 ? "" : "s"}, ` : ""}
          the potential-savings total, the 12-month projection and the executive report are locked.
        </p>
        {paywall.message && <p className="mt-2 text-sm text-amber-200">{paywall.message}</p>}
      </div>
      <PaywallButtons paywall={paywall} />
      {!paywall.isPro && (
        <div className="grid w-full gap-3 sm:grid-cols-2 lg:basis-full">
          <PlanCard plan="report" />
          <PlanCard plan="pro" />
        </div>
      )}
    </div>
  );
}

/** Blurred, non-interactive placeholder with an overlay CTA. Placeholders contain no real data. */
function LockedSection({ title, paywall, placeholder, proOnly = false }: { title: string; paywall: Paywall; placeholder: ReactNode; proOnly?: boolean }) {
  return (
    <div className={cn(glass, "relative overflow-hidden p-6")}>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Lock className="h-4 w-4 text-slate-400" /> {title}
      </h2>
      <div aria-hidden inert className="pointer-events-none mt-4 select-none blur-md">
        {placeholder}
      </div>
      <div className="absolute inset-0 top-14 grid place-items-center p-4">
        <div className={cn(glass, "max-w-md bg-slate-900/85 p-5 text-center")}>
          <Lock className="mx-auto h-6 w-6 text-indigo-300" />
          <p className="mt-2 font-medium">{proOnly ? "Scenario forecasting is a Pro feature" : "Unlock your full forecast"}</p>
          <p className="mt-1 text-sm text-slate-400">
            {proOnly ? "Ask \"what if\" in plain English and see your adjusted 12-month runway." : "See every month of your seasonality- and inflation-adjusted cash flow."}
          </p>
          <div className="mt-4">
            <PaywallButtons paywall={paywall} proOnly={proOnly} />
          </div>
          {paywall.message && <p className="mt-3 text-sm text-amber-200">{paywall.message}</p>}
        </div>
      </div>
    </div>
  );
}

const FAKE_ROWS = Array.from({ length: 12 }, (_, i) => ({ m: i, a: 50 + 18 * Math.sin(i / 1.8), b: 42 + 10 * Math.cos(i / 2.3) }));

function FakeChart() {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={FAKE_ROWS}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <Line dataKey="a" stroke={COLOR.revenue} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line dataKey="b" stroke={COLOR.expenses} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function FakeScenarioChat({ mode }: { mode: WorkspaceMode }) {
  return (
    <div className="space-y-3">
      <p className="ml-auto max-w-[80%] rounded-2xl bg-indigo-500/70 px-3 py-2 text-sm">{scenarioExamples(mode)[0]}</p>
      <p className="max-w-[80%] rounded-2xl bg-white/[0.06] px-3 py-2 text-sm">Adjusted runway compared to baseline over the next 12 months…</p>
      <FakeChart />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function projectionRows(a: FinancialAnalysis) {
  const rows: Array<FinancialAnalysis["macroProjections"][number] & { net: number; cumulative: number }> = [];
  for (const p of a.macroProjections) {
    const net = p.projectedRevenue - p.projectedExpenses;
    rows.push({ ...p, net, cumulative: (rows.at(-1)?.cumulative ?? 0) + net });
  }
  return rows;
}

function useDerived(a: FinancialAnalysis) {
  return useMemo(() => {
    // Monthly figures are recurring-only; one-time lines are shown separately and land in month 1 of the projection.
    const monthlyExpenses = splitTotals(a.itemizedExpenses).recurring;
    const oneTimeRevenue = splitTotals(a.itemizedRevenue).oneTime;
    const oneTimeExpenses = splitTotals(a.itemizedExpenses).oneTime;
    const net = a.monthlyRevenue - monthlyExpenses;
    const rows = projectionRows(a);
    const annualNet = rows.at(-1)?.cumulative ?? 0;
    const firstNegative = rows.find((r) => r.cumulative < 0)?.month ?? null;
    return { monthlyExpenses, oneTimeRevenue, oneTimeExpenses, net, rows, annualNet, firstNegative };
  }, [a]);
}

function KpiRow({ analysis, mode, locked }: { analysis: FinancialAnalysis; mode: WorkspaceMode; locked: boolean }) {
  const d = useDerived(analysis);
  const copy = MODE_COPY[mode];
  const tiles: { label: string; value: string; sub?: string; bad?: boolean; locked?: boolean }[] = [
    { label: `Monthly ${copy.revenue.toLowerCase()}`, value: usd.format(analysis.monthlyRevenue), sub: d.oneTimeRevenue > 0 ? `+ ${usd.format(d.oneTimeRevenue)} one-time` : undefined },
    { label: `Monthly ${copy.expenses.toLowerCase()}`, value: usd.format(d.monthlyExpenses), sub: d.oneTimeExpenses > 0 ? `+ ${usd.format(d.oneTimeExpenses)} one-time` : undefined },
    { label: copy.net, value: usd.format(d.net), bad: d.net < 0 },
    locked
      ? { label: "12-mo projected net", value: "Locked", sub: "Unlock to see your forecast", locked: true }
      : {
          label: "12-mo projected net",
          value: usd.format(d.annualNet),
          sub: d.firstNegative ? `Cash turns negative in ${d.firstNegative}` : `After ${pct(analysis.inflationRateAssumed)} inflation`,
          bad: d.annualNet < 0,
        },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className={cn(glass, "p-5")}>
          <p className="text-xs uppercase tracking-wide text-slate-400">{t.label}</p>
          <p className={cn("mt-2 flex items-center gap-2 text-2xl font-semibold tabular-nums text-slate-50", t.locked && "text-slate-500")}>
            {t.locked && <Lock className="h-5 w-5" />}
            {t.value}
          </p>
          {t.sub && (
            <p className={cn("mt-1 flex items-center gap-1 text-xs", t.bad ? "text-rose-300" : "text-slate-400")}>
              {t.bad && <AlertTriangle className="h-3 w-3" />}
              {t.sub}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: ReadonlyArray<{ name?: string | number; value?: unknown; color?: string }>; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <p className="mb-1 font-medium text-slate-200">{label}</p>
      {payload.map((p) => (
        <p key={String(p.name)} className="flex items-center gap-2 text-slate-300">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-400">{p.name}</span>
          <span className="ml-auto pl-3 tabular-nums text-slate-100">{usd.format(Number(p.value))}</span>
        </p>
      ))}
    </div>
  );
}

const axisProps = { stroke: "#64748b", tick: { fill: "#94a3b8", fontSize: 12 }, tickLine: false, axisLine: false } as const;

function ProjectionCharts({ analysis }: { analysis: FinancialAnalysis }) {
  const { rows } = useDerived(analysis);
  const [showTable, setShowTable] = useState(false);
  const copy = MODE_COPY[modeOf(analysis.businessType)];

  return (
    <div className={cn(glass, "p-6")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">12-Month Macro-Adjusted Projection</h2>
          <p className="text-sm text-slate-400">
            Seasonality for {BUSINESS_TYPE_LABELS[analysis.businessType].toLowerCase()} · {pct(analysis.inflationRateAssumed)} annual inflation on costs
          </p>
        </div>
        <button onClick={() => setShowTable((s) => !s)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">
          {showTable ? "Show chart" : "Show table"}
        </button>
      </div>

      {showTable ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 font-medium">Month</th>
                <th className="py-2 text-right font-medium">{copy.revenue}</th>
                <th className="py-2 text-right font-medium">{copy.expenses}</th>
                <th className="py-2 text-right font-medium">Net</th>
                <th className="py-2 text-right font-medium">Cumulative</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r) => (
                <tr key={r.month}>
                  <td className="py-2 text-slate-300">{r.month}</td>
                  <td className="py-2 text-right">{usd.format(r.projectedRevenue)}</td>
                  <td className="py-2 text-right">{usd.format(r.projectedExpenses)}</td>
                  <td className={cn("py-2 text-right", r.net < 0 && "text-rose-300")}>{usd.format(r.net)}</td>
                  <td className={cn("py-2 text-right", r.cumulative < 0 && "text-rose-300")}>{usd.format(r.cumulative)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="month" {...axisProps} tickFormatter={(m: string) => m.split(" ")[0]} />
                <YAxis {...axisProps} width={64} tickFormatter={(v: number) => usdCompact.format(v)} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(255,255,255,0.25)" }} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "#cbd5e1" }} />
                <Line name={`Projected ${copy.revenue.toLowerCase()}`} type="monotone" dataKey="projectedRevenue" stroke={COLOR.revenue} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#0f172a" }} />
                <Line name={`Projected ${copy.expenses.toLowerCase()}`} type="monotone" dataKey="projectedExpenses" stroke={COLOR.expenses} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#0f172a" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <h3 className="mt-6 text-sm font-medium text-slate-300">Cumulative cash flow</h3>
          <div className="mt-2 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLOR.cash} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={COLOR.cash} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="month" {...axisProps} tickFormatter={(m: string) => m.split(" ")[0]} />
                <YAxis {...axisProps} width={64} tickFormatter={(v: number) => usdCompact.format(v)} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.3)" />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(255,255,255,0.25)" }} />
                <Area name="Cumulative net cash" type="monotone" dataKey="cumulative" stroke={COLOR.cash} strokeWidth={2} fill="url(#cashFill)" activeDot={{ r: 4, strokeWidth: 2, stroke: "#0f172a" }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scenario forecasting (Pro)
// ---------------------------------------------------------------------------

function scenarioExamples(mode: WorkspaceMode) {
  return mode === "PERSONAL"
    ? ["What if groceries go up 10% and I put an extra $300/month into investments?", "What if rent rises 5% in month 6?", "What if I pay off my car loan in 4 months?"]
    : ["What if fuel costs increase by 15% and I gain 2 new clients next quarter?", "What if I hire a $4,000/month technician starting in month 3?", "What if revenue drops 20% for the next 3 months?"];
}

interface ScenarioEntry {
  id: number;
  prompt: string;
  plan?: ScenarioPlan;
  result?: ScenarioResult;
  error?: string;
  saved?: boolean;
}

function ScenarioPanel({ analysis, workspaceId }: { analysis: FinancialAnalysis; workspaceId: string | null }) {
  const mode = modeOf(analysis.businessType);
  const [entries, setEntries] = useState<ScenarioEntry[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SavedScenario[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const baseline: ScenarioBaseline = useMemo(
    () => ({
      businessType: analysis.businessType,
      itemizedRevenue: analysis.itemizedRevenue.map(({ label, amount, oneTime }) => ({ label, amount, oneTime })),
      itemizedExpenses: analysis.itemizedExpenses.map(({ label, amount, category, oneTime }) => ({ label, amount, category, oneTime })),
      inflationRateAssumed: analysis.inflationRateAssumed,
    }),
    [analysis],
  );

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    listScenarios(workspaceId)
      .then((s) => !cancelled && setSaved(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [entries]);

  const ask = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    const id = Date.now();
    setEntries((e) => [...e, { id, prompt }]);
    setDraft("");
    setBusy(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ mode: "scenario", prompt, baseline }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      const { scenario } = (await res.json()) as { scenario: ScenarioPlan };
      const result = applyScenario(baseline, scenario.adjustments);
      setEntries((e) => e.map((x) => (x.id === id ? { ...x, plan: scenario, result } : x)));
      setSelected(id);
    } catch (err) {
      setEntries((e) => e.map((x) => (x.id === id ? { ...x, error: err instanceof Error ? err.message : "Scenario failed." } : x)));
    } finally {
      setBusy(false);
    }
  };

  const loadSaved = (s: SavedScenario) => {
    const id = Date.now();
    const plan: ScenarioPlan = { prompt: s.prompt, adjustments: s.adjustments, assumptions: [], explanation: s.summary.explanation };
    setEntries((e) => [...e, { id, prompt: s.prompt, plan, result: applyScenario(baseline, s.adjustments), saved: true }]);
    setSelected(id);
  };

  const save = async (entry: ScenarioEntry) => {
    if (!workspaceId || !entry.plan || !entry.result) return;
    setSaveError(null);
    try {
      await saveScenario({
        workspaceId,
        prompt: entry.prompt,
        adjustments: entry.plan.adjustments,
        summary: { baselineAnnualNet: entry.result.baselineAnnualNet, adjustedAnnualNet: entry.result.adjustedAnnualNet, delta: entry.result.delta, explanation: entry.plan.explanation },
      });
      setEntries((e) => e.map((x) => (x.id === entry.id ? { ...x, saved: true } : x)));
      setSaved(await listScenarios(workspaceId));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save.");
    }
  };

  const active = entries.find((e) => e.id === selected && e.result);
  const firstNegative = active?.result?.points.find((p) => p.adjustedCumulative < 0)?.month ?? null;

  return (
    <div className={cn(glass, "p-6")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <MessageSquareText className="h-5 w-5 text-indigo-300" /> Scenario Forecasting
          </h2>
          <p className="text-sm text-slate-400">Describe a change in plain English. We model it on top of your baseline projection.</p>
        </div>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-5">
        {/* Chat */}
        <div className="flex flex-col lg:col-span-2">
          <div ref={listRef} className="max-h-80 min-h-40 flex-1 space-y-3 overflow-y-auto pr-1 text-sm" aria-live="polite">
            {entries.length === 0 && (
              <div className="space-y-2">
                <p className="text-slate-500">Try one of these:</p>
                {scenarioExamples(mode).map((ex) => (
                  <button key={ex} onClick={() => ask(ex)} className="block w-full rounded-xl border border-white/10 px-3 py-2 text-left text-slate-300 hover:bg-white/5">
                    {ex}
                  </button>
                ))}
              </div>
            )}
            {entries.map((e) => (
              <div key={e.id} className="space-y-2">
                <p className="ml-auto max-w-[90%] rounded-2xl rounded-br-sm bg-indigo-500/80 px-3 py-2 text-white">{e.prompt}</p>
                {e.error ? (
                  <p className="max-w-[90%] rounded-2xl rounded-bl-sm bg-rose-500/10 px-3 py-2 text-rose-200">{e.error}</p>
                ) : e.plan && e.result ? (
                  <button
                    onClick={() => setSelected(e.id)}
                    className={cn("block max-w-[90%] rounded-2xl rounded-bl-sm px-3 py-2 text-left", selected === e.id ? "bg-white/[0.1] ring-1 ring-indigo-400/40" : "bg-white/[0.06] hover:bg-white/[0.08]")}
                  >
                    <span className="text-slate-200">{e.plan.explanation || "Scenario modeled."}</span>
                    <span className={cn("mt-1 block text-xs font-medium tabular-nums", e.result.delta >= 0 ? "text-emerald-300" : "text-rose-300")}>
                      {e.result.delta >= 0 ? "+" : ""}
                      {usd.format(e.result.delta)} over 12 months
                    </span>
                  </button>
                ) : (
                  <p className="inline-flex items-center gap-2 rounded-2xl bg-white/[0.06] px-3 py-2 text-slate-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Modeling…
                  </p>
                )}
              </div>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(draft);
            }}
            className="mt-3 flex gap-2"
          >
            <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} placeholder="What if…" aria-label="Scenario" className={inputCls} />
            <button type="submit" disabled={busy || !draft.trim()} aria-label="Run scenario" className="grid h-9 w-10 shrink-0 place-items-center rounded-lg bg-indigo-500 text-white hover:bg-indigo-400 disabled:opacity-40">
              <Send className="h-4 w-4" />
            </button>
          </form>

          {saved.length > 0 && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Saved in this workspace</p>
              <ul className="mt-2 space-y-1 text-sm">
                {saved.slice(0, 6).map((s) => (
                  <li key={s.id}>
                    <button onClick={() => loadSaved(s)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-slate-300 hover:bg-white/5">
                      <Bookmark className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                      <span className="flex-1 truncate">{s.prompt}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Chart */}
        <div className="lg:col-span-3">
          {active?.result && active.plan ? (
            <>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <Stat label="Baseline 12-mo net" value={usd.format(active.result.baselineAnnualNet)} />
                <Stat label="Adjusted 12-mo net" value={usd.format(active.result.adjustedAnnualNet)} tone={active.result.adjustedAnnualNet < 0 ? "bad" : undefined} />
                <Stat label="Change" value={`${active.result.delta >= 0 ? "+" : ""}${usd.format(active.result.delta)}`} tone={active.result.delta >= 0 ? "good" : "bad"} />
              </div>
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={active.result.points} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="month" {...axisProps} tickFormatter={(m: string) => m.split(" ")[0]} />
                    <YAxis {...axisProps} width={64} tickFormatter={(v: number) => usdCompact.format(v)} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.3)" />
                    <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(255,255,255,0.25)" }} />
                    <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "#cbd5e1" }} />
                    <Line name="Baseline runway" type="monotone" dataKey="baselineCumulative" stroke={COLOR.baseline} strokeDasharray="5 4" strokeWidth={2} dot={false} />
                    <Line name="Adjusted runway" type="monotone" dataKey="adjustedCumulative" stroke={COLOR.cash} strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#0f172a" }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {firstNegative && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-rose-300">
                  <AlertTriangle className="h-3 w-3" /> Under this scenario, cumulative cash turns negative in {firstNegative}.
                </p>
              )}
              <div className="mt-4 space-y-2 text-sm">
                <ul className="space-y-1">
                  {active.plan.adjustments.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-slate-300">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-300" />
                      {a.description} <span className="text-slate-500">(from month {a.startMonth})</span>
                    </li>
                  ))}
                </ul>
                {active.result.unmatched.length > 0 && (
                  <p className="text-xs text-amber-200">No matching line items for: {active.result.unmatched.join("; ")}. Those changes had no effect.</p>
                )}
                {active.plan.assumptions.length > 0 && (
                  <details className="text-xs text-slate-400">
                    <summary className="cursor-pointer text-slate-300">Assumptions</summary>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {active.plan.assumptions.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              <div className="mt-4 flex items-center gap-3">
                {workspaceId ? (
                  <button onClick={() => save(active)} disabled={active.saved} className={cn(secondaryBtn, "py-1.5 text-xs")}>
                    <Bookmark className="h-3.5 w-3.5" /> {active.saved ? "Saved" : "Save scenario"}
                  </button>
                ) : (
                  <p className="text-xs text-slate-500">Create a workspace to save scenarios.</p>
                )}
                {saveError && <p className="text-xs text-rose-300">{saveError}</p>}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">Saving stores only the question, the adjustment parameters and the headline totals — never your statements.</p>
            </>
          ) : (
            <div className="grid h-full min-h-64 place-items-center rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-500">
              Your baseline vs adjusted runway will appear here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn("mt-1 font-semibold tabular-nums", tone === "good" && "text-emerald-300", tone === "bad" && "text-rose-300")}>{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

const SEVERITY_STYLE: Record<Severity, { badge: string; Icon: typeof ShieldAlert }> = {
  HIGH: { badge: "border-rose-400/40 bg-rose-500/15 text-rose-200", Icon: ShieldAlert },
  MEDIUM: { badge: "border-amber-400/40 bg-amber-500/15 text-amber-200", Icon: AlertTriangle },
  LOW: { badge: "border-sky-400/40 bg-sky-500/15 text-sky-200", Icon: Info },
};

function AuditPanel({ analysis, paywall }: { analysis: FinancialAnalysis; paywall: Paywall }) {
  const [showAll, setShowAll] = useState(false);
  const teaser = paywall.access.level === "teaser";
  const flags = analysis.auditFlags;
  const visible = showAll || teaser ? flags : flags.filter((f) => f.severity !== "LOW").slice(0, 6);
  const savings = sum(flags, (f) => f.potentialSavings);
  const locked = paywall.access.lockedFlagCount;

  return (
    <div className={cn(glass, "p-6")}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ShieldAlert className="h-5 w-5 text-rose-300" /> Audit Mode
        </h2>
        {teaser ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-400">
            <Lock className="h-3 w-3" /> Savings total locked
          </span>
        ) : (
          savings > 0 && <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-200">~{usd.format(savings)}/mo potential</span>
        )}
      </div>

      {flags.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-slate-300">
          <CheckCircle2 className="h-4 w-4 text-emerald-300" /> No issues found.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {visible.map((f, i) => {
            const s = SEVERITY_STYLE[f.severity];
            return (
              <li key={`${f.title}-${i}`} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-slate-100">{f.title}</p>
                  <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", s.badge)}>
                    <s.Icon className="h-3 w-3" /> {f.severity}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-slate-400">{f.message}</p>
                {f.potentialSavings > 0 && <p className="mt-2 text-xs text-emerald-300">Save ~{usd.format(f.potentialSavings)}/mo</p>}
              </li>
            );
          })}
        </ul>
      )}

      {teaser && locked > 0 && (
        <div className="relative mt-3">
          <ul aria-hidden inert className="pointer-events-none select-none space-y-3 blur-sm">
            {Array.from({ length: Math.min(locked, 3) }, (_, i) => (
              <li key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="h-3 w-2/3 rounded bg-white/15" />
                <div className="mt-3 h-2.5 w-full rounded bg-white/10" />
                <div className="mt-2 h-2.5 w-4/5 rounded bg-white/10" />
              </li>
            ))}
          </ul>
          <div className="absolute inset-0 grid place-items-center">
            <div className="rounded-xl border border-white/10 bg-slate-900/90 px-4 py-3 text-center text-sm shadow-xl">
              <p className="flex items-center justify-center gap-1.5 font-medium">
                <Lock className="h-4 w-4 text-indigo-300" /> {locked} more flag{locked === 1 ? "" : "s"} locked
              </p>
              <button onClick={paywall.access.reportUnlocks > 0 && paywall.access.sealed ? paywall.unlock : () => paywall.checkout("report")} className="mt-2 text-xs text-indigo-300 hover:text-indigo-200">
                {paywall.access.reportUnlocks > 0 && paywall.access.sealed ? "Use a report unlock" : `Unlock full audit ($${PRICING.reportUnlockUsd})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {!teaser && flags.length > visible.length && (
        <button onClick={() => setShowAll(true)} className="mt-3 text-sm text-indigo-300 hover:text-indigo-200">
          Show all {flags.length} flags
        </button>
      )}

      {analysis.missingCategories.length > 0 && (
        <div className="mt-5 border-t border-white/10 pt-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Missing categories</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {analysis.missingCategories.map((c) => (
              <span key={c} className="rounded-md border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-100">
                {c}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WinnerCard({ analysis, label }: { analysis: FinancialAnalysis; label: string }) {
  const { topService, message } = analysis.winnerInsight;
  const personal = analysis.businessType === "PERSONAL_FAMILY";
  return (
    <div className={cn(glass, "border-emerald-400/20 bg-gradient-to-br from-emerald-500/10 to-transparent p-6")}>
      <h2 className="flex items-center gap-2 text-sm font-medium text-emerald-200">
        <Trophy className="h-4 w-4" /> {personal ? "Biggest budget lever" : `Top ${label.toLowerCase()} performer`}
      </h2>
      <p className="mt-2 text-xl font-semibold">{topService}</p>
      <p className="mt-2 text-sm text-slate-300">{message}</p>
    </div>
  );
}

function OneTimeBadge() {
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-amber-300/30 bg-amber-400/10 px-1.5 py-0.5 align-middle text-[11px] text-amber-100" title="Counted once, in the first projected month">
      <Repeat1 className="h-3 w-3" /> One-time
    </span>
  );
}

function LineItems({ analysis }: { analysis: FinancialAnalysis }) {
  const personal = analysis.businessType === "PERSONAL_FAMILY";
  const copy = MODE_COPY[modeOf(analysis.businessType)];
  return (
    <div className={cn(glass, "grid gap-6 p-6 md:grid-cols-2")}>
      <div>
        <h3 className="text-sm font-medium text-slate-300">{copy.revenue}</h3>
        <ul className="mt-3 divide-y divide-white/5 text-sm">
          {analysis.itemizedRevenue.map((r) => (
            <li key={r.label} className="flex justify-between gap-3 py-2">
              <span className="text-slate-300">
                {r.label}
                {r.oneTime && <OneTimeBadge />}
              </span>
              <span className="tabular-nums">
                {usd.format(r.amount)} {!personal && <span className="text-xs text-slate-500">· {pct(r.margin)} margin</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-medium text-slate-300">{copy.expenses}</h3>
        <ul className="mt-3 divide-y divide-white/5 text-sm">
          {analysis.itemizedExpenses.map((e, i) => (
            <li key={`${e.label}-${i}`} className="py-2">
              <div className="flex justify-between gap-3">
                <span className="text-slate-300">
                  {e.label}
                  {e.category && e.category.toLowerCase() !== e.label.toLowerCase() && <span className="text-xs text-slate-500"> · {e.category}</span>}
                  {e.oneTime && <OneTimeBadge />}
                </span>
                <span className="tabular-nums">{usd.format(e.amount)}</span>
              </div>
              {e.flag && (
                <p className="mt-1 flex items-center gap-1 text-xs text-amber-200">
                  <AlertTriangle className="h-3 w-3" /> {e.flag}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Executive report → browser print dialog ("Save as PDF"). Rendered client-side only.
// ---------------------------------------------------------------------------

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function reportHtml(a: FinancialAnalysis) {
  const copy = MODE_COPY[modeOf(a.businessType)];
  const monthlyExpenses = splitTotals(a.itemizedExpenses).recurring;
  const net = a.monthlyRevenue - monthlyExpenses;
  const rows = projectionRows(a);
  const cumulative = rows.at(-1)?.cumulative ?? 0;
  const projRows = rows
    .map(
      (p) =>
        `<tr><td>${esc(p.month)}</td><td>${usd.format(p.projectedRevenue)}</td><td>${usd.format(p.projectedExpenses)}</td><td class="${p.net < 0 ? "neg" : ""}">${usd.format(p.net)}</td><td class="${p.cumulative < 0 ? "neg" : ""}">${usd.format(p.cumulative)}</td></tr>`,
    )
    .join("");
  const flags = a.auditFlags
    .map((f) => `<li><strong>[${f.severity}] ${esc(f.title)}</strong> — ${esc(f.message)}${f.potentialSavings > 0 ? ` <em>(~${usd.format(f.potentialSavings)}/mo)</em>` : ""}</li>`)
    .join("");
  const generated = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LedgerPulse Executive Report ${new Date().toISOString().slice(0, 10)}</title>
<style>
body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;max-width:860px;margin:40px auto;padding:0 20px}
h1{font-size:24px;margin:0}h2{font-size:16px;margin:28px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
.muted{color:#666}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px}
.kpi{border:1px solid #ddd;border-radius:8px;padding:12px}.kpi b{display:block;font-size:18px;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}td,th{padding:6px 8px;border-bottom:1px solid #eee;text-align:right}
td:first-child,th:first-child{text-align:left}.neg{color:#b42318}li{margin-bottom:6px}
@page{margin:16mm}@media print{body{margin:0;max-width:none}}
</style></head><body>
<h1>LedgerPulse Executive Report</h1>
<p class="muted">${esc(BUSINESS_TYPE_LABELS[a.businessType])} · Generated ${esc(generated)} · ${pct(a.inflationRateAssumed)} inflation assumed</p>
<div class="kpis">
<div class="kpi">Monthly ${esc(copy.revenue.toLowerCase())}<b>${usd.format(a.monthlyRevenue)}</b></div>
<div class="kpi">Monthly ${esc(copy.expenses.toLowerCase())}<b>${usd.format(monthlyExpenses)}</b></div>
<div class="kpi">${esc(copy.net)}<b class="${net < 0 ? "neg" : ""}">${usd.format(net)}</b></div>
<div class="kpi">12-mo projected net<b class="${cumulative < 0 ? "neg" : ""}">${usd.format(cumulative)}</b></div>
</div>
<h2>${a.businessType === "PERSONAL_FAMILY" ? "Biggest budget lever" : "Top performer"}: ${esc(a.winnerInsight.topService)}</h2><p>${esc(a.winnerInsight.message)}</p>
<h2>Priority actions</h2>${flags ? `<ol>${flags}</ol>` : "<p>No issues found.</p>"}
${a.missingCategories.length ? `<h2>Missing categories</h2><p>${a.missingCategories.map(esc).join(", ")}</p>` : ""}
<h2>12-month projection</h2>
<table><thead><tr><th>Month</th><th>${esc(copy.revenue)}</th><th>${esc(copy.expenses)}</th><th>Net</th><th>Cumulative</th></tr></thead><tbody>${projRows}</tbody></table>
<p class="muted" style="margin-top:24px;font-size:12px">Projections apply seasonality and inflation to current recurring monthly averages; one-time items are counted once, in the first month. ${esc(LEGAL_DISCLAIMER)}</p>
</body></html>`;
}

/** Opens the browser's print dialog on a hidden iframe so the user can save a PDF. */
function printExecutiveReport(a: FinancialAnalysis) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.srcdoc = reportHtml(a);
  frame.onload = () => {
    const w = frame.contentWindow;
    if (!w) return frame.remove();
    w.addEventListener("afterprint", () => setTimeout(() => frame.remove(), 0));
    w.focus();
    w.print();
    // Fallback cleanup for browsers that don't fire afterprint.
    setTimeout(() => frame.isConnected && frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}
