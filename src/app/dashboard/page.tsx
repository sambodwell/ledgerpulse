"use client";

import { Component, useCallback, useEffect, useId, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Briefcase,
  CheckCircle2,
  ChevronUp,
  ClipboardList,
  Download,
  FileText,
  Home,
  Info,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Repeat,
  Repeat1,
  FolderPlus,
  Flag,
  LayoutDashboard,
  CalendarDays,
  LineChart as LineChartIcon,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  BadgeCheck,
  Sparkles,
  SplitSquareHorizontal,
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
  DEFAULT_FORECAST,
  MODE_COPY,
  PRICING,
  effectiveInflationRate,
  isAnalysisResponse,
  isCpiReading,
  isExtractedLineItems,
  isBusinessType,
  modeOf,
  monthKey,
  normalizeForecastSettings,
  projectBaseline,
  projectionOptions,
  resolvePercentExpenses,
  splitTotals,
  sum,
  validShare,
  type AnalysisAccess,
  type AnalysisResponse,
  type BusinessType,
  type CpiReading,
  type ExpenseLine,
  type ForecastSettings,
  type RevenueLine,
  type FinancialAnalysis,
  type PercentOfRevenue,
  type Severity,
  type WorkspaceMode,
  type WorkspaceProfile,
} from "@/lib/schemas";
import { authHeaders, createWorkspace, saveFiscalTracker, updateWorkspace } from "@/lib/supabase";
import { exactMoney, normalizeTrackerState, statementTotals, withLoggedActual, type MonthActual } from "@/lib/fiscal";
import { isStatementPeriod, periodLabel, type StatementPeriod } from "@/lib/statementPeriod";
import { StatementMonthPicker } from "@/components/dashboard/StatementMonth";
import { clearDraft, draftKey, loadDraft, saveDraft } from "@/lib/formDraft";
import { DEV_UNLOCK } from "@/lib/devUnlock";
import { useApp } from "@/components/AppProvider";
import { fromMode, useWorkspace } from "@/context/WorkspaceContext";
import { ProfileMenu } from "@/components/ProfileMenu";
import { PlanCard } from "@/components/PlanCard";
import { LEGAL_DISCLAIMER } from "@/components/Footer";
import { CHART, COLOR, ChartTooltip, axisProps, esc, monthTick, printHtml } from "@/components/dashboard/chartKit";
import { ForecastControls } from "@/components/dashboard/ForecastControls";
import { ScenarioPanel, scenarioExamples } from "@/components/dashboard/ScenarioPanel";
import { FiscalYearTracker, ImplementedToggle, toggleImplemented, type GoalReport } from "@/components/dashboard/FiscalYearTracker";
import { GoalPaceBanner, GoalTracker, goalPaceBannerHtml, goalPaceReportHtml } from "@/components/dashboard/GoalTracker";
import { clearLocalTracker, clearUnsyncedTracker, readLocalTracker, useFiscalTracker } from "@/components/dashboard/useFiscalTracker";
import { InfoTip } from "@/components/InfoTip";
import { FeedbackWidget } from "@/components/dashboard/FeedbackWidget";
import { MoneyInput } from "@/components/dashboard/MoneyInput";
import { ExpenseShareCard } from "@/components/dashboard/ExpenseShare";
import { cn, errorMessage, glass, inputCls, pct, primaryBtn, secondaryBtn, usd, usdCompact } from "@/components/ui";

const PRIVACY_BADGE = "🔒 256-Bit Encrypted | Zero File Retention — Your financial data is parsed in memory and never stored.";
const PENDING_UNLOCK_KEY = "lp:pendingUnlock";
/** This tab's analysis results per workspace (sessionStorage; cleared on sign-out). */
const resultsKey = (userId: string) => `lp:results:${userId}`;

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
type ResultsTab = "overview" | "forecast" | "fiscal" | "report";

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

  // Results live in this browser tab only (sessionStorage), per workspace, so switching workspaces or reloading
  // the tab keeps each workspace's report. They are never sent to our database.
  const [results, setResults] = useState<Record<string, AnalysisResponse>>({});
  const userId = app.user?.id ?? null;
  const resultsLoadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || resultsLoadedFor.current === userId) return;
    resultsLoadedFor.current = userId;
    const stored = safeSession((s) => s.getItem(resultsKey(userId)));
    if (!stored) return;
    try {
      const parsed: unknown = JSON.parse(stored);
      if (!parsed || typeof parsed !== "object") return;
      const valid = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, v]) => isAnalysisResponse(v))) as Record<string, AnalysisResponse>;
      setResults((cur) => ({ ...valid, ...cur }));
    } catch {
      /* ignore malformed */
    }
  }, [userId]);
  useEffect(() => {
    if (!userId || resultsLoadedFor.current !== userId) return;
    safeSession((s) => (Object.keys(results).length ? s.setItem(resultsKey(userId), JSON.stringify(results)) : s.removeItem(resultsKey(userId))));
  }, [results, userId]);
  const current = results[wsKey] ?? null;

  const [tab, setTab] = useState<InputTab>("form");
  /** Results command-center tab. */
  const [resultsTab, setResultsTab] = useState<ResultsTab>("overview");
  /** null = automatic: inputs open until a report exists, then collapsed. */
  const [inputsOverride, setInputsOverride] = useState<boolean | null>(null);
  const inputsOpen = inputsOverride ?? !current;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paywallBusy, setPaywallBusy] = useState<Paywall["busy"]>(null);
  const [paywallMsg, setPaywallMsg] = useState<string | null>(null);
  const [pendingUnlock, setPendingUnlock] = useState<{ sealed: string; wsKey: string } | null>(null);
  const [confirmingCheckout, setConfirmingCheckout] = useState(false);
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null);
  /**
   * Projection start month + horizon + seasonality / inflation, shared by the baseline chart, scenarios, KPIs and the
   * executive report. Remembered per workspace on this device.
   */
  const forecastKey = userId ? `lp:forecast:${userId}:${wsKey}` : null;
  const [forecastState, setForecastState] = useState<{ key: string | null; value: ForecastSettings }>({ key: null, value: DEFAULT_FORECAST });
  if (forecastState.key !== forecastKey) {
    // Workspace (or user) changed: adopt that workspace's saved settings during render, before anything uses them.
    let stored: unknown = null;
    try {
      const raw = forecastKey && typeof window !== "undefined" ? window.localStorage.getItem(forecastKey) : null;
      stored = raw ? JSON.parse(raw) : null;
    } catch {
      stored = null;
    }
    setForecastState({ key: forecastKey, value: stored ? normalizeForecastSettings(stored) : DEFAULT_FORECAST });
  }
  const forecast = forecastState.value;
  const setForecast = useCallback(
    (value: ForecastSettings) => {
      setForecastState({ key: forecastKey, value });
      try {
        if (forecastKey) window.localStorage.setItem(forecastKey, JSON.stringify(value));
      } catch {
        /* per-device convenience only */
      }
    },
    [forecastKey],
  );

  // Live CPI (U.S. BLS, cached server-side for a day) is the default inflation rate; owners can override it.
  const [cpi, setCpi] = useState<CpiReading | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/cpi")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: unknown) => !cancelled && setCpi(isCpiReading(d) ? d : { rate: DEFAULT_FORECAST.customInflationRate, period: null, source: "Default assumption", live: false }))
      .catch(() => !cancelled && setCpi({ rate: DEFAULT_FORECAST.customInflationRate, period: null, source: "Default assumption", live: false }));
    return () => {
      cancelled = true;
    };
  }, []);
  const inflationRate = effectiveInflationRate(forecast, cpi);
  const inflationLabel = forecast.inflationSource === "CUSTOM" ? "custom rate" : cpi?.live ? `live CPI, ${cpi.period}` : "default assumption";

  const resultsRef = useRef<HTMLDivElement>(null);
  const ws = app.activeWorkspace;
  const formDefaultType: BusinessType = mode === "PERSONAL" ? "PERSONAL_FAMILY" : ws && ws.mode === "BUSINESS" ? ws.businessType : "REAL_ESTATE";

  /** Fiscal Year Tracker state (monthly actuals, goals, savings) for the active workspace, shared by the Goal Tracker at the top. */
  const tracker = useFiscalTracker({ userId: userId ?? "", workspaceId: ws?.id ?? null, businessType: formDefaultType });
  /** Goal pace included in the executive PDF. */
  const goalReport: GoalReport | null = tracker.pace && tracker.status !== "loading" && !tracker.loadFailed ? { pace: tracker.pace, fyLabel: tracker.fyLabel } : null;

  const { setUiHints, refreshProfile } = app;
  useEffect(
    () =>
      setUiHints({
        mode,
        hasAnalysis: !!current,
        hasWorkspace: !!app.activeWorkspace,
        seasonality: forecast.seasonality,
        inflation: forecast.inflation,
        horizonMonths: forecast.months,
        trackerForecastMode: tracker.state.forecastMode,
        goalMetric: tracker.goal != null ? tracker.state.goalMetric : null,
      }),
    [mode, current, app.activeWorkspace, forecast.seasonality, forecast.inflation, forecast.months, tracker.state.forecastMode, tracker.state.goalMetric, tracker.goal, setUiHints],
  );

  /** "Set your goals and log actuals" callout, shown after the first PDF report for a workspace until dismissed. */
  const calloutKey = userId ? `lp:reportCallout:${userId}:${wsKey}` : null;
  const [calloutShownFor, setCalloutShownFor] = useState<string | null>(null);
  const showCallout = !!calloutKey && calloutShownFor === calloutKey;
  const onReportDownloaded = () => {
    if (!calloutKey) return;
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(calloutKey) === "dismissed";
    } catch {
      /* ignore */
    }
    if (!dismissed) setCalloutShownFor(calloutKey);
  };
  const dismissCallout = () => {
    setCalloutShownFor(null);
    try {
      if (calloutKey) window.localStorage.setItem(calloutKey, "dismissed");
    } catch {
      /* ignore */
    }
  };
  const jumpTo = (id: string, focusSelector?: string) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    if (focusSelector) setTimeout(() => el?.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true }), 350);
  };
  /** Switches results tab, then scrolls to an element inside it once it is visible. */
  const openTab = (t: ResultsTab, id: string, focusSelector?: string) => {
    setResultsTab(t);
    requestAnimationFrame(() => jumpTo(id, focusSelector));
  };

  const post = useCallback(async (init: RequestInit) => {
    const auth = await authHeaders();
    return fetch("/api/analyze", { method: "POST", ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...auth } });
  }, []);

  /** Runs the analysis and stores the result under `targetKey` (the workspace chosen in the picker). */
  const runAnalysis = useCallback(
    async (init: RequestInit, targetKey: string): Promise<boolean> => {
      setLoading(true);
      setError(null);
      setPaywallMsg(null);
      try {
        const res = await post(init);
        if (!res.ok) throw new Error(await errorMessage(res));
        const data: unknown = await res.json();
        if (!isAnalysisResponse(data)) throw new Error("Received an unexpected response from the analysis service.");
        setResults((r) => ({ ...r, [targetKey]: data }));
        // A fresh report opens on the Overview tab, with the inputs tucked away.
        setResultsTab("overview");
        setInputsOverride(null);
        requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
        return false;
      } finally {
        setLoading(false);
      }
    },
    [post],
  );

  /**
   * Every new analysis first asks which project / business it belongs to (current workspace preselected), so
   * different businesses or jobs never get mixed in one workspace.
   */
  const [picker, setPicker] = useState<{ init: RequestInit; businessType: BusinessType; resolve: (ok: boolean) => void } | null>(null);
  const requestAnalysis = useCallback(
    (init: RequestInit, businessType: BusinessType) => new Promise<boolean>((resolve) => setPicker({ init, businessType, resolve })),
    [],
  );
  /** New workspace from the picker: the baseline is seeded from its first analysis. */
  const seedBaselineFor = useRef<string | null>(null);
  const confirmTarget = async (target: { kind: "existing"; id: string } | { kind: "new"; workspace: WorkspaceProfile } | { kind: "temporary" }) => {
    if (!picker) return;
    const { init, resolve } = picker;
    setPicker(null);
    let key = "guest";
    if (target.kind === "new") {
      await app.refreshWorkspaces();
      app.setActiveWorkspaceId(target.workspace.id);
      seedBaselineFor.current = target.workspace.id;
      key = target.workspace.id;
    } else if (target.kind === "existing") {
      if (target.id !== ws?.id) app.setActiveWorkspaceId(target.id);
      key = target.id;
    } else if (ws) {
      app.setActiveWorkspaceId(null);
    }
    resolve(await runAnalysis(init, key));
  };

  // Seed a brand-new workspace's tracker baseline from its first analysis (only while the plan is still empty).
  const { update: updateTracker } = tracker;
  useEffect(() => {
    const a = current?.analysis;
    if (!a || !ws || seedBaselineFor.current !== ws.id || tracker.status === "loading" || tracker.loadFailed || current.access.level === "teaser") return;
    seedBaselineFor.current = null;
    if (tracker.state.baseline.revenue !== 0 || tracker.state.baseline.expenses !== 0) return;
    updateTracker((s) => ({ ...s, businessType: a.businessType, baseline: { revenue: a.monthlyRevenue, expenses: splitTotals(a.itemizedExpenses).recurring } }));
  }, [current, ws, tracker.status, tracker.loadFailed, tracker.state.baseline, updateTracker]);

  /** Logs a reviewed statement's totals into the Fiscal Year Tracker month; returns a confirmation line. */
  const logStatementMonth = (key: string, actual: MonthActual) => {
    const replaced = !!tracker.state.actuals[key];
    updateTracker((s) => withLoggedActual(s, key, actual));
    return `${replaced ? "Replaced" : "Logged"} ${periodLabel(key)} actuals: ${exactMoney(actual.revenue)} revenue / ${exactMoney(actual.expenses)} expenses. Goal pace and projections updated.`;
  };

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

  const teaser = current?.access.level === "teaser";
  const rawAnalysis = current?.analysis ?? null;
  // Full reports re-project client-side so line-item edits and the chosen horizon/start month apply immediately.
  // Teasers stay redacted (no projection) exactly as the server sent them.
  const analysis = useMemo(() => (rawAnalysis && !teaser ? withProjection(rawAnalysis, forecast, inflationRate) : rawAnalysis), [rawAnalysis, teaser, forecast, inflationRate]);
  const updateLineItems = useCallback(
    (revenue: RevenueLine[], expenses: ExpenseLine[]) =>
      setResults((r) => {
        const cur = r[wsKey];
        if (!cur) return r;
        // %-of-revenue expenses (e.g. management at 8.8% of rent) re-price from the edited revenue.
        const itemizedExpenses = resolvePercentExpenses(revenue, expenses);
        return { ...r, [wsKey]: { ...cur, analysis: { ...cur.analysis, itemizedRevenue: revenue, itemizedExpenses, monthlyRevenue: splitTotals(revenue).recurring } } };
      }),
    [wsKey],
  );
  const copy = MODE_COPY[mode];
  const downloadReport = () => {
    if (!analysis || teaser) return;
    printExecutiveReport(analysis, forecast, goalReport, inflationLabel);
    onReportDownloaded();
  };

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
    <div className="relative min-h-screen overflow-x-clip bg-slate-950 text-slate-100">
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
                ? "Enter your household income and spending or upload a bank statement. We'll audit your budget and project the next 12–60 months."
                : "Enter your numbers or upload a bank statement / P&L. We'll audit it and project the next 12–60 months — flat by default, with optional seasonality and inflation."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-300">
              {ws ? (
                <>
                  {ws.mode === "PERSONAL" ? <Home className="h-4 w-4 text-slate-400" /> : <Briefcase className="h-4 w-4 text-slate-400" />}
                  Workspace: <span className="font-medium text-slate-100">{ws.name}</span>
                  <span className="text-slate-500">· {BUSINESS_TYPE_LABELS[ws.businessType]}</span>
                  <WorkspaceMenu
                    workspace={ws}
                    onRename={async (name) => {
                      await updateWorkspace(ws.id, { name });
                      await app.refreshWorkspaces();
                    }}
                    onDelete={async () => {
                      const id = ws.id;
                      await app.removeWorkspace(id);
                      // Drop everything this device kept for the deleted workspace.
                      clearUnsyncedTracker(app.user!.id, id);
                      setResults((r) => {
                        const { [id]: _gone, ...rest } = r;
                        void _gone;
                        return rest;
                      });
                      try {
                        window.localStorage.removeItem(`lp:forecast:${app.user!.id}:${id}`);
                        window.localStorage.removeItem(`lp:reportCallout:${app.user!.id}:${id}`);
                      } catch {
                        /* ignore */
                      }
                    }}
                  />
                </>
              ) : (
                <span className="text-slate-500">No saved workspace selected — you&apos;ll be asked to name one when you run an analysis.</span>
              )}
            </div>
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

        {/* Goal Tracker first: the year-end delta is the first thing an owner sees. */}
        <div className="mb-8">
          <PanelBoundary title="Goal Tracker">
            <GoalTracker tracker={tracker} id="goal-tracker" onViewSavings={() => (analysis && paywall ? openTab("fiscal", "savings-tracker") : jumpTo("savings-tracker"))} />
          </PanelBoundary>
        </div>

        {/* Inputs collapse once a report exists, so the results tabs are one click away instead of a long scroll. */}
        {current && (
          <div className={cn(glass, "mb-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3")}>
            <p className="text-sm text-slate-300">
              {inputsOpen ? "Enter new numbers or upload another statement to refresh this report." : "Report ready. Run a new analysis any time — your goals and logged actuals are kept."}
            </p>
            <button type="button" onClick={() => setInputsOverride(!inputsOpen)} aria-expanded={inputsOpen} aria-controls="analysis-inputs" className={cn(secondaryBtn, "px-3 py-1.5 text-xs")}>
              {inputsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {inputsOpen ? "Hide inputs" : "New analysis / edit inputs"}
            </button>
          </div>
        )}

        <div id="analysis-inputs" className={cn(!inputsOpen && "hidden")}>
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

          {/* items-start: a long parsed statement in one column must not stretch (and reflow) the other. */}
          <section className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <div className={cn("min-w-0", tab !== "form" && "hidden lg:block")}>
              <PanelBoundary title="Guided form">
                <GuidedForm
                  key={`${wsKey}-${mode}`}
                  draftKey={draftKey(app.user.id, wsKey, mode)}
                  mode={mode}
                  defaultType={formDefaultType}
                  disabled={loading}
                  onSubmit={(payload) => requestAnalysis({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, payload.businessType)}
                />
              </PanelBoundary>
            </div>
            <div className={cn("min-w-0", tab !== "upload" && "hidden lg:block")}>
              <PanelBoundary title="Statement upload">
                {/* Not keyed by workspace: picking a workspace for the report must not throw away the parsed lines under review. */}
                <StatementUploader
                  key={mode}
                  mode={mode}
                  disabled={loading}
                  onSubmit={(init, bt) => requestAnalysis(init, bt ?? formDefaultType)}
                  trackerReady={tracker.status !== "loading" && !tracker.loadFailed}
                  onLogActuals={logStatementMonth}
                />
              </PanelBoundary>
            </div>
          </section>
        </div>

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

        {analysis && paywall ? (
          <div ref={resultsRef} className={cn("scroll-mt-6 space-y-6", inputsOpen ? "mt-10" : "mt-2")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">Results{ws ? <span className="text-base font-normal text-slate-400"> · {ws.name}</span> : null}</h2>
              {teaser ? (
                <button onClick={() => paywall.checkout("report")} className={cn(secondaryBtn, "text-slate-300")} title="Unlock the full audit to download">
                  <Lock className="h-4 w-4" /> Download Executive PDF Report
                </button>
              ) : (
                <button onClick={downloadReport} className={cn(primaryBtn, "shadow-lg shadow-indigo-500/25")}>
                  <Download className="h-4 w-4" /> Download Executive PDF Report
                </button>
              )}
            </div>

            {showCallout && (
              <ReportCallout
                hasGoal={!!tracker.pace}
                loggedCount={tracker.summary.loggedCount}
                onSetGoal={() => jumpTo("goal-tracker", "input")}
                onLogActuals={() => openTab("fiscal", "fiscal-tracker", "tbody input")}
                onDismiss={dismissCallout}
              />
            )}

            {teaser && <TeaserBanner paywall={paywall} />}

            <ResultsTabs value={resultsTab} onChange={setResultsTab} />

            <div role="tabpanel" id="results-panel-overview" aria-labelledby="results-tab-overview" hidden={resultsTab !== "overview"} className="space-y-6">
              {tracker.pace && (
                <div className="flex flex-col gap-2">
                  <GoalPaceBanner pace={tracker.pace} fyLabel={tracker.fyLabel} compact />
                  <button type="button" onClick={() => jumpTo("goal-tracker")} className="self-end text-xs text-indigo-300 hover:text-indigo-200">
                    Adjust goal ↑
                  </button>
                </div>
              )}
              <PanelBoundary title="Summary">
                <KpiRow analysis={analysis} mode={modeOf(analysis.businessType)} locked={teaser} settings={forecast} inflationLabel={inflationLabel} />
              </PanelBoundary>
              {/* Left: visual analytics. Right: the revenue and expense line items. */}
              <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
                <div className="min-w-0 space-y-6 lg:col-span-2">
                  <PanelBoundary title="Expense share">
                    <ExpenseShareCard analysis={analysis} />
                  </PanelBoundary>
                  <PanelBoundary title="Winner insight">
                    <WinnerCard analysis={analysis} label={copy.revenue} />
                  </PanelBoundary>
                </div>
                <div className="min-w-0 space-y-6 lg:col-span-3">
                  <PanelBoundary title="Line items">
                    <LineItems analysis={analysis} onApply={updateLineItems} />
                  </PanelBoundary>
                  <PanelBoundary title="Audit Mode">
                    <AuditPanel
                      analysis={analysis}
                      paywall={paywall}
                      workspaceId={ws?.id ?? null}
                      implemented={tracker.state.savings}
                      onToggleImplemented={
                        teaser || tracker.status === "loading" || tracker.loadFailed
                          ? undefined
                          : (f) => tracker.update((s) => toggleImplemented(s, { title: f.title, monthly: f.potentialSavings }, monthKey(new Date())))
                      }
                    />
                  </PanelBoundary>
                </div>
              </div>
            </div>

            <div role="tabpanel" id="results-panel-forecast" aria-labelledby="results-tab-forecast" hidden={resultsTab !== "forecast"} className="space-y-6">
              <PanelBoundary title="Projection chart">
                {teaser ? (
                  <LockedSection title="Macro-Adjusted Projection" paywall={paywall} placeholder={<FakeChart />} />
                ) : (
                  <ProjectionCharts analysis={analysis} settings={forecast} onSettingsChange={setForecast} cpi={cpi} inflationLabel={inflationLabel} actuals={tracker.state.actuals} />
                )}
              </PanelBoundary>
              <PanelBoundary title="Scenario forecasting">
                {isPro && !teaser ? (
                  <ScenarioPanel analysis={analysis} workspaceId={ws?.id ?? null} settings={forecast} onSettingsChange={setForecast} />
                ) : (
                  <LockedSection title="Interactive Scenario Forecasting" paywall={paywall} proOnly placeholder={<FakeScenarioChat mode={mode} />} />
                )}
              </PanelBoundary>
            </div>

            <div role="tabpanel" id="results-panel-fiscal" aria-labelledby="results-tab-fiscal" hidden={resultsTab !== "fiscal"}>
              <PanelBoundary title="Fiscal Year Tracker">
                <FiscalYearTracker tracker={tracker} analysis={teaser ? null : rawAnalysis} id="fiscal-tracker" />
              </PanelBoundary>
            </div>

            <div role="tabpanel" id="results-panel-report" aria-labelledby="results-tab-report" hidden={resultsTab !== "report"} className="space-y-6">
              <PanelBoundary title="Executive report">
                {teaser ? (
                  <LockedSection title="Executive PDF Report" paywall={paywall} placeholder={<FakeChart />} />
                ) : (
                  <ReportPreview html={resultsTab === "report" ? reportHtml(analysis, forecast, goalReport, inflationLabel) : ""} onDownload={downloadReport} hasGoal={!!goalReport} onSetGoal={() => jumpTo("goal-tracker", "input")} />
                )}
              </PanelBoundary>
            </div>

            <FeedbackWidget
              key={`report-${wsKey}`}
              context="report"
              size="lg"
              workspaceId={ws?.id ?? null}
              prompt={teaser ? "How useful is this free preview?" : "How useful is this report?"}
              className={cn(glass, "border-amber-300/20 bg-gradient-to-r from-amber-400/[0.06] via-transparent to-indigo-500/[0.06] px-6 py-6")}
            />
          </div>
        ) : (
          <section className="mt-10" aria-label="Fiscal Year Tracker">
            <PanelBoundary title="Fiscal Year Tracker">
              <FiscalYearTracker tracker={tracker} analysis={null} id="fiscal-tracker" />
            </PanelBoundary>
          </section>
        )}
      </main>

      {picker && (
        <AnalysisTargetDialog
          userId={app.user.id}
          workspaces={app.workspaces}
          activeId={ws?.id ?? null}
          businessType={picker.businessType}
          hasReport={(id) => !!results[id]}
          onCancel={() => {
            picker.resolve(false);
            setPicker(null);
          }}
          onConfirm={confirmTarget}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Which project / business is this for?" — asked before every new analysis
// ---------------------------------------------------------------------------

function suggestWorkspaceName(bt: BusinessType, existing: WorkspaceProfile[]) {
  const year = new Date().getFullYear();
  const base = bt === "PERSONAL_FAMILY" ? `Household Budget ${year}` : `${BUSINESS_TYPE_LABELS[bt].split(" (")[0].split(" /")[0]} ${year}`;
  const taken = new Set(existing.map((w) => w.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base.slice(0, 80);
  for (let i = 2; i < 100; i++) if (!taken.has(`${base} (${i})`.toLowerCase())) return `${base} (${i})`.slice(0, 80);
  return base.slice(0, 80);
}

type AnalysisTarget = { kind: "existing"; id: string } | { kind: "new"; workspace: WorkspaceProfile } | { kind: "temporary" };

function AnalysisTargetDialog({
  userId,
  workspaces,
  activeId,
  businessType,
  hasReport,
  onCancel,
  onConfirm,
}: {
  userId: string;
  workspaces: WorkspaceProfile[];
  activeId: string | null;
  businessType: BusinessType;
  hasReport: (id: string) => boolean;
  onCancel: () => void;
  onConfirm: (t: AnalysisTarget) => void | Promise<void>;
}) {
  const [choice, setChoice] = useState<string>(activeId ?? "new");
  const [name, setName] = useState(() => suggestWorkspaceName(businessType, workspaces));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const analysisMode = modeOf(businessType);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);
  useEffect(() => {
    if (choice === "new") nameRef.current?.select();
  }, [choice]);

  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setError(null);
    if (choice === "temporary") return void onConfirm({ kind: "temporary" });
    if (choice !== "new") return void onConfirm({ kind: "existing", id: choice });
    if (!name.trim()) return setError("Give the project or business a name.");
    setBusy(true);
    try {
      const created = await createWorkspace({ name, businessType });
      // Carry over anything logged on this device before a workspace existed.
      const local = readLocalTracker(userId);
      if (local) {
        try {
          await saveFiscalTracker(created.id, normalizeTrackerState(local, businessType));
          clearLocalTracker(userId);
        } catch (err) {
          console.warn("[workspace] tracker copy failed", err);
        }
      }
      await onConfirm({ kind: "new", workspace: created });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the workspace.");
      setBusy(false);
    }
  };

  const option = (value: string, children: ReactNode) => (
    <label
      key={value}
      className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition", choice === value ? "border-indigo-400/60 bg-indigo-500/10" : "border-white/10 hover:bg-white/5")}
    >
      <input type="radio" name="analysis-target" className="mt-1 accent-indigo-400" checked={choice === value} onChange={() => setChoice(value)} />
      <span className="min-w-0 flex-1 text-sm">{children}</span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn(glass, "w-full max-w-lg bg-slate-900/95 p-6")}>
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold">
            <FolderPlus className="h-5 w-5 text-indigo-300" /> Which project or business is this for?
          </h2>
          <button type="button" onClick={onCancel} disabled={busy} aria-label="Close" className="text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-300">Each workspace keeps its own report, goals, monthly actuals and scenarios, so different businesses or jobs never get mixed together.</p>

        <div className="mt-4 max-h-[50vh] space-y-2 overflow-y-auto overscroll-contain pr-1">
          {workspaces.map((w) =>
            option(
              w.id,
              <>
                <span className="flex flex-wrap items-center gap-2 font-medium text-slate-100">
                  {w.name}
                  {w.id === activeId && <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[11px] font-normal text-indigo-200">Current</span>}
                </span>
                <span className="block text-xs text-slate-500">{BUSINESS_TYPE_LABELS[w.businessType]}</span>
                {choice === w.id && hasReport(w.id) && <span className="mt-1 block text-xs text-amber-200">Replaces this workspace&apos;s current report. Its goals and logged actuals are kept.</span>}
                {choice === w.id && w.mode !== analysisMode && (
                  <span className="mt-1 block text-xs text-amber-200">This is a {w.mode === "PERSONAL" ? "personal" : "business"} workspace — consider a new one for this {analysisMode === "PERSONAL" ? "household" : "business"} analysis.</span>
                )}
              </>,
            ),
          )}
          {option(
            "new",
            <>
              <span className="font-medium text-slate-100">New project / business</span>
              {choice === "new" && (
                <>
                  <input
                    ref={nameRef}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={80}
                    aria-label="New workspace name"
                    placeholder="e.g. 123 Main St Duplex"
                    className={cn(inputCls, "mt-2")}
                    autoFocus
                  />
                  <span className="mt-1 block text-xs text-slate-500">Type: {BUSINESS_TYPE_LABELS[businessType]}. Change it any time in workspace settings.</span>
                </>
              )}
            </>,
          )}
          {option(
            "temporary",
            <>
              <span className="text-slate-300">Don&apos;t save — use a temporary workspace</span>
              <span className="block text-xs text-slate-500">The report stays in this tab only; goals and actuals stay on this device.</span>
            </>,
          )}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-rose-200">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className={cn(secondaryBtn, "text-slate-300")}>
            Cancel
          </button>
          <button type="submit" disabled={busy || (choice === "new" && !name.trim())} className={primaryBtn}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {choice === "new" ? "Create & analyze" : "Analyze"}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">Uploaded statement files are never stored — only the monthly totals and goals you track.</p>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workspace settings (rename / delete) next to the workspace name
// ---------------------------------------------------------------------------

function WorkspaceMenu({ workspace, onRename, onDelete }: { workspace: WorkspaceProfile; onRename: (name: string) => Promise<void>; onDelete: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(workspace.name);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"rename" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const reset = () => {
    setOpen(false);
    setConfirming(false);
    setError(null);
    setName(workspace.name);
  };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !busy && reset();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && reset();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  });

  const run = async (kind: "rename" | "delete", fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      setBusy(null);
      if (kind === "delete") return; // this menu unmounts with the workspace
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(null);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => (open ? reset() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/5 hover:text-white"
      >
        <Settings2 className="h-3.5 w-3.5" /> Workspace settings
      </button>
      {open && (
        <div role="dialog" aria-labelledby={titleId} className={cn(glass, "absolute left-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-slate-900/95 p-4 text-sm")}>
          <p id={titleId} className="text-xs uppercase tracking-wide text-slate-500">
            Workspace settings
          </p>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && name.trim() !== workspace.name) void run("rename", () => onRename(name));
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Workspace name" className={cn(inputCls, "py-1.5")} />
            <button type="submit" disabled={!!busy || !name.trim() || name.trim() === workspace.name} className={cn(secondaryBtn, "px-3 py-1.5 text-xs")}>
              {busy === "rename" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Rename"}
            </button>
          </form>

          <div className="mt-4 border-t border-white/10 pt-3">
            {confirming ? (
              <div className="rounded-lg border border-rose-300/30 bg-rose-500/10 p-3">
                <p className="text-sm text-rose-100">
                  Permanently delete <strong>{workspace.name}</strong>?
                </p>
                <p className="mt-1 text-xs text-rose-200/80">Its Fiscal Year Tracker (monthly actuals, goals, savings) and saved scenarios are deleted too. This can&apos;t be undone.</p>
                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" onClick={() => setConfirming(false)} disabled={!!busy} className={cn(secondaryBtn, "px-3 py-1.5 text-xs")}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void run("delete", onDelete)}
                    disabled={!!busy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-400 disabled:opacity-50"
                  >
                    {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete workspace
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className="inline-flex items-center gap-1.5 text-xs text-rose-300 hover:text-rose-200">
                <Trash2 className="h-3.5 w-3.5" /> Delete workspace…
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className="mt-2 text-xs text-rose-300">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post-report follow-up
// ---------------------------------------------------------------------------

function ReportCallout({ hasGoal, loggedCount, onSetGoal, onLogActuals, onDismiss }: { hasGoal: boolean; loggedCount: number; onSetGoal: () => void; onLogActuals: () => void; onDismiss: () => void }) {
  return (
    <div role="status" className="flex flex-col gap-3 rounded-2xl border border-indigo-300/30 bg-gradient-to-r from-indigo-500/15 via-indigo-500/[0.06] to-emerald-500/10 p-5 sm:flex-row sm:items-center">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-indigo-500/25">
        <Flag className="h-5 w-5 text-indigo-200" />
      </span>
      <div className="flex-1">
        <p className="font-medium text-slate-50">Your report is ready — now set your goals and log actuals to track your pace.</p>
        <p className="mt-0.5 text-sm text-slate-300">
          {hasGoal ? "Your goal is set." : "Pick a net income, revenue or expense goal for the year."}{" "}
          {loggedCount > 0 ? `${loggedCount} month${loggedCount === 1 ? "" : "s"} logged so far.` : "Then log each month as it closes to see exactly how far ahead or behind you are."}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onSetGoal} className={primaryBtn}>
          <Flag className="h-4 w-4" /> {hasGoal ? "Review goal" : "Set a goal"}
        </button>
        <button type="button" onClick={onLogActuals} className={secondaryBtn}>
          Log actuals
        </button>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results command center: tabs + report preview
// ---------------------------------------------------------------------------

const RESULTS_TABS: { key: ResultsTab; label: string; short: string; Icon: typeof Home }[] = [
  { key: "overview", label: "Overview", short: "Overview", Icon: LayoutDashboard },
  { key: "forecast", label: "Forecast & Scenarios", short: "Forecast", Icon: LineChartIcon },
  { key: "fiscal", label: "Fiscal Year & Actuals", short: "Fiscal Year", Icon: CalendarDays },
  { key: "report", label: "Executive Report", short: "Report", Icon: FileText },
];

/** Accessible tab bar (arrow keys / Home / End move between tabs). Scrolls horizontally on narrow screens. */
function ResultsTabs({ value, onChange }: { value: ResultsTab; onChange: (t: ResultsTab) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (i: number) => {
    const n = (i + RESULTS_TABS.length) % RESULTS_TABS.length;
    onChange(RESULTS_TABS[n].key);
    refs.current[n]?.focus();
  };
  const idx = RESULTS_TABS.findIndex((t) => t.key === value);
  return (
    <div className="sticky top-0 z-30 -mx-4 bg-slate-950/85 px-4 py-2 backdrop-blur-md sm:mx-0 sm:rounded-2xl sm:px-0 sm:py-0 sm:bg-transparent sm:backdrop-blur-none">
      <div
        role="tablist"
        aria-label="Report sections"
        className={cn(glass, "flex gap-1 overflow-x-auto overscroll-x-contain p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden")}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") move(idx + 1);
          else if (e.key === "ArrowLeft") move(idx - 1);
          else if (e.key === "Home") move(0);
          else if (e.key === "End") move(RESULTS_TABS.length - 1);
          else return;
          e.preventDefault();
        }}
      >
        {RESULTS_TABS.map((t, i) => {
          const on = t.key === value;
          return (
            <button
              key={t.key}
              ref={(el) => {
                refs.current[i] = el;
              }}
              id={`results-tab-${t.key}`}
              role="tab"
              type="button"
              aria-selected={on}
              aria-controls={`results-panel-${t.key}`}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(t.key)}
              className={cn(
                "inline-flex shrink-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300 sm:px-4",
                on ? "bg-indigo-500/90 text-white shadow" : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
              )}
            >
              <t.Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="sm:hidden">{t.short}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Live preview of the executive PDF (same HTML that prints), in a sandboxed frame. */
function ReportPreview({ html, onDownload, hasGoal, onSetGoal }: { html: string; onDownload: () => void; hasGoal: boolean; onSetGoal: () => void }) {
  return (
    <div className={cn(glass, "p-4 sm:p-6")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <FileText className="h-5 w-5 text-indigo-300" /> Executive report preview
          </h2>
          <p className="mt-0.5 text-sm text-slate-400">
            Exactly what the PDF contains: KPIs, goal pace with % ahead / behind, priority actions and the projection. It updates as you change line items, goals or forecast settings.
          </p>
          {!hasGoal && (
            <button type="button" onClick={onSetGoal} className="mt-1 text-xs text-indigo-300 hover:text-indigo-200">
              Set a goal to add the pace section ↑
            </button>
          )}
        </div>
        <button type="button" onClick={onDownload} className={primaryBtn}>
          <Download className="h-4 w-4" /> Download PDF
        </button>
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-white">
        <iframe title="Executive report preview" srcDoc={html} sandbox="" className="h-[70vh] min-h-[28rem] w-full" />
      </div>
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
  /** Recurring lines only: percent (1–99) of the first projected month this line covers; "" = full month. */
  partial: string;
}
interface FormExpense {
  id: number;
  label: string;
  amount: string;
  category: string;
  /** Every line starts recurring; the owner can flip single charges (a late fee, one purchase) to one-time. */
  oneTime: boolean;
  /** Recurring lines only: percent (1–99) of the first projected month this line covers; "" = full month. */
  partial: string;
  /** Priced as a % of revenue instead of a dollar amount (e.g. property management at 8.8% of rent). */
  pctMode: boolean;
  /** Percent, e.g. "8.8". */
  pct: string;
  /** Revenue line label the percent applies to; "" = all recurring revenue. */
  pctOf: string;
}

type FormPayload = {
  mode: "form";
  businessType: BusinessType;
  revenue: { label: string; amount: number; margin?: number; oneTime?: true; firstMonthShare?: number }[];
  expenses: { label: string; amount: number; category: string; oneTime?: true; firstMonthShare?: number; percentOf?: PercentOfRevenue }[];
  /** "statement" = parsed from an upload and reviewed by the owner. */
  origin?: "manual" | "statement";
};

let nextId = 1;
const newId = () => nextId++;

const blankRevenue = (label = ""): FormRevenue => ({ id: newId(), label, amount: "", margin: "", oneTime: false, partial: "" });
const blankExpense = (category = ""): FormExpense => ({ id: newId(), label: "", amount: "", category, oneTime: false, partial: "", pctMode: false, pct: "", pctOf: "" });

/** Form "partial %" → share of the first month (0–1, exclusive), or undefined for one-time / full-month lines. */
const rowShare = (r: { oneTime: boolean; partial: string }) => (r.oneTime || r.partial === "" ? undefined : validShare(Number(r.partial) / 100));

const validRevenueRows = (rows: FormRevenue[]) => rows.filter((r) => r.label.trim() && Number(r.amount) > 0);
const validExpenseRows = (rows: FormExpense[]) => rows.filter((e) => expenseLabel(e) && Number(e.amount) > 0);

/** Form "%" → share (0–1], or undefined. */
const pctShare = (e: Pick<FormExpense, "pctMode" | "pct">) => {
  if (!e.pctMode) return undefined;
  const n = Number(e.pct);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n / 100 : undefined;
};

/** The revenue a %-priced expense row points at, for the current (unsaved) revenue rows. */
function pctBase(e: Pick<FormExpense, "pctOf">, revenue: FormRevenue[]) {
  const lines = validRevenueRows(revenue).filter((r) => !r.oneTime);
  const hits = e.pctOf ? lines.filter((r) => r.label.trim().toLowerCase() === e.pctOf.trim().toLowerCase()) : lines;
  return sum(hits, (r) => Number(r.amount) || 0);
}

/** Expense rows with %-priced rows' amounts filled in from the current revenue rows (one-time rows can't be %-priced). */
function effectiveExpenses(expenses: FormExpense[], revenue: FormRevenue[]): FormExpense[] {
  return expenses.map((e) => {
    const share = pctShare(e);
    return share ? { ...e, oneTime: false, partial: "", amount: (Math.round(pctBase(e, revenue) * share * 100) / 100).toFixed(2) } : e;
  });
}

/** Form rows → API payload lines. Only valid rows are sent; `oneTime` is sent only when set. */
function toPayloadLines(revenue: FormRevenue[], expenses: FormExpense[], personal: boolean): Pick<FormPayload, "revenue" | "expenses"> {
  return {
    revenue: validRevenueRows(revenue).map((r) => ({
      label: r.label.trim(),
      amount: Number(r.amount),
      ...(!personal && r.margin !== "" && Number.isFinite(Number(r.margin)) ? { margin: Math.min(100, Math.max(0, Number(r.margin))) / 100 } : {}),
      ...(r.oneTime ? { oneTime: true as const } : rowShare(r) ? { firstMonthShare: rowShare(r) } : {}),
    })),
    expenses: validExpenseRows(effectiveExpenses(expenses, revenue)).map((e) => {
      const share = pctShare(e);
      return {
        label: expenseLabel(e),
        amount: Number(e.amount),
        category: e.category.trim() || "Uncategorized",
        ...(share
          ? { percentOf: { pct: Math.round(share * 100000) / 100000, revenueLabel: e.pctOf.trim() || null } }
          : e.oneTime
            ? { oneTime: true as const }
            : rowShare(e)
              ? { firstMonthShare: rowShare(e) }
              : {}),
      };
    }),
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
const optionalStr = (v: unknown) => v === undefined || typeof v === "string";
const isFormRevenue = (r: unknown): r is FormRevenue =>
  !!r &&
  typeof r === "object" &&
  typeof (r as FormRevenue).id === "number" &&
  ["label", "amount", "margin"].every((k) => typeof (r as unknown as Record<string, unknown>)[k] === "string") &&
  optionalBool((r as FormRevenue).oneTime) &&
  optionalStr((r as FormRevenue).partial);
const isFormExpense = (e: unknown): e is FormExpense =>
  !!e &&
  typeof e === "object" &&
  typeof (e as FormExpense).id === "number" &&
  ["label", "amount", "category"].every((k) => typeof (e as unknown as Record<string, unknown>)[k] === "string") &&
  optionalBool((e as FormExpense).oneTime) &&
  optionalStr((e as FormExpense).partial) &&
  optionalBool((e as FormExpense).pctMode) &&
  optionalStr((e as FormExpense).pct) &&
  optionalStr((e as FormExpense).pctOf);

/** Reads a saved draft for this form, validating its shape and keeping row ids unique. Client-only (the form never SSRs). */
function restoreDraft(key: string, mode: WorkspaceMode) {
  const d = loadDraft<unknown, unknown>(key);
  if (!d || !isBusinessType(d.businessType) || modeOf(d.businessType) !== mode) return null;
  if (!d.revenue.every(isFormRevenue) || !d.expenses.every(isFormExpense)) return null;
  const revenue = (d.revenue as FormRevenue[]).map((r) => ({ ...r, oneTime: r.oneTime === true, partial: r.partial ?? "" }));
  const expenses = (d.expenses as FormExpense[]).map((e) => ({ ...e, oneTime: e.oneTime === true, partial: e.partial ?? "", pctMode: e.pctMode === true, pct: e.pct ?? "", pctOf: e.pctOf ?? "" }));
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
  const validExpenses = validExpenseRows(effectiveExpenses(expenses, revenue));

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
            revenue={revenue}
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
                <div className="relative w-[9.5rem] shrink-0">
                  <NumInput aria-label="Margin percent (leave blank to estimate)" value={row.margin} placeholder="Margin (auto)" onChange={(v) => update({ margin: v })} className="pr-7" />
                  <span aria-hidden className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-slate-500">
                    %
                  </span>
                </div>
              )}
              <RecurrenceControl oneTime={row.oneTime} partial={row.partial} onChange={update} />
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
  revenue,
  mode,
  businessType,
  hint,
}: {
  rows: FormExpense[];
  setRows: (fn: (rows: FormExpense[]) => FormExpense[]) => void;
  /** Current revenue rows, for %-of-revenue expenses. */
  revenue: FormRevenue[];
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
                {row.pctMode ? (
                  <PercentAmount row={row} revenue={revenue} onChange={update} />
                ) : (
                  <div className="w-[7.5rem]">
                    <MoneyInput aria-label={row.oneTime ? "One-time amount" : "Monthly amount"} value={row.amount} onChange={(v) => update({ amount: v })} />
                  </div>
                )}
                <AmountModeToggle pctMode={row.pctMode} onChange={(pctMode) => update(pctMode ? { pctMode, oneTime: false, partial: "" } : { pctMode, amount: effectiveExpenses([row], revenue)[0].amount })} />
                {!row.pctMode && <RecurrenceControl oneTime={row.oneTime} partial={row.partial} onChange={update} />}
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

/** $ / % switch for an expense line. */
function AmountModeToggle({ pctMode, onChange }: { pctMode: boolean; onChange: (pctMode: boolean) => void }) {
  return (
    <div role="radiogroup" aria-label="Amount type" className="inline-flex h-[38px] shrink-0 rounded-lg border border-white/10 bg-slate-900/60 p-0.5 text-xs">
      {(
        [
          [false, "$", "Fixed dollar amount"],
          [true, "%", "Percent of a revenue line (e.g. management fee at 8.8% of rent)"],
        ] as const
      ).map(([v, label, title]) => (
        <button
          key={label}
          type="button"
          role="radio"
          aria-checked={pctMode === v}
          title={title}
          onClick={() => onChange(v)}
          className={cn("w-8 rounded-md font-semibold transition", pctMode === v ? "bg-indigo-500/80 text-white" : "text-slate-400 hover:text-slate-200")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** % input + "of [revenue line]" select, with the auto-calculated monthly dollar amount. */
function PercentAmount({ row, revenue, onChange }: { row: FormExpense; revenue: FormRevenue[]; onChange: (patch: Partial<FormExpense>) => void }) {
  const lines = validRevenueRows(revenue).filter((r) => !r.oneTime);
  const labels = Array.from(new Set(lines.map((r) => r.label.trim())));
  const missing = !!row.pctOf && !labels.some((l) => l.toLowerCase() === row.pctOf.trim().toLowerCase());
  const computed = Number(effectiveExpenses([row], revenue)[0].amount) || 0;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <div className="relative w-[5.5rem]">
        <input
          aria-label="Percent of revenue"
          type="text"
          inputMode="decimal"
          placeholder="8.8"
          value={row.pct}
          onChange={(e) => {
            const [w, ...rest] = e.target.value.replace(/[^\d.]/g, "").split(".");
            const v = rest.length ? `${w || "0"}.${rest.join("").slice(0, 3)}` : w;
            onChange({ pct: Number(v) > 100 ? "100" : v });
          }}
          className={cn(inputCls, "pr-6 tabular-nums")}
        />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-slate-500">
          %
        </span>
      </div>
      <span className="text-xs text-slate-500">of</span>
      <select aria-label="Revenue line the percent applies to" value={row.pctOf} onChange={(e) => onChange({ pctOf: e.target.value })} className={cn(inputCls, "w-auto max-w-[11rem] py-2 pr-7 text-xs")}>
        <option value="">All recurring revenue</option>
        {labels.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
        {missing && <option value={row.pctOf}>{row.pctOf} (not found)</option>}
      </select>
      <span className="text-xs tabular-nums text-slate-300" aria-live="polite" title="Calculated automatically and updated whenever that revenue changes">
        = {usd.format(computed)}/mo
      </span>
    </div>
  );
}

type Recurrence = "recurring" | "partial" | "oneTime";
const RECURRENCE_HELP: Record<Recurrence, string> = {
  recurring: "Recurring: repeats every month.",
  partial: "Partial first month: repeats monthly, but only this % of the first projected month is counted (e.g. rent or a contract starting mid-month).",
  oneTime: "One-time: counted once, in the first projected month (e.g. a single-week contract or a late fee).",
};

/** Recurring (default) / partial first month / one-time selector for a single line item. */
function RecurrenceControl({ oneTime, partial, onChange }: { oneTime: boolean; partial: string; onChange: (patch: { oneTime?: boolean; partial?: string }) => void }) {
  const value: Recurrence = oneTime ? "oneTime" : partial !== "" ? "partial" : "recurring";
  const Icon = value === "oneTime" ? Repeat1 : value === "partial" ? SplitSquareHorizontal : Repeat;
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <div className="relative">
        <Icon aria-hidden className={cn("pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2", value === "recurring" ? "text-slate-400" : value === "partial" ? "text-sky-200" : "text-amber-100")} />
        <select
          aria-label="Recurrence"
          title={RECURRENCE_HELP[value]}
          value={value}
          onChange={(e) => {
            const v = e.target.value as Recurrence;
            onChange(v === "oneTime" ? { oneTime: true, partial: "" } : v === "partial" ? { oneTime: false, partial: partial || "50" } : { oneTime: false, partial: "" });
          }}
          className={cn(
            "h-[38px] appearance-none rounded-lg border pl-7 pr-3 text-xs font-medium [color-scheme:dark] transition focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300",
            value === "oneTime" && "border-amber-300/40 bg-amber-950/60 text-amber-100",
            value === "partial" && "border-sky-300/40 bg-sky-950/60 text-sky-100",
            value === "recurring" && "border-white/10 bg-slate-900/80 text-slate-200",
          )}
        >
          <option value="recurring">Recurring</option>
          <option value="partial">Partial 1st month</option>
          <option value="oneTime">One-time</option>
        </select>
      </div>
      {value === "partial" && (
        <div className="relative w-[4.75rem]">
          <input
            aria-label="Percent of the first month"
            title="Share of the first projected month this line covers, e.g. 50 for mid-month"
            type="text"
            inputMode="numeric"
            value={partial}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
              onChange({ partial: digits === "" || digits === "0" ? "1" : digits });
            }}
            className={cn(inputCls, "pr-6 tabular-nums")}
          />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-slate-500">
            %
          </span>
        </div>
      )}
    </div>
  );
}

/** Totals before submitting: recurring per month, with one-time amounts and first-month proration listed separately. */
function ReviewSummary({ mode, businessType, revenue, expenses }: { mode: WorkspaceMode; businessType: BusinessType; revenue: FormRevenue[]; expenses: FormExpense[] }) {
  const copy = MODE_COPY[mode];
  const rev = rowTotals(revenue);
  const exp = rowTotals(expenses);
  const oneTimeRev = revenue.filter((r) => r.oneTime).length;
  const oneTimeExp = expenses.filter((e) => e.oneTime).length;
  // Month-1 change from partial lines: −amount × (1 − share) for revenue, +amount × (1 − share) back for expenses.
  const proration = (rows: { amount: string; oneTime: boolean; partial: string }[]) => sum(rows, (r) => (rowShare(r) ? (Number(r.amount) || 0) * (1 - rowShare(r)!) : 0));
  const partialCount = [...revenue, ...expenses].filter((r) => rowShare(r)).length;
  const firstMonthAdj = proration(expenses) - proration(revenue);
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
      {partialCount > 0 && (
        <ReviewRow
          label={`Partial-month proration (${partialCount} line${partialCount === 1 ? "" : "s"}, first month only)`}
          value={`${firstMonthAdj >= 0 ? "+" : ""}${usd.format(firstMonthAdj)}`}
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

  // After "Add line": scroll only the list (not the whole page) to the new last row, then focus its first field.
  // scrollIntoView on the row would also scroll every ancestor, making the page jump on long parsed statements.
  useEffect(() => {
    if (!scrollToNew.current) return;
    scrollToNew.current = false;
    const list = listRef.current;
    const row = list?.lastElementChild as HTMLElement | null;
    if (!list || !row) return;
    list.scrollTo({ top: list.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
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
      <p className="flex items-center justify-between gap-2 px-1 pb-1 text-xs uppercase tracking-wide text-slate-500">
        <span>{props.columns.join(" → ")}</span>
        {count > 3 && <span className="shrink-0 normal-case tracking-normal text-slate-600">{count} lines · scroll</span>}
      </p>
      {/* Fixed-height, self-contained scroll area: stable gutter (no width jump when the scrollbar appears) and no scroll chaining into the page. */}
      <div ref={listRef} className="max-h-[26rem] space-y-3 overflow-y-auto overscroll-contain scroll-py-2 rounded-xl pr-1 [scrollbar-gutter:stable]">
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

function NumInput({ value, onChange, placeholder = "0", className, ...rest }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; "aria-label": string }) {
  // Text (not type=number): no spinner arrows eating the box width, and the value stays exactly what was typed.
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      value={value}
      onChange={(e) => {
        const [w, ...r] = e.target.value.replace(/[^\d.]/g, "").split(".");
        onChange(r.length ? `${w || "0"}.${r.join("").slice(0, 2)}` : w);
      }}
      className={cn(inputCls, "tabular-nums", className)}
    />
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
  /** Month detected from the statement (null = not found). */
  period: StatementPeriod | null;
  /** Month the totals will be logged against ("" = not chosen yet). */
  month: string;
  /** Log the reviewed totals into the Fiscal Year Tracker when the report is generated. */
  logToTracker: boolean;
  /** Month already logged from this review (prevents double logging). */
  loggedMonth: string | null;
}

/** Parsed statement lines → editable form rows. Amounts are shown with cents; margins as percents. */
function toReviewState(items: { businessType: BusinessType; revenue: RevenueLine[]; expenses: ExpenseLine[] }, mode: WorkspaceMode, period: StatementPeriod | null): UploadReviewState {
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
    period,
    month: period?.key ?? "",
    logToTracker: !!period,
    loggedMonth: null,
  };
}

/** The reviewed rows → that month's actual totals (exact to the cent). */
function reviewTotals(review: UploadReviewState): MonthActual {
  return statementTotals({
    revenue: validRevenueRows(review.revenue).map((r) => ({ amount: Number(r.amount) })),
    expenses: validExpenseRows(effectiveExpenses(review.expenses, review.revenue)).map((e) => ({ amount: Number(e.amount), oneTime: e.oneTime })),
  });
}

function StatementUploader({
  mode,
  disabled,
  onSubmit,
  trackerReady,
  onLogActuals,
}: {
  mode: WorkspaceMode;
  disabled: boolean;
  onSubmit: (init: RequestInit, businessType?: BusinessType) => Promise<boolean>;
  trackerReady: boolean;
  onLogActuals: (key: string, actual: MonthActual) => string;
}) {
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
      const data = (await res.json()) as { items?: unknown; period?: unknown };
      if (!isExtractedLineItems(data.items)) throw new Error("Received an unexpected response from the analysis service.");
      setReview(toReviewState(data.items, mode, isStatementPeriod(data.period) ? data.period : null));
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
        trackerReady={trackerReady}
        onLogActuals={onLogActuals}
        onGenerate={(payload) => onSubmit({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, payload.businessType)}
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
      <button type="button" onClick={() => void onSubmit(documentInit(false), businessType || undefined)} disabled={busy || !ready} className="mt-2 self-center text-xs text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline disabled:opacity-40">
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
  trackerReady,
  onLogActuals,
}: {
  mode: WorkspaceMode;
  review: UploadReviewState;
  setReview: (fn: (r: UploadReviewState | null) => UploadReviewState | null) => void;
  disabled: boolean;
  onBack: () => void;
  onGenerate: (payload: FormPayload) => Promise<boolean>;
  trackerReady: boolean;
  onLogActuals: (key: string, actual: MonthActual) => string;
}) {
  const personal = mode === "PERSONAL";
  const copy = MODE_COPY[mode];
  const { businessType, revenue, expenses } = review;
  const validRevenue = validRevenueRows(revenue);
  const validExpenses = validExpenseRows(effectiveExpenses(expenses, revenue));
  const setRevenue = (fn: (rows: FormRevenue[]) => FormRevenue[]) => setReview((r) => r && { ...r, revenue: fn(r.revenue) });
  const setExpenses = (fn: (rows: FormExpense[]) => FormExpense[]) => setReview((r) => r && { ...r, expenses: fn(r.expenses) });
  const [logNote, setLogNote] = useState<string | null>(null);
  const totals = reviewTotals(review);
  const canLog = trackerReady && !!review.month && (totals.revenue > 0 || totals.expenses > 0);
  const logNow = () => {
    if (!canLog) return;
    setLogNote(onLogActuals(review.month, totals));
    setReview((r) => r && { ...r, loggedMonth: r.month });
  };
  const generate = async () => {
    // Log first so the tracker (and goal pace) already reflect this month when the report opens.
    if (review.logToTracker && canLog && review.loggedMonth !== review.month) logNow();
    await onGenerate({ mode: "form", businessType, origin: "statement", ...toPayloadLines(revenue, expenses, personal) });
  };

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
          <ExpenseRowsEditor rows={expenses} setRows={setExpenses} revenue={revenue} mode={mode} businessType={businessType} hint="Change a category if it was misread; a blank category is auto-classified." />
        </section>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <ReviewSummary mode={mode} businessType={businessType} revenue={validRevenue} expenses={validExpenses} />
        </div>

        <section aria-label="Statement month" className="rounded-xl border border-indigo-300/25 bg-indigo-500/[0.06] p-4">
          <StatementMonthPicker
            detected={review.period}
            value={review.month}
            onChange={(month) => {
              setLogNote(null);
              setReview((r) => r && { ...r, month, logToTracker: true });
            }}
          />
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 pt-3 text-xs">
            <label className="inline-flex cursor-pointer items-center gap-2 text-slate-300">
              <input
                type="checkbox"
                className="h-4 w-4 accent-indigo-400"
                checked={review.logToTracker}
                disabled={!review.month}
                onChange={(e) => setReview((r) => r && { ...r, logToTracker: e.target.checked })}
              />
              Log these totals as {review.month ? periodLabel(review.month) : "this month's"} actuals in the Fiscal Year Tracker
            </label>
            <span className="tabular-nums text-slate-500">
              {exactMoney(totals.revenue)} in · {exactMoney(totals.expenses)} out{totals.oneTimeExpenses ? ` (${exactMoney(totals.oneTimeExpenses)} one-time)` : ""}
            </span>
            <button
              type="button"
              onClick={logNow}
              disabled={!canLog || review.loggedMonth === review.month}
              className="ml-auto rounded-lg border border-indigo-300/30 px-2.5 py-1 text-indigo-100 hover:bg-indigo-400/10 disabled:opacity-40"
              title={trackerReady ? "Log now without generating a report" : "The tracker is still loading"}
            >
              {review.loggedMonth === review.month && review.month ? "Logged ✓" : "Log now"}
            </button>
          </div>
          {logNote && (
            <p role="status" className="mt-2 flex items-start gap-1.5 text-xs text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {logNote}
            </p>
          )}
          <p className="mt-2 text-[11px] text-slate-500">Uses the reviewed lines above for a single month; only the monthly totals are saved, never the statement.</p>
        </section>
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
          onClick={() => void generate()}
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
          the potential-savings total, the multi-month projection and the executive report are locked.
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
            {proOnly ? "Ask \"what if\" in plain English and see your adjusted runway over 12–60 months." : "See every month of your projected cash flow, with optional seasonality and inflation."}
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
          <CartesianGrid stroke={CHART.grid} vertical={false} />
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

function toBaseline(a: FinancialAnalysis) {
  return { businessType: a.businessType, itemizedRevenue: a.itemizedRevenue, itemizedExpenses: a.itemizedExpenses, inflationRateAssumed: a.inflationRateAssumed };
}

/** Re-projects with the chosen settings. `inflationRate` (live CPI or the owner's custom rate) replaces the server's assumption. */
function withProjection(a: FinancialAnalysis, s: ForecastSettings, inflationRate: number): FinancialAnalysis {
  const withRate = { ...a, inflationRateAssumed: inflationRate };
  return { ...withRate, macroProjections: projectBaseline(toBaseline(withRate), projectionOptions(s)) };
}

/** "Flat baseline", "Seasonality on", "3.0% annual inflation on costs (live CPI, Sep 2026)", or both. */
function macroSummary(s: Pick<ForecastSettings, "seasonality" | "inflation">, inflationRate: number, inflationLabel?: string) {
  if (!s.seasonality && !s.inflation) return "Flat baseline — no seasonality or inflation";
  return [s.seasonality && "seasonality", s.inflation && `${pct(inflationRate)} annual inflation on costs${inflationLabel ? ` (${inflationLabel})` : ""}`]
    .filter(Boolean)
    .join(" · ")
    .replace(/^./, (c) => c.toUpperCase());
}

/** Read-only ON / OFF chip so the projection's macro state is obvious even when the controls are scrolled away. */
function MacroChip({ label, on, detail }: { label: string; on: boolean; detail?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        on ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-100" : "border-white/10 bg-white/[0.03] text-slate-400",
      )}
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-emerald-300" : "bg-slate-600")} />
      {label} <b className="font-semibold">{on ? "ON" : "OFF"}</b>
      {on && detail && <span className="text-emerald-200/80">· {detail}</span>}
    </span>
  );
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

function KpiRow({ analysis, mode, locked, settings, inflationLabel }: { analysis: FinancialAnalysis; mode: WorkspaceMode; locked: boolean; settings: ForecastSettings; inflationLabel: string }) {
  const d = useDerived(analysis);
  const months = settings.months;
  const copy = MODE_COPY[mode];
  const tiles: { label: string; value: string; sub?: string; bad?: boolean; locked?: boolean; info?: ReactNode }[] = [
    { label: `Monthly ${copy.revenue.toLowerCase()}`, value: usd.format(analysis.monthlyRevenue), sub: d.oneTimeRevenue > 0 ? `+ ${usd.format(d.oneTimeRevenue)} one-time` : undefined },
    { label: `Monthly ${copy.expenses.toLowerCase()}`, value: usd.format(d.monthlyExpenses), sub: d.oneTimeExpenses > 0 ? `+ ${usd.format(d.oneTimeExpenses)} one-time` : undefined },
    { label: copy.net, value: usd.format(d.net), bad: d.net < 0 },
    locked
      ? { label: `${months}-mo projected net`, value: "Locked", sub: "Unlock to see your forecast", locked: true }
      : {
          label: `${months}-mo projected net`,
          value: usd.format(d.annualNet),
          info: (
            <>
              Total net cash over the next {months} months: recurring {copy.revenue.toLowerCase()} minus recurring {copy.expenses.toLowerCase()} each month, plus one-time items in
              month 1. {settings.seasonality || settings.inflation ? "Includes the seasonality / inflation toggles you turned on." : "Flat by default — no seasonality or inflation."}
            </>
          ),
          sub: d.firstNegative
            ? `Cash turns negative in ${d.firstNegative}`
            : settings.inflation
              ? `After ${pct(analysis.inflationRateAssumed)} inflation (${inflationLabel})`
              : settings.seasonality
                ? "With seasonality"
                : "Flat baseline (no inflation)",
          bad: d.annualNet < 0,
        },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className={cn(glass, "p-5")}>
          <p className="flex items-center justify-between gap-2 text-xs uppercase tracking-wide text-slate-400">
            {t.label}
            {t.info && <InfoTip label={t.label}>{t.info}</InfoTip>}
          </p>
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

function ProjectionCharts({
  analysis,
  settings,
  onSettingsChange,
  cpi,
  inflationLabel,
  actuals,
}: {
  analysis: FinancialAnalysis;
  settings: ForecastSettings;
  onSettingsChange: (s: ForecastSettings) => void;
  cpi: CpiReading | null;
  inflationLabel: string;
  /** Logged monthly actuals, for fitting the seasonal curve. */
  actuals?: Record<string, MonthActual>;
}) {
  const { rows } = useDerived(analysis);
  const [showTable, setShowTable] = useState(false);
  const copy = MODE_COPY[modeOf(analysis.businessType)];
  const months = settings.months;
  const long = months > 12;

  return (
    <div className={cn(glass, "p-6")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            {months}-Month Projection
            <InfoTip label="How the projection works" align="left">
              Each month repeats your recurring line items exactly as entered; one-time items land in month 1 and partial lines are pro-rated there. %-of-revenue
              expenses move with their revenue line. Seasonality and inflation are off unless you switch them on below.
            </InfoTip>
          </h2>
          <p className="text-sm text-slate-400">
            {macroSummary(settings, analysis.inflationRateAssumed, inflationLabel)}
            {settings.seasonality && ` · ${BUSINESS_TYPE_LABELS[analysis.businessType].toLowerCase()} curve`}
          </p>
          <p className="mt-1.5 flex flex-wrap gap-1.5">
            <MacroChip label="Seasonality" on={settings.seasonality} />
            <MacroChip label="Inflation" on={settings.inflation} detail={`${pct(analysis.inflationRateAssumed)} ${settings.inflationSource === "CUSTOM" ? "custom" : "CPI"}`} />
          </p>
        </div>
        <button onClick={() => setShowTable((s) => !s)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">
          {showTable ? "Show chart" : "Show table"}
        </button>
      </div>
      <ForecastControls settings={settings} onChange={onSettingsChange} cpi={cpi} className="mt-4" businessType={analysis.businessType} actuals={actuals} />

      {showTable ? (
        <div className="relative mt-4 max-h-[32rem] overflow-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="sticky top-0 z-20 bg-slate-900 text-left text-xs uppercase text-slate-400 shadow-[0_1px_0_rgba(255,255,255,0.08)]">
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
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="month" {...axisProps} tickFormatter={monthTick(long)} minTickGap={16} />
                <YAxis {...axisProps} width={64} tickFormatter={(v: number) => usdCompact.format(v)} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: CHART.cursor }} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: CHART.legend }} />
                <Line name={`Projected ${copy.revenue.toLowerCase()}`} type="monotone" dataKey="projectedRevenue" stroke={COLOR.revenue} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.surface }} />
                <Line name={`Projected ${copy.expenses.toLowerCase()}`} type="monotone" dataKey="projectedExpenses" stroke={COLOR.expenses} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.surface }} />
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
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="month" {...axisProps} tickFormatter={monthTick(long)} minTickGap={16} />
                <YAxis {...axisProps} width={64} tickFormatter={(v: number) => usdCompact.format(v)} />
                <ReferenceLine y={0} stroke={CHART.zero} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: CHART.cursor }} />
                <Area name="Cumulative net cash" type="monotone" dataKey="cumulative" stroke={COLOR.cash} strokeWidth={2} fill="url(#cashFill)" activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.surface }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
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

type AuditFlag = FinancialAnalysis["auditFlags"][number];

function AuditPanel({
  analysis,
  paywall,
  workspaceId,
  implemented = [],
  onToggleImplemented,
}: {
  analysis: FinancialAnalysis;
  paywall: Paywall;
  workspaceId: string | null;
  /** The tracker's savings list, to show which recommendations the owner has already acted on. */
  implemented?: { title: string; status: "IDENTIFIED" | "IMPLEMENTED"; since?: string }[];
  onToggleImplemented?: (flag: AuditFlag) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const teaser = paywall.access.level === "teaser";
  const flags = analysis.auditFlags;
  const visible = showAll || teaser ? flags : flags.filter((f) => f.severity !== "LOW").slice(0, 6);
  const savings = sum(flags, (f) => f.potentialSavings);
  const locked = paywall.access.lockedFlagCount;
  const doneFor = (f: AuditFlag) => implemented.find((x) => x.title === f.title && x.status === "IMPLEMENTED");

  return (
    <div className={cn(glass, "p-6")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ShieldAlert className="h-5 w-5 text-rose-300" /> Audit Mode
          </h2>
          <p
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-sky-300/25 bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-medium text-sky-200"
            title="Every line item is reviewed by AI against category benchmarks; flagged amounts are estimates for you to confirm."
          >
            <BadgeCheck className="h-3.5 w-3.5 shrink-0" aria-hidden /> AI-verified cost optimization
          </p>
        </div>
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
                {f.potentialSavings > 0 && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-emerald-300">
                      {doneFor(f) ? `Saving ~${usd.format(f.potentialSavings)}/mo` : `Save ~${usd.format(f.potentialSavings)}/mo`}
                    </p>
                    {onToggleImplemented && <ImplementedToggle on={!!doneFor(f)} title={f.title} since={doneFor(f)?.since} onToggle={() => onToggleImplemented(f)} />}
                  </div>
                )}
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

      <FeedbackWidget context="audit" workspaceId={workspaceId} prompt="Rate this audit" className="mt-5 border-t border-white/10 pt-4" />
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

function PercentBadge({ link }: { link: PercentOfRevenue }) {
  return (
    <span
      className="ml-2 inline-flex items-center gap-1 rounded-md border border-indigo-300/30 bg-indigo-400/10 px-1.5 py-0.5 align-middle text-[11px] text-indigo-100"
      title="Calculated from revenue and updated automatically when that revenue changes"
    >
      {Math.round(link.pct * 100000) / 1000}% of {link.revenueLabel ?? "revenue"}
    </span>
  );
}

function PartialBadge({ share }: { share: number }) {
  return (
    <span
      className="ml-2 inline-flex items-center gap-1 rounded-md border border-sky-300/30 bg-sky-400/10 px-1.5 py-0.5 align-middle text-[11px] text-sky-100"
      title="Recurring, but only part of the first projected month is counted (e.g. starts mid-month)"
    >
      <SplitSquareHorizontal className="h-3 w-3" /> Partial · {Math.round(share * 100)}% of 1st month
    </span>
  );
}

/** Sum of an itemized list, shown above it so the lines can be checked against the total at a glance. */
function ListTotal({ count, totals }: { count: number; totals: { recurring: number; oneTime: number } }) {
  const all = totals.recurring + totals.oneTime;
  return (
    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
      <span className="text-xs text-slate-400">
        Total · {count} item{count === 1 ? "" : "s"}
      </span>
      <span className="tabular-nums">
        <span className="font-semibold text-slate-100">{usd.format(all)}</span>
        {totals.oneTime > 0 && (
          <span className="ml-1.5 text-xs text-slate-500">
            ({usd.format(totals.recurring)} recurring + {usd.format(totals.oneTime)} one-time)
          </span>
        )}
      </span>
    </div>
  );
}

/** Analysis lines → editable form rows (amounts with cents, margins as percents, partial share as a percent). */
function toFormRows(revenue: RevenueLine[], expenses: ExpenseLine[], personal: boolean) {
  const share = (l: { oneTime?: boolean; firstMonthShare?: number }) => {
    const v = l.oneTime ? undefined : validShare(l.firstMonthShare);
    return v ? String(Math.round(v * 100)) : "";
  };
  return {
    revenue: revenue.map((r) => ({
      ...blankRevenue(r.label),
      amount: r.amount.toFixed(2),
      margin: personal || !Number.isFinite(r.margin) ? "" : String(Math.round(r.margin * 100)),
      oneTime: r.oneTime === true,
      partial: share(r),
    })),
    expenses: expenses.map((e) => ({
      ...blankExpense(e.category),
      label: e.label,
      amount: e.amount.toFixed(2),
      oneTime: e.oneTime === true,
      partial: e.percentOf ? "" : share(e),
      ...(e.percentOf ? { pctMode: true, pct: String(Math.round(e.percentOf.pct * 100000) / 1000), pctOf: e.percentOf.revenueLabel ?? "" } : {}),
    })),
  };
}

/**
 * Report line items with an "Edit Items" mode: rename, re-price, re-categorize, add/remove lines and switch
 * recurring / partial-first-month / one-time, without re-uploading. KPIs, projections and scenarios recompute
 * locally from the edited lines; audit flags and insights keep the original analysis.
 */
function LineItems({ analysis, onApply }: { analysis: FinancialAnalysis; onApply: (revenue: RevenueLine[], expenses: ExpenseLine[]) => void }) {
  const personal = analysis.businessType === "PERSONAL_FAMILY";
  const mode = modeOf(analysis.businessType);
  const copy = MODE_COPY[mode];
  const [editing, setEditing] = useState<{ revenue: FormRevenue[]; expenses: FormExpense[] } | null>(null);
  const [edited, setEdited] = useState(false);

  const startEdit = () => setEditing(toFormRows(analysis.itemizedRevenue, analysis.itemizedExpenses, personal));
  const apply = () => {
    if (!editing) return;
    const lines = toPayloadLines(editing.revenue, editing.expenses, personal);
    const revenue: RevenueLine[] = lines.revenue.map((r) => {
      const prior = analysis.itemizedRevenue.find((x) => x.label === r.label);
      return { ...r, margin: personal ? 1 : r.margin ?? prior?.margin ?? 0.5 };
    });
    const expenses: ExpenseLine[] = lines.expenses.map((e) => {
      const prior = analysis.itemizedExpenses.find((x) => x.label === e.label && x.category === e.category);
      return { ...e, category: e.category === "Uncategorized" ? "Other" : e.category, ...(prior?.flag ? { flag: prior.flag } : {}) } as ExpenseLine;
    });
    onApply(revenue, expenses);
    setEditing(null);
    setEdited(true);
  };

  const revTotals = splitTotals(analysis.itemizedRevenue);
  const expTotals = splitTotals(analysis.itemizedExpenses);
  const canApply = !!editing && validRevenueRows(editing.revenue).length > 0;

  return (
    <div className={cn(glass, "p-6")}>
      {editing ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Pencil className="h-4 w-4 text-indigo-300" /> Edit line items
            </h2>
            <p className="text-xs text-slate-500">Changes update the KPIs, projection and scenarios instantly — no re-upload.</p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <section aria-label={copy.revenue}>
              <h3 className="mb-2 text-sm font-medium text-slate-200">{copy.revenue}</h3>
              <RevenueRowsEditor
                rows={editing.revenue}
                setRows={(fn) => setEditing((s) => s && { ...s, revenue: fn(s.revenue) })}
                mode={mode}
                custom={analysis.businessType === "OTHER_CUSTOM"}
                hint="Monthly amounts. Partial = a recurring line that only covers part of the first month."
              />
            </section>
            <section aria-label={copy.expenses}>
              <h3 className="mb-2 text-sm font-medium text-slate-200">{copy.expenses}</h3>
              <ExpenseRowsEditor
                rows={editing.expenses}
                setRows={(fn) => setEditing((s) => s && { ...s, expenses: fn(s.expenses) })}
                revenue={editing.revenue}
                mode={mode}
                businessType={analysis.businessType}
                hint="e.g. mark rent that starts mid-month as Partial at 50%, or a single-week contract as One-time."
              />
            </section>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <ReviewSummary mode={mode} businessType={analysis.businessType} revenue={validRevenueRows(editing.revenue)} expenses={validExpenseRows(effectiveExpenses(editing.expenses, editing.revenue))} />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!canApply && <p className="mr-auto text-sm text-amber-200">Keep at least one {personal ? "income" : "revenue"} line with an amount.</p>}
            <button type="button" onClick={() => setEditing(null)} className={secondaryBtn}>
              Cancel
            </button>
            <button type="button" onClick={apply} disabled={!canApply} className={primaryBtn}>
              <CheckCircle2 className="h-4 w-4" /> Apply changes
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-medium text-slate-300">{copy.revenue}</h3>
              <ListTotal count={analysis.itemizedRevenue.length} totals={revTotals} />
              <ul className="mt-2 max-h-[28rem] divide-y divide-white/5 overflow-y-auto overscroll-contain pr-1 text-sm [scrollbar-gutter:stable]">
                {analysis.itemizedRevenue.map((r, i) => {
                  const share = r.oneTime ? undefined : validShare(r.firstMonthShare);
                  return (
                    <li key={`${r.label}-${i}`} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 py-2">
                      <span className="min-w-0 break-words text-slate-300">
                        {r.label}
                        {r.oneTime && <OneTimeBadge />}
                        {share && <PartialBadge share={share} />}
                      </span>
                      <span className="ml-auto whitespace-nowrap tabular-nums">
                        {usd.format(r.amount)} {!personal && <span className="text-xs text-slate-500">· {pct(r.margin)} margin</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs tabular-nums text-slate-500">
                {usd.format(revTotals.recurring)}/mo recurring{revTotals.oneTime > 0 ? ` · ${usd.format(revTotals.oneTime)} one-time` : ""}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-300">{copy.expenses}</h3>
              <ListTotal count={analysis.itemizedExpenses.length} totals={expTotals} />
              <ul className="mt-2 max-h-[28rem] divide-y divide-white/5 overflow-y-auto overscroll-contain pr-1 text-sm [scrollbar-gutter:stable]">
                {analysis.itemizedExpenses.map((e, i) => {
                  const share = e.oneTime ? undefined : validShare(e.firstMonthShare);
                  return (
                    <li key={`${e.label}-${i}`} className="py-2">
                      <div className="flex justify-between gap-3">
                        <span className="text-slate-300">
                          {e.label}
                          {e.category && e.category.toLowerCase() !== e.label.toLowerCase() && <span className="text-xs text-slate-500"> · {e.category}</span>}
                          {e.oneTime && <OneTimeBadge />}
                          {e.percentOf && <PercentBadge link={e.percentOf} />}
                          {share && !e.percentOf && <PartialBadge share={share} />}
                        </span>
                        <span className="shrink-0 tabular-nums">{usd.format(e.amount)}</span>
                      </div>
                      {e.flag && (
                        <p className="mt-1 flex items-center gap-1 text-xs text-amber-200">
                          <AlertTriangle className="h-3 w-3" /> {e.flag}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs tabular-nums text-slate-500">
                {usd.format(expTotals.recurring)}/mo recurring{expTotals.oneTime > 0 ? ` · ${usd.format(expTotals.oneTime)} one-time` : ""}
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
            <button type="button" onClick={startEdit} className={cn(secondaryBtn, "py-1.5 text-xs")}>
              <Pencil className="h-3.5 w-3.5" /> Edit Items
            </button>
            <p className="text-xs text-slate-500">
              {edited
                ? "Edited — totals, projection and scenarios reflect your changes. Audit flags and insights are from the original analysis; re-run Analyze to refresh them."
                : "Adjust names, amounts, or recurring / partial / one-time status without re-uploading."}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Executive report → browser print dialog ("Save as PDF"). Rendered client-side only.
// ---------------------------------------------------------------------------

function reportHtml(a: FinancialAnalysis, settings: ForecastSettings, goal: GoalReport | null, inflationLabel: string) {
  const months = settings.months;
  const macro = macroSummary(settings, a.inflationRateAssumed, inflationLabel);
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
td:first-child,th:first-child{text-align:left}.neg{color:#b42318}.pos{color:#047857}li{margin-bottom:6px}.kpi .muted{font-size:11px}
.pace-banner{margin-top:20px;border:2px solid;border-radius:10px;padding:14px 16px;break-inside:avoid}.pace-good{border-color:#047857;background:#ecfdf5}.pace-bad{border-color:#b42318;background:#fef3f2}
.pace-head{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}.pace-good .pace-head{color:#047857}.pace-bad .pace-head{color:#b42318}
@page{margin:16mm}@media print{body{margin:0;max-width:none}}
</style></head><body>
<h1>LedgerPulse Executive Report</h1>
<p class="muted">${esc(BUSINESS_TYPE_LABELS[a.businessType])} · Generated ${esc(generated)} · ${esc(macro)}</p>
<div class="kpis">
<div class="kpi">Monthly ${esc(copy.revenue.toLowerCase())}<b>${usd.format(a.monthlyRevenue)}</b></div>
<div class="kpi">Monthly ${esc(copy.expenses.toLowerCase())}<b>${usd.format(monthlyExpenses)}</b></div>
<div class="kpi">${esc(copy.net)}<b class="${net < 0 ? "neg" : ""}">${usd.format(net)}</b></div>
<div class="kpi">${months}-mo projected net<b class="${cumulative < 0 ? "neg" : ""}">${usd.format(cumulative)}</b></div>
</div>
${goal ? goalPaceBannerHtml(goal.pace, goal.fyLabel, esc) : ""}
<h2>${a.businessType === "PERSONAL_FAMILY" ? "Biggest budget lever" : "Top performer"}: ${esc(a.winnerInsight.topService)}</h2><p>${esc(a.winnerInsight.message)}</p>
<h2>Priority actions</h2>${flags ? `<ol>${flags}</ol>` : "<p>No issues found.</p>"}
${a.missingCategories.length ? `<h2>Missing categories</h2><p>${a.missingCategories.map(esc).join(", ")}</p>` : ""}
<h2>${months}-month projection</h2>
<table><thead><tr><th>Month</th><th>${esc(copy.revenue)}</th><th>${esc(copy.expenses)}</th><th>Net</th><th>Cumulative</th></tr></thead><tbody>${projRows}</tbody></table>
${goal ? goalPaceReportHtml(goal.pace, goal.fyLabel, esc) : ""}
<p class="muted" style="margin-top:24px;font-size:12px">Projections repeat current recurring monthly amounts (${esc(macro.toLowerCase())}); one-time items are counted once, in the first month, partial-month lines are pro-rated in the first month, and %-of-revenue expenses follow their revenue line.${goal ? " Goal pace spreads the year-end goal evenly across the 12 fiscal months and compares logged actuals plus the tracker forecast against it." : ""} ${esc(LEGAL_DISCLAIMER)}</p>
</body></html>`;
}

/** Opens the browser's print dialog with the executive report so the user can save a PDF. */
function printExecutiveReport(a: FinancialAnalysis, settings: ForecastSettings, goal: GoalReport | null, inflationLabel: string) {
  printHtml(reportHtml(a, settings, goal, inflationLabel));
}
