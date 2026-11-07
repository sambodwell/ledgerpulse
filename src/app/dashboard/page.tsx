"use client";

import { Component, useCallback, useEffect, useId, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Area, AreaChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Briefcase,
  CheckCircle2,
  CircleHelp,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Download,
  FileText,
  Lightbulb,
  TrendingUp,
  FolderOpen,
  History,
  Home,
  Info,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Repeat,
  Repeat1,
  RotateCw,
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
  HORIZON_OPTIONS,
  MODE_COPY,
  MONTH_NAMES,
  PRICING,
  effectiveInflationRate,
  isAnalysisResponse,
  isCpiReading,
  isBusinessType,
  modeOf,
  monthKey,
  parseMonthKey,
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
  type ExtractedLineItems,
  type ForecastSettings,
  type RevenueLine,
  type FinancialAnalysis,
  type PercentOfRevenue,
  type Severity,
  type WorkspaceMode,
  type WorkspaceProfile,
} from "@/lib/schemas";
import {
  authHeaders,
  createWorkspace,
  deleteDocument,
  documentSlices,
  listDocuments,
  listReportVersions,
  loadReportVersion,
  loadWorkspaceReport,
  loadWorkspaceSettings,
  saveDocuments,
  saveFiscalTracker,
  saveReportVersion,
  saveWorkspaceReport,
  saveWorkspaceSettings,
  updateDocument,
  updateDocumentItems,
  updateWorkspace,
  type NewWorkspaceDocument,
  type ReportVersionMeta,
  type ReportVersionSummary,
  type WorkspaceDocument,
} from "@/lib/supabase";
import { exactMoney, normalizeTrackerState, statementTotals, withLoggedActual, type MonthActual } from "@/lib/fiscal";
import { aggregateActuals, calibrateToActuals, resolveBasis, type ActualsAggregate, type ProjectionBasis } from "@/lib/projectionBasis";
import { DOCUMENT_KIND_LABELS, REVIEW_FLAG_LABELS, aggregateStatements, documentName, hashFile, renameForMonth, monthlyBaseline, parseExtractResponse, type ParsedStatement, type ReviewFlag, type StatementOverlap } from "@/lib/batchStatements";
import { buildVendorHistory, classifyLine, insightTone, matchFlags, sameVendor, type LineInsight } from "@/lib/lineInsights";
import { periodLabel } from "@/lib/statementPeriod";
import { StatementMonthPicker, statementMonthOptions } from "@/components/dashboard/StatementMonth";
import { DocumentsHub } from "@/components/dashboard/DocumentsHub";
import { AuditDeepDive } from "@/components/dashboard/AuditDeepDive";
import { BrandLogo } from "@/components/BrandLogo";
import { CheckoutModal, type CheckoutBusy, type CheckoutKind } from "@/components/CheckoutModal";
import { clearDraft, draftKey, loadDraft, saveDraft } from "@/lib/formDraft";
import { DEV_UNLOCK } from "@/lib/devUnlock";
import { useApp } from "@/components/AppProvider";
import { fromMode, useWorkspace } from "@/context/WorkspaceContext";
import { ProfileMenu, creditsLabel } from "@/components/ProfileMenu";
import { AppShell } from "@/components/WorkspaceSidebar";
import { LEGAL_DISCLAIMER } from "@/components/Footer";
import { CHART, COLOR, ChartTooltip, axisProps, esc, monthTick, printHtml, signedUsd } from "@/components/dashboard/chartKit";
import { downloadHtmlAsPdf, pdfFileName } from "@/lib/pdfDownload";
import { ForecastControls, SeasonalityHelp } from "@/components/dashboard/ForecastControls";
import { ScenarioPanel, scenarioExamples } from "@/components/dashboard/ScenarioPanel";
import { FiscalYearTracker, ImplementedToggle, toggleImplemented, type GoalReport } from "@/components/dashboard/FiscalYearTracker";
import { DataCompletenessNote, GoalPaceBanner, GoalTracker, goalPaceBannerHtml, goalPaceReportHtml } from "@/components/dashboard/GoalTracker";
import { clearLocalTracker, clearUnsyncedTracker, readLocalTracker, useFiscalTracker } from "@/components/dashboard/useFiscalTracker";
import { InfoTip } from "@/components/InfoTip";
import { FeedbackWidget } from "@/components/dashboard/FeedbackWidget";
import { MoneyInput, MoneyNumberInput } from "@/components/dashboard/MoneyInput";
import { ExpenseShareCard } from "@/components/dashboard/ExpenseShare";
import { CashFlowChart } from "@/components/dashboard/CashFlowChart";
import { MonthlyBreakdown, type LineRef } from "@/components/dashboard/MonthlyBreakdown";
import { WhatIfSimulator } from "@/components/dashboard/WhatIfSimulator";
import { RunwayCard, breakEvenSentence, runwayFigures, runwaySentence } from "@/components/dashboard/RunwayCard";
import { BenchmarkGauges, benchmarksReportHtml } from "@/components/dashboard/BenchmarkGauges";
import { VendorCreepAlerts, useVendorCreep } from "@/components/dashboard/VendorCreepAlerts";
import { useWorkspacePref } from "@/components/dashboard/useWorkspacePref";
import { GranularityToggle, PaceStrip } from "@/components/dashboard/GranularityToggle";
import { GRANULARITIES, GRANULARITY_LABELS, GRANULARITY_UNIT, isGranularity, labelToKey, paceOf, toPeriods, type Granularity } from "@/lib/granularity";
import { defaultBenchmarkProfile, evaluateBenchmarks, isBenchmarkProfile, type BenchmarkProfile } from "@/lib/benchmarks";
import { creepHeadline, type VendorCreep } from "@/lib/vendorCreep";
import { cn, errorMessage, glass, inputCls, pct, primaryBtn, secondaryBtn, usd, usdCompact } from "@/components/ui";

const PRIVACY_BADGE = "🔒 256-Bit Encrypted | Zero File Retention — Statement files are parsed in memory and never stored; only the parsed results are saved to your private workspace.";
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
  busy: CheckoutBusy;
  message: string | null;
  checkout: (kind: CheckoutKind) => void;
  /** Opens the Pro checkout modal (plans, Stripe checkout, VIP access code). */
  openCheckout: () => void;
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
  // Locked to the active workspace's type: a saved workspace is one book (see WorkspaceContext).
  const { mode, setActiveWorkspace, locked: modeLocked } = useWorkspace();
  const setMode = (m: WorkspaceMode) => setActiveWorkspace(fromMode(m));

  // Gate: financial inputs require an account (the API enforces this too).
  const mustSignIn = app.ready && !app.user;
  useEffect(() => {
    if (mustSignIn) router.replace(`/signup?next=${encodeURIComponent("/dashboard")}`);
  }, [mustSignIn, router]);

  // Results per workspace. Saved workspaces persist their latest report to `workspace_reports` (so it survives
  // reloads, deploys and other devices); this tab also keeps a sessionStorage copy, which is all a temporary
  // ("guest") report ever gets.
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

  // Load each saved workspace's report from the database once (a report already in this tab wins).
  const activeWsId = app.activeWorkspace?.id ?? null;
  const reportFetched = useRef<Set<string>>(new Set());
  /** Last report written to / read from the database, per workspace, so unchanged reports aren't re-saved. */
  const reportSynced = useRef<Record<string, AnalysisResponse>>({});
  const [reportLoading, setReportLoading] = useState<string | null>(null);
  /**
   * Whether each workspace's saved report has been looked up: "ok" (loaded, or confirmed there is none) or "error".
   * Until it is known the dashboard shows a loading state rather than guessing between the upload screen and the
   * analysis tabs.
   */
  const [reportStatus, setReportStatus] = useState<Record<string, "ok" | "error">>({});
  const markReport = useCallback((id: string, s: "ok" | "error") => setReportStatus((cur) => (cur[id] === s ? cur : { ...cur, [id]: s })), []);

  /*
   * Report history: every new analysis appends an immutable version (workspace_report_versions), so re-running an
   * analysis — e.g. after uploading more months — never silently replaces earlier insights. `activeVersion` is the
   * version currently on screen (null = the latest report, or one not recorded as a version).
   */
  const [versionsByWs, setVersionsByWs] = useState<Record<string, ReportVersionMeta[]>>({});
  const [activeVersion, setActiveVersion] = useState<Record<string, string | null>>({});
  const versionsFetched = useRef<Set<string>>(new Set());
  const loadVersions = useCallback(async (id: string) => {
    versionsFetched.current.add(id);
    try {
      const list = await listReportVersions(id);
      setVersionsByWs((cur) => ({ ...cur, [id]: list }));
      return list;
    } catch (e) {
      // History is additive: a missing table (migration 0005 not applied yet) must never block the dashboard.
      versionsFetched.current.delete(id);
      console.warn("[report] versions unavailable", e);
      return [];
    }
  }, []);
  const recordVersion = useCallback((id: string, report: AnalysisResponse, summary: ReportVersionSummary) => {
    if (id === "guest" || report.access.level !== "full") return;
    saveReportVersion(id, report, summary)
      .then((meta) => {
        setVersionsByWs((cur) => ({ ...cur, [id]: [meta, ...(cur[id] ?? []).filter((v) => v.id !== meta.id)] }));
        setActiveVersion((cur) => ({ ...cur, [id]: meta.id }));
      })
      .catch((e) => console.warn("[report] version save failed", e));
  }, []);
  /** Workspaces whose documents changed (line removed, document deleted / re-dated) since their report was generated. */
  const [docsChangedFor, setDocsChangedFor] = useState<Set<string>>(new Set());
  const markDocsChanged = (id: string, changed: boolean) =>
    setDocsChangedFor((cur) => {
      if (cur.has(id) === changed) return cur;
      const next = new Set(cur);
      if (changed) next.add(id);
      else next.delete(id);
      return next;
    });

  const [reportReloadTick, setReportReloadTick] = useState(0);
  useEffect(() => {
    if (!userId || !activeWsId || reportFetched.current.has(activeWsId)) return;
    const id = activeWsId;
    reportFetched.current.add(id);
    setReportLoading(id);
    void loadVersions(id);
    loadWorkspaceReport(id)
      .then(async (r) => {
        if (r) {
          reportSynced.current[id] = r;
          setResults((cur) => (cur[id] ? cur : { ...cur, [id]: r }));
          markReport(id, "ok");
          return;
        }
        // No latest report row (e.g. the tab closed before it saved): fall back to the newest saved version, so a
        // workspace with history never lands on a dead "run analysis" state. It is re-saved as the latest below.
        const versions = versionsFetched.current.has(id) ? await listReportVersions(id).catch(() => []) : [];
        const newest = versions[0] ? await loadReportVersion(versions[0].id).catch(() => null) : null;
        if (newest) {
          setResults((cur) => (cur[id] ? cur : { ...cur, [id]: newest }));
          setActiveVersion((cur) => ({ ...cur, [id]: versions[0].id }));
        }
        markReport(id, "ok");
      })
      .catch((e) => {
        reportFetched.current.delete(id);
        markReport(id, "error");
        console.warn("[report] load failed", e);
      })
      .finally(() => setReportLoading((cur) => (cur === id ? null : cur)));
  }, [userId, activeWsId, markReport, loadVersions, reportReloadTick]);
  const retryReportLoad = () => setReportReloadTick((n) => n + 1);
  // Persist changed reports (new analysis, unlock, line-item edits), debounced.
  useEffect(() => {
    if (!userId) return;
    const dirty = Object.entries(results).filter(([k, v]) => k !== "guest" && reportSynced.current[k] !== v && reportFetched.current.has(k));
    if (!dirty.length) return;
    const t = setTimeout(() => {
      for (const [k, v] of dirty) {
        reportSynced.current[k] = v;
        saveWorkspaceReport(k, v).catch((e) => {
          delete reportSynced.current[k];
          console.warn("[report] save failed", e);
        });
      }
    }, 800);
    return () => clearTimeout(t);
    // reportLoading: re-check once a workspace's initial load finishes (a report made meanwhile is saved then).
  }, [results, userId, reportLoading]);

  // Documents analyzed into each saved workspace ("My Documents").
  const [docsByWs, setDocsByWs] = useState<Record<string, WorkspaceDocument[]>>({});
  const [docsState, setDocsState] = useState<{ loading: string | null; error: string | null }>({ loading: null, error: null });
  const docsFetched = useRef<Set<string>>(new Set());
  const loadDocs = useCallback(async (id: string) => {
    docsFetched.current.add(id);
    setDocsState({ loading: id, error: null });
    try {
      const list = await listDocuments(id);
      setDocsByWs((cur) => ({ ...cur, [id]: list }));
      setDocsState((s) => (s.loading === id ? { loading: null, error: null } : s));
    } catch (e) {
      docsFetched.current.delete(id);
      setDocsState({ loading: null, error: e instanceof Error ? `Couldn't load documents: ${e.message}` : "Couldn't load documents." });
    }
  }, []);
  useEffect(() => {
    if (userId && activeWsId && !docsFetched.current.has(activeWsId)) void loadDocs(activeWsId);
  }, [userId, activeWsId, loadDocs]);
  const workspaceDocs = activeWsId ? docsByWs[activeWsId] ?? [] : [];
  const [docsOpen, setDocsOpen] = useState(false);
  /** Document to scroll to when the manager opens from the sidebar's Documents menu. */
  const [docsFocus, setDocsFocus] = useState<string | null>(null);
  const openDocuments = useCallback(
    (docId?: string) => {
      setDocsFocus(docId ?? null);
      setDocsOpen(true);
      if (activeWsId && !docsFetched.current.has(activeWsId)) void loadDocs(activeWsId);
    },
    [activeWsId, loadDocs],
  );
  const [wsSettingsOpen, setWsSettingsOpen] = useState(false);

  /**
   * Bumped whenever the statement uploader must start clean: a brand-new workspace, or switching to another
   * workspace from a menu. (Not when the "which workspace?" picker switches mid-review — that keeps the parsed lines.)
   */
  const [uploaderEpoch, setUploaderEpoch] = useState(0);
  const pickerSwitching = useRef(false);
  const prevWsId = useRef(activeWsId);
  useEffect(() => {
    if (prevWsId.current === activeWsId) return;
    prevWsId.current = activeWsId;
    if (pickerSwitching.current) pickerSwitching.current = false;
    else {
      setUploaderEpoch((n) => n + 1);
      // Another workspace: its own state decides where it lands (an "inputs open" choice made in the previous
      // workspace must not carry over and park a workspace that has data on the upload screen).
      setInputsOverride(null);
      setResultsTab("overview");
    }
  }, [activeWsId]);

  const [tab, setTab] = useState<InputTab>("form");
  /** Parsed statement lines are under review: the review takes the full width (revenue | expenses side by side). */
  const [reviewing, setReviewing] = useState(false);
  /** Results command-center tab. */
  const [resultsTab, setResultsTab] = useState<ResultsTab>("overview");
  /** null = automatic: see `inputsOpen` below. */
  const [inputsOverride, setInputsOverride] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paywallBusy, setPaywallBusy] = useState<Paywall["busy"]>(null);
  const [paywallMsg, setPaywallMsg] = useState<string | null>(null);
  const [pendingUnlock, setPendingUnlock] = useState<{ sealed: string; wsKey: string } | null>(null);
  const [confirmingCheckout, setConfirmingCheckout] = useState(false);
  /** The post-analysis paywall modal. Opens on its own when a free account's analysis comes back as a preview. */
  const [checkoutOpen, setCheckoutOpen] = useState(false);
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
  /**
   * The business type the owner picked in the setup wizard or the statement review panel, scoped to this workspace +
   * mode (so it never leaks into another book). Both panels read it, so they always agree.
   */
  const typeScope = `${wsKey}-${mode}`;
  const [pickedType, setPickedType] = useState<{ scope: string; type: BusinessType | null } | null>(null);
  const syncedType: BusinessType | null =
    mode === "PERSONAL" ? null : pickedType?.scope === typeScope ? pickedType.type : ws && ws.mode === "BUSINESS" ? ws.businessType : null;
  const pickType = useCallback((type: BusinessType | null) => setPickedType({ scope: typeScope, type }), [typeScope]);
  /** Opens the statement uploader's "add more documents" picker (registered by the uploader). */
  const uploadMoreRef = useRef<(() => void) | null>(null);

  /** Fiscal Year Tracker state (monthly actuals, goals, savings) for the active workspace, shared with the Goal Tracker. */
  const tracker = useFiscalTracker({ userId: userId ?? "", workspaceId: ws?.id ?? null, businessType: formDefaultType });
  /** Goal pace included in the executive PDF. */
  const goalReport: GoalReport | null = tracker.pace && tracker.status !== "loading" && !tracker.loadFailed ? { pace: tracker.pace, fyLabel: tracker.fyLabel } : null;

  /*
   * Where a workspace lands. A workspace with anything saved — a report, parsed documents, or logged actuals — opens
   * straight on the analysis dashboard; only a workspace with nothing in it opens on the upload / onboarding inputs.
   * While its report, documents and tracker are still loading, neither is shown (no flash of the upload screen).
   */
  const trackerHasActuals = tracker.status !== "loading" && !tracker.loadFailed && Object.keys(tracker.state.actuals).length > 0;
  const docsKnown = !activeWsId || activeWsId in docsByWs || (!!docsState.error && docsState.loading === null);
  const reportKnown = !activeWsId || !!current || !!reportStatus[activeWsId];
  const hydrating = !!activeWsId && !current && (!reportKnown || !docsKnown || tracker.status === "loading");
  const hasSavedData = !!current || workspaceDocs.length > 0 || (!!activeWsId && trackerHasActuals);
  const inputsOpen = inputsOverride ?? (!hydrating && !hasSavedData);

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
  /** Shows the statement uploader (opening the inputs if they are collapsed) and scrolls to it. */
  const revealUploader = () => {
    setInputsOverride(true);
    setTab("upload");
    requestAnimationFrame(() => jumpTo("statement-uploader"));
  };
  /** "Upload More Documents": opens the file picker right away (inside the click) and brings the uploader / review into view. */
  const uploadMore = () => {
    uploadMoreRef.current?.();
    revealUploader();
  };

  const post = useCallback(async (init: RequestInit) => {
    const auth = await authHeaders();
    return fetch("/api/analyze", { method: "POST", ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...auth } });
  }, []);

  /** Runs the analysis and stores the result under `targetKey` (the workspace chosen in the picker). */
  const runAnalysis = useCallback(
    async (
      init: RequestInit,
      targetKey: string,
      opts: { quiet?: boolean; source?: ReportVersionSummary["source"]; months?: string[]; documents?: number } = {},
    ): Promise<AnalysisResponse | null> => {
      setLoading(true);
      setError(null);
      setPaywallMsg(null);
      try {
        const res = await post(init);
        if (!res.ok) throw new Error(await errorMessage(res));
        const data: unknown = await res.json();
        if (!isAnalysisResponse(data)) throw new Error("Received an unexpected response from the analysis service.");
        setResults((r) => ({ ...r, [targetKey]: data }));
        // High-intent moment: the preview is on screen, the Pro dashboard behind it is locked.
        if (!opts.quiet && data.access.level === "teaser" && data.access.tier !== "pro") setCheckoutOpen(true);
        // Every run is kept as its own version; the previous report stays restorable from Report history.
        recordVersion(targetKey, data, {
          source: opts.source ?? "analysis",
          monthlyRevenue: data.analysis.monthlyRevenue,
          monthlyExpenses: splitTotals(data.analysis.itemizedExpenses).recurring,
          ...(opts.months?.length ? { months: [...new Set(opts.months)].sort() } : {}),
          ...(opts.documents ? { documents: opts.documents } : {}),
        });
        setDocsChangedFor((cur) => {
          if (!cur.has(targetKey)) return cur;
          const next = new Set(cur);
          next.delete(targetKey);
          return next;
        });
        setInputsOverride(null);
        // A fresh report opens on the Overview tab, with the inputs tucked away. A quiet (background) rebuild leaves
        // the owner where they are.
        if (!opts.quiet) {
          setResultsTab("overview");
          requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
        }
        return data;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [post, recordVersion],
  );

  /**
   * A saved workspace with parsed documents but no saved report (e.g. the tab closed before the report finished
   * saving) rebuilds its report from those documents once, in the background, so it still opens on the dashboard
   * tabs. Only when the report lookup succeeded and found nothing — a failed lookup never triggers a rebuild.
   */
  const rebuildTried = useRef<Set<string>>(new Set());
  const [rebuilding, setRebuilding] = useState<string | null>(null);
  // Rebuild source: every saved document (all months, cumulatively) — or, for a workspace with only logged months,
  // those actuals — so a workspace with valid data always has a way to a report.
  const trackerActuals = tracker.status === "loading" || tracker.loadFailed ? null : tracker.state.actuals;
  const rebuildPayload = useCallback(
    (id: string) => {
      const docs = docsByWs[id] ?? [];
      const fromDocs = payloadFromDocuments(docs, formDefaultType);
      if (fromDocs) return { payload: fromDocs, months: [...new Set(docs.flatMap((d) => documentSlices(d).map((s) => s.period)))], documents: docs.length };
      const fromActuals = id === activeWsId && trackerActuals ? payloadFromActuals(trackerActuals, formDefaultType) : null;
      return fromActuals ? { payload: fromActuals, months: Object.keys(trackerActuals!), documents: 0 } : null;
    },
    [docsByWs, formDefaultType, activeWsId, trackerActuals],
  );
  const rebuildFromDocuments = useCallback(
    async (id: string, opts: { quiet?: boolean } = { quiet: true }) => {
      const src = rebuildPayload(id);
      if (!src) return false;
      rebuildTried.current.add(id);
      setRebuilding(id);
      try {
        return !!(await runAnalysis({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(src.payload) }, id, { quiet: opts.quiet, source: "rebuild", months: src.months, documents: src.documents }));
      } finally {
        setRebuilding((cur) => (cur === id ? null : cur));
      }
    },
    [rebuildPayload, runAnalysis],
  );
  const rebuildSource = activeWsId ? rebuildPayload(activeWsId) : null;
  const canRebuild = !!rebuildSource;
  useEffect(() => {
    if (!activeWsId || current || loading || reportStatus[activeWsId] !== "ok" || !(activeWsId in docsByWs) || rebuildTried.current.has(activeWsId)) return;
    // Saved documents first; otherwise even one or two logged months (from any point in the year) build the report, so
    // the overview, forecast and executive report never sit empty while the workspace has data. Logged months are only
    // used once this workspace's own tracker has loaded.
    const fromDocs = !!payloadFromDocuments(docsByWs[activeWsId], formDefaultType);
    if (!fromDocs && !(tracker.workspaceId === activeWsId && trackerActuals && payloadFromActuals(trackerActuals, formDefaultType))) return;
    const t = setTimeout(() => void rebuildFromDocuments(activeWsId), 0);
    return () => clearTimeout(t);
  }, [activeWsId, current, loading, reportStatus, docsByWs, formDefaultType, rebuildFromDocuments, tracker.workspaceId, trackerActuals]);

  /** "Re-analyze all N months": one fresh report across every saved document, kept as a new version. */
  const reanalyzeAll = async () => {
    if (!activeWsId) return;
    const months = rebuildSource?.months.length ?? 0;
    if (await rebuildFromDocuments(activeWsId)) {
      setLogNotice(`Re-analyzed ${months} month${months === 1 ? "" : "s"} of saved documents. The previous report is kept in Report history.`);
    }
  };

  /** Removes one line from a saved document (monthly breakdown), recomputing that document's totals. */
  const removeDocLine = async (ref: LineRef) => {
    const { doc, period, side, index } = ref;
    const wsId = doc.workspaceId;
    let next: Parameters<typeof updateDocumentItems>[1];
    if (doc.months.length) {
      const months = doc.months.map((m) => (m.period === period ? { ...m, [side]: m[side].filter((_, i) => i !== index) } : m));
      next = { items: doc.items, months, totals: statementTotals({ revenue: months.flatMap((m) => m.revenue), expenses: months.flatMap((m) => m.expenses) }) };
    } else {
      if (!doc.items) return;
      const items = side === "revenue" ? { ...doc.items, revenue: doc.items.revenue.filter((_, i) => i !== index) } : { ...doc.items, expenses: doc.items.expenses.filter((_, i) => i !== index) };
      next = { items, months: [], totals: statementTotals(items) };
    }
    const saved = await updateDocumentItems(doc, next);
    setDocsByWs((cur) => ({ ...cur, [wsId]: (cur[wsId] ?? []).map((d) => (d.id === saved.id ? saved : d)) }));
    markDocsChanged(wsId, true);
  };

  /**
   * Every new analysis first asks which project / business it belongs to (current workspace preselected), so
   * different businesses or jobs never get mixed in one workspace.
   */
  const [picker, setPicker] = useState<{ init: RequestInit; businessType: BusinessType; extras: AnalysisExtras; resolve: (ok: boolean) => void } | null>(null);
  const requestAnalysis = useCallback(
    (init: RequestInit, businessType: BusinessType, extras: AnalysisExtras = {}) => new Promise<boolean>((resolve) => setPicker({ init, businessType, extras, resolve })),
    [],
  );
  /** New workspace from the picker: the baseline is seeded from its first analysis. */
  const seedBaselineFor = useRef<string | null>(null);
  /** Months to log once the target workspace's tracker has loaded (the picker may switch workspaces first). */
  const pendingLog = useRef<{ ws: string | null; entries: { key: string; actual: MonthActual }[] } | null>(null);
  const [pendingLogTick, setPendingLogTick] = useState(0);
  const [logNotice, setLogNotice] = useState<string | null>(null);
  const confirmTarget = async (target: AnalysisTarget) => {
    if (!picker) return;
    const { init, resolve, extras } = picker;
    setPicker(null);
    let key = "guest";
    if (target.kind === "new") {
      await app.refreshWorkspaces();
      pickerSwitching.current = true;
      app.setActiveWorkspaceId(target.workspace.id);
      seedBaselineFor.current = target.workspace.id;
      key = target.workspace.id;
      // Brand-new workspace: it has no report yet, so nothing needs loading (and nothing is inherited).
      reportFetched.current.add(key);
      markReport(key, "ok");
      docsFetched.current.add(key);
      setDocsByWs((cur) => ({ ...cur, [key]: [] }));
    } else if (target.kind === "existing") {
      if (target.id !== ws?.id) {
        pickerSwitching.current = true;
        app.setActiveWorkspaceId(target.id);
      }
      key = target.id;
    } else if (ws) {
      pickerSwitching.current = true;
      app.setActiveWorkspaceId(null);
    }
    const report = await runAnalysis(init, key, { months: extras.months, documents: extras.docs?.length });
    const ok = !!report;
    if (report && extras.log?.length) {
      pendingLog.current = { ws: key === "guest" ? null : key, entries: extras.log };
      setPendingLogTick((n) => n + 1);
    }
    // Cumulative ingestion: uploaded documents are appended to the workspace (same file = updated, never duplicated;
    // earlier months are never removed). Reviewed documents are kept even if the report call itself failed, so the
    // months aren't lost and the report can be rebuilt from them.
    const docs: NewWorkspaceDocument[] = [...(extras.docs ?? [])];
    if (report && extras.docFromAnalysis) {
      const items: ExtractedLineItems = { businessType: report.analysis.businessType, revenue: report.analysis.itemizedRevenue, expenses: report.analysis.itemizedExpenses };
      docs.push({ ...extras.docFromAnalysis, period: null, items, totals: statementTotals({ revenue: items.revenue, expenses: items.expenses }) });
    }
    if (docs.length && key !== "guest") {
      const wsId = key;
      saveDocuments(wsId, docs)
        .then((saved) =>
          setDocsByWs((cur) => {
            const ids = new Set(saved.map((d) => d.id));
            return { ...cur, [wsId]: [...saved, ...(cur[wsId] ?? []).filter((d) => !ids.has(d.id))] };
          }),
        )
        .catch((e) => setDocsState({ loading: null, error: e instanceof Error ? `Couldn't save documents: ${e.message}` : "Couldn't save documents." }));
    }
    resolve(ok);
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

  // Apply months queued by a statement upload once the target workspace's tracker is ready.
  useEffect(() => {
    const p = pendingLog.current;
    if (!p || tracker.workspaceId !== p.ws || tracker.status === "loading" || tracker.loadFailed) return;
    pendingLog.current = null;
    updateTracker((s) => p.entries.reduce((acc, e) => withLoggedActual(acc, e.key, e.actual), s));
    const names = p.entries.map((e) => periodLabel(e.key));
    setLogNotice(`Logged ${names.length === 1 ? names[0] : `${names.length} months (${names.join(", ")})`} into the Fiscal Year Tracker. Goal pace and projections now use ${names.length === 1 ? "it" : "them"}.`);
  }, [pendingLogTick, tracker.workspaceId, tracker.status, tracker.loadFailed, updateTracker]);

  // A workspace just created from a menu opens on a clean slate: inputs open on the statement upload, the uploader
  // reset, nothing carried over from the previous workspace.
  const { freshWorkspaceId, clearFreshWorkspace } = app;
  useEffect(() => {
    if (!freshWorkspaceId || freshWorkspaceId !== activeWsId) return;
    clearFreshWorkspace();
    reportFetched.current.add(freshWorkspaceId);
    markReport(freshWorkspaceId, "ok");
    docsFetched.current.add(freshWorkspaceId);
    setDocsByWs((cur) => ({ ...cur, [freshWorkspaceId]: [] }));
    setResults((r) => {
      if (!r[freshWorkspaceId]) return r;
      const { [freshWorkspaceId]: _drop, ...rest } = r;
      void _drop;
      return rest;
    });
    setUploaderEpoch((n) => n + 1);
    setTab("upload");
    setInputsOverride(true);
    setResultsTab("overview");
    setError(null);
    setLogNotice(null);
    requestAnimationFrame(() => document.getElementById("analysis-inputs")?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" }));
  }, [freshWorkspaceId, activeWsId, clearFreshWorkspace, markReport]);

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
          recordVersion(targetWs, data, { source: "unlock", monthlyRevenue: data.analysis.monthlyRevenue, monthlyExpenses: splitTotals(data.analysis.itemizedExpenses).recurring });
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
    [post, refreshProfile, recordVersion],
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
    async (kind: CheckoutKind) => {
      if (!app.user) {
        setCheckoutOpen(false);
        app.openAuth("signup");
        return;
      }
      setPaywallBusy(kind);
      setPaywallMsg(null);
      try {
        const res = await fetch("/api/stripe/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify({ kind, from: "dashboard" }),
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
        openCheckout: () => {
          setPaywallMsg(null);
          setCheckoutOpen(true);
        },
        unlock: () => {
          if (!app.user) return app.openAuth("signin");
          if (current.access.sealed) void unlockSealed(current.access.sealed, wsKey);
          else setPaywallMsg("Run the analysis again to unlock it.");
        },
      }
    : null;

  const teaser = current?.access.level === "teaser";
  const teaserSealed = teaser ? current?.access.sealed ?? null : null;
  const teaserCreditUnlock = teaserSealed && app.user ? () => void unlockSealed(teaserSealed, wsKey).then(() => setCheckoutOpen(false)) : undefined;
  const rawAnalysis = current?.analysis ?? null;
  // Full reports re-project client-side so line-item edits and the chosen horizon/start month apply immediately.
  // Teasers stay redacted (no projection) exactly as the server sent them.
  // Projection basis: with two or more logged months (AUTO), the projection follows the average of every logged actual
  // instead of the single report it was generated from. Remembered per workspace for this tab.
  const [basisByWs, setBasisByWs] = useState<Record<string, ProjectionBasis>>({});
  const basisChoice = basisByWs[wsKey] ?? "AUTO";
  const setBasisChoice = (b: ProjectionBasis) => setBasisByWs((cur) => ({ ...cur, [wsKey]: b }));
  const actualsAgg = useMemo(() => (tracker.status === "loading" || tracker.loadFailed ? null : aggregateActuals(tracker.state.actuals)), [tracker.state.actuals, tracker.status, tracker.loadFailed]);
  const basis = resolveBasis(basisChoice, actualsAgg);
  /** The line items the projection and scenarios run on (scaled to the actuals average when that basis is active). */
  const projectionSource = useMemo(() => (rawAnalysis && !teaser && basis === "ACTUALS" && actualsAgg ? calibrateToActuals(rawAnalysis, actualsAgg) : rawAnalysis), [rawAnalysis, teaser, basis, actualsAgg]);
  const analysis = useMemo(() => {
    if (!rawAnalysis || teaser || !projectionSource) return rawAnalysis;
    // Report figures (KPIs, line items) stay as entered; only the projection switches basis.
    return { ...withProjection(rawAnalysis, forecast, inflationRate), macroProjections: withProjection(projectionSource, forecast, inflationRate).macroProjections };
  }, [rawAnalysis, teaser, projectionSource, forecast, inflationRate]);
  const scenarioAnalysis = useMemo(() => (projectionSource && analysis ? { ...projectionSource, inflationRateAssumed: analysis.inflationRateAssumed } : analysis), [projectionSource, analysis]);
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
  const [reportDownloading, setReportDownloading] = useState(false);
  const downloadReport = async () => {
    if (!analysis || teaser || reportDownloading) return;
    setReportDownloading(true);
    try {
      await downloadExecutiveReport(analysis, forecast, goalReport, inflationLabel, reportExtras, ws?.name ?? null);
      onReportDownloaded();
    } finally {
      setReportDownloading(false);
    }
  };

  const versions = activeWsId ? versionsByWs[activeWsId] ?? [] : [];
  const shownVersionId = activeWsId ? activeVersion[activeWsId] ?? versions[0]?.id ?? null : null;
  /** Brings back an earlier version as the workspace's current report (the newer ones stay in history). */
  const restoreVersion = async (id: string) => {
    if (!activeWsId) return;
    const wsId = activeWsId;
    const r = await loadReportVersion(id);
    if (!r) throw new Error("That version couldn't be loaded.");
    setResults((cur) => ({ ...cur, [wsId]: r }));
    setActiveVersion((cur) => ({ ...cur, [wsId]: id }));
    setResultsTab("overview");
  };
  // The report predates the documents when one was edited / deleted in this session, or saved after the shown version
  // (with a little slack, since a new upload's documents are saved just after its report).
  const shownVersion = versions.find((v) => v.id === shownVersionId);
  const docsNewerThanReport =
    !!shownVersion && workspaceDocs.some((d) => new Date(d.updatedAt).getTime() - new Date(shownVersion.createdAt).getTime() > 120_000);
  const reportStale = !!activeWsId && !!current && (docsChangedFor.has(activeWsId) || docsNewerThanReport);

  /** Cash on hand for runway math, and the latest bank-statement closing balance offered as a one-click fill (per workspace, this device). */
  const [cashOnHand, setCashOnHand] = useWorkspacePref<number | null>(userId ? `lp:cash:${userId}:${wsKey}` : null, null, (v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
  const [detectedCash, setDetectedCash] = useWorkspacePref<{ amount: number; period: string | null } | null>(userId ? `lp:cashDetected:${userId}:${wsKey}` : null, null, (v) => {
    const o = v as { amount?: unknown; period?: unknown } | null;
    return o && typeof o.amount === "number" && Number.isFinite(o.amount) ? { amount: o.amount, period: typeof o.period === "string" ? o.period : null } : null;
  });
  /** Monthly / Weekly / Daily increment shared by the Overview cash-flow chart and the Forecast projection (per workspace, this device). */
  const [granularity, setGranularity] = useWorkspacePref<Granularity>(userId ? `lp:granularity:${userId}:${wsKey}` : null, "MONTHLY", (v) => (isGranularity(v) ? v : null));
  /*
   * Workspace financial defaults (inflation, seasonality, horizon, start month, view increment, cash on hand) follow the
   * workspace to every device via `workspaces.settings`. The device copy (localStorage) is what renders first; the saved
   * copy is adopted once it loads, and later changes are written back, debounced.
   */
  const settingsSynced = useRef<Record<string, string>>({});
  const [settingsReady, setSettingsReady] = useState<Record<string, true>>({});
  useEffect(() => {
    if (!userId || !activeWsId || settingsReady[activeWsId] || activeWsId in settingsSynced.current) return;
    const id = activeWsId;
    settingsSynced.current[id] = "";
    loadWorkspaceSettings(id)
      .then((saved) => {
        if (saved) {
          const f = saved.forecast ? normalizeForecastSettings(saved.forecast) : null;
          try {
            if (f) window.localStorage.setItem(`lp:forecast:${userId}:${id}`, JSON.stringify(f));
            if (typeof saved.cashOnHand === "number" && Number.isFinite(saved.cashOnHand)) window.localStorage.setItem(`lp:cash:${userId}:${id}`, JSON.stringify(saved.cashOnHand));
            if (isGranularity(saved.granularity)) window.localStorage.setItem(`lp:granularity:${userId}:${id}`, JSON.stringify(saved.granularity));
          } catch {
            /* device copy is a convenience */
          }
          // Same shape and key order as the save below, so loading never triggers a redundant write (jsonb reorders keys).
          settingsSynced.current[id] = JSON.stringify({ forecast: f ?? undefined, cashOnHand: typeof saved.cashOnHand === "number" ? saved.cashOnHand : null, granularity: saved.granularity });
          // Re-adopt the (now updated) device copies for this workspace.
          setForecastState((cur) => (cur.key === `lp:forecast:${userId}:${id}` && f ? { key: cur.key, value: f } : cur));
          setSettingsAdopt((n) => n + 1);
        }
        setSettingsReady((cur) => ({ ...cur, [id]: true }));
      })
      .catch((e) => {
        delete settingsSynced.current[id];
        console.warn("[workspace] settings unavailable", e);
        setSettingsReady((cur) => ({ ...cur, [id]: true }));
      });
  }, [userId, activeWsId, settingsReady]);
  /** Bumped after saved settings land so the per-device prefs re-read their (updated) stored values. */
  const [settingsAdopt, setSettingsAdopt] = useState(0);
  useEffect(() => {
    if (!settingsAdopt || !userId || !activeWsId) return;
    const read = (k: string) => {
      try {
        const raw = window.localStorage.getItem(k);
        return raw == null ? null : (JSON.parse(raw) as unknown);
      } catch {
        return null;
      }
    };
    const c = read(`lp:cash:${userId}:${activeWsId}`);
    if (typeof c === "number" && c !== cashOnHand) setCashOnHand(c);
    const g = read(`lp:granularity:${userId}:${activeWsId}`);
    if (isGranularity(g) && g !== granularity) setGranularity(g);
    // Only when new saved settings arrive, not on every local change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsAdopt]);
  useEffect(() => {
    if (!activeWsId || !settingsReady[activeWsId]) return;
    const id = activeWsId;
    const next = { forecast, cashOnHand, granularity };
    const json = JSON.stringify(next);
    if (settingsSynced.current[id] === json) return;
    const t = setTimeout(() => {
      settingsSynced.current[id] = json;
      saveWorkspaceSettings(id, next).catch((e) => {
        delete settingsSynced.current[id];
        console.warn("[workspace] settings save failed", e);
      });
    }, 1000);
    return () => clearTimeout(t);
  }, [activeWsId, settingsReady, forecast, cashOnHand, granularity]);

  /** Benchmark peer group (defaults from the business type; households always use the 50/30/20 profile). */
  const [storedBenchmark, setBenchmarkProfile] = useWorkspacePref<BenchmarkProfile | null>(userId ? `lp:benchmark:${userId}:${wsKey}` : null, null, (v) => (isBenchmarkProfile(v) && v !== "HOUSEHOLD" ? v : null));
  const benchmarkProfile: BenchmarkProfile =
    !analysis || analysis.businessType === "PERSONAL_FAMILY" ? "HOUSEHOLD" : storedBenchmark ?? defaultBenchmarkProfile(analysis.businessType);
  /** Recurring vendors whose bill rose across the saved statement months. */
  const vendorCreep = useVendorCreep(workspaceDocs);
  const reportExtras: ReportExtras = { benchmarkProfile, cash: cashOnHand, creep: vendorCreep };
  const toggleSaving =
    teaser || tracker.status === "loading" || tracker.loadFailed
      ? undefined
      : (f: { title: string; potentialSavings: number }) => tracker.update((st) => toggleImplemented(st, { title: f.title, monthly: f.potentialSavings }, monthKey(new Date())));

  // Sidebar links from other pages (Settings) land here with ?open=documents or ?open=workspace-settings.
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current || !app.ready || !ws) return;
    deepLinkHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    const open = params.get("open");
    if (!open) return;
    params.delete("open");
    const rest = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
    if (open === "documents") openDocuments();
    else if (open === "upload") revealUploader();
    else if (open === "workspace-settings") setWsSettingsOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot deep link; revealUploader only calls setters
  }, [app.ready, ws, openDocuments]);

  const deleteActiveWorkspace = async () => {
    if (!ws) return;
    const id = ws.id;
    await app.removeWorkspace(id);
    setWsSettingsOpen(false);
    // Drop everything this device kept for the deleted workspace.
    clearUnsyncedTracker(app.user!.id, id);
    delete reportSynced.current[id];
    delete settingsSynced.current[id];
    reportFetched.current.delete(id);
    docsFetched.current.delete(id);
    versionsFetched.current.delete(id);
    const drop = <T,>(r: Record<string, T>) => {
      const { [id]: _gone, ...rest } = r;
      void _gone;
      return rest;
    };
    setVersionsByWs(drop);
    setDocsByWs(drop);
    setResults(drop);
    try {
      for (const k of ["forecast", "reportCallout", "cash", "cashDetected", "granularity", "benchmark"]) window.localStorage.removeItem(`lp:${k}:${app.user!.id}:${id}`);
    } catch {
      /* ignore */
    }
  };

  /** Quick wins + top performers for the Overview's left column. */
  const insights = useMemo(() => (analysis && !teaser ? overviewInsights(analysis, tracker.state.savings) : null), [analysis, teaser, tracker.state.savings]);

  if (!app.ready || !app.user) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 text-sm text-slate-400" role="status">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-indigo-300" /> {app.ready ? "Redirecting to sign up…" : "Checking your session…"}
        </span>
      </div>
    );
  }

  /** Goal Tracker: rendered inside Fiscal Year & Actuals (or under the inputs before there's any data). */
  const goalTracker = (
    <PanelBoundary title="Goal Tracker">
      <GoalTracker tracker={tracker} id="goal-tracker" onViewSavings={() => jumpTo("savings-tracker")} />
    </PanelBoundary>
  );

  return (
    <AppShell documents={ws ? { docs: workspaceDocs, loading: docsState.loading === ws.id, onOpen: openDocuments, onUploadMore: uploadMore } : undefined} onOpenWorkspaceSettings={ws ? () => setWsSettingsOpen(true) : undefined}>
    <div className="relative min-h-screen overflow-x-clip bg-slate-950 text-slate-100">
      {/* Ambient glow */}
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div className="absolute -top-40 left-1/4 h-[28rem] w-[28rem] rounded-full bg-indigo-600/20 blur-[120px]" />
        <div className="absolute top-1/3 -right-24 h-[24rem] w-[24rem] rounded-full bg-emerald-500/10 blur-[120px]" />
      </div>

      <main className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <BrandLogo height={26} />
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{mode === "PERSONAL" ? "Household budget & savings forecast" : "Cash flow & runway forecast"}</h1>
            <p className="mt-2 max-w-2xl text-slate-400">
              {mode === "PERSONAL"
                ? "Enter your household income and spending or upload a bank statement. We'll audit your budget and project the next 12–60 months."
                : "Enter your numbers or upload a bank statement / P&L. We'll audit it and project the next 12–60 months — flat by default, with optional seasonality and inflation."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-300">
              {ws ? (
                <>
                  {ws.mode === "PERSONAL" ? <Home className="h-4 w-4 text-emerald-300" /> : <Briefcase className="h-4 w-4 text-indigo-300" />}
                  Workspace: <span className="font-medium text-slate-100">{ws.name}</span>
                  <span className="text-slate-500">· {ws.mode === "PERSONAL" ? "Personal book" : `Business · ${BUSINESS_TYPE_LABELS[ws.businessType].split(" (")[0]}`}</span>
                  <button
                    type="button"
                    onClick={() => setWsSettingsOpen(true)}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/5 hover:text-white"
                  >
                    <Settings2 className="h-3.5 w-3.5" /> Workspace settings
                  </button>
                </>
              ) : (
                <span className="text-slate-500">No saved workspace selected — pick one in the sidebar, or you&apos;ll be asked to name one when you run an analysis.</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 self-end sm:self-start">
            {/* Only an unsaved (temporary) analysis can switch mode; a saved workspace is fixed to its own type. */}
            {!modeLocked && <ModeToggle mode={mode} onChange={setMode} />}
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

        {/* Inputs collapse once a report exists, so the results tabs are one click away instead of a long scroll. */}
        {(current || (!hydrating && hasSavedData)) && (
          <div className={cn(glass, "mb-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3")}>
            <p className="text-sm text-slate-300">
              {inputsOpen
                ? current
                  ? "Enter new numbers or upload another statement to refresh this report."
                  : "Enter numbers or upload statements to add to this workspace."
                : current
                  ? "Report ready. Run a new analysis any time — your goals and logged actuals are kept."
                  : "This workspace has saved data. Add statements or run a new analysis any time — your goals and logged actuals are kept."}
            </p>
            <button type="button" onClick={() => setInputsOverride(!inputsOpen)} aria-expanded={inputsOpen} aria-controls="analysis-inputs" className={cn(secondaryBtn, "px-3 py-1.5 text-xs")}>
              {inputsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {inputsOpen ? "Hide inputs" : "New analysis / edit inputs"}
            </button>
          </div>
        )}

        <div id="analysis-inputs" className={cn(!inputsOpen && "hidden")}>
          {/* Input selector: tabs on small screens, side-by-side on large */}
          <div role="tablist" aria-label="Input method" className={cn(glass, "mb-4 inline-flex p-1 lg:hidden", reviewing && "hidden")}>
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
            {/* While a statement is under review the guided form steps aside so the review can use both columns. */}
            <div className={cn("min-w-0", reviewing ? "hidden" : tab !== "form" && "hidden lg:block")}>
              <PanelBoundary title="Guided form">
                <GuidedForm
                  key={`${wsKey}-${mode}`}
                  draftKey={draftKey(app.user.id, wsKey, mode)}
                  mode={mode}
                  defaultType={formDefaultType}
                  disabled={loading}
                  onSubmit={(payload) => requestAnalysis({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, payload.businessType)}
                  syncedType={syncedType}
                  onTypeChange={pickType}
                />
              </PanelBoundary>
            </div>
            <div id="statement-uploader" className={cn("min-w-0 scroll-mt-6", reviewing ? "lg:col-span-2" : tab !== "upload" && "hidden lg:block")}>
              <PanelBoundary title="Statement upload">
                {/* Not keyed by workspace: picking a workspace for the report must not throw away the parsed lines under review. */}
                {/* Reset (via uploaderEpoch) for a brand-new workspace or a menu switch, so no parsed numbers carry over. */}
                <StatementUploader
                  key={`${mode}-${uploaderEpoch}`}
                  mode={mode}
                  disabled={loading}
                  onSubmit={(init, bt, extras) => requestAnalysis(init, bt ?? formDefaultType, extras)}
                  trackerReady={tracker.status !== "loading" && !tracker.loadFailed}
                  onLogActuals={logStatementMonth}
                  existingDocs={workspaceDocs}
                  onBalanceDetected={setDetectedCash}
                  syncedType={syncedType}
                  onTypeChange={pickType}
                  uploadMoreRef={uploadMoreRef}
                  onReviewChange={setReviewing}
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
        {hydrating && (
          <div className={cn(glass, "mt-6 flex items-center gap-3 p-5 text-sm text-slate-300")} role="status">
            <Loader2 className="h-4 w-4 animate-spin text-indigo-300" /> Loading this workspace&apos;s saved report, documents and actuals…
          </div>
        )}
        {logNotice && (
          <div className="mt-6 flex items-start gap-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100" role="status">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
            <span className="flex-1">{logNotice}</span>
            <button onClick={() => setLogNotice(null)} aria-label="Dismiss" className="text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {docsState.error && !docsOpen && (
          <div role="alert" className="mt-6 flex items-start gap-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{docsState.error} Your report is unaffected; re-upload the statement to keep it in this workspace&apos;s documents.</span>
            <button onClick={() => setDocsState((d) => ({ ...d, error: null }))} aria-label="Dismiss" className="text-rose-200 hover:text-white">
              <X className="h-4 w-4" />
            </button>
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
            {/* Primary navigation first: Overview is the landing view; the Goal Tracker lives under Fiscal Year & Actuals. */}
            <ResultsTabs value={resultsTab} onChange={setResultsTab} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">Results{ws ? <span className="text-base font-normal text-slate-400"> · {ws.name}</span> : null}</h2>
              <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={uploadMore} className={cn(secondaryBtn, "text-slate-200")}>
                <Upload className="h-4 w-4" /> Upload More Documents
              </button>
              {ws && (
                <button type="button" onClick={() => openDocuments()} className={cn(secondaryBtn, "text-slate-200")}>
                  <FolderOpen className="h-4 w-4" /> Documents
                  {workspaceDocs.length > 0 && <span className="rounded-full bg-white/10 px-1.5 text-[11px] tabular-nums">{workspaceDocs.length}</span>}
                </button>
              )}
              {ws && versions.length > 0 && <ReportHistory versions={versions} activeId={shownVersionId} onRestore={restoreVersion} />}
              {teaser ? (
                <button onClick={paywall.openCheckout} className={cn(secondaryBtn, "text-slate-300")} title="Upgrade to Pro to download">
                  <Lock className="h-4 w-4" /> Download Executive PDF Report
                </button>
              ) : (
                <button onClick={() => void downloadReport()} disabled={reportDownloading} className={cn(primaryBtn, "shadow-lg shadow-indigo-500/25")}>
                  {reportDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {reportDownloading ? "Preparing PDF…" : "Download Executive PDF Report"}
                </button>
              )}
              </div>
            </div>

            {showCallout && (
              <ReportCallout
                hasGoal={!!tracker.pace}
                loggedCount={tracker.summary.loggedCount}
                onSetGoal={() => openTab("fiscal", "goal-tracker", "input")}
                onLogActuals={() => openTab("fiscal", "fiscal-tracker", "tbody input")}
                onDismiss={dismissCallout}
              />
            )}

            {teaser && <TeaserBanner paywall={paywall} />}

            <div role="tabpanel" id="results-panel-overview" aria-labelledby="results-tab-overview" hidden={resultsTab !== "overview"} className="space-y-6">
              {tracker.pace && (
                <div className="flex flex-col gap-2">
                  <GoalPaceBanner pace={tracker.pace} fyLabel={tracker.fyLabel} compact />
                  <button type="button" onClick={() => openTab("fiscal", "goal-tracker")} className="self-end text-xs text-indigo-300 hover:text-indigo-200">
                    Adjust goal →
                  </button>
                </div>
              )}
              <PanelBoundary title="Summary">
                <KpiRow analysis={analysis} mode={modeOf(analysis.businessType)} locked={teaser} settings={forecast} inflationLabel={inflationLabel} />
              </PanelBoundary>
              {reportStale && !teaser && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300/30 bg-amber-400/[0.07] px-4 py-3 text-sm text-amber-100" role="status">
                  <Info className="h-4 w-4 shrink-0 text-amber-300" aria-hidden />
                  <span className="flex-1">Your saved documents changed after this report was generated. Re-analyze to fold every month into the report — this version stays in Report history.</span>
                  <button type="button" onClick={() => void reanalyzeAll()} disabled={loading || !canRebuild} className={cn(secondaryBtn, "px-3 py-1.5 text-xs")}>
                    {rebuilding === activeWsId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Repeat className="h-3.5 w-3.5" />} Re-analyze all months
                  </button>
                </div>
              )}
              {!teaser && vendorCreep.length > 0 && (
                <PanelBoundary title="Vendor price creep">
                  <VendorCreepAlerts
                    creep={vendorCreep}
                    figures={{ monthlyRevenue: analysis.monthlyRevenue, monthlyExpenses: splitTotals(analysis.itemizedExpenses).recurring, personal: analysis.businessType === "PERSONAL_FAMILY" }}
                    implemented={tracker.state.savings}
                    onToggleImplemented={toggleSaving}
                  />
                </PanelBoundary>
              )}
              {!teaser && (
                <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
                  <PanelBoundary title="Cash runway">
                    <RunwayCard analysis={analysis} cash={cashOnHand} onCashChange={setCashOnHand} detected={detectedCash} />
                  </PanelBoundary>
                  <PanelBoundary title="Benchmarks">
                    <BenchmarkGauges analysis={analysis} profile={benchmarkProfile} onProfileChange={setBenchmarkProfile} />
                  </PanelBoundary>
                </div>
              )}
              {/* Left: visual analytics (cash flow + expense share). Right: the revenue and expense line items. */}
              <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
                <div className="min-w-0 space-y-6 lg:col-span-2">
                  {!teaser && (
                    <PanelBoundary title="Monthly cash flow">
                      <CashFlowChart
                        analysis={analysis}
                        actuals={trackerActuals ?? {}}
                        docs={workspaceDocs}
                        settings={forecast}
                        onSettingsChange={setForecast}
                        revenueLabel={copy.revenue}
                        expensesLabel={copy.expenses}
                        onOpenForecast={() => openTab("forecast", "results-panel-forecast")}
                        granularity={granularity}
                        onGranularityChange={setGranularity}
                      />
                    </PanelBoundary>
                  )}
                  <PanelBoundary title="Expense share">
                    <ExpenseShareCard analysis={analysis} />
                  </PanelBoundary>
                  <PanelBoundary title="Winner insight">
                    <WinnerCard analysis={analysis} label={copy.revenue} />
                  </PanelBoundary>
                  {insights && insights.wins.length > 0 && (
                    <PanelBoundary title="Quick wins">
                      <QuickWinsCard wins={insights.wins} onOpenAudit={() => jumpTo("audit-panel")} onOpenScenarios={() => openTab("forecast", "results-panel-forecast")} />
                    </PanelBoundary>
                  )}
                  {insights && insights.performers.length > 0 && (
                    <PanelBoundary title="Top performers">
                      <TopPerformersCard performers={insights.performers} personal={analysis.businessType === "PERSONAL_FAMILY"} label={copy.revenue} />
                    </PanelBoundary>
                  )}
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
                      onToggleImplemented={toggleSaving}
                    />
                  </PanelBoundary>
                </div>
              </div>
              {ws && workspaceDocs.length > 0 && (
                <PanelBoundary title="Monthly breakdown">
                  <MonthlyBreakdown
                    docs={workspaceDocs}
                    revenueLabel={copy.revenue}
                    expensesLabel={copy.expenses}
                    loggedActuals={trackerActuals ?? undefined}
                    onRemoveLine={removeDocLine}
                    onSyncMonth={trackerActuals ? (period, actual) => setLogNotice(logStatementMonth(period, actual)) : undefined}
                    onReanalyze={canRebuild && !teaser ? () => void reanalyzeAll() : undefined}
                    reanalyzing={rebuilding === ws.id}
                    stale={reportStale}
                  />
                </PanelBoundary>
              )}
            </div>

            <div role="tabpanel" id="results-panel-forecast" aria-labelledby="results-tab-forecast" hidden={resultsTab !== "forecast"} className="space-y-6">
              <PanelBoundary title="Projection chart">
                {teaser ? (
                  <LockedSection title="Macro-Adjusted Projection" paywall={paywall} placeholder={<FakeChart />} />
                ) : (
                  <ProjectionCharts
                    analysis={analysis}
                    settings={forecast}
                    onSettingsChange={setForecast}
                    cpi={cpi}
                    inflationLabel={inflationLabel}
                    actuals={tracker.state.actuals}
                    basis={basis}
                    basisChoice={basisChoice}
                    onBasisChange={setBasisChoice}
                    actualsAgg={actualsAgg}
                    granularity={granularity}
                    onGranularityChange={setGranularity}
                  />
                )}
              </PanelBoundary>
              <PanelBoundary title="What-if simulator">
                {isPro && !teaser && scenarioAnalysis ? (
                  <WhatIfSimulator analysis={scenarioAnalysis} settings={forecast} cash={cashOnHand} />
                ) : (
                  <LockedSection title="What-If Simulator (instant sliders)" paywall={paywall} proOnly placeholder={<FakeChart />} />
                )}
              </PanelBoundary>
              <PanelBoundary title="Scenario forecasting">
                {isPro && !teaser && scenarioAnalysis ? (
                  <ScenarioPanel analysis={scenarioAnalysis} workspaceId={ws?.id ?? null} settings={forecast} onSettingsChange={setForecast} />
                ) : (
                  <LockedSection title="Interactive Scenario Forecasting" paywall={paywall} proOnly placeholder={<FakeScenarioChat mode={mode} />} />
                )}
              </PanelBoundary>
            </div>

            <div role="tabpanel" id="results-panel-fiscal" aria-labelledby="results-tab-fiscal" hidden={resultsTab !== "fiscal"} className="space-y-6">
              {goalTracker}
              <PanelBoundary title="Fiscal Year Tracker">
                <FiscalYearTracker tracker={tracker} analysis={teaser ? null : rawAnalysis} id="fiscal-tracker" />
              </PanelBoundary>
            </div>

            <div role="tabpanel" id="results-panel-report" aria-labelledby="results-tab-report" hidden={resultsTab !== "report"} className="space-y-6">
              <PanelBoundary title="Executive report">
                {teaser ? (
                  <LockedSection title="Executive PDF Report" paywall={paywall} placeholder={<FakeChart />} />
                ) : (
                  <ReportPreview
                    html={resultsTab === "report" ? reportHtml(analysis, forecast, goalReport, inflationLabel, reportExtras) : ""}
                    onDownload={() => void downloadReport()}
                    downloading={reportDownloading}
                    hasGoal={!!goalReport}
                    onSetGoal={() => openTab("fiscal", "goal-tracker", "input")}
                  />
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
        ) : !hydrating && hasSavedData && ws ? (
          // Saved data but no report (yet): still the 4-tab dashboard. Fiscal Year & Actuals works from the logged
          // months; the report tabs explain what's missing and rebuild it from the saved documents.
          <div ref={resultsRef} className={cn("scroll-mt-6 space-y-6", inputsOpen ? "mt-10" : "mt-2")}>
            <ResultsTabs value={resultsTab} onChange={setResultsTab} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">
                Results<span className="text-base font-normal text-slate-400"> · {ws.name}</span>
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={uploadMore} className={cn(secondaryBtn, "text-slate-200")}>
                  <Upload className="h-4 w-4" /> Upload More Documents
                </button>
                {versions.length > 0 && <ReportHistory versions={versions} activeId={null} onRestore={restoreVersion} noneShowing />}
              </div>
            </div>
            {(["overview", "forecast", "report"] as const).map((t) => (
              <div key={t} role="tabpanel" id={`results-panel-${t}`} aria-labelledby={`results-tab-${t}`} hidden={resultsTab !== t} className="space-y-6">
                <NoReportPanel
                  rebuilding={rebuilding === ws.id || (loading && !!canRebuild && !current)}
                  docCount={workspaceDocs.length}
                  loggedCount={Object.keys(tracker.state.actuals).length}
                  reportLoadFailed={reportStatus[ws.id] === "error"}
                  rebuildFrom={rebuildSource ? (rebuildSource.documents ? "documents" : "actuals") : null}
                  onRebuild={canRebuild && !loading ? () => void rebuildFromDocuments(ws.id, { quiet: false }) : undefined}
                  onRetryLoad={reportStatus[ws.id] === "error" ? retryReportLoad : undefined}
                  onRestoreLatest={versions[0] ? () => void restoreVersion(versions[0].id).catch((e) => setError(e instanceof Error ? e.message : "Couldn't restore that version.")) : undefined}
                  onNewAnalysis={() => {
                    setInputsOverride(true);
                    requestAnimationFrame(() => jumpTo("analysis-inputs"));
                  }}
                  onOpenFiscal={() => setResultsTab("fiscal")}
                  onOpenDocuments={workspaceDocs.length ? () => openDocuments() : undefined}
                />
                {t === "overview" && workspaceDocs.length > 0 && (
                  <PanelBoundary title="Monthly breakdown">
                    <MonthlyBreakdown
                      docs={workspaceDocs}
                      revenueLabel={copy.revenue}
                      expensesLabel={copy.expenses}
                      loggedActuals={trackerActuals ?? undefined}
                      onRemoveLine={removeDocLine}
                      onSyncMonth={trackerActuals ? (period, actual) => setLogNotice(logStatementMonth(period, actual)) : undefined}
                    />
                  </PanelBoundary>
                )}
              </div>
            ))}
            <div role="tabpanel" id="results-panel-fiscal" aria-labelledby="results-tab-fiscal" hidden={resultsTab !== "fiscal"} className="space-y-6">
              {goalTracker}
              <PanelBoundary title="Fiscal Year Tracker">
                <FiscalYearTracker tracker={tracker} analysis={null} id="fiscal-tracker" />
              </PanelBoundary>
            </div>
          </div>
        ) : hydrating ? null : (
          <section className="mt-10 space-y-6" aria-label="Goals and Fiscal Year Tracker">
            {goalTracker}
            <PanelBoundary title="Fiscal Year Tracker">
              <FiscalYearTracker tracker={tracker} analysis={null} id="fiscal-tracker" />
            </PanelBoundary>
          </section>
        )}
      </main>

      {docsOpen && ws && (
        <DocumentsHub
          workspaceName={ws.name}
          focusId={docsFocus}
          docs={workspaceDocs}
          loading={docsState.loading === ws.id}
          error={docsState.error}
          onClose={() => {
            setDocsOpen(false);
            setDocsFocus(null);
          }}
          onRename={async (id, name) => {
            await updateDocument(id, { name });
            setDocsByWs((cur) => ({ ...cur, [ws.id]: (cur[ws.id] ?? []).map((d) => (d.id === id ? { ...d, name: name.trim().slice(0, 160) } : d)) }));
          }}
          onSetMonth={async (id, period) => {
            await updateDocument(id, { period });
            setDocsByWs((cur) => ({ ...cur, [ws.id]: (cur[ws.id] ?? []).map((d) => (d.id === id ? { ...d, period } : d)) }));
            markDocsChanged(ws.id, true);
          }}
          onDelete={async (id) => {
            await deleteDocument(id);
            setDocsByWs((cur) => ({ ...cur, [ws.id]: (cur[ws.id] ?? []).filter((d) => d.id !== id) }));
            markDocsChanged(ws.id, true);
          }}
          onLogToTracker={
            tracker.status === "loading" || tracker.loadFailed
              ? undefined
              : (d) => {
                  if (d.months.length > 1) {
                    // Multi-month document: each month's own totals go into that month.
                    const entries = documentSlices(d).map((sl) => ({ key: sl.period, actual: statementTotals({ revenue: sl.items.revenue, expenses: sl.items.expenses }) }));
                    updateTracker((s) => entries.reduce((acc, e) => withLoggedActual(acc, e.key, e.actual), s));
                    return `Logged ${entries.length} months (${periodLabel(entries[0].key)} – ${periodLabel(entries[entries.length - 1].key)}) from “${d.name}”. Goal pace and projections updated.`;
                  }
                  return d.period ? logStatementMonth(d.period, { revenue: d.totals.revenue, expenses: d.totals.expenses, ...(d.totals.oneTimeExpenses ? { oneTimeExpenses: d.totals.oneTimeExpenses } : {}) }) : null;
                }
          }
          loggedMonths={tracker.status === "loading" || tracker.loadFailed ? undefined : new Set(Object.keys(tracker.state.actuals))}
        />
      )}

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

      {wsSettingsOpen && ws && (
        <WorkspaceSettingsDialog
          // Keyed by id: the dialog's fields must never show the previous workspace's values.
          key={ws.id}
          workspace={ws}
          forecast={forecast}
          onForecastChange={setForecast}
          cpi={cpi}
          cashOnHand={cashOnHand}
          onCashChange={setCashOnHand}
          granularity={granularity}
          onGranularityChange={setGranularity}
          synced={!!settingsReady[ws.id]}
          onRename={async (name) => {
            await updateWorkspace(ws.id, { name });
            await app.refreshWorkspaces();
          }}
          onChangeType={async (businessType) => {
            await updateWorkspace(ws.id, { businessType });
            await app.refreshWorkspaces();
          }}
          onDelete={deleteActiveWorkspace}
          onClose={() => setWsSettingsOpen(false)}
        />
      )}
      {checkoutOpen && (
        <CheckoutModal
          onClose={() => setCheckoutOpen(false)}
          onCheckout={(kind) => void checkout(kind)}
          onUnlocked={async () => {
            // Access code accepted server-side: pick up the new tier, then open the analysis that was previewed.
            await refreshProfile();
            if (current?.access.level === "teaser" && current.access.sealed) await unlockSealed(current.access.sealed, wsKey);
            setCheckoutOpen(false);
          }}
          busy={paywallBusy}
          message={paywallMsg}
          signedIn={!!app.user}
          onSignIn={() => {
            setCheckoutOpen(false);
            app.openAuth("signin");
          }}
          lockedFlagCount={current?.access.level === "teaser" ? current.access.lockedFlagCount : 0}
          report={current?.access.level === "teaser" ? { credits: current.access.reportUnlocks, onUseCredit: teaserCreditUnlock } : undefined}
        />
      )}
    </div>
    </AppShell>
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

/** What a statement upload hands over with its analysis: documents to keep in the workspace and months to log. */
interface AnalysisExtras {
  docs?: NewWorkspaceDocument[];
  /** "Skip review": the document is saved with the lines the analysis read from it. */
  docFromAnalysis?: Pick<NewWorkspaceDocument, "name" | "fileName" | "fileSize" | "contentHash" | "kind">;
  log?: { key: string; actual: MonthActual }[];
  /** Months of data the analysis covers ("YYYY-MM"), recorded on the report version. */
  months?: string[];
}

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
  const analysisModeForChoice = modeOf(businessType);
  // A workspace of the other kind can't receive this analysis (its book would mix business and household numbers).
  const [choice, setChoice] = useState<string>(() => (activeId && workspaces.some((w) => w.id === activeId && w.mode === analysisModeForChoice) ? activeId : "new"));
  const [name, setName] = useState(() => suggestWorkspaceName(businessType, workspaces));
  const [busy, setBusy] = useState(false);
  // Device-only tracker data (logged before any workspace existed). New workspaces start clean unless the owner opts in.
  const [localTracker] = useState(() => {
    const raw = readLocalTracker(userId);
    const s = raw ? normalizeTrackerState(raw, businessType) : null;
    const months = s ? Object.keys(s.actuals).length : 0;
    return s && (months > 0 || s.targets.net != null || s.targets.revenue != null || s.baseline.revenue > 0) ? { raw, months } : null;
  });
  const [carryLocal, setCarryLocal] = useState(false);
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
    if (choice !== "new") {
      if (workspaces.find((w) => w.id === choice)?.mode !== analysisMode) return setError("Pick a workspace of the same kind, or create a new one.");
      return void onConfirm({ kind: "existing", id: choice });
    }
    if (!name.trim()) return setError("Give the project or business a name.");
    setBusy(true);
    try {
      const created = await createWorkspace({ name, businessType });
      // Only when explicitly chosen: link the goals / actuals kept on this device into the new workspace.
      if (carryLocal && localTracker) {
        try {
          await saveFiscalTracker(created.id, normalizeTrackerState(localTracker.raw, businessType));
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

  const option = (value: string, children: ReactNode, disabled = false) => (
    <label
      key={value}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3 transition",
        disabled ? "cursor-not-allowed border-white/5 opacity-50" : "cursor-pointer",
        !disabled && (choice === value ? "border-indigo-400/60 bg-indigo-500/10" : "border-white/10 hover:bg-white/5"),
      )}
    >
      <input type="radio" name="analysis-target" className="mt-1 accent-indigo-400" checked={choice === value} disabled={disabled} onChange={() => setChoice(value)} />
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
                {w.mode !== analysisMode && (
                  <span className="mt-1 block text-xs text-slate-400">
                    {w.mode === "PERSONAL" ? "Personal" : "Business"} workspace — can&apos;t hold this {analysisMode === "PERSONAL" ? "household" : "business"} analysis. Workspaces never mix the two.
                  </span>
                )}
              </>,
              w.mode !== analysisMode,
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
                  <span className="mt-1 block text-xs text-slate-500">Type: {BUSINESS_TYPE_LABELS[businessType]}. Starts clean — no numbers from other workspaces.</span>
                  {localTracker && (
                    <label className="mt-2 flex items-start gap-2 text-xs text-slate-300">
                      <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-indigo-400" checked={carryLocal} onChange={(e) => setCarryLocal(e.target.checked)} />
                      <span>
                        Also bring in the goals{localTracker.months ? ` and ${localTracker.months} logged month${localTracker.months === 1 ? "" : "s"}` : ""} saved on this device without a workspace
                      </span>
                    </label>
                  )}
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
        <p className="mt-3 text-xs text-slate-500">Statement files are never stored. A saved workspace keeps the parsed results (documents, report, monthly totals and goals) so nothing disappears on reload.</p>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workspace settings: name & type, financial defaults (inflation master switch, …), danger zone
// ---------------------------------------------------------------------------

function SettingSwitch({ checked, onChange, label, description, help }: { checked: boolean; onChange: (v: boolean) => void; label: string; description: string; help?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-3">
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-100">
          {label}
          {help}
        </span>
        <span className="mt-0.5 block text-xs text-slate-400">{description}</span>
      </span>
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className={cn(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-indigo-300",
          checked ? "border-indigo-400 bg-indigo-500" : "border-white/15 bg-white/10",
        )}
      >
        <span className={cn("absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-0.5")} style={{ backgroundColor: "#fff" }} />
      </span>
    </label>
  );
}

function SegmentedChoice<T extends string | number>({ value, options, onChange, label }: { value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-lg border border-white/10 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("rounded-md px-2.5 py-1 text-xs font-medium tabular-nums transition", value === o.value ? "bg-indigo-500/80 text-white" : "text-slate-400 hover:text-slate-200")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Everything that belongs to one workspace: its name and (business) type, the financial defaults every chart,
 * forecast, scenario and the Executive report use — with Inflation as a master switch — and deletion. Documents moved
 * out of here into their own sidebar menu.
 */
function WorkspaceSettingsDialog({
  workspace,
  forecast,
  onForecastChange,
  cpi,
  cashOnHand,
  onCashChange,
  granularity,
  onGranularityChange,
  synced,
  onRename,
  onChangeType,
  onDelete,
  onClose,
}: {
  workspace: WorkspaceProfile;
  forecast: ForecastSettings;
  onForecastChange: (s: ForecastSettings) => void;
  cpi: CpiReading | null;
  cashOnHand: number | null;
  onCashChange: (v: number | null) => void;
  granularity: Granularity;
  onGranularityChange: (g: Granularity) => void;
  /** The saved (all-devices) copy has loaded, so changes are being synced. */
  synced: boolean;
  onRename: (name: string) => Promise<void>;
  onChangeType: (bt: BusinessType) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [busy, setBusy] = useState<"rename" | "type" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [rateText, setRateText] = useState(() => (forecast.customInflationRate * 100).toFixed(1));
  const titleId = useId();
  const personal = workspace.mode === "PERSONAL";
  const confirmOk = confirmText.trim().toLowerCase() === workspace.name.trim().toLowerCase();
  const set = (patch: Partial<ForecastSettings>) => onForecastChange({ ...forecast, ...patch });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const run = async (kind: "rename" | "type" | "delete", fn: () => Promise<void>, done?: string) => {
    setBusy(kind);
    setError(null);
    setNote(null);
    try {
      await fn();
      if (done) setNote(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const commitRate = () => {
    const r = Number(rateText) / 100;
    if (!Number.isFinite(r)) return setRateText((forecast.customInflationRate * 100).toFixed(1));
    const clamped = Math.min(0.5, Math.max(-0.1, r));
    setRateText((clamped * 100).toFixed(1));
    set({ customInflationRate: clamped });
  };
  const liveLabel = cpi ? (cpi.live ? `Live CPI · ${pct(cpi.rate)}${cpi.period ? ` (${cpi.period})` : ""}` : `Default assumption · ${pct(cpi.rate)}`) : "Live CPI (loading…)";

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn(glass, "flex max-h-[92vh] w-full max-w-2xl flex-col bg-slate-900/95")}>
        <header className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold">
              <Settings2 className="h-5 w-5 text-indigo-300" /> Workspace settings
            </h2>
            <p className="mt-0.5 truncate text-sm text-slate-400">
              {workspace.name} · {personal ? "Personal book" : "Business book"}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={!!busy} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5">
          {(error || note) && (
            <p role={error ? "alert" : "status"} className={cn("rounded-lg border px-3 py-2 text-xs", error ? "border-rose-300/30 bg-rose-500/10 text-rose-100" : "border-emerald-300/30 bg-emerald-500/10 text-emerald-100")}>
              {error ?? note}
            </p>
          )}

          {/* General */}
          <section aria-labelledby={`${titleId}-general`} className="space-y-3">
            <h3 id={`${titleId}-general`} className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              General
            </h3>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim() && name.trim() !== workspace.name) void run("rename", () => onRename(name), "Workspace renamed.");
              }}
            >
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Workspace name" className={cn(inputCls, "py-1.5")} />
              <button type="submit" disabled={!!busy || !name.trim() || name.trim() === workspace.name} className={cn(secondaryBtn, "px-3 py-1.5 text-xs")}>
                {busy === "rename" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Rename"}
              </button>
            </form>
            {personal ? (
              <p className="flex items-center gap-1.5 text-xs text-slate-400">
                <Home className="h-3.5 w-3.5 text-emerald-300" /> Personal / household workspace. Create a separate workspace for a business.
              </p>
            ) : (
              <label className="block text-xs text-slate-400">
                Business type
                <select
                  value={workspace.businessType}
                  disabled={!!busy}
                  onChange={(e) => void run("type", () => onChangeType(e.target.value as BusinessType), "Business type updated. Re-run the analysis to apply its benchmarks and seasonality.")}
                  className={cn(inputCls, "mt-1 py-1.5")}
                >
                  {BUSINESS_ONLY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {BUSINESS_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-slate-500">A business workspace stays a business; household budgets get their own workspace so the books never mix.</span>
              </label>
            )}
          </section>

          {/* Financial defaults */}
          <section aria-labelledby={`${titleId}-fin`} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id={`${titleId}-fin`} className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Financial defaults
              </h3>
              <span className="text-[11px] text-slate-500">{synced ? "Saved to this workspace on every device" : "Saved on this device"}</span>
            </div>
            <p className="text-xs text-slate-400">Apply to this workspace&apos;s charts, forecast, What-if and scenario tools, and the Executive PDF report.</p>

            <SettingSwitch
              checked={forecast.inflation}
              onChange={(v) => set({ inflation: v })}
              label="Inflation (master switch)"
              description={forecast.inflation ? `On: costs and income compound at ${pct(effectiveInflationRate(forecast, cpi))}/yr across every projection.` : "Off: projections stay in today's dollars."}
            />
            {forecast.inflation && (
              <div className="ml-1 space-y-2 border-l border-white/10 pl-4">
                <SegmentedChoice
                  label="Inflation rate source"
                  value={forecast.inflationSource}
                  onChange={(v) => set({ inflationSource: v })}
                  options={[
                    { value: "CPI", label: liveLabel },
                    { value: "CUSTOM", label: "Custom rate" },
                  ]}
                />
                {forecast.inflationSource === "CUSTOM" && (
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    Annual rate
                    <span className="relative">
                      <input
                        inputMode="decimal"
                        value={rateText}
                        onChange={(e) => setRateText(e.target.value)}
                        onBlur={commitRate}
                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commitRate())}
                        aria-label="Custom annual inflation rate (%)"
                        className={cn(inputCls, "w-24 py-1.5 pr-6 tabular-nums")}
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-500">%</span>
                    </span>
                    <span className="text-slate-500">−10% to 50%</span>
                  </label>
                )}
              </div>
            )}

            <SettingSwitch
              checked={forecast.seasonality}
              onChange={(v) => set({ seasonality: v })}
              label="Seasonality"
              help={<SeasonalityHelp className="ml-0" />}
              description={forecast.seasonality ? "On: projections follow this business type's month-by-month curve (fine-tune it on the Forecast tab)." : "Off: flat inputs project flat."}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-3">
                <p className="text-sm font-medium text-slate-100">Default horizon</p>
                <div className="mt-2">
                  <SegmentedChoice label="Default forecast horizon" value={forecast.months} onChange={(v) => set({ months: v })} options={HORIZON_OPTIONS.map((m) => ({ value: m, label: `${m}M` }))} />
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-3">
                <p className="text-sm font-medium text-slate-100">View increment</p>
                <div className="mt-2">
                  <SegmentedChoice label="Default view increment" value={granularity} onChange={onGranularityChange} options={GRANULARITIES.map((g) => ({ value: g, label: GRANULARITY_LABELS[g] }))} />
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-3">
                <p className="text-sm font-medium text-slate-100">Projections start</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <SegmentedChoice
                    label="Projection start"
                    value={forecast.startMode === "CUSTOM" ? "NEXT" : forecast.startMode}
                    onChange={(v) => set({ startMode: v })}
                    options={[
                      { value: "NEXT", label: "Next month" },
                      { value: "CURRENT", label: "This month" },
                      { value: "FISCAL", label: "Fiscal year" },
                    ]}
                  />
                  {forecast.startMode === "FISCAL" && (
                    <select value={forecast.fiscalStartMonth} onChange={(e) => set({ fiscalStartMonth: Number(e.target.value) })} aria-label="Fiscal year starts in" className={cn(inputCls, "w-auto py-1 text-xs")}>
                      {MONTH_NAMES.map((m, i) => (
                        <option key={m} value={i}>
                          {m}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {forecast.startMode === "CUSTOM" && <p className="mt-1 text-[11px] text-slate-500">Currently a custom month (set on the Forecast tab).</p>}
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-3">
                <p className="text-sm font-medium text-slate-100">{personal ? "Savings / cash on hand" : "Cash on hand"}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">Used for runway and break-even.</p>
                <MoneyNumberInput value={cashOnHand} onChange={onCashChange} placeholder="0.00" aria-label="Cash on hand" className={cn(inputCls, "mt-2 py-1.5 tabular-nums")} />
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onForecastChange({ ...DEFAULT_FORECAST, customInflationRate: forecast.customInflationRate });
                onGranularityChange("MONTHLY");
                setNote("Financial defaults reset: inflation and seasonality off, 12-month horizon starting next month, monthly view.");
              }}
              className="text-xs text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
            >
              Reset financial defaults
            </button>
          </section>

          {/* Danger zone */}
          <section aria-labelledby={`${titleId}-danger`} className="border-t border-white/10 pt-4">
            <h3 id={`${titleId}-danger`} className="sr-only">
              Delete workspace
            </h3>
            {confirming ? (
              <form
                className="rounded-lg border border-rose-300/30 bg-rose-500/10 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (confirmOk && !busy) void run("delete", onDelete);
                }}
              >
                <p className="text-sm font-medium text-rose-100">Are you sure? This cannot be undone.</p>
                <p className="mt-1 text-xs text-rose-200/80">
                  Deleting <strong>{workspace.name}</strong> permanently removes its documents, report, Fiscal Year Tracker (monthly actuals, goals, savings), saved scenarios and settings.
                </p>
                <label className="mt-2 block text-xs text-rose-100">
                  Type <strong className="select-all">{workspace.name}</strong> to confirm
                  <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoFocus aria-label="Type the workspace name to confirm" className={cn(inputCls, "mt-1 py-1.5")} />
                </label>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirming(false);
                      setConfirmText("");
                    }}
                    disabled={!!busy}
                    className={cn(secondaryBtn, "px-3 py-1.5 text-xs")}
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={!!busy || !confirmOk} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-400 disabled:opacity-50">
                    {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete workspace
                  </button>
                </div>
              </form>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className="inline-flex items-center gap-1.5 text-xs text-rose-300 hover:text-rose-200">
                <Trash2 className="h-3.5 w-3.5" /> Delete workspace…
              </button>
            )}
          </section>
        </div>

        <footer className="flex justify-end border-t border-white/10 px-5 py-3">
          <button type="button" onClick={onClose} disabled={!!busy} className={primaryBtn}>
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview insights: automated quick wins + top performers (left column)
// ---------------------------------------------------------------------------

interface QuickWin {
  title: string;
  detail: string;
  /** Estimated monthly $ impact, used to rank the wins. */
  monthly: number;
  action?: "audit" | "scenarios";
}

interface Performer {
  label: string;
  amount: number;
  share: number;
  margin: number;
  /** Monthly gross profit (amount × margin). */
  contribution: number;
}

/**
 * Deterministic suggestions from the report's own numbers — no extra AI call. Ranked by estimated monthly impact;
 * savings already marked implemented in the ROI tracker are skipped.
 */
function overviewInsights(a: FinancialAnalysis, savings: { title: string; status: string }[]): { wins: QuickWin[]; performers: Performer[] } {
  const personal = a.businessType === "PERSONAL_FAMILY";
  const done = new Set(savings.filter((x) => x.status === "IMPLEMENTED").map((x) => x.title));
  const recurringRevenue = a.itemizedRevenue.filter((r) => !r.oneTime);
  const recurringExpenses = a.itemizedExpenses.filter((e) => !e.oneTime);
  const revenue = a.monthlyRevenue;
  const expenses = sum(recurringExpenses, (e) => e.amount);
  const net = revenue - expenses;
  const wins: QuickWin[] = [];

  // 1) The single biggest open audit saving.
  const open = a.auditFlags.filter((f) => f.potentialSavings > 0 && !done.has(f.title)).sort((x, y) => y.potentialSavings - x.potentialSavings);
  if (open[0]) {
    const total = sum(open, (f) => f.potentialSavings);
    wins.push({
      title: `Act on “${open[0].title}”`,
      detail: `Worth about ${usd.format(open[0].potentialSavings)}/mo (${usd.format(open[0].potentialSavings * 12)}/yr).${open.length > 1 ? ` ${open.length} open audit items total ${usd.format(total)}/mo.` : ""}`,
      monthly: open[0].potentialSavings,
      action: "audit",
    });
  }

  // 2) Renegotiate the largest recurring cost.
  const biggest = [...recurringExpenses].sort((x, y) => y.amount - x.amount)[0];
  if (biggest && revenue > 0 && biggest.amount / revenue >= 0.08) {
    const five = biggest.amount * 0.05;
    wins.push({
      title: `${personal ? "Trim" : "Renegotiate"} ${biggest.label || biggest.category}`,
      detail: `Your largest recurring cost is ${pct(biggest.amount / revenue)} of ${personal ? "income" : "revenue"}. Cutting it 5% frees ${usd.format(five)}/mo (${usd.format(five * 12)}/yr).`,
      monthly: five,
    });
  }

  // 3) Small recurring charges (subscription creep).
  const small = recurringExpenses.filter((e) => e.amount > 0 && e.amount < 100);
  if (small.length >= 3) {
    const t = sum(small, (e) => e.amount);
    wins.push({
      title: "Review small recurring charges",
      detail: `${small.length} charges under $100 add up to ${usd.format(t)}/mo. Cancelling a quarter of them saves about ${usd.format(t * 0.25)}/mo.`,
      monthly: t * 0.25,
    });
  }

  // 4) Pricing (business) or savings rate (household).
  if (!personal && revenue > 0 && net / revenue < 0.15) {
    const lift = revenue * 0.03;
    wins.push({
      title: "Test a 3% price increase",
      detail: `Net margin is ${pct(net / revenue)}. A 3% price rise with no lost volume adds ${usd.format(lift)}/mo straight to profit. Model it in the What-if simulator.`,
      monthly: lift,
      action: "scenarios",
    });
  } else if (personal && revenue > 0 && net / revenue < 0.2) {
    const gap = revenue * 0.2 - Math.max(0, net);
    wins.push({
      title: "Close the 20% savings gap",
      detail: `You keep ${pct(Math.max(0, net) / revenue)} of income. Reaching the 50/30/20 savings target means finding ${usd.format(gap)}/mo.`,
      monthly: gap,
      action: "scenarios",
    });
  }

  // 5) Revenue concentration risk (business).
  const top = [...recurringRevenue].sort((x, y) => y.amount - x.amount)[0];
  if (!personal && top && revenue > 0 && recurringRevenue.length > 1 && top.amount / revenue >= 0.6) {
    wins.push({
      title: "Reduce revenue concentration",
      detail: `${pct(top.amount / revenue)} of revenue comes from ${top.label}. Losing it would cut income to ${usd.format(revenue - top.amount)}/mo. Adding a second stream lowers the risk.`,
      monthly: top.amount * 0.1,
    });
  }

  const performers: Performer[] = personal
    ? []
    : recurringRevenue
        .filter((r) => r.amount > 0)
        .map((r) => ({ label: r.label, amount: r.amount, share: revenue > 0 ? r.amount / revenue : 0, margin: r.margin, contribution: r.amount * r.margin }))
        .sort((x, y) => y.contribution - x.contribution)
        .slice(0, 3);

  return { wins: wins.sort((x, y) => y.monthly - x.monthly).slice(0, 3), performers };
}

function QuickWinsCard({ wins, onOpenAudit, onOpenScenarios }: { wins: QuickWin[]; onOpenAudit: () => void; onOpenScenarios: () => void }) {
  return (
    <div className={cn(glass, "border-amber-300/20 bg-gradient-to-br from-amber-400/[0.08] to-transparent p-6")}>
      <h2 className="flex items-center gap-2 text-sm font-medium text-amber-100">
        <Lightbulb className="h-4 w-4" /> Quick wins
      </h2>
      <p className="mt-1 text-xs text-slate-400">Suggestions from this report&apos;s own numbers, biggest monthly impact first.</p>
      <ol className="mt-3 space-y-3">
        {wins.map((w, i) => (
          <li key={w.title} className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-amber-400/15 text-xs font-semibold text-amber-100 tabular-nums">{i + 1}</span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-100">{w.title}</p>
              <p className="mt-0.5 text-xs text-slate-400">{w.detail}</p>
              {w.action && (
                <button type="button" onClick={w.action === "audit" ? onOpenAudit : onOpenScenarios} className="mt-1 text-xs text-indigo-300 hover:text-indigo-200">
                  {w.action === "audit" ? "View in Audit Mode →" : "Model it in Forecast & Scenarios →"}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TopPerformersCard({ performers, personal, label }: { performers: Performer[]; personal: boolean; label: string }) {
  if (personal) return null;
  const best = performers[0];
  return (
    <div className={cn(glass, "p-6")}>
      <h2 className="flex items-center gap-2 text-sm font-medium text-slate-200">
        <TrendingUp className="h-4 w-4 text-emerald-300" /> Top {label.toLowerCase()} lines by profit
      </h2>
      <ul className="mt-3 space-y-2.5">
        {performers.map((p) => (
          <li key={p.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-slate-100" title={p.label}>
                {p.label}
              </span>
              <span className="shrink-0 tabular-nums text-emerald-200">{usd.format(p.contribution)}/mo</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
              <div className="h-full rounded-full bg-emerald-400/70" style={{ width: `${Math.max(4, Math.min(100, (p.contribution / (best?.contribution || 1)) * 100))}%` }} />
            </div>
            <p className="mt-0.5 text-[11px] tabular-nums text-slate-500">
              {pct(p.share)} of {label.toLowerCase()} · {pct(p.margin)} margin
            </p>
          </li>
        ))}
      </ul>
      {best && performers.length > 1 && (
        <p className="mt-3 text-xs text-slate-400">
          Growing <strong className="font-medium text-slate-200">{best.label}</strong> by 10% adds {usd.format(best.contribution * 0.1)}/mo in gross profit, more than any other line.
        </p>
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

/**
 * Report tabs of a workspace that has saved data but no report: says what's there and how to get the report —
 * rebuilt from the saved documents (automatically on load, or on demand) or from a new analysis.
 */
function NoReportPanel({
  rebuilding,
  docCount,
  loggedCount,
  reportLoadFailed,
  rebuildFrom,
  onRebuild,
  onRetryLoad,
  onRestoreLatest,
  onNewAnalysis,
  onOpenFiscal,
  onOpenDocuments,
}: {
  rebuilding: boolean;
  docCount: number;
  loggedCount: number;
  reportLoadFailed: boolean;
  /** What a rebuild would run on. */
  rebuildFrom: "documents" | "actuals" | null;
  onRebuild?: () => void;
  /** Re-tries loading the saved report (shown after a failed load). */
  onRetryLoad?: () => void;
  /** Restores the newest saved report version. */
  onRestoreLatest?: () => void;
  onNewAnalysis: () => void;
  onOpenFiscal: () => void;
  onOpenDocuments?: () => void;
}) {
  const saved = [docCount ? `${docCount} saved document${docCount === 1 ? "" : "s"}` : "", loggedCount ? `${loggedCount} logged month${loggedCount === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
  return (
    <div className={cn(glass, "p-6")} role="status">
      {rebuilding ? (
        <p className="flex items-center gap-2 text-sm text-slate-200">
          <Loader2 className="h-4 w-4 animate-spin text-indigo-300" /> Rebuilding this workspace&apos;s report from {saved || "its saved data"}…
        </p>
      ) : (
        <>
          <p className="text-sm font-medium text-slate-100">
            {reportLoadFailed ? "Couldn't load this workspace's saved report." : "This workspace doesn't have a report yet."}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {saved ? `It has ${saved}. ` : ""}
            {reportLoadFailed
              ? "Your data is safe — retry the load, or rebuild the report from what's saved."
              : onRestoreLatest
                ? "Restore your most recent saved report, or rebuild it from everything saved so far."
                : onRebuild
                  ? rebuildFrom === "actuals"
                    ? "Build a report from your logged months, or run a new analysis with full line items."
                    : "Rebuild the report from every saved document (all months combined), or run a new analysis."
                  : "Run an analysis to see the overview, forecast and executive report — logged months are already in Fiscal Year & Actuals."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {onRetryLoad && (
              <button type="button" onClick={onRetryLoad} className={primaryBtn}>
                <RotateCw className="h-4 w-4" /> Retry loading report
              </button>
            )}
            {onRestoreLatest && (
              <button type="button" onClick={onRestoreLatest} className={onRetryLoad ? secondaryBtn : primaryBtn}>
                <History className="h-4 w-4" /> Restore latest version
              </button>
            )}
            {onRebuild && (
              <button type="button" onClick={onRebuild} className={onRetryLoad || onRestoreLatest ? secondaryBtn : primaryBtn}>
                <Repeat className="h-4 w-4" /> {rebuildFrom === "actuals" ? "Build report from logged months" : "Rebuild report from all documents"}
              </button>
            )}
            <button type="button" onClick={onNewAnalysis} className={secondaryBtn}>
              <Plus className="h-4 w-4" /> New analysis
            </button>
            {loggedCount > 0 && (
              <button type="button" onClick={onOpenFiscal} className={secondaryBtn}>
                <CalendarDays className="h-4 w-4" /> Fiscal Year & Actuals
              </button>
            )}
            {onOpenDocuments && (
              <button type="button" onClick={onOpenDocuments} className={secondaryBtn}>
                <FolderOpen className="h-4 w-4" /> My Documents
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const VERSION_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const VERSION_SOURCE: Record<ReportVersionSummary["source"], string> = { analysis: "New analysis", rebuild: "Re-analyzed from documents", unlock: "Unlocked full report" };

/** "Report history": every saved version of this workspace's report, newest first, each restorable. */
function ReportHistory({ versions, activeId, onRestore, noneShowing = false }: { versions: ReportVersionMeta[]; activeId: string | null; onRestore: (id: string) => Promise<void>; noneShowing?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const menuId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const restore = async (id: string) => {
    setBusy(id);
    setErr(null);
    try {
      await onRestore(id);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't restore that version.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={menuId} className={cn(secondaryBtn, "text-slate-200")}>
        <History className="h-4 w-4" /> Report history <span className="rounded-full bg-white/10 px-1.5 text-[11px] tabular-nums">{versions.length}</span>
      </button>
      {open && (
        <div id={menuId} className={cn(glass, "absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] bg-slate-900/95 p-2")}>
          <p className="px-2 pb-1.5 pt-1 text-[11px] text-slate-500">Each analysis is saved as its own version. Restoring one never deletes the others.</p>
          {err && <p role="alert" className="mx-2 mb-1.5 text-xs text-rose-200">{err}</p>}
          <ul className="max-h-80 space-y-1 overflow-y-auto overscroll-contain">
            {versions.map((v, i) => {
              const current = !noneShowing && (v.id === activeId || (!activeId && i === 0));
              const s = v.summary;
              const span = s.months?.length ? (s.months.length === 1 ? periodLabel(s.months[0]) : `${periodLabel(s.months[0])} – ${periodLabel(s.months[s.months.length - 1])}`) : null;
              return (
                <li key={v.id} className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs", current ? "bg-indigo-500/15" : "hover:bg-white/[0.03]")}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-200">
                      {VERSION_DATE.format(new Date(v.createdAt))}
                      {i === 0 && <span className="ml-1.5 text-[10px] uppercase text-slate-500">latest</span>}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">
                      {VERSION_SOURCE[s.source]}
                      {span ? ` · ${span}` : ""}
                      {s.monthlyRevenue != null ? ` · ${usd.format(s.monthlyRevenue)}/mo in` : ""}
                      {s.monthlyExpenses != null ? ` · ${usd.format(s.monthlyExpenses)} out` : ""}
                    </p>
                  </div>
                  {current ? (
                    <span className="shrink-0 rounded-full border border-indigo-300/30 px-2 py-0.5 text-[10px] text-indigo-100">Showing</span>
                  ) : (
                    <button type="button" onClick={() => void restore(v.id)} disabled={busy !== null} className="shrink-0 rounded-md border border-white/15 px-2 py-0.5 text-slate-200 hover:bg-white/10 disabled:opacity-40">
                      {busy === v.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Restore"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

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
    <div className="sticky top-14 z-30 -mx-4 bg-slate-950/85 lg:top-0 px-4 py-2 backdrop-blur-md sm:mx-0 sm:rounded-2xl sm:px-0 sm:py-0 sm:bg-transparent sm:backdrop-blur-none">
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
function ReportPreview({ html, onDownload, downloading, hasGoal, onSetGoal }: { html: string; onDownload: () => void; downloading: boolean; hasGoal: boolean; onSetGoal: () => void }) {
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
        <button type="button" onClick={onDownload} disabled={downloading} className={primaryBtn}>
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {downloading ? "Preparing PDF…" : "Download PDF"}
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
  /** Statement review only: parser flags and cross-month recurrence for this line (highlighted inline). */
  insight?: LineInsight;
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
  /** Statement review only: parser flags and cross-month recurrence for this line (highlighted inline). */
  insight?: LineInsight;
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
  syncedType,
  onTypeChange,
}: {
  draftKey: string;
  mode: WorkspaceMode;
  defaultType: BusinessType;
  disabled: boolean;
  onSubmit: (p: FormPayload) => Promise<boolean>;
  /** The business type chosen anywhere on the page (this wizard, the statement review, the workspace); null = none yet. */
  syncedType: BusinessType | null;
  /** Reports a business type picked here so the statement upload / review panel stays on the same type. */
  onTypeChange: (bt: BusinessType) => void;
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
    const type = syncedType && !personal ? syncedType : defaultType;
    const rows = templateRows(type);
    touched.current = false;
    setStep(0);
    setBusinessType(type);
    setRevenue(rows.revenue);
    setExpenses(rows.expenses);
    setRestored(false);
  };

  const applyType = (bt: BusinessType) => {
    setBusinessType(bt);
    // Re-seed templates only while no amounts have been entered.
    if ([...revenue, ...expenses].every((r) => !r.amount)) {
      const rows = templateRows(bt);
      setRevenue(rows.revenue);
      setExpenses(rows.expenses);
    }
  };
  const chooseType = (bt: BusinessType) => {
    applyType(bt);
    if (!personal) onTypeChange(bt);
  };
  // A type picked in the statement review panel flows back here, so the two never disagree.
  const [seenSync, setSeenSync] = useState(syncedType);
  if (seenSync !== syncedType) {
    setSeenSync(syncedType);
    if (!personal && syncedType && syncedType !== businessType) applyType(syncedType);
  }
  // A restored draft's type was an explicit choice: share it with the upload panel once on load.
  const sharedDraftType = useRef(false);
  useEffect(() => {
    if (sharedDraftType.current) return;
    sharedDraftType.current = true;
    if (initial && !personal && !syncedType) onTypeChange(initial.businessType);
  }, [initial, personal, syncedType, onTypeChange]);

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
      rowClassName={(row) => insightRowClass(row.insight)}
      render={(row, removeButton) => {
        const update = (patch: Partial<FormRevenue>) => setRows((r) => r.map((x) => (x.id === row.id ? { ...x, ...patch } : x)));
        return (
          <>
            {row.insight && <RowInsightNotice insight={row.insight} onChange={(insight) => update({ insight })} />}
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
              <RecurrenceControl oneTime={row.oneTime} partial={row.partial} onChange={(p) => update({ ...p, ...settleRecurrence(row.insight) })} />
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
        rowClassName={(row) => insightRowClass(row.insight)}
        render={(row, removeButton) => {
          const update = (patch: Partial<FormExpense>) => setRows((r) => r.map((x) => (x.id === row.id ? { ...x, ...patch } : x)));
          const help = personal ? CATEGORY_HELP[row.category] : undefined;
          return (
            <>
              {row.insight && <RowInsightNotice insight={row.insight} onChange={(insight) => update({ insight })} />}
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
                {!row.pctMode && <RecurrenceControl oneTime={row.oneTime} partial={row.partial} onChange={(p) => update({ ...p, ...settleRecurrence(row.insight) })} />}
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

// ---------------------------------------------------------------------------
// Inline line-item insights (statement review): flagged transactions and recurrence to confirm
// ---------------------------------------------------------------------------

/** Card styling for a line that needs a look; undefined = the default card. */
function insightRowClass(i: LineInsight | undefined): string | undefined {
  switch (insightTone(i)) {
    case "duplicate":
      return "border-rose-400/60 border-l-4 border-l-rose-400 bg-rose-500/[0.07] shadow-[0_0_0_1px_rgba(251,113,133,0.15)]";
    case "flag":
      return "border-amber-400/60 border-l-4 border-l-amber-400 bg-amber-400/[0.07] shadow-[0_0_0_1px_rgba(251,191,36,0.15)]";
    case "recurrence":
      return "border-sky-400/50 border-l-4 border-l-sky-400 bg-sky-400/[0.05]";
    default:
      return undefined;
  }
}

/** Picking recurring / one-time on a line settles its "does this repeat?" prompt. */
const settleRecurrence = (i: LineInsight | undefined): { insight?: LineInsight } => (i?.recurrence && i.recurrence.status !== "confirmed" ? { insight: { ...i, recurrenceReviewed: true } } : {});

const FLAG_TONE: Record<ReviewFlag["kind"], string> = {
  UNRECOGNIZED_MERCHANT: "border-amber-300/50 bg-amber-400/15 text-amber-100",
  DUPLICATE_TRANSACTION: "border-rose-300/50 bg-rose-500/15 text-rose-100",
  UNUSUAL_CHARGE: "border-orange-300/50 bg-orange-400/15 text-orange-100",
};

/** The flag / recurrence banner at the top of a line's card. */
function RowInsightNotice({ insight, onChange }: { insight: LineInsight; onChange: (i: LineInsight) => void }) {
  const flagsOpen = insight.flags.length > 0 && !insight.flagsReviewed;
  const rec = insight.recurrence;
  const recOpen = !!rec && rec.status !== "confirmed" && !insight.recurrenceReviewed;
  return (
    <div className="space-y-1.5">
      {insight.flags.length > 0 &&
        (flagsOpen ? (
          <div role="note" className="rounded-lg border border-white/10 bg-slate-950/40 px-2.5 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden />
              {[...new Set(insight.flags.map((f) => f.kind))].map((k) => (
                <span key={k} className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", FLAG_TONE[k])}>
                  {REVIEW_FLAG_LABELS[k]}
                </span>
              ))}
              <button
                type="button"
                onClick={() => onChange({ ...insight, flagsReviewed: true })}
                className="ml-auto inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/5 hover:text-white"
              >
                <CheckCircle2 className="h-3 w-3" aria-hidden /> Looks fine
              </button>
            </div>
            <ul className="mt-1.5 space-y-1">
              {insight.flags.map((f, i) => (
                <li key={`${f.kind}-${f.date}-${f.transactionId}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-slate-300">
                  <span className="text-slate-100">{f.merchant}</span>
                  <span className="tabular-nums">{exactMoney(f.amount)}</span>
                  {f.date && <span className="text-slate-500">{f.date}</span>}
                  {f.transactionId && <span className="font-mono text-[10px] text-slate-500">#{f.transactionId}</span>}
                  {f.note && <span className="basis-full text-slate-400">{f.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <CheckCircle2 className="h-3 w-3 text-emerald-400/80" aria-hidden /> {insight.flags.length === 1 ? "Flag" : `${insight.flags.length} flags`} checked
            <button type="button" onClick={() => onChange({ ...insight, flagsReviewed: false })} className="text-indigo-300 hover:text-indigo-200">
              show
            </button>
          </p>
        ))}
      {rec &&
        (recOpen ? (
          <p role="note" className="flex items-start gap-1.5 rounded-lg border border-sky-300/30 bg-sky-500/10 px-2.5 py-1.5 text-xs text-sky-100">
            <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" aria-hidden />
            <span className="flex-1">
              <span className="font-semibold">{rec.status === "new" ? "New this month" : "Recurring or one-time?"}</span> {rec.note}
            </span>
            <button type="button" onClick={() => onChange({ ...insight, recurrenceReviewed: true })} className="shrink-0 text-[11px] text-sky-200 underline-offset-2 hover:underline">
              Keep as is
            </button>
          </p>
        ) : rec.status === "confirmed" ? (
          <p className="inline-flex items-center gap-1 rounded-full border border-emerald-300/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200" title={rec.note}>
            <BadgeCheck className="h-3 w-3" aria-hidden /> {rec.note}
          </p>
        ) : null)}
    </div>
  );
}

/** "2 flagged · 1 to confirm" for a list header. */
function InsightCounts({ rows }: { rows: { insight?: LineInsight }[] }) {
  const flagged = rows.filter((r) => {
    const t = insightTone(r.insight);
    return t === "flag" || t === "duplicate";
  }).length;
  const confirm = rows.filter((r) => insightTone(r.insight) === "recurrence").length;
  if (!flagged && !confirm) return null;
  return (
    <span className="ml-2 inline-flex flex-wrap gap-1.5 align-middle text-[11px] font-normal">
      {flagged > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/40 bg-amber-400/10 px-2 py-0.5 text-amber-100">
          <AlertTriangle className="h-3 w-3" aria-hidden /> {flagged} flagged
        </span>
      )}
      {confirm > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border border-sky-300/40 bg-sky-400/10 px-2 py-0.5 text-sky-100">
          <CircleHelp className="h-3 w-3" aria-hidden /> {confirm} to confirm
        </span>
      )}
    </span>
  );
}

function RowEditor<T extends { id: number }>(props: {
  hint: string;
  columns: string[];
  rows: T[];
  onAdd: () => void;
  onRemove: (id: number) => void;
  /** Rendered inside a stacked card per line, so long labels (e.g. category names) get full width. */
  render: (row: T, removeButton: ReactNode) => ReactNode;
  /** Replaces the card's default border / background (e.g. to highlight a flagged line). */
  rowClassName?: (row: T) => string | undefined;
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
          <div key={row.id} className={cn("space-y-2 rounded-xl border p-3 transition-colors", props.rowClassName?.(row) ?? "border-white/10 bg-white/[0.02]")}>
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
// No cap on how many files one upload takes: a file isn't "one month" (multi-month reports are split into their
// calendar months on extraction), and files are read one at a time, so a large batch only takes longer.

/** An earlier document from this workspace covering a month in the current upload (e.g. last week's card statement). */
type EarlierStatement = ParsedStatement & { include: boolean; savedAt: string };

/** One calendar month's own itemized rows in a multi-month review (never blended with other months). */
interface MonthRows {
  /** Stable id: the month key, or "?<statement id>" for a statement without a month. */
  id: string;
  key: string;
  statementIds: string[];
  /** false = the month comes only from documents already saved in the workspace (edited in My Documents, not here). */
  editable: boolean;
  revenue: FormRevenue[];
  expenses: FormExpense[];
}

interface UploadReviewState {
  businessType: BusinessType;
  /**
   * Single month: that month's editable rows. Several months: the forward baseline averaged from `monthRows` when the
   * review was built (the live baseline is recomputed from the edited months — see `reviewBaseline`).
   */
  revenue: FormRevenue[];
  expenses: FormExpense[];
  /** Two or more months: each month's itemized rows, oldest first; empty for a single month. */
  monthRows: MonthRows[];
  /** Month shown in the month-by-month editor (a `MonthRows.id`). */
  activeMonth: string;
  /** Statements read in this upload (one or many). */
  statements: ParsedStatement[];
  /** Saved documents for the same months, folded into those months' totals when included. */
  earlier: EarlierStatement[];
  /** Saved documents for *other* months in this workspace (cumulative ingestion). */
  history: EarlierStatement[];
  /** Fold `history` into the report so it covers every month so far, not just this upload. */
  cumulative: boolean;
  months: { key: string; actual: MonthActual; statementIds: string[] }[];
  duplicateLines: number;
  excludedOneTime: number;
  /** Raw card / bank statements that share a month with a P&L: potential duplicates, excluded unless confirmed. */
  overlaps: StatementOverlap[];
  /** Log each month's totals into the Fiscal Year Tracker when the report is generated. */
  logToTracker: boolean;
  /** Months already logged from this review via "Log now" (prevents double logging). */
  loggedKeys: string[];
  /** The line items were rebuilt after a month / document change (edits were reset). */
  rebuilt: boolean;
}

/** Parsed lines → editable form rows. Amounts are shown with cents; margins as percents. `insightOf` attaches flags / recurrence. */
function itemsToRows(items: { revenue: RevenueLine[]; expenses: ExpenseLine[] }, personal: boolean, insightOf?: (line: RevenueLine | ExpenseLine) => LineInsight | undefined) {
  const withInsight = (line: RevenueLine | ExpenseLine) => {
    const insight = insightOf?.(line);
    return insight ? { insight } : {};
  };
  return {
    revenue: items.revenue.map(
      (r): FormRevenue => ({
        ...blankRevenue(r.label),
        amount: r.amount.toFixed(2),
        margin: personal || !Number.isFinite(r.margin) ? "" : String(Math.round(r.margin * 100)),
        oneTime: r.oneTime === true,
        ...withInsight(r),
      }),
    ),
    expenses: items.expenses.map((e): FormExpense => ({ ...blankExpense(e.category), label: e.label, amount: e.amount.toFixed(2), oneTime: e.oneTime === true, ...withInsight(e) })),
  };
}

/**
 * This upload's statements with recurrence cross-checked against every other month the owner has (the rest of this
 * upload plus every saved document), and the parser's review flags matched to their lines. The insights are keyed by
 * the returned line objects, which the batch aggregation passes through unchanged into each month's lines.
 */
function classifyStatements(statements: ParsedStatement[], reference: ParsedStatement[]): { statements: ParsedStatement[]; insights: Map<RevenueLine | ExpenseLine, LineInsight> } {
  const history = buildVendorHistory(reference.map((s) => ({ month: s.month, revenue: s.items.revenue, expenses: s.items.expenses })));
  const insights = new Map<RevenueLine | ExpenseLine, LineInsight>();
  const classified = statements.map((s): ParsedStatement => {
    const { byLine } = matchFlags(s.reviewFlags ?? [], [...s.items.revenue, ...s.items.expenses]);
    const adjust = <L extends RevenueLine | ExpenseLine>(l: L, side: "revenue" | "expense", flags: ReviewFlag[]): L => {
      const c = classifyLine(l, side, s.month, history);
      const { uncertain: _u, oneTime: _o, ...rest } = l;
      void _u;
      void _o;
      const line = (c.oneTime ? { ...rest, oneTime: true } : rest) as L;
      if (flags.length || c.recurrence) insights.set(line, { flags, ...(c.recurrence ? { recurrence: c.recurrence } : {}) });
      return line;
    };
    const nRev = s.items.revenue.length;
    return {
      ...s,
      items: {
        ...s.items,
        revenue: s.items.revenue.map((r, i) => adjust(r, "revenue", byLine.get(i) ?? [])),
        expenses: s.items.expenses.map((e, i) => adjust(e, "expense", byLine.get(nRev + i) ?? [])),
      },
    };
  });
  return { statements: classified, insights };
}

/** A business workspace always gets a business analysis, even if the statement looked personal. */
const typeForMode = (bt: BusinessType, mode: WorkspaceMode): BusinessType => (mode === "PERSONAL" ? "PERSONAL_FAMILY" : bt === "PERSONAL_FAMILY" ? "OTHER_CUSTOM" : bt);

/** Saved workspace documents for the months these statements cover (excluding the same files). */
function earlierFor(statements: ParsedStatement[], docs: WorkspaceDocument[], prev: EarlierStatement[] = []): EarlierStatement[] {
  const months = new Set(statements.map((s) => s.month).filter(Boolean));
  const hashes = new Set(statements.map((s) => s.contentHash).filter(Boolean));
  // Multi-month documents contribute only the months that overlap this upload.
  return docs
    .filter((d) => !(d.contentHash && hashes.has(d.contentHash)))
    .flatMap((d) =>
      documentSlices(d)
        .filter((sl) => months.has(sl.period))
        .map((sl): EarlierStatement => {
          const id = d.months.length ? `doc-${d.id}-${sl.period}` : `doc-${d.id}`;
          return {
            id,
            name: d.months.length ? `${d.name} · ${periodLabel(sl.period)}` : d.name,
            fileName: d.fileName,
            fileSize: d.fileSize,
            contentHash: d.contentHash,
            kind: d.kind === "pasted" ? "pasted" : "statement",
            items: sl.items,
            detected: sl.period,
            month: sl.period,
            savedAt: d.createdAt,
            include: prev.find((p) => p.id === id)?.include ?? true,
          };
        }),
    );
}

const HISTORY_PREFIX = "hist-";
const isHistoryId = (id: string) => id.startsWith(HISTORY_PREFIX);

/**
 * Saved workspace documents for months this upload does *not* cover (excluding the same files): the earlier months a
 * cumulative report folds in, so a new month adds to the analysis instead of replacing it.
 */
function historyFor(statements: ParsedStatement[], docs: WorkspaceDocument[]): EarlierStatement[] {
  const months = new Set(statements.map((s) => s.month).filter(Boolean));
  const hashes = new Set(statements.map((s) => s.contentHash).filter(Boolean));
  return docs
    .filter((d) => !(d.contentHash && hashes.has(d.contentHash)))
    .flatMap((d) =>
      documentSlices(d)
        .filter((sl) => !months.has(sl.period))
        .map(
          (sl): EarlierStatement => ({
            id: `${HISTORY_PREFIX}${d.id}-${sl.period}`,
            name: d.months.length ? `${d.name} · ${periodLabel(sl.period)}` : d.name,
            fileName: d.fileName,
            fileSize: d.fileSize,
            contentHash: d.contentHash,
            kind: d.kind === "pasted" ? "pasted" : "statement",
            items: sl.items,
            detected: sl.period,
            month: sl.period,
            savedAt: d.createdAt,
            include: true,
          }),
        ),
    );
}

/**
 * (Re)builds the review from the statements: per-month totals, and line items that are that month's own rows for a
 * single month, or one itemized set per month (plus the averaged forward baseline) for several months.
 */
function buildReview(
  statements: ParsedStatement[],
  earlier: EarlierStatement[],
  history: EarlierStatement[],
  mode: WorkspaceMode,
  prev?: UploadReviewState,
  /** The business type the owner already chose (wizard / workspace / uploader); wins over the parser's guess. */
  preferredType?: BusinessType,
): UploadReviewState {
  const personal = mode === "PERSONAL";
  const cumulative = prev?.cumulative ?? true;
  // Recurrence is checked against every month the owner has, even saved months left out of this report.
  const { statements: classified, insights } = classifyStatements(statements, [...statements, ...earlier, ...history]);
  const included = [...classified, ...earlier.filter((e) => e.include), ...(cumulative ? history : [])];
  const agg = aggregateStatements(included, statements[0]?.items.businessType ?? "OTHER_CUSTOM");
  const insightOf = (l: RevenueLine | ExpenseLine) => insights.get(l);
  const rows = itemsToRows(agg, personal, insightOf);
  const monthRows: MonthRows[] =
    agg.monthLines.length > 1
      ? agg.monthLines.map((m) => ({
          id: m.key || `?${m.statementIds[0]}`,
          key: m.key,
          statementIds: m.statementIds,
          editable: m.statementIds.some((id) => !isHistoryId(id)),
          ...itemsToRows(m, personal, insightOf),
        }))
      : [];
  const editable = monthRows.filter((m) => m.editable);
  // Open on the same month as before a rebuild, else the first month of this upload that needs a look.
  const activeMonth =
    (prev && monthRows.some((m) => m.id === prev.activeMonth) ? prev.activeMonth : undefined) ??
    (editable.find((m) => [...m.revenue, ...m.expenses].some((r) => insightTone(r.insight))) ?? editable[0] ?? monthRows[0])?.id ??
    "";
  return {
    businessType: prev?.businessType ?? typeForMode(preferredType ?? agg.businessType, mode),
    revenue: rows.revenue,
    expenses: rows.expenses,
    monthRows,
    activeMonth,
    statements,
    earlier,
    history,
    cumulative,
    months: agg.months,
    duplicateLines: agg.duplicateLines,
    excludedOneTime: agg.excludedOneTime,
    overlaps: agg.overlaps,
    logToTracker: prev?.logToTracker ?? agg.months.some((m) => m.key && m.statementIds.some((id) => !isHistoryId(id))),
    loggedKeys: prev?.loggedKeys ?? [],
    rebuilt: !!prev,
  };
}

/** The reviewed rows → one month's actual totals (exact to the cent). */
function reviewTotals(review: Pick<UploadReviewState, "revenue" | "expenses">): MonthActual {
  return statementTotals({
    revenue: validRevenueRows(review.revenue).map((r) => ({ amount: Number(r.amount) })),
    expenses: validExpenseRows(effectiveExpenses(review.expenses, review.revenue)).map((e) => ({ amount: Number(e.amount), oneTime: e.oneTime })),
  });
}

/** What each month logs: that month's own reviewed (edited) rows, exact to the cent. */
function monthActuals(review: UploadReviewState): { key: string; actual: MonthActual }[] {
  // Months that come only from earlier saved documents (cumulative mode) are already in the workspace: never re-logged.
  if (review.monthRows.length) return review.monthRows.filter((m) => m.key && m.editable).map((m) => ({ key: m.key, actual: reviewTotals(m) }));
  const keyed = review.months.filter((m) => m.key && m.statementIds.some((id) => !isHistoryId(id)));
  if (review.months.length === 1 && keyed.length === 1) return [{ key: keyed[0].key, actual: reviewTotals(review) }];
  return keyed.map((m) => ({ key: m.key, actual: m.actual }));
}

/** Form rows → line items (the shape saved documents and the batch aggregation use). */
function rowsToLines(rows: Pick<UploadReviewState, "revenue" | "expenses">, personal: boolean): { revenue: RevenueLine[]; expenses: ExpenseLine[] } {
  const lines = toPayloadLines(rows.revenue, rows.expenses, personal);
  return {
    revenue: lines.revenue.map((r) => ({ ...r, margin: personal ? 1 : r.margin ?? 0.5 })),
    expenses: lines.expenses.map((e) => ({ ...e, category: e.category === "Uncategorized" ? "Other" : e.category })) as ExpenseLine[],
  };
}

/**
 * Hand-added months ("+ Add Month") have no parsed lines to rebuild from: before a rebuild, copy what the owner typed
 * into each one's rows back into its statement so the rebuild keeps it.
 */
function syncManualStatements(statements: ParsedStatement[], review: Pick<UploadReviewState, "monthRows">, personal: boolean): ParsedStatement[] {
  return statements.map((s) => {
    if (s.kind !== "form") return s;
    const row = review.monthRows.find((m) => m.statementIds.length === 1 && m.statementIds[0] === s.id);
    return row ? { ...s, items: { ...s.items, ...rowsToLines(row, personal) } } : s;
  });
}

/**
 * The forward baseline the report runs on. Several months: recurring lines averaged across every month's *edited*
 * rows (one-time lines stay in their own month); a single month: its rows as they are.
 */
function reviewBaseline(review: UploadReviewState, personal: boolean): Pick<FormPayload, "revenue" | "expenses"> {
  if (!review.monthRows.length) return toPayloadLines(review.revenue, review.expenses, personal);
  const months = review.monthRows.map((m) => toPayloadLines(m.revenue, m.expenses, personal));
  // Margins: the amount-weighted average of the months that state one; blank everywhere = estimated by the analysis.
  // Categories stay as typed ("Uncategorized" is auto-classified by the analysis).
  const marginOf = (label: string) => {
    const key = label.trim().toLowerCase();
    const given = months.flatMap((m) => m.revenue).filter((r) => !r.oneTime && r.label.trim().toLowerCase() === key && r.margin != null);
    const total = given.reduce((a, r) => a + r.amount, 0);
    return given.length && total > 0 ? Math.round((given.reduce((a, r) => a + r.margin! * r.amount, 0) / total) * 1000) / 1000 : undefined;
  };
  const base = monthlyBaseline(months.map((m) => ({ revenue: m.revenue.map((r) => ({ ...r, margin: 0 })), expenses: m.expenses })));
  return {
    revenue: base.revenue.map((r) => {
      const margin = personal ? undefined : marginOf(r.label);
      return { label: r.label, amount: r.amount, ...(margin != null ? { margin } : {}) };
    }),
    expenses: base.expenses.map((e) => ({ label: e.label, amount: e.amount, category: e.category })),
  };
}

/** Months the review's line items cover: this upload and (cumulatively) earlier ones. */
const reviewMonthKeys = (review: UploadReviewState) => review.months.map((m) => m.key).filter(Boolean);

/** The reviewed rows → the analysis request + what to save / log alongside it. */
function reviewSubmission(review: UploadReviewState, personal: boolean): { payload: FormPayload; extras: AnalysisExtras } {
  // Months are logged into whichever workspace the report goes to, once that workspace has loaded.
  const log = review.logToTracker ? monthActuals(review).filter((m) => !review.loggedKeys.includes(m.key) && (m.actual.revenue > 0 || m.actual.expenses > 0)) : [];
  return {
    payload: { mode: "form", businessType: review.businessType, origin: "statement", ...reviewBaseline(review, personal) },
    extras: { log, docs: docsToSave(review, personal), months: reviewMonthKeys(review) },
  };
}

/** Rows → line items (for saving a single reviewed statement as edited). */
function rowsToItems(review: UploadReviewState, personal: boolean): ExtractedLineItems {
  return { businessType: review.businessType, ...rowsToLines(review, personal) };
}

/** A statement's lines as the owner edited them: its month's rows, when that month holds only this statement. */
function editedLines(review: UploadReviewState, s: ParsedStatement, personal: boolean): { revenue: RevenueLine[]; expenses: ExpenseLine[] } {
  const m = review.monthRows.find((x) => x.editable && x.statementIds.length === 1 && x.statementIds[0] === s.id);
  // Several statements merged into one month (e.g. checking + card) can't be split back apart: those keep their parsed lines.
  return m ? rowsToLines(m, personal) : { revenue: s.items.revenue, expenses: s.items.expenses };
}

/**
 * One saved document per uploaded file. A multi-month file is saved once, with its months (as assigned in the
 * review) kept as a per-month breakdown; months moved onto the same month are merged.
 */
function docsToSave(review: UploadReviewState, personal: boolean): NewWorkspaceDocument[] {
  // The on-screen rows are this one statement's own lines only when nothing else is folded into them.
  const single = review.statements.length === 1 && !review.earlier.some((e) => e.include) && !(review.cumulative && review.history.length);
  const groups = new Map<string, ParsedStatement[]>();
  // A raw card / bank statement left out as a P&L duplicate isn't saved either: a later rebuild from My Documents
  // would otherwise add its charges on top of the P&L that already contains them.
  const excluded = new Set(review.overlaps.filter((o) => !o.confirmed).map((o) => o.statementId));
  for (const s of review.statements) {
    if (excluded.has(s.id)) continue;
    // A hand-added month the owner left blank isn't worth a document.
    if (s.kind === "form") {
      const own = editedLines(review, s, personal);
      if (!own.revenue.length && !own.expenses.length) continue;
    }
    const k = s.source?.id ?? s.id;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  return [...groups.values()].map((list) => {
    const first = list[0];
    const base = { name: first.source?.name ?? first.name, fileName: first.fileName, fileSize: first.fileSize, contentHash: first.contentHash, kind: first.kind };
    const byMonth = new Map<string, { revenue: RevenueLine[]; expenses: ExpenseLine[] }>();
    for (const s of list) {
      const m = byMonth.get(s.month) ?? { revenue: [], expenses: [] };
      const own = editedLines(review, s, personal);
      byMonth.set(s.month, { revenue: [...m.revenue, ...own.revenue], expenses: [...m.expenses, ...own.expenses] });
    }
    const keyed = [...byMonth.entries()].filter(([k]) => k).sort(([a], [b]) => a.localeCompare(b));
    if (first.source && keyed.length > 1 && keyed.length === byMonth.size) {
      const months = keyed.map(([period, l]) => ({ period, ...l }));
      const all = { revenue: months.flatMap((m) => m.revenue), expenses: months.flatMap((m) => m.expenses) };
      // The lines live in `months`; the top-level lists stay empty so the row isn't stored twice.
      return { ...base, period: null, items: { businessType: first.items.businessType, revenue: [], expenses: [] }, months, totals: statementTotals(all) };
    }
    const items: ExtractedLineItems = single
      ? rowsToItems(review, personal)
      : { businessType: first.items.businessType, revenue: [...byMonth.values()].flatMap((m) => m.revenue), expenses: [...byMonth.values()].flatMap((m) => m.expenses) };
    return { ...base, period: keyed.length === 1 && byMonth.size === 1 ? keyed[0][0] : null, items, totals: statementTotals({ revenue: items.revenue, expenses: items.expenses }) };
  });
}

/**
 * A workspace's saved documents → one "form" payload: the same monthly baseline an upload of those documents would
 * produce (recurring lines averaged across every month they cover). Used to rebuild a report that is missing (e.g. the
 * page was closed before the report finished saving) so a workspace with data never lands back on the upload screen.
 */
function payloadFromDocuments(docs: WorkspaceDocument[], businessType: BusinessType): FormPayload | null {
  const statements: ParsedStatement[] = docs.flatMap((d): ParsedStatement[] => {
    const base = { name: d.name, fileName: null, fileSize: null, contentHash: null, kind: "statement" as const };
    const slices = documentSlices(d);
    if (slices.length) return slices.map((sl) => ({ ...base, id: `${d.id}-${sl.period}`, items: sl.items, detected: sl.period, month: sl.period }));
    return d.items && (d.items.revenue.length || d.items.expenses.length) ? [{ ...base, id: d.id, items: d.items, detected: "", month: "" }] : [];
  });
  if (!statements.length) return null;
  const agg = aggregateStatements(statements, businessType);
  if (!agg.revenue.length && !agg.expenses.length) return null;
  const personal = businessType === "PERSONAL_FAMILY";
  return {
    mode: "form",
    businessType,
    origin: "statement",
    revenue: agg.revenue.map((r) => ({ label: r.label, amount: r.amount, ...(personal ? {} : { margin: r.margin }), ...(r.oneTime ? { oneTime: true as const } : {}) })),
    expenses: agg.expenses.map((e) => ({ label: e.label, amount: e.amount, category: e.category, ...(e.oneTime ? { oneTime: true as const } : {}) })),
  };
}

/**
 * Logged tracker months → a minimal "form" payload (average monthly revenue and recurring expenses), for a workspace
 * that has actuals but no documents or report. Keeps it from dead-ending on "run an analysis" when data exists.
 */
function payloadFromActuals(actuals: Record<string, MonthActual>, businessType: BusinessType): FormPayload | null {
  const agg = aggregateActuals(actuals);
  if (!agg || !(agg.revenue > 0)) return null;
  const personal = businessType === "PERSONAL_FAMILY";
  const span = agg.months === 1 ? "1 logged month" : `${agg.months} logged months`;
  return {
    mode: "form",
    businessType,
    origin: "manual",
    revenue: [{ label: `Average monthly ${personal ? "income" : "revenue"} (${span})`, amount: agg.revenue, ...(personal ? {} : { margin: 0.5 }) }],
    expenses: agg.expenses > 0 ? [{ label: `Average monthly expenses (${span})`, amount: agg.expenses, category: "Other" }] : [],
  };
}

function StatementUploader({
  mode,
  disabled,
  onSubmit,
  trackerReady,
  onLogActuals,
  existingDocs,
  onBalanceDetected,
  syncedType,
  onTypeChange,
  uploadMoreRef,
  onReviewChange,
}: {
  mode: WorkspaceMode;
  disabled: boolean;
  onSubmit: (init: RequestInit, businessType: BusinessType | undefined, extras: AnalysisExtras) => Promise<boolean>;
  trackerReady: boolean;
  onLogActuals: (key: string, actual: MonthActual) => string;
  /** Documents already saved in this workspace (duplicate detection + same-month totals). */
  existingDocs: WorkspaceDocument[];
  /** The latest bank-statement closing balance read in this batch (offered as cash on hand for the runway). */
  onBalanceDetected?: (b: { amount: number; period: string | null }) => void;
  /**
   * The business type already chosen (setup wizard, review dropdown or the workspace itself); null = detect it. Shared
   * with the wizard so both panels always show — and submit — the same type.
   */
  syncedType: BusinessType | null;
  onTypeChange: (bt: BusinessType | null) => void;
  /** Set to a function that opens the "add more documents" file picker (used by the sidebar's Upload button). */
  uploadMoreRef?: { current: (() => void) | null };
  /** Told whether parsed lines are under review, so the page can give the review the full width. */
  onReviewChange?: (reviewing: boolean) => void;
}) {
  const personal = mode === "PERSONAL";
  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState("");
  const [input, setInput] = useState<"file" | "paste">("file");
  // Business type is owned by the dashboard (kept in sync with the wizard); personal books are always household.
  const businessType: BusinessType | "" = personal ? "PERSONAL_FAMILY" : syncedType ?? "";
  const [dragOver, setDragOver] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [batchNotes, setBatchNotes] = useState<string[]>([]);
  const [rawReview, setReview] = useState<UploadReviewState | null>(null);
  // The review always shows the shared business type, so a choice made in the wizard (or here) never snaps back to
  // whatever the parser guessed.
  const review = rawReview && !personal && syncedType && rawReview.businessType !== syncedType ? { ...rawReview, businessType: syncedType } : rawReview;
  const inputRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLInputElement>(null);
  /** Distinguishes statement ids across incremental uploads into the same review. */
  const batchSeq = useRef(0);
  useEffect(() => {
    if (!uploadMoreRef) return;
    uploadMoreRef.current = () => moreRef.current?.click();
    return () => {
      uploadMoreRef.current = null;
    };
  }, [uploadMoreRef]);
  const reviewing = !!rawReview;
  useEffect(() => {
    if (!onReviewChange) return;
    onReviewChange(reviewing);
    return () => onReviewChange(false);
  }, [onReviewChange, reviewing]);

  const ready = input === "file" ? files.length > 0 : pasted.trim().length > 0;
  const busy = disabled || extracting;
  const savedHashes = useMemo(() => new Map(existingDocs.filter((d) => d.contentHash).map((d) => [d.contentHash!, d])), [existingDocs]);

  /** Adds files, keeping order and skipping exact repeats of the same file. */
  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const key = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
    const seen = new Set(files.map(key));
    const next = [...files];
    for (const f of Array.from(list)) {
      if (seen.has(key(f))) continue;
      seen.add(key(f));
      next.push(f);
    }
    setExtractError(null);
    setFiles(next);
  };

  const fileInit = (f: File | null, extract: boolean): RequestInit => {
    if (f) {
      const fd = new FormData();
      fd.append("file", f);
      if (businessType) fd.append("businessType", businessType);
      if (extract) fd.append("mode", "extract");
      return { body: fd };
    }
    return {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: extract ? "extract" : "text", rawText: pasted, ...(businessType ? { businessType } : {}) }),
    };
  };

  /** Reads each statement in turn (one request at a time keeps large batches inside rate limits), then aggregates. */
  const extract = async (opts: { direct?: boolean; more?: File[] } = {}) => {
    // `more`: files added from inside the review — read them and fold them into the statements already under review.
    const adding = opts.more && rawReview ? rawReview : null;
    setExtracting(true);
    setExtractError(null);
    if (!adding) setBatchNotes([]);
    const sources: (File | null)[] = opts.more ?? (input === "file" ? files : [null]);
    const seq = ++batchSeq.current;
    const parsed: ParsedStatement[] = [];
    const notes: string[] = [];
    const seen = new Set<string>(adding ? adding.statements.map((s) => s.contentHash).filter((h): h is string => !!h) : []);
    let balance: { amount: number; period: string | null } | null = null;
    const headers = await authHeaders();
    for (let i = 0; i < sources.length; i++) {
      const f = sources[i];
      const label = f?.name ?? "Pasted text";
      setProgress({ done: i, total: sources.length, name: label });
      try {
        const hash = await hashFile(f ?? new Blob([pasted], { type: "text/plain" }));
        if (hash && seen.has(hash)) {
          notes.push(adding ? `${label}: already in this review — skipped.` : `${label}: same file as another in this batch — read once.`);
          continue;
        }
        if (hash) seen.add(hash);
        const prior = hash ? savedHashes.get(hash) : undefined;
        if (prior) notes.push(`${label}: already in My Documents as “${prior.name}” — it will be updated, not added twice.`);
        const init = fileInit(f, true);
        const res = await fetch("/api/analyze", { method: "POST", ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...headers } });
        if (!res.ok) throw new Error(await errorMessage(res));
        const data = parseExtractResponse(await res.json());
        if (!data) throw new Error("Received an unexpected response from the analysis service.");
        if (data.endingBalance != null) {
          const at = data.months.length ? data.months[data.months.length - 1].period.key : data.period?.key ?? null;
          if (!balance || (at ?? "") >= (balance.period ?? "")) balance = { amount: data.endingBalance, period: at };
        }
        if (data.reviewFlags.length) notes.push(`${label}: ${data.reviewFlags.length} transaction${data.reviewFlags.length === 1 ? "" : "s"} flagged for review (${DOCUMENT_KIND_LABELS[data.documentKind].toLowerCase()}).`);
        const id = `st-${seq}-${i}-${hash?.slice(0, 8) ?? i}`;
        const common = { fileName: f?.name ?? null, fileSize: f?.size ?? null, contentHash: hash, kind: f ? ("statement" as const) : ("pasted" as const), documentKind: data.documentKind };
        if (data.months.length >= 2) {
          // One file covering several months (H1 / quarterly / annual): each calendar month in the document becomes its
          // own statement, already assigned to that month, so one upload seeds every month it lists.
          const name = f ? documentName(f.name, { months: data.months.map((m) => m.period.key), documentKind: data.documentKind }) : "Pasted statement";
          // Each flag goes to the month it's dated in, else the month whose lines name that merchant, else the first.
          const flagMonth = (fl: ReviewFlag) =>
            data.months.find((m) => m.period.key === fl.date.slice(0, 7))?.period.key ??
            data.months.find((m) => [...m.items.revenue, ...m.items.expenses].some((l) => sameVendor(fl.lineLabel || fl.merchant, l.label)))?.period.key ??
            data.months[0].period.key;
          for (const m of data.months) {
            const flags = data.reviewFlags.filter((fl) => flagMonth(fl) === m.period.key);
            parsed.push({
              ...common,
              id: `${id}-${m.period.key}`,
              name: `${name} · ${m.period.label}`,
              items: { ...m.items, businessType: typeForMode(m.items.businessType, mode) },
              detected: m.period.key,
              month: m.period.key,
              source: { id, name },
              ...(flags.length ? { reviewFlags: flags } : {}),
            });
          }
          notes.push(`${label}: covers ${data.months.length} months (${data.months[0].period.label} – ${data.months[data.months.length - 1].period.label}) — each month's rows were assigned to that month.`);
          continue;
        }
        const period = data.period;
        parsed.push({
          ...common,
          id,
          name: f ? documentName(f.name, { months: period ? [period.key] : [], documentKind: data.documentKind }) : `Pasted statement${period ? ` · ${period.label}` : ""}`,
          items: { ...data.items, businessType: typeForMode(data.items.businessType, mode) },
          detected: period?.key ?? "",
          month: period?.key ?? "",
          ...(data.reviewFlags.length ? { reviewFlags: data.reviewFlags } : {}),
        });
      } catch (e) {
        notes.push(`${label}: ${e instanceof Error ? e.message : "couldn't be read."}`);
      }
    }
    setProgress(null);
    setExtracting(false);
    if (balance) onBalanceDetected?.(balance);
    if (adding) {
      // Incremental upload: keep the review (month assignments, chosen type, logging choice) and add the new months.
      setBatchNotes((prev) => [...prev, ...notes]);
      if (!parsed.length) return;
      setFiles((cur) => [...cur, ...(opts.more ?? []).filter((f) => !cur.includes(f))]);
      setReview((r) => {
        if (!r) return r;
        const all = [...syncManualStatements(r.statements, r, personal), ...parsed];
        return buildReview(all, earlierFor(all, existingDocs, r.earlier), historyFor(all, existingDocs), mode, { ...r, statements: all, loggedKeys: [] });
      });
      return;
    }
    setBatchNotes(notes);
    if (!parsed.length) {
      setExtractError(notes.join(" ") || "Couldn't read the statement.");
      return;
    }
    const built = buildReview(parsed, earlierFor(parsed, existingDocs), historyFor(parsed, existingDocs), mode, undefined, syncedType ?? undefined);
    if (opts.direct && validRevenueRows(built.revenue).length > 0) {
      // "Skip review" in a workspace with earlier months: generate straight away, cumulatively.
      const { payload, extras } = reviewSubmission(built, personal);
      const ok = await onSubmit({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, payload.businessType, extras);
      if (ok) return;
    }
    setReview(built);
  };

  /** "Upload More Documents": inside a review the new files are read and folded in; otherwise they join the file list. */
  const moreInput = (
    <input
      ref={moreRef}
      type="file"
      accept={ACCEPT}
      multiple
      hidden
      aria-hidden
      tabIndex={-1}
      onChange={(e) => {
        const list = e.target.files ? Array.from(e.target.files) : [];
        e.target.value = "";
        if (!list.length) return;
        if (rawReview) void extract({ more: list });
        else {
          setInput("file");
          addFiles(list);
        }
      }}
    />
  );

  if (review) {
    return (
      <>
        {moreInput}
        <UploadReview
          mode={mode}
          review={review}
          setReview={setReview}
          notes={batchNotes}
          existingDocs={existingDocs}
          disabled={disabled}
          onBack={() => setReview(null)}
          trackerReady={trackerReady}
          onLogActuals={onLogActuals}
          onTypeChange={onTypeChange}
          onUploadMore={() => moreRef.current?.click()}
          uploadingMore={extracting ? (progress ? (progress.total > 1 ? `Reading ${progress.done + 1} of ${progress.total}…` : `Reading ${progress.name}…`) : "Reading…") : null}
          onGenerate={(payload, extras) => onSubmit({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, payload.businessType, extras)}
        />
      </>
    );
  }

  const single = input === "paste" || files.length === 1;
  /** Earlier months already saved here: a skipped review still reads the file, then folds those months in. */
  const hasHistory = existingDocs.some((d) => documentSlices(d).length > 0);
  const skipDirect = async () => {
    if (hasHistory) return extract({ direct: true });
    const f = input === "file" ? files[0] : null;
    const hash = await hashFile(f ?? new Blob([pasted], { type: "text/plain" }));
    await onSubmit(fileInit(f, false), businessType || undefined, {
      docFromAnalysis: { name: f ? documentName(f.name) : "Pasted statement", fileName: f?.name ?? null, fileSize: f?.size ?? null, contentHash: hash, kind: f ? "statement" : "pasted" },
    });
  };

  return (
    <div className={cn(glass, "flex h-full flex-col p-6")}>
      {moreInput}
      <div className="flex items-center gap-2">
        <Upload className="h-5 w-5 text-indigo-300" />
        <h2 className="text-lg font-semibold">{personal ? "Upload Bank / Card Statements" : "Upload Bank / P&L Statements"}</h2>
      </div>
      <p className="mt-1 text-sm text-slate-400">PDF, CSV or plain text — one statement or several months at once. Scanned PDFs work too.</p>

      <div className="mt-5 inline-flex self-start rounded-lg border border-white/10 p-0.5 text-sm">
        {(["file", "paste"] as const).map((m) => (
          <button key={m} onClick={() => setInput(m)} className={cn("rounded-md px-3 py-1.5", input === m ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200")}>
            {m === "file" ? "Upload files" : "Paste text"}
          </button>
        ))}
      </div>

      <div className="mt-4 flex-1">
        {input === "file" ? (
          <>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                addFiles(e.dataTransfer.files);
              }}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
              role="button"
              tabIndex={0}
              className={cn(
                "grid min-h-40 cursor-pointer place-items-center rounded-xl border-2 border-dashed p-6 text-center transition",
                dragOver ? "border-indigo-400 bg-indigo-500/10" : "border-white/15 hover:border-white/30 hover:bg-white/[0.03]",
              )}
            >
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                multiple
                hidden
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <div>
                <Upload className="mx-auto h-8 w-8 text-slate-500" />
                <p className="mt-2 text-sm text-slate-300">{files.length ? "Drop or click to add more statements" : "Drop statements here or click to browse"}</p>
                <p className="mt-1 text-xs text-slate-500">Any number of files, 15 MB each · multi-month reports (H1, quarterly, annual) are split into their months</p>
              </div>
            </div>
            {files.length > 0 && (
              <ul className="mt-3 max-h-48 space-y-1.5 overflow-y-auto overscroll-contain pr-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${f.size}-${f.lastModified}`} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-sm">
                    <FileText className="h-4 w-4 shrink-0 text-indigo-300" />
                    <span className="min-w-0 flex-1 truncate" title={f.name}>
                      {f.name}
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                    {progress && progress.name === f.name && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-indigo-300" />}
                    <button
                      type="button"
                      onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                      disabled={busy}
                      aria-label={`Remove ${f.name}`}
                      className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-500 hover:bg-white/5 hover:text-rose-300 disabled:opacity-40"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
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
          <select value={businessType} onChange={(e) => onTypeChange((e.target.value as BusinessType | "") || null)} className={cn(inputCls, "mt-1")}>
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
        <Lock className="mt-0.5 h-3 w-3 shrink-0" /> Encrypted in transit and parsed in memory. The file itself is never stored — only the parsed results, in your workspace.
      </p>

      {extractError && (
        <p role="alert" className="mt-4 flex items-start gap-1.5 text-sm text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {extractError}
        </p>
      )}

      <button onClick={() => void extract()} disabled={busy || !ready} className={cn(primaryBtn, "mt-4 py-2.5")}>
        {extracting && <Loader2 className="h-4 w-4 animate-spin" />}
        {extracting && progress
          ? progress.total > 1
            ? `Reading ${progress.done + 1} of ${progress.total}…`
            : "Reading line items…"
          : files.length > 1 && input === "file"
            ? `Extract & review ${files.length} statements`
            : "Extract & review line items"}
      </button>
      {single && (
        <button type="button" onClick={() => void skipDirect()} disabled={busy || !ready} className="mt-2 self-center text-xs text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline disabled:opacity-40">
          {hasHistory ? "Skip review — analyze together with earlier months" : "Skip review and analyze directly"}
        </button>
      )}
    </div>
  );
}

/**
 * P&L vs. raw statement guard: a month with both a P&L and a credit card / bank statement would otherwise count the
 * card's charges twice (once itemized, once inside the P&L totals). Lists each overlapping statement's lines with the
 * P&L line they likely roll into; they stay out of the totals until the owner confirms they're extra.
 */
function OverlapGuard({ overlaps, onConfirm }: { overlaps: StatementOverlap[]; onConfirm: (statementId: string, confirmed: boolean) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!overlaps.length) return null;
  const excluded = overlaps.filter((o) => !o.confirmed);
  return (
    <div role="status" className="mt-3 rounded-xl border border-rose-300/30 bg-rose-500/[0.06] px-3 py-2.5 text-xs">
      <p className="flex items-start gap-1.5 font-medium text-rose-100">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Potential duplicates: {overlaps.length === 1 ? "a raw statement covers" : `${overlaps.length} raw statements cover`} the same month as a P&amp;L
          {excluded.length ? ` — ${excluded.length === 1 ? "its" : "their"} revenue and expense lines are left out of the monthly totals so nothing is counted twice.` : "."}
        </span>
      </p>
      <ul className="mt-2 space-y-2">
        {overlaps.map((o) => {
          const matched = o.lines.filter((l) => l.matchedPnlLine).length;
          return (
            <li key={o.statementId} className="rounded-lg border border-white/10 bg-slate-900/40 px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 flex-1 text-slate-200">
                  <span className="font-medium">{o.statementName}</span>{" "}
                  <span className="text-slate-400">
                    · {DOCUMENT_KIND_LABELS[o.documentKind]} · {periodLabel(o.month)} · overlaps {o.pnlNames.join(", ")}
                  </span>
                </span>
                <span className={cn("tabular-nums", o.confirmed ? "text-slate-300" : "text-slate-500 line-through")} title={o.confirmed ? undefined : "Excluded from the monthly totals"}>
                  {exactMoney(o.revenue)} in · {exactMoney(o.expenses)} out
                </span>
              </div>
              <p className="mt-1 text-slate-400">
                {o.lines.length} line{o.lines.length === 1 ? "" : "s"}
                {matched ? `, ${matched} matching a P&L line` : ""} —{" "}
                {o.confirmed ? <span className="text-amber-200">counted on top of the P&amp;L (you confirmed)</span> : <span>excluded from totals</span>}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => setOpen((x) => (x === o.statementId ? null : o.statementId))} aria-expanded={open === o.statementId} className="text-indigo-300 hover:text-indigo-200">
                  {open === o.statementId ? "Hide lines" : "View overlapping lines"}
                </button>
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-slate-300">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-rose-400" checked={o.confirmed} onChange={(e) => onConfirm(o.statementId, e.target.checked)} />
                  These charges are not in the P&amp;L — count them too
                </label>
              </div>
              {open === o.statementId && (
                <ul className="mt-2 divide-y divide-white/5 tabular-nums">
                  {o.lines.map((l, i) => (
                    <li key={`${l.label}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1">
                      <span className="min-w-0 text-slate-300">
                        {l.label}
                        {l.category && <span className="text-slate-500"> · {l.category}</span>}
                        {l.matchedPnlLine ? <span className="text-rose-200"> · likely in P&amp;L &ldquo;{l.matchedPnlLine}&rdquo;</span> : <span className="text-slate-500"> · no matching P&amp;L line</span>}
                      </span>
                      <span className="text-slate-200">
                        {l.side === "revenue" ? "+" : ""}
                        {exactMoney(l.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {excluded.length > 0 && <p className="mt-2 text-[11px] text-slate-500">Excluded statements aren&apos;t saved to My Documents either, so a later rebuild can&apos;t double count them.</p>}
    </div>
  );
}

/** Post-upload step: the owner edits, re-categorizes, deletes or adds parsed lines, assigns months, then generates the report. */
/** Raw transactions the parser flagged (unrecognized merchants, duplicate transaction IDs, unusual charges). */
function ReviewFlagsList({ statements }: { statements: ParsedStatement[] }) {
  const flags = statements.flatMap((s) => (s.reviewFlags ?? []).map((f) => ({ ...f, from: s.source?.name ?? s.name })));
  const [open, setOpen] = useState(true);
  if (!flags.length) return null;
  const tone = { UNRECOGNIZED_MERCHANT: "text-amber-200", DUPLICATE_TRANSACTION: "text-rose-200", UNUSUAL_CHARGE: "text-sky-200" } as const;
  return (
    <div className="mt-3 rounded-xl border border-amber-300/25 bg-amber-400/[0.05] px-3 py-2 text-xs">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 text-left font-medium text-amber-100">
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {flags.length} transaction{flags.length === 1 ? "" : "s"} to double-check
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5">
          {flags.map((f, i) => (
            <li key={`${f.kind}-${f.merchant}-${f.date}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-slate-300">
              <span className={cn("font-medium", tone[f.kind])}>{REVIEW_FLAG_LABELS[f.kind]}</span>
              <span className="text-slate-100">{f.merchant}</span>
              <span className="tabular-nums">{exactMoney(f.amount)}</span>
              {f.date && <span className="text-slate-500">{f.date}</span>}
              {f.transactionId && <span className="font-mono text-[10px] text-slate-500">#{f.transactionId}</span>}
              <span className="basis-full text-slate-400">{f.note}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-slate-500">
        Each flagged charge is also highlighted on its line below{statements.length > 1 ? " (in its month)" : ""}. Flagged charges still count — remove or edit them if they shouldn&apos;t, or mark them &ldquo;Looks fine&rdquo;.
      </p>
    </div>
  );
}

const MONTH_CHIP = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const chipLabel = (key: string) => {
  const d = parseMonthKey(key);
  return d ? MONTH_CHIP.format(d) : "No month";
};

/**
 * Multi-month review: one tab per calendar month, each with that month's own itemized revenue and expense lines
 * (actual amounts, never averaged), so January and September can be inspected and edited independently.
 */
function MonthByMonthEditor({
  review,
  setReview,
  mode,
  onAddMonth,
}: {
  review: UploadReviewState;
  setReview: (fn: (r: UploadReviewState | null) => UploadReviewState | null) => void;
  mode: WorkspaceMode;
  /** Adds a blank, editable month ("YYYY-MM") to the review. */
  onAddMonth: (key: string) => void;
}) {
  const copy = MODE_COPY[mode];
  const active = review.monthRows.find((m) => m.id === review.activeMonth) ?? review.monthRows[0];
  if (!active) return null;
  const update = (fn: (m: MonthRows) => MonthRows) => setReview((r) => r && { ...r, monthRows: r.monthRows.map((m) => (m.id === active.id ? fn(m) : m)), rebuilt: false });
  const nameOf = (m: MonthRows) => (m.key ? periodLabel(m.key) : `No month yet · ${review.statements.find((s) => s.id === m.statementIds[0])?.name ?? "statement"}`);
  const attention = (m: MonthRows) => [...m.revenue, ...m.expenses].filter((r) => insightTone(r.insight)).length;
  const totals = reviewTotals(active);
  const idx = review.monthRows.indexOf(active);
  const go = (i: number) => {
    const m = review.monthRows[i];
    if (m) setReview((r) => r && { ...r, activeMonth: m.id });
  };

  return (
    <section aria-label="Line items by month" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-slate-200">Line items by month</h3>
          <p className="text-xs text-slate-400">Each month shows its own actual amounts. Edits apply to that month only.</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => go(idx - 1)} disabled={idx <= 0} aria-label="Previous month" className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 text-slate-300 hover:bg-white/5 disabled:opacity-30">
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => go(idx + 1)} disabled={idx >= review.monthRows.length - 1} aria-label="Next month" className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 text-slate-300 hover:bg-white/5 disabled:opacity-30">
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Top / right padding leaves room for the count badges: an overflow-x container clips anything outside it. */}
      <div role="group" aria-label="Choose a month" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 pr-2 pt-2">
        {review.monthRows.map((m) => {
          const t = reviewTotals(m);
          const n = attention(m);
          const on = m.id === active.id;
          return (
            <button
              key={m.id}
              type="button"
              aria-pressed={on}
              onClick={() => setReview((r) => r && { ...r, activeMonth: m.id })}
              title={`${nameOf(m)}: ${exactMoney(t.revenue)} in · ${exactMoney(t.expenses)} out${t.revenue === 0 ? ` · ${NO_REVENUE_NOTE}` : ""}${n ? ` · ${n} line${n === 1 ? "" : "s"} to check` : ""}${m.editable ? "" : " · saved earlier"}`}
              className={cn(
                "relative flex min-w-[6.5rem] shrink-0 flex-col items-start rounded-lg border px-2.5 py-1.5 text-left text-xs transition",
                on ? "border-indigo-300/60 bg-indigo-500/20 text-white" : "border-white/10 bg-white/[0.02] text-slate-300 hover:border-white/25",
                !m.editable && !on && "opacity-70",
              )}
            >
              <span className="flex items-center gap-1 font-medium">
                {chipLabel(m.key)}
                {!m.editable && <History className="h-3 w-3 text-slate-400" aria-label="saved earlier" />}
              </span>
              <span className="tabular-nums text-[10px] text-slate-400">
                {usdCompact.format(t.revenue)} in · {usdCompact.format(t.expenses)} out
              </span>
              {t.revenue === 0 && <span className="text-[10px] italic text-slate-500">No revenue this period</span>}
              {n > 0 && (
                <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-semibold text-slate-950" aria-label={`${n} to check`}>
                  {n}
                </span>
              )}
            </button>
          );
        })}
        <AddMonthControl existing={review.monthRows.map((m) => m.key)} onAdd={onAddMonth} chip />
      </div>

      <div className="rounded-xl border border-white/10 bg-slate-900/30 p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 flex-col">
            <p className="text-sm font-semibold text-slate-100">{nameOf(active)}</p>
            {totals.revenue === 0 && <ZeroRevenueNote />}
          </div>
          <p className="text-xs tabular-nums text-slate-400 sm:text-right">
            {exactMoney(totals.revenue)} in · {exactMoney(totals.expenses)} out
            {totals.oneTimeExpenses ? ` (${exactMoney(totals.oneTimeExpenses)} one-time)` : ""} · net {exactMoney(totals.revenue - totals.expenses)}
          </p>
        </div>
        {active.editable ? (
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <section aria-label={`${copy.revenue}, ${nameOf(active)}`} className="min-w-0">
              <h4 className="mb-2 text-sm font-medium text-slate-200">
                {copy.revenue}
                <InsightCounts rows={active.revenue} />
              </h4>
              <RevenueRowsEditor
                rows={active.revenue}
                setRows={(fn) => update((m) => ({ ...m, revenue: fn(m.revenue) }))}
                mode={mode}
                custom={review.businessType === "OTHER_CUSTOM"}
                hint="This month's actual amounts. Mark anything that won't repeat as one-time — it's logged in this month but left out of the forecast."
              />
            </section>
            <section aria-label={`${copy.expenses}, ${nameOf(active)}`} className="min-w-0">
              <h4 className="mb-2 text-sm font-medium text-slate-200">
                {copy.expenses}
                <InsightCounts rows={active.expenses} />
              </h4>
              <ExpenseRowsEditor
                rows={active.expenses}
                setRows={(fn) => update((m) => ({ ...m, expenses: fn(m.expenses) }))}
                revenue={active.revenue}
                mode={mode}
                businessType={review.businessType}
                hint="Change a category if it was misread; a blank category is auto-classified."
              />
            </section>
          </div>
        ) : (
          <div className="text-xs">
            <p className="mb-2 flex items-start gap-1.5 text-slate-400">
              <Info className="mt-0.5 h-3 w-3 shrink-0" /> Already saved in this workspace — included in the forecast average. Edit it from My Documents.
            </p>
            <ul className="divide-y divide-white/5 tabular-nums">
              {[
                ...validRevenueRows(active.revenue).map((r) => ({ id: r.id, label: r.label, sub: copy.revenue, amount: r.amount, oneTime: r.oneTime })),
                ...validExpenseRows(active.expenses).map((e) => ({ id: e.id, label: expenseLabel(e), sub: e.category || "Uncategorized", amount: e.amount, oneTime: e.oneTime })),
              ].map((l) => (
                <li key={l.id} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate text-slate-300">
                    {l.label} <span className="text-slate-500">· {l.sub}</span>
                    {l.oneTime && <span className="ml-1.5 rounded bg-amber-400/15 px-1 text-[10px] uppercase text-amber-200">one-time</span>}
                  </span>
                  <span className="shrink-0 text-slate-200">{exactMoney(Number(l.amount))}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

const NO_REVENUE_NOTE = "No revenue recorded in this statement period";

/** Muted note beside a $0-revenue month, so a seasonal dip doesn't read as a parsing error. */
function ZeroRevenueNote({ className }: { className?: string }) {
  return <span className={cn("text-[11px] italic text-slate-500", className)}>{NO_REVENUE_NOTE}</span>;
}

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The month after the latest one in `keys` (skipping any already taken), or the current month when there are none. */
function nextMonthKey(keys: string[], now = new Date()): string {
  const taken = new Set(keys.filter((k) => MONTH_KEY_RE.test(k)));
  const latest = [...taken].sort().pop();
  let d = latest ? new Date(Date.UTC(Number(latest.slice(0, 4)), Number(latest.slice(5, 7)), 1)) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  while (taken.has(monthKey(d))) d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return monthKey(d);
}

/**
 * "+ Add Month": opens an inline month / year picker (defaulting to the month after the latest one in the review) and
 * adds a blank, editable month for lines the statements didn't cover. `chip` styles it to sit at the end of the month chips.
 */
function AddMonthControl({ existing, onAdd, chip = false }: { existing: string[]; onAdd: (key: string) => void; chip?: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const inputId = useId();
  const taken = existing.includes(value);
  const valid = MONTH_KEY_RE.test(value) && !taken;
  const start = () => {
    setValue(nextMonthKey(existing));
    setOpen(true);
  };
  const submit = () => {
    if (!valid) return;
    onAdd(value);
    setOpen(false);
  };
  if (!open)
    return (
      <button
        type="button"
        onClick={start}
        className={cn(
          "inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-dashed border-indigo-300/40 text-xs text-indigo-200 transition hover:border-indigo-300/70 hover:bg-indigo-500/10",
          chip ? "min-w-[6.5rem] self-stretch px-2.5 py-1.5" : "px-2.5 py-1",
        )}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden /> Add Month
      </button>
    );
  return (
    <div
      role="group"
      aria-label="Add a month"
      className={cn("flex shrink-0 flex-col gap-1 rounded-lg border border-indigo-300/50 bg-indigo-500/10 px-2.5 py-1.5 text-xs", chip && "self-stretch")}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <div className="flex items-center gap-1.5">
        <label htmlFor={inputId} className="sr-only">
          Month and year to add
        </label>
        <input
          id={inputId}
          type="month"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          className={cn(inputCls, "w-auto py-1 text-xs [color-scheme:dark]")}
        />
        <button type="button" onClick={submit} disabled={!valid} className="rounded-md bg-indigo-500 px-2 py-1 font-medium text-white hover:bg-indigo-400 disabled:opacity-40">
          Add
        </button>
        <button type="button" onClick={() => setOpen(false)} aria-label="Cancel adding a month" className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-white/5 hover:text-white">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {taken && <span className="text-[10px] text-amber-200">{periodLabel(value)} is already in this review.</span>}
    </div>
  );
}

function UploadReview({
  mode,
  review,
  setReview,
  notes,
  existingDocs,
  disabled,
  onBack,
  onGenerate,
  trackerReady,
  onLogActuals,
  onTypeChange,
  onUploadMore,
  uploadingMore,
}: {
  mode: WorkspaceMode;
  review: UploadReviewState;
  setReview: (fn: (r: UploadReviewState | null) => UploadReviewState | null) => void;
  notes: string[];
  existingDocs: WorkspaceDocument[];
  disabled: boolean;
  onBack: () => void;
  onGenerate: (payload: FormPayload, extras: AnalysisExtras) => Promise<boolean>;
  trackerReady: boolean;
  onLogActuals: (key: string, actual: MonthActual) => string;
  /** Keeps the setup wizard on the same business type as this dropdown. */
  onTypeChange: (bt: BusinessType) => void;
  /** Opens the file picker to add more statements (other months) to this review. */
  onUploadMore: () => void;
  /** Progress text while added statements are being read; null when idle. */
  uploadingMore: string | null;
}) {
  const personal = mode === "PERSONAL";
  const copy = MODE_COPY[mode];
  const { businessType, revenue, expenses } = review;
  const multiMonth = review.monthRows.length > 0;
  // Several months: the summary shows the live forward baseline, averaged from each month's edited rows.
  const baselineRows = useMemo(() => {
    if (!review.monthRows.length) return null;
    const b = reviewBaseline(review, personal);
    return itemsToRows({ revenue: b.revenue.map((r) => ({ ...r, margin: r.margin ?? Number.NaN })), expenses: b.expenses }, personal);
  }, [review, personal]);
  const summaryRows = baselineRows ?? { revenue, expenses };
  const validRevenue = validRevenueRows(summaryRows.revenue);
  const validExpenses = validExpenseRows(effectiveExpenses(summaryRows.expenses, summaryRows.revenue));
  const setRevenue = (fn: (rows: FormRevenue[]) => FormRevenue[]) => setReview((r) => r && { ...r, revenue: fn(r.revenue), rebuilt: false });
  const setExpenses = (fn: (rows: FormExpense[]) => FormExpense[]) => setReview((r) => r && { ...r, expenses: fn(r.expenses), rebuilt: false });
  const [logNote, setLogNote] = useState<string | null>(null);
  const batch = review.statements.length > 1 || review.earlier.length > 0;
  const toLog = monthActuals(review);
  const pendingLog = toLog.filter((m) => !review.loggedKeys.includes(m.key));
  const unassigned = review.statements.filter((s) => !s.month).length;
  const canLog = trackerReady && pendingLog.some((m) => m.actual.revenue > 0 || m.actual.expenses > 0);

  /** Re-assign a statement's month (or include / exclude an earlier document) and rebuild. */
  const restructure = (statements: ParsedStatement[], earlierPrev: EarlierStatement[]) => {
    setLogNote(null);
    const earlier = earlierFor(statements, existingDocs, earlierPrev);
    const history = historyFor(statements, existingDocs);
    setReview((r) => {
      if (!r) return r;
      // One statement, nothing to fold in: just re-label the month and keep the owner's edited rows.
      // (Coming from a month-by-month review, e.g. after removing a statement, rebuild instead so no stale month tabs stay.)
      if (statements.length === 1 && !r.monthRows.length && !earlier.length && !r.earlier.length && !(r.cumulative && (history.length || r.history.length))) {
        const m = statements[0].month;
        return { ...r, statements, history, months: [{ key: m, actual: reviewTotals(r), statementIds: [statements[0].id] }], logToTracker: !!m, loggedKeys: [] };
      }
      return buildReview(syncManualStatements(statements, r, personal), earlier, history, mode, { ...r, loggedKeys: [] });
    });
  };
  const setCumulative = (cumulative: boolean) => {
    setLogNote(null);
    setReview((r) => r && buildReview(syncManualStatements(r.statements, r, personal), r.earlier, r.history, mode, { ...r, cumulative }));
  };
  /**
   * "+ Add Month": a blank, editable month for figures no uploaded statement covers. It's backed by a hand-entered
   * statement (kind "form") so it survives later rebuilds and is saved like any other month. Inserted in place rather
   * than rebuilt, so edits already made to other months are kept; a single-month review becomes month by month.
   */
  const addMonth = (key: string) => {
    setLogNote(null);
    setReview((r) => {
      if (!r || !MONTH_KEY_RE.test(key)) return r;
      const existing = r.monthRows.find((m) => m.key === key);
      if (existing) return { ...r, activeMonth: existing.id };
      if (!r.monthRows.length && r.months.some((m) => m.key === key)) return r;
      const manual: ParsedStatement = {
        id: `manual-${key}-${newId()}`,
        name: `Manual entry · ${periodLabel(key)}`,
        fileName: null,
        fileSize: null,
        contentHash: null,
        kind: "form",
        items: { businessType: r.businessType, revenue: [], expenses: [] },
        detected: "",
        month: key,
      };
      const current: MonthRows[] = r.monthRows.length
        ? r.monthRows
        : r.months.slice(0, 1).map((m) => ({
            id: m.key || `?${m.statementIds[0]}`,
            key: m.key,
            statementIds: m.statementIds,
            editable: m.statementIds.some((id) => !isHistoryId(id)),
            revenue: r.revenue,
            expenses: r.expenses,
          }));
      const added: MonthRows = { id: key, key, statementIds: [manual.id], editable: true, revenue: [blankRevenue()], expenses: [blankExpense()] };
      const byKey = (a: { key: string }, b: { key: string }) => (a.key || "9999").localeCompare(b.key || "9999");
      return {
        ...r,
        statements: [...r.statements, manual],
        monthRows: [...current, added].sort(byKey),
        months: [...r.months, { key, actual: statementTotals({ revenue: [], expenses: [] }), statementIds: [manual.id] }].sort(byKey),
        activeMonth: added.id,
        logToTracker: r.logToTracker || r.months.length === 0,
        rebuilt: false,
      };
    });
  };
  const historyMonths = [...new Set(review.history.map((h) => h.month))].sort();
  /** Unconfirmed P&L duplicates: neither their revenue nor their expenses are in any month's totals. */
  const excludedIds = new Set(review.overlaps.filter((o) => !o.confirmed).map((o) => o.statementId));

  const logNow = () => {
    if (!canLog) return;
    const lines = pendingLog.map((m) => onLogActuals(m.key, m.actual));
    setLogNote(lines.length === 1 ? lines[0] : `Logged ${lines.length} months: ${pendingLog.map((m) => periodLabel(m.key)).join(", ")}. Goal pace and projections updated.`);
    setReview((r) => r && { ...r, loggedKeys: [...r.loggedKeys, ...pendingLog.map((m) => m.key)] });
  };
  const generate = async () => {
    const { payload, extras } = reviewSubmission(review, personal);
    await onGenerate(payload, extras);
  };

  return (
    <div className={cn(glass, "flex h-full flex-col p-6")}>
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardList className="h-5 w-5 text-indigo-300" />
        <h2 className="flex-1 text-lg font-semibold">Review parsed line items</h2>
        <button type="button" onClick={onUploadMore} disabled={disabled || !!uploadingMore} className={cn(primaryBtn, "px-3 py-1.5 text-xs")} title="Add statements for other months (or another account) to this review">
          {uploadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {uploadingMore ?? "Upload More Documents"}
        </button>
      </div>
      <p className="mt-1 text-sm text-slate-400">
        {(() => {
          const read = review.statements.filter((s) => s.kind !== "form");
          const files = new Set(read.map((s) => s.source?.id ?? s.id)).size;
          if (files === read.length) return read.length > 1 ? `We read ${files} statements. ` : "";
          return `We read ${files} document${files === 1 ? "" : "s"} covering ${read.length} month entries. `;
        })()}
        {multiMonth
          ? `Line items are itemized month by month across ${review.monthRows.length} months${review.cumulative && historyMonths.length ? ` (${historyMonths.length} of them already saved in this workspace)` : ""} — pick a month to inspect and edit it on its own. The forecast uses the average of the recurring lines; one-time items stay in their month.`
          : `We read ${revenue.length + expenses.length} line${revenue.length + expenses.length === 1 ? "" : "s"}.`}{" "}
        Fix amounts or categories, delete anything that doesn&apos;t belong, add what&apos;s missing — then generate the report. Highlighted lines need a look.
      </p>
      {notes.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg border border-amber-300/25 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-100">
          {notes.map((n) => (
            <li key={n} className="flex items-start gap-1.5">
              <Info className="mt-0.5 h-3 w-3 shrink-0" /> {n}
            </li>
          ))}
        </ul>
      )}

      {/* Statements and their months */}
      <section aria-label="Statements" className="mt-4 rounded-xl border border-indigo-300/25 bg-indigo-500/[0.06] p-4">
        {!batch ? (
          <StatementMonthPicker
            detected={review.statements[0].detected ? { key: review.statements[0].detected, label: periodLabel(review.statements[0].detected), source: "text", confidence: "high" } : null}
            value={review.statements[0].month}
            onChange={(month) => restructure([{ ...review.statements[0], name: renameForMonth(review.statements[0], month), month }], review.earlier)}
          />
        ) : (
          <>
            <p className="text-xs font-medium uppercase tracking-wide text-indigo-200">Statements in this upload</p>
            <ul className="mt-2 space-y-1.5">
              {review.statements.map((s) => {
                const t = statementTotals({ revenue: s.items.revenue, expenses: s.items.expenses });
                const dropped = excludedIds.has(s.id);
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-slate-900/40 px-2.5 py-2 text-xs">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-indigo-300" />
                    <span className="min-w-0 flex-1 truncate text-slate-200" title={s.fileName ?? s.name}>
                      {s.name}
                    </span>
                    <span className={cn("tabular-nums", dropped ? "text-slate-500 line-through" : "text-slate-400")} title={dropped ? "Potential duplicate of a P&L — excluded from the monthly totals" : undefined}>
                      {exactMoney(t.revenue)} in · {exactMoney(t.expenses)} out
                    </span>
                    {dropped && <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-rose-200">excluded</span>}
                    <select
                      aria-label={`Month for ${s.name}`}
                      value={s.month}
                      onChange={(e) => restructure(review.statements.map((x) => (x.id === s.id ? { ...x, name: renameForMonth(x, e.target.value), month: e.target.value } : x)), review.earlier)}
                      className={cn(inputCls, "w-auto py-1 pr-7 text-xs", !s.month && "border-amber-300/50")}
                    >
                      {/* A month read from a multi-month document always keeps a month (it can be moved, not cleared). */}
                      {!s.source && <option value="">Pick a month…</option>}
                      {statementMonthOptions(s.detected || null).map((k) => (
                        <option key={k} value={k}>
                          {periodLabel(k)}
                          {k === s.detected ? " (detected)" : ""}
                        </option>
                      ))}
                    </select>
                    {review.statements.length > 1 && (
                      <button
                        type="button"
                        onClick={() => restructure(review.statements.filter((x) => x.id !== s.id), review.earlier)}
                        aria-label={`Leave out ${s.name}`}
                        className="grid h-6 w-6 place-items-center rounded text-slate-500 hover:bg-white/5 hover:text-rose-300"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {review.earlier.length > 0 && (
              <>
                <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-400">Already in this workspace for the same months</p>
                <ul className="mt-1.5 space-y-1.5">
                  {review.earlier.map((e) => (
                    <li key={e.id}>
                      <label className="flex cursor-pointer flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2 text-xs">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-indigo-400"
                          checked={e.include}
                          onChange={(ev) => restructure(review.statements, review.earlier.map((x) => (x.id === e.id ? { ...x, include: ev.target.checked } : x)))}
                        />
                        <span className="min-w-0 flex-1 truncate text-slate-300">{e.name}</span>
                        <span className="text-slate-500">{periodLabel(e.month)} · from My Documents</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-slate-500">Included documents are added into that month (e.g. checking + credit card), with identical lines counted once.</p>
              </>
            )}
          </>
        )}

        {review.history.length > 0 && (
          <div className="mt-3 rounded-lg border border-emerald-300/25 bg-emerald-500/[0.06] px-3 py-2.5 text-xs">
            <label className="flex cursor-pointer items-start gap-2 text-slate-200">
              <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-emerald-400" checked={review.cumulative} onChange={(e) => setCumulative(e.target.checked)} />
              <span>
                <span className="font-medium">
                  Combine with {historyMonths.length} earlier month{historyMonths.length === 1 ? "" : "s"} already in this workspace
                </span>{" "}
                <span className="text-slate-400">
                  ({historyMonths.length === 1 ? periodLabel(historyMonths[0]) : `${periodLabel(historyMonths[0])} – ${periodLabel(historyMonths[historyMonths.length - 1])}`})
                </span>
              </span>
            </label>
            <p className="mt-1 pl-5 text-[11px] text-slate-400">
              {review.cumulative
                ? "The report and forecast cover every month so far. Earlier months stay saved and aren't re-logged; the previous report is kept in Report history."
                : "This report covers only this upload. Earlier months stay saved in My Documents either way."}
            </p>
          </div>
        )}

        <OverlapGuard
          overlaps={review.overlaps}
          onConfirm={(id, confirmOverlap) => restructure(review.statements.map((x) => (x.id === id ? { ...x, confirmOverlap } : x)), review.earlier)}
        />

        <ReviewFlagsList statements={review.statements} />

        {(review.duplicateLines > 0 || review.excludedOneTime > 0 || review.rebuilt) && (
          <ul className="mt-3 space-y-1 text-[11px] text-slate-400">
            {review.duplicateLines > 0 && <li>• {review.duplicateLines} identical line{review.duplicateLines === 1 ? "" : "s"} found in two statements for the same month — counted once.</li>}
            {review.excludedOneTime > 0 && <li>• {review.excludedOneTime} past one-time item{review.excludedOneTime === 1 ? " is" : "s are"} logged in {review.excludedOneTime === 1 ? "its" : "their"} month but left out of the monthly baseline.</li>}
            {review.rebuilt && <li>• Line items were rebuilt for the new month assignment.</li>}
          </ul>
        )}

        {/* What gets logged */}
        <div className="mt-3 border-t border-white/10 pt-3 text-xs">
          {toLog.length > 0 && (
            <ul className="mb-2 space-y-1 tabular-nums text-slate-400">
              {toLog.map((m) => (
                <li key={m.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4">
                  {/* Label + auxiliary note stack on the left so the totals column stays aligned on the right. */}
                  <span className="flex min-w-0 flex-col">
                    <span className="text-slate-300">
                      {periodLabel(m.key)}
                      {review.loggedKeys.includes(m.key) && <span className="ml-1 text-emerald-300">· logged ✓</span>}
                    </span>
                    {m.actual.revenue === 0 && <ZeroRevenueNote className="leading-tight" />}
                  </span>
                  <span className="whitespace-nowrap text-right">
                    {exactMoney(m.actual.revenue)} in · {exactMoney(m.actual.expenses)} out
                    {m.actual.oneTimeExpenses ? <span className="block text-[11px] text-slate-500">({exactMoney(m.actual.oneTimeExpenses)} one-time)</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="inline-flex cursor-pointer items-center gap-2 text-slate-300">
              <input type="checkbox" className="h-4 w-4 accent-indigo-400" checked={review.logToTracker} disabled={!toLog.length} onChange={(e) => setReview((r) => r && { ...r, logToTracker: e.target.checked })} />
              {toLog.length > 1 ? `Log these ${toLog.length} months as actuals in the Fiscal Year Tracker` : `Log these totals as ${toLog[0] ? periodLabel(toLog[0].key) : "this month's"} actuals in the Fiscal Year Tracker`}
            </label>
            <button
              type="button"
              onClick={logNow}
              disabled={!canLog}
              className="ml-auto rounded-lg border border-indigo-300/30 px-2.5 py-1 text-indigo-100 hover:bg-indigo-400/10 disabled:opacity-40"
              title={trackerReady ? "Log now without generating a report" : "The tracker is still loading"}
            >
              {toLog.length && !pendingLog.length ? "Logged ✓" : "Log now"}
            </button>
          </div>
          {unassigned > 0 && (
            <p className="mt-2 text-[11px] text-amber-200">
              {unassigned} statement{unassigned === 1 ? " has" : "s have"} no month yet — pick one so {unassigned === 1 ? "it" : "they"} can be logged{batch ? " and averaged correctly" : ""}.
            </p>
          )}
          {logNote && (
            <p role="status" className="mt-2 flex items-start gap-1.5 text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {logNote}
            </p>
          )}
          <p className="mt-2 text-[11px] text-slate-500">Logging replaces that month&apos;s actuals (never adds to them), so re-uploading a month can&apos;t double count it.</p>
        </div>
      </section>

      {!personal && (
        <label className="mt-4 block text-sm">
          <span className="text-slate-400">Business type</span>
          <select
            value={businessType}
            onChange={(e) => {
              const bt = e.target.value as BusinessType;
              setReview((r) => r && { ...r, businessType: bt });
              onTypeChange(bt);
            }}
            className={cn(inputCls, "mt-1")}
          >
            {BUSINESS_ONLY_TYPES.map((bt) => (
              <option key={bt} value={bt}>
                {BUSINESS_TYPE_LABELS[bt]}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="mt-5 flex-1 space-y-6">
        {multiMonth ? (
          <MonthByMonthEditor review={review} setReview={setReview} mode={mode} onAddMonth={addMonth} />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-400">{review.months[0]?.key ? `Line items for ${periodLabel(review.months[0].key)}.` : "Line items for this statement."} Missing a month? Add it and enter its lines by hand.</p>
              <AddMonthControl existing={review.months.map((m) => m.key)} onAdd={addMonth} />
            </div>
            {/* Revenue on the left, expenses on the right; stacked on narrow screens. */}
            <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
              <section aria-label={copy.revenue} className="min-w-0">
                <h3 className="mb-2 text-sm font-medium text-slate-200">
                  {copy.revenue}
                  <InsightCounts rows={revenue} />
                </h3>
                <RevenueRowsEditor rows={revenue} setRows={setRevenue} mode={mode} custom={businessType === "OTHER_CUSTOM"} hint="Recurring lines are monthly amounts; one-time lines are the full single amount." />
              </section>
              <section aria-label={copy.expenses} className="min-w-0">
                <h3 className="mb-2 text-sm font-medium text-slate-200">
                  {copy.expenses}
                  <InsightCounts rows={expenses} />
                </h3>
                <ExpenseRowsEditor rows={expenses} setRows={setExpenses} revenue={revenue} mode={mode} businessType={businessType} hint="Change a category if it was misread; a blank category is auto-classified." />
              </section>
            </div>
          </>
        )}
        {/* Baseline summary spans both columns, with the actions pinned beneath it. */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          {baselineRows && (
            <div className="mb-3">
              <p className="text-sm font-medium text-slate-200">Forecast baseline · average of {review.monthRows.length} months</p>
              <p className="mt-0.5 text-xs text-slate-400">
                Recurring lines averaged across every month above (a line missing from a month counts as $0 there); one-time lines are logged in their own month only. Updates as you edit.
              </p>
            </div>
          )}
          <ReviewSummary mode={mode} businessType={businessType} revenue={validRevenue} expenses={validExpenses} />
          {baselineRows && validRevenue.length + validExpenses.length > 0 && (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer select-none text-indigo-300 hover:text-indigo-200">View the averaged baseline lines</summary>
              <ul className="mt-2 divide-y divide-white/5 tabular-nums">
                {[...validRevenue.map((r) => ({ id: r.id, label: r.label, sub: copy.revenue, amount: r.amount })), ...validExpenses.map((e) => ({ id: e.id, label: expenseLabel(e), sub: e.category || "Uncategorized", amount: e.amount }))].map((l) => (
                  <li key={l.id} className="flex items-baseline justify-between gap-3 py-1">
                    <span className="min-w-0 truncate text-slate-300">
                      {l.label} <span className="text-slate-500">· {l.sub}</span>
                    </span>
                    <span className="shrink-0 text-slate-200">{exactMoney(Number(l.amount))}/mo</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>

      {validRevenue.length === 0 && <p className="mt-4 text-sm text-amber-200">Add at least one {personal ? "income" : "revenue"} line with an amount to generate the report.</p>}

      {/* Action bar: full width under both columns, kept in view while scrolling long line lists. */}
      <div className="sticky bottom-0 z-10 -mx-6 -mb-6 mt-6 flex items-center justify-between gap-3 rounded-b-2xl border-t border-white/10 bg-slate-950/85 px-6 py-4 backdrop-blur">
        <button type="button" onClick={onBack} disabled={disabled} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-30">
          <ArrowLeft className="h-4 w-4" /> Back to upload
        </button>
        <button type="button" onClick={() => void generate()} disabled={disabled || validRevenue.length === 0} className={primaryBtn}>
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
          {busy === "unlock" && <Loader2 className="h-4 w-4 animate-spin" />} Use 1 of {creditsLabel(access.reportUnlocks)}
        </button>
      ) : (
        !paywall.isPro && (
          <button onClick={paywall.openCheckout} disabled={!!busy} className={cn(primaryBtn, "shadow-lg shadow-indigo-500/25")}>
            <Sparkles className="h-4 w-4" /> Unlock Pro Dashboard · from ${PRICING.proMonthlyUsd}/mo
          </button>
        )
      )}
      {canSpendCredit && !paywall.isPro && (
        <button onClick={paywall.openCheckout} disabled={!!busy} className={cn(secondaryBtn, "border-amber-300/30 text-amber-100 hover:bg-amber-400/10")}>
          <Sparkles className="h-4 w-4" /> See Pro plans
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
          the potential-savings total, the interactive Pro dashboard, rolling projections, audit deep-dives and the executive report are locked.
        </p>
        {paywall.message && <p className="mt-2 text-sm text-amber-200">{paywall.message}</p>}
      </div>
      <PaywallButtons paywall={paywall} />
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

/** Rounds a domain outward to "nice" steps so lines fill the plot instead of hugging one edge (e.g. 70k–85k, not 0–85k). */
function niceDomain(values: number[], { includeZero = false } = {}): [number, number] {
  const vs = values.filter(Number.isFinite);
  if (!vs.length) return [0, 1];
  let lo = Math.min(...vs, ...(includeZero ? [0] : []));
  let hi = Math.max(...vs, ...(includeZero ? [0] : []));
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  const span = hi - lo;
  // Pad 8% each side, then snap to a step of 1/2/2.5/5 × 10^n.
  lo -= span * 0.08;
  hi += span * 0.08;
  const raw = (hi - lo) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? raw;
  let min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  // All-positive data never gets a negative axis.
  if (Math.min(...vs) >= 0 && min < 0) min = 0;
  return [min, max];
}

function ProjectionCharts({
  analysis,
  settings,
  onSettingsChange,
  cpi,
  inflationLabel,
  actuals,
  basis,
  basisChoice,
  onBasisChange,
  actualsAgg,
  granularity = "MONTHLY",
  onGranularityChange,
}: {
  analysis: FinancialAnalysis;
  settings: ForecastSettings;
  onSettingsChange: (s: ForecastSettings) => void;
  cpi: CpiReading | null;
  inflationLabel: string;
  /** Logged monthly actuals, for fitting the seasonal curve. */
  actuals?: Record<string, MonthActual>;
  /** What the projection is running on right now. */
  basis: "ACTUALS" | "REPORT";
  basisChoice: ProjectionBasis;
  onBasisChange: (b: ProjectionBasis) => void;
  actualsAgg: ActualsAggregate | null;
  /** Time increment the chart, table and summary are bucketed into. */
  granularity?: Granularity;
  onGranularityChange?: (g: Granularity) => void;
}) {
  const { rows: monthRows } = useDerived(analysis);
  const [showTable, setShowTable] = useState(false);
  const copy = MODE_COPY[modeOf(analysis.businessType)];
  const months = settings.months;
  const long = months > 12;
  const gradId = useId().replace(/[^a-zA-Z0-9]/g, "");

  // Re-bucket the monthly projection into weeks / days (each month paced evenly over its calendar days). Falls back
  // to months if a projection label can't be read as a calendar month.
  const periods = useMemo(() => {
    const keys = monthRows.map((r) => labelToKey(r.month));
    const usable = keys.every((k): k is string => !!k);
    const g: Granularity = usable ? granularity : "MONTHLY";
    if (g === "MONTHLY") return { g, rows: monthRows.map((r) => ({ ...r, tick: monthTick(long)(r.month), days: 0 })) };
    const out = toPeriods(
      monthRows.map((r, i) => ({ key: keys[i]!, revenue: r.projectedRevenue, expenses: r.projectedExpenses, projected: true })),
      g,
    ).map((p) => ({ month: p.label, tick: long ? `${p.tick} '${p.label.slice(-2)}` : p.tick, days: p.days, projectedRevenue: p.revenue, projectedExpenses: p.expenses, net: p.net, cumulative: p.cumulative }));
    return { g, rows: out };
  }, [monthRows, granularity, long]);
  const rows = periods.rows;
  const granular = periods.g !== "MONTHLY";
  const unit = GRANULARITY_UNIT[periods.g];
  const Unit = unit[0].toUpperCase() + unit.slice(1);
  const ticks = useMemo(() => new Map(rows.map((r) => [r.month, r.tick])), [rows]);
  const tickOf = (m: string) => ticks.get(m) ?? m;
  const pace = useMemo(
    () =>
      granular
        ? paceOf(
            rows.map((r) => ({ label: r.month, tick: r.tick, days: r.days, revenue: r.projectedRevenue, expenses: r.projectedExpenses, net: r.net, cumulative: r.cumulative, projected: true })),
            periods.g,
          )
        : null,
    [rows, granular, periods.g],
  );

  // Profit band (revenue above expenses) and loss band (expenses above revenue) as [low, high] ranges, so the gap
  // between the two lines is shaded green or red. Both stay continuous (zero height where they don't apply).
  const chartRows = rows.map((r) => ({
    ...r,
    profitBand: [r.projectedExpenses, Math.max(r.projectedRevenue, r.projectedExpenses)] as [number, number],
    lossBand: [r.projectedRevenue, Math.max(r.projectedRevenue, r.projectedExpenses)] as [number, number],
  }));
  const lineDomain = niceDomain(rows.flatMap((r) => [r.projectedRevenue, r.projectedExpenses]));
  const cumDomain = niceDomain(
    rows.map((r) => r.cumulative),
    { includeZero: true },
  );

  // Summary stats for the header.
  const totalNet = rows.reduce((acc, r) => acc + r.net, 0);
  const avgNet = rows.length ? totalNet / rows.length : 0;
  const profitable = rows.filter((r) => r.net >= 0).length;
  const best = rows.reduce<(typeof rows)[number] | null>((b, r) => (!b || r.net > b.net ? r : b), null);
  const worst = rows.reduce<(typeof rows)[number] | null>((b, r) => (!b || r.net < b.net ? r : b), null);
  const spread = !!best && !!worst && best.month !== worst.month;

  return (
    <div className={cn(glass, "p-6")}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-start">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            {months}-Month Projection{granular && <span className="font-normal text-slate-400"> · {GRANULARITY_LABELS[periods.g].toLowerCase()}</span>}
            <InfoTip label="How the projection works" align="left">
              Each month repeats your recurring line items; one-time items land in month 1 and partial lines are pro-rated there. %-of-revenue expenses move with their
              revenue line. With two or more logged months, the projection uses their average (switch below). Seasonality and inflation are off unless you switch them on.
              Weekly and Daily views spread each projected month evenly over its calendar days — weeks are 7-day blocks from the first projected day, and the last
              one can be shorter.
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

        {/* Top-center summary: the projection at a glance. */}
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4" aria-label="Projection summary">
          <SummaryStat
            label={`Avg ${unit === "day" ? "daily" : `${unit}ly`} ${(pace?.net ?? avgNet) >= 0 ? "profit" : "loss"}`}
            value={signedUsd(pace?.net ?? avgNet)}
            tone={(pace?.net ?? avgNet) >= 0 ? "good" : "bad"}
            title={granular ? `Per full ${unit}, weighted by calendar days` : undefined}
          />
          <SummaryStat label={`${months}-mo total net`} value={signedUsd(totalNet)} tone={totalNet >= 0 ? "good" : "bad"} />
          <SummaryStat label={`Profitable ${unit}s`} value={`${profitable} of ${rows.length}`} tone={profitable === rows.length ? "good" : profitable === 0 ? "bad" : undefined} />
          <SummaryStat
            label={spread ? `Best / worst ${unit}` : `${Unit} net`}
            value={best ? (spread && worst ? `${tickOf(best.month)} / ${tickOf(worst.month)}` : signedUsd(best.net)) : "—"}
            title={best && worst ? `Best: ${best.month} ${signedUsd(best.net)} · Worst: ${worst.month} ${signedUsd(worst.net)}` : undefined}
          />
        </dl>

        <div className="flex flex-wrap items-center gap-2 justify-self-start lg:flex-col lg:items-end lg:justify-self-end">
          {onGranularityChange && <GranularityToggle value={granularity} onChange={onGranularityChange} />}
          <button onClick={() => setShowTable((s) => !s)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">
            {showTable ? "Show chart" : "Show table"}
          </button>
        </div>
      </div>

      {pace && (
        <div className="mt-4">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Average pace per {unit} over the projection</p>
          <PaceStrip pace={pace} granularity={periods.g} revenueLabel={copy.revenue} />
        </div>
      )}

      {/* Projection basis: the latest report vs every logged month. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-xs">
        <span className="text-slate-400">Projection based on</span>
        <div role="radiogroup" aria-label="Projection basis" className="inline-flex flex-wrap rounded-lg border border-white/10 bg-slate-900/60 p-0.5">
          {(
            [
              ["AUTO", "Auto"],
              ["ACTUALS", actualsAgg ? `Avg of ${actualsAgg.months} logged month${actualsAgg.months === 1 ? "" : "s"}` : "Logged actuals"],
              ["REPORT", "This report's line items"],
            ] as const
          ).map(([b, label]) => (
            <button
              key={b}
              type="button"
              role="radio"
              aria-checked={basisChoice === b}
              disabled={b === "ACTUALS" && !actualsAgg}
              onClick={() => onBasisChange(b)}
              className={cn("rounded-md px-2.5 py-1 font-medium transition disabled:opacity-40", basisChoice === b ? "bg-indigo-500/80 text-white" : "text-slate-400 hover:text-slate-200")}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="min-w-0 text-slate-400">
          {basis === "ACTUALS" && actualsAgg ? (
            <>
              Using {exactMoney(actualsAgg.revenue)} in / {exactMoney(actualsAgg.expenses)} out per month, averaged over {periodLabel(actualsAgg.first)}
              {actualsAgg.months > 1 ? ` – ${periodLabel(actualsAgg.last)}` : ""}
              {actualsAgg.oneTimeExcluded > 0 ? ` (one-time costs of ${exactMoney(actualsAgg.oneTimeExcluded)} left out)` : ""}.
            </>
          ) : actualsAgg ? (
            <>Using this report&apos;s line items.{basisChoice === "AUTO" ? " Log one more month to switch to your actuals average automatically." : ""}</>
          ) : (
            <>Using this report&apos;s line items — log monthly actuals in the Fiscal Year tab to project from your real average.</>
          )}
        </span>
      </div>

      <ForecastControls settings={settings} onChange={onSettingsChange} cpi={cpi} className="mt-4" businessType={analysis.businessType} actuals={actuals} />

      {showTable ? (
        <div className="relative mt-4 max-h-[32rem] overflow-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="sticky top-0 z-20 bg-slate-900 text-left text-xs uppercase text-slate-400 shadow-[0_1px_0_rgba(255,255,255,0.08)]">
              <tr>
                <th className="py-2 font-medium">{Unit}</th>
                <th className="py-2 text-right font-medium">{copy.revenue}</th>
                <th className="py-2 text-right font-medium">{copy.expenses}</th>
                <th className="py-2 text-right font-medium">Net</th>
                {granular && (
                  <th className="py-2 text-right font-medium" title={`Extra ${copy.revenue.toLowerCase()} needed that ${unit} to cover its costs`}>
                    To break even
                  </th>
                )}
                <th className="py-2 text-right font-medium">Cumulative</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r) => (
                <tr key={r.month}>
                  <td className="py-2 text-slate-300">
                    {r.month}
                    {periods.g === "WEEKLY" && r.days < 7 && <span className="text-xs text-slate-500"> ({r.days} days)</span>}
                  </td>
                  <td className="py-2 text-right">{usd.format(r.projectedRevenue)}</td>
                  <td className="py-2 text-right">{usd.format(r.projectedExpenses)}</td>
                  <td className={cn("py-2 text-right", r.net < 0 ? "text-rose-300" : "text-emerald-300")}>{usd.format(r.net)}</td>
                  {granular && <td className={cn("py-2 text-right", r.net < 0 ? "text-rose-300" : "text-slate-500")}>{r.net < 0 ? usd.format(-r.net) : "—"}</td>}
                  <td className={cn("py-2 text-right", r.cumulative < 0 && "text-rose-300")}>{usd.format(r.cumulative)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="mt-4 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartRows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="month" {...axisProps} tickFormatter={tickOf} minTickGap={16} />
                <YAxis {...axisProps} width={72} domain={lineDomain} tickCount={6} tickFormatter={(v: number) => usdCompact.format(v)} />
                <Tooltip content={<ProjectionTooltip revenueLabel={copy.revenue} expensesLabel={copy.expenses} />} cursor={{ stroke: CHART.cursor }} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: CHART.legend }} />
                <Area name="Profit gap" type="linear" dataKey="profitBand" stroke="none" fill={COLOR.gain} fillOpacity={0.22} isAnimationActive={false} activeDot={false} legendType="square" />
                <Area name="Loss gap" type="linear" dataKey="lossBand" stroke="none" fill={COLOR.loss} fillOpacity={0.25} isAnimationActive={false} activeDot={false} legendType="square" />
                <Line name={`Projected ${copy.revenue.toLowerCase()}`} type="linear" dataKey="projectedRevenue" stroke={COLOR.revenue} strokeWidth={2.25} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.surface }} />
                <Line name={`Projected ${copy.expenses.toLowerCase()}`} type="linear" dataKey="projectedExpenses" stroke={COLOR.expenses} strokeWidth={2.25} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.surface }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Shaded gap = {unit === "day" ? "daily" : `${unit}ly`} profit (green: {copy.revenue.toLowerCase()} above {copy.expenses.toLowerCase()}) or loss (red). The axis scales to your numbers, so it may not start at $0.
            {granular && " Each month's total is spread evenly over its calendar days."}
          </p>

          <h3 className="mt-6 text-sm font-medium text-slate-300">Cumulative cash flow</h3>
          <div className="mt-2 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id={`cashFill${gradId}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLOR.cash} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={COLOR.cash} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="month" {...axisProps} tickFormatter={monthTick(long)} minTickGap={16} />
                <YAxis {...axisProps} width={72} domain={cumDomain} tickCount={5} tickFormatter={(v: number) => usdCompact.format(v)} />
                <ReferenceLine y={0} stroke={CHART.zero} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: CHART.cursor }} />
                <Area name="Cumulative net cash" type="monotone" dataKey="cumulative" stroke={COLOR.cash} strokeWidth={2} fill={`url(#cashFill${gradId})`} activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.surface }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
      <DataCompletenessNote loggedCount={actualsAgg?.months ?? 0} className="mt-4" />
    </div>
  );
}

function SummaryStat({ label, value, tone, title }: { label: string; value: string; tone?: "good" | "bad"; title?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2" title={title}>
      <dt className="truncate text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={cn("mt-0.5 whitespace-nowrap text-sm font-semibold tabular-nums text-slate-100", tone === "good" && "text-emerald-300", tone === "bad" && "text-rose-300")}>{value}</dd>
    </div>
  );
}

/** Revenue, expenses and that month's profit / loss (the shaded bands themselves aren't listed). */
function ProjectionTooltip({
  active,
  payload,
  label,
  revenueLabel,
  expensesLabel,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: { projectedRevenue: number; projectedExpenses: number; net: number } }>;
  label?: string | number;
  revenueLabel: string;
  expensesLabel: string;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <p className="mb-1 font-medium text-slate-200">{label}</p>
      {(
        [
          [revenueLabel, row.projectedRevenue, COLOR.revenue],
          [expensesLabel, row.projectedExpenses, COLOR.expenses],
        ] as const
      ).map(([name, v, color]) => (
        <p key={name} className="flex items-center gap-2 text-slate-300">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
          <span className="text-slate-400">{name}</span>
          <span className="ml-auto pl-3 tabular-nums text-slate-100">{usd.format(v)}</span>
        </p>
      ))}
      <p className={cn("mt-1 flex items-center gap-2 border-t border-white/10 pt-1 font-medium", row.net >= 0 ? "text-emerald-300" : "text-rose-300")}>
        {row.net >= 0 ? "Profit" : "Loss"}
        <span className="ml-auto pl-3 tabular-nums">{signedUsd(row.net)}</span>
      </p>
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
  const [openFlag, setOpenFlag] = useState<AuditFlag | null>(null);
  const teaser = paywall.access.level === "teaser";
  const flags = analysis.auditFlags;
  const visible = showAll || teaser ? flags : flags.filter((f) => f.severity !== "LOW").slice(0, 6);
  const savings = sum(flags, (f) => f.potentialSavings);
  const locked = paywall.access.lockedFlagCount;
  const doneFor = (f: AuditFlag) => implemented.find((x) => x.title === f.title && x.status === "IMPLEMENTED");

  return (
    <div id="audit-panel" className={cn(glass, "scroll-mt-20 p-6")}>
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
              <li
                key={`${f.title}-${i}`}
                className={cn(
                  "rounded-xl border bg-white/[0.03] p-4 transition hover:bg-white/[0.05]",
                  f.severity === "HIGH" ? "border-rose-300/25 hover:border-rose-300/40" : "border-white/10 hover:border-white/20",
                )}
              >
                <button type="button" onClick={() => (teaser ? paywall.openCheckout() : setOpenFlag(f))} className="group block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-300" aria-label={teaser ? `${f.title}: upgrade to open the strategy deep-dive` : `${f.title}: open strategy and recommendations`}>
                  <span className="flex items-start justify-between gap-3">
                    <span className="text-sm font-medium text-slate-100 group-hover:text-white">{f.title}</span>
                    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", s.badge)}>
                      <s.Icon className="h-3 w-3" /> {f.severity}
                    </span>
                  </span>
                  <span className="mt-1.5 block text-sm text-slate-400">{f.message}</span>
                  <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-300 group-hover:text-indigo-200">
                    {f.severity === "HIGH" ? "See the strategy & next steps" : "Details & recommendations"} <ArrowRight className="h-3 w-3" />
                  </span>
                </button>
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
              <button onClick={paywall.access.reportUnlocks > 0 && paywall.access.sealed ? paywall.unlock : paywall.openCheckout} className="mt-2 text-xs text-indigo-300 hover:text-indigo-200">
                {paywall.access.reportUnlocks > 0 && paywall.access.sealed ? "Use a full-report credit" : "Unlock with Pro"}
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

      {openFlag && (
        <AuditDeepDive
          flag={openFlag}
          figures={{ monthlyRevenue: analysis.monthlyRevenue, monthlyExpenses: splitTotals(analysis.itemizedExpenses).recurring, personal: analysis.businessType === "PERSONAL_FAMILY" }}
          onClose={() => setOpenFlag(null)}
          implemented={!!doneFor(openFlag)}
          implementedSince={doneFor(openFlag)?.since}
          onToggleImplemented={onToggleImplemented ? () => onToggleImplemented(openFlag) : undefined}
        />
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

/** Benchmarks, runway and vendor creep for the executive report. */
interface ReportExtras {
  benchmarkProfile: BenchmarkProfile;
  cash: number | null;
  creep: VendorCreep[];
}

function reportExtrasHtml(a: FinancialAnalysis, x: ReportExtras): string {
  const personal = a.businessType === "PERSONAL_FAMILY";
  const { be, runway, paces } = runwayFigures(a, x.cash);
  const vsBe = (v: number | null) => (v == null || personal ? "—" : v >= 0 ? `${usd.format(v)} above` : `${usd.format(-v)} short`);
  const paceRows = paces
    .map((p) => `<tr><td>${esc(p.label)} <span class="muted">(${esc(p.range)})</span></td><td class="${p.net < 0 ? "neg" : "pos"}">${p.net >= 0 ? "▲" : "▼"} On pace for ${signedUsd(p.net)}</td><td>${vsBe(p.vsBreakEven)}</td></tr>`)
    .join("");
  const runwayLine = runway
    ? `<p><strong>${runway.months == null ? (runway.avgNet >= 0 ? "Cash-flow positive" : "10+ years of runway") : `${runway.months.toFixed(1)} months of runway`}</strong> on ${usd.format(runway.cash)} cash on hand. ${esc(runwaySentence(runway, personal))}</p>`
    : `<p class="muted">Cash on hand not entered — runway not calculated.</p>`;
  const paceTable = paceRows ? `<table><thead><tr><th>Period</th><th>Direction</th><th>${personal ? "" : "Vs. break-even"}</th></tr></thead><tbody>${paceRows}</tbody></table>` : "";
  const creep = x.creep.length
    ? `<h2>Vendor price creep</h2><ul>${x.creep
        .slice(0, 10)
        .map((c) => `<li><strong>[${c.severity}]</strong> ${esc(creepHeadline(c))} <em>(+${usd.format(c.increase)}/mo · ${usd.format(c.annualImpact)}/yr)</em></li>`)
        .join("")}</ul>`
    : "";
  const benchmarks = benchmarksReportHtml(evaluateBenchmarks(x.benchmarkProfile, a.itemizedRevenue, a.itemizedExpenses), x.benchmarkProfile, esc);
  return `<h2>Cash runway &amp; break-even</h2>${runwayLine}<p>${esc(breakEvenSentence(be, personal))}</p>${paceTable}${benchmarks}${creep}`;
}

function reportHtml(a: FinancialAnalysis, settings: ForecastSettings, goal: GoalReport | null, inflationLabel: string, extras?: ReportExtras) {
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
<title>Sumhaven Executive Report ${new Date().toISOString().slice(0, 10)}</title>
<style>
body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;max-width:860px;margin:40px auto;padding:0 20px}
h1{font-size:24px;margin:0}h2{font-size:16px;margin:28px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
.muted{color:#666}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px}
.kpi{border:1px solid #ddd;border-radius:8px;padding:12px}.kpi b{display:block;font-size:18px;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}td,th{padding:6px 8px;border-bottom:1px solid #eee;text-align:right}
td:first-child,th:first-child{text-align:left}.neg{color:#b42318}.pos{color:#047857}.warn{color:#b54708}li{margin-bottom:6px}.kpi .muted{font-size:11px}
.pace-banner{margin-top:20px;border:2px solid;border-radius:10px;padding:14px 16px;break-inside:avoid}.pace-good{border-color:#047857;background:#ecfdf5}.pace-bad{border-color:#b42318;background:#fef3f2}
.pace-head{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}.pace-good .pace-head{color:#047857}.pace-bad .pace-head{color:#b42318}
@page{margin:16mm}@media print{body{margin:0;max-width:none}}
</style></head><body>
<h1>Sumhaven Executive Report</h1>
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
${extras ? reportExtrasHtml(a, extras) : ""}
${a.missingCategories.length ? `<h2>Missing categories</h2><p>${a.missingCategories.map(esc).join(", ")}</p>` : ""}
<h2>${months}-month projection</h2>
<table><thead><tr><th>Month</th><th>${esc(copy.revenue)}</th><th>${esc(copy.expenses)}</th><th>Net</th><th>Cumulative</th></tr></thead><tbody>${projRows}</tbody></table>
${goal ? goalPaceReportHtml(goal.pace, goal.fyLabel, esc) : ""}
<p class="muted" style="margin-top:24px;font-size:12px">Projections repeat current recurring monthly amounts (${esc(macro.toLowerCase())}); one-time items are counted once, in the first month, partial-month lines are pro-rated in the first month, and %-of-revenue expenses follow their revenue line.${goal ? " Goal pace spreads the year-end goal evenly across the 12 fiscal months and compares logged actuals plus the tracker forecast against it." : ""} ${esc(LEGAL_DISCLAIMER)}</p>
</body></html>`;
}

/**
 * Downloads the executive report as a real .pdf file (no print dialog — on macOS `window.print()` opened the native
 * print preview instead of downloading). Falls back to the print dialog only if the PDF can't be built.
 */
async function downloadExecutiveReport(a: FinancialAnalysis, settings: ForecastSettings, goal: GoalReport | null, inflationLabel: string, extras: ReportExtras | undefined, workspaceName: string | null) {
  const html = reportHtml(a, settings, goal, inflationLabel, extras);
  try {
    await downloadHtmlAsPdf(html, pdfFileName("Sumhaven Executive Report", workspaceName, new Date().toISOString().slice(0, 10)));
  } catch (e) {
    console.warn("[report] pdf failed, falling back to print", e);
    printHtml(html);
  }
}
