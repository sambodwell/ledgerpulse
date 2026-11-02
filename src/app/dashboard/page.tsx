"use client";

import { Component, useCallback, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
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
  CheckCircle2,
  ClipboardList,
  Download,
  FileText,
  Info,
  Loader2,
  Plus,
  ShieldAlert,
  Trash2,
  Trophy,
  Upload,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  CATEGORY_TEMPLATES,
  isFinancialAnalysis,
  sum,
  type BusinessType,
  type FinancialAnalysis,
  type Severity,
} from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const cn = (...inputs: Parameters<typeof clsx>) => twMerge(clsx(inputs));

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCompact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

// Chart colors: validated categorical slots 1–3 for a dark surface.
const COLOR = { revenue: "#3987e5", expenses: "#d95926", cash: "#199e70" } as const;

const glass = "rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.35)]";

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
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-3 rounded-lg border border-white/15 px-3 py-1.5 text-slate-200 hover:bg-white/10"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type InputTab = "form" | "upload";

export default function DashboardPage() {
  const [tab, setTab] = useState<InputTab>("form");
  const [analysis, setAnalysis] = useState<FinancialAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const runAnalysis = useCallback(async (init: RequestInit) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", { method: "POST", ...init });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : `Request failed (${res.status})`;
        throw new Error(msg);
      }
      if (!isFinancialAnalysis(data)) throw new Error("Received an unexpected response from the analysis service.");
      setAnalysis(data);
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-950 text-slate-100">
      {/* Ambient glow */}
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div className="absolute -top-40 left-1/4 h-[28rem] w-[28rem] rounded-full bg-indigo-600/20 blur-[120px]" />
        <div className="absolute top-1/3 -right-24 h-[24rem] w-[24rem] rounded-full bg-emerald-500/10 blur-[120px]" />
      </div>

      <main className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium tracking-wide text-indigo-300">LedgerPulse</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Cash flow &amp; runway forecast</h1>
            <p className="mt-2 max-w-2xl text-slate-400">
              Enter your numbers or upload a bank statement / P&amp;L. We&apos;ll audit it and project the next 12 months with seasonality and inflation.
            </p>
          </div>
          {analysis && (
            <button
              onClick={() => downloadExecutiveReport(analysis)}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
            >
              <Download className="h-4 w-4" /> Download Executive Report
            </button>
          )}
        </header>

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
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm transition",
                tab === key ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200",
              )}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className={cn(tab !== "form" && "hidden lg:block")}>
            <PanelBoundary title="Guided form">
              <GuidedForm disabled={loading} onSubmit={(payload) => runAnalysis({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })} />
            </PanelBoundary>
          </div>
          <div className={cn(tab !== "upload" && "hidden lg:block")}>
            <PanelBoundary title="Statement upload">
              <StatementUploader disabled={loading} onSubmit={runAnalysis} />
            </PanelBoundary>
          </div>
        </section>

        {loading && (
          <div className={cn(glass, "mt-6 flex items-center gap-3 p-5 text-slate-300")} role="status">
            <Loader2 className="h-5 w-5 animate-spin text-indigo-300" />
            Analyzing your financials — large statements can take a minute.
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

        {analysis && (
          <div ref={resultsRef} className="mt-10 scroll-mt-6 space-y-6">
            <PanelBoundary title="Summary">
              <KpiRow analysis={analysis} />
            </PanelBoundary>
            <div className="grid gap-6 xl:grid-cols-3">
              <div className="space-y-6 xl:col-span-2">
                <PanelBoundary title="Projection chart">
                  <ProjectionCharts analysis={analysis} />
                </PanelBoundary>
                <PanelBoundary title="Line items">
                  <LineItems analysis={analysis} />
                </PanelBoundary>
              </div>
              <div className="space-y-6">
                <PanelBoundary title="Audit Mode">
                  <AuditPanel analysis={analysis} />
                </PanelBoundary>
                <PanelBoundary title="Winner insight">
                  <WinnerCard analysis={analysis} />
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
// Guided form
// ---------------------------------------------------------------------------

interface FormRevenue {
  id: number;
  label: string;
  amount: string;
  margin: string; // percent, 0–100
}
interface FormExpense {
  id: number;
  label: string;
  amount: string;
  category: string;
}

type FormPayload = {
  mode: "form";
  businessType: BusinessType;
  revenue: { label: string; amount: number; margin?: number }[];
  expenses: { label: string; amount: number; category: string }[];
};

let nextId = 1;
const newId = () => nextId++;

function templateRows(bt: BusinessType) {
  const t = CATEGORY_TEMPLATES[bt];
  return {
    revenue: t.revenue.slice(0, 2).map<FormRevenue>((label) => ({ id: newId(), label, amount: "", margin: "" })),
    expenses: t.expenses.filter((e) => e.essential).map<FormExpense>((e) => ({ id: newId(), label: e.category, amount: "", category: e.category })),
  };
}

const STEPS = ["Business", "Revenue", "Expenses", "Review"] as const;

function GuidedForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (p: FormPayload) => void }) {
  const [step, setStep] = useState(0);
  const [businessType, setBusinessType] = useState<BusinessType>("REAL_ESTATE");
  const [revenue, setRevenue] = useState<FormRevenue[]>(() => templateRows("REAL_ESTATE").revenue);
  const [expenses, setExpenses] = useState<FormExpense[]>(() => templateRows("REAL_ESTATE").expenses);
  const [touchedType, setTouchedType] = useState(false);

  const chooseType = (bt: BusinessType) => {
    setBusinessType(bt);
    // Re-seed templates only until the user starts editing lines.
    const pristine = [...revenue, ...expenses].every((r) => !r.amount);
    if (pristine || !touchedType) {
      const rows = templateRows(bt);
      setRevenue(rows.revenue);
      setExpenses(rows.expenses);
    }
    setTouchedType(true);
  };

  const validRevenue = revenue.filter((r) => r.label.trim() && Number(r.amount) > 0);
  const validExpenses = expenses.filter((e) => e.label.trim() && Number(e.amount) > 0);
  const canNext = step === 0 || (step === 1 ? validRevenue.length > 0 : true);

  const submit = () =>
    onSubmit({
      mode: "form",
      businessType,
      revenue: validRevenue.map((r) => ({
        label: r.label.trim(),
        amount: Number(r.amount),
        ...(r.margin !== "" && Number.isFinite(Number(r.margin)) ? { margin: Math.min(100, Math.max(0, Number(r.margin))) / 100 } : {}),
      })),
      expenses: validExpenses.map((e) => ({ label: e.label.trim(), amount: Number(e.amount), category: e.category || "Uncategorized" })),
    });

  const categoryOptions = CATEGORY_TEMPLATES[businessType].expenses.map((e) => e.category);

  return (
    <div className={cn(glass, "flex h-full flex-col p-6")}>
      <div className="flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-indigo-300" />
        <h2 className="text-lg font-semibold">Guided Input Form</h2>
      </div>

      <ol className="mt-5 flex gap-2" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <div className={cn("h-1 rounded-full", i <= step ? "bg-indigo-400" : "bg-white/10")} />
            <span className={cn("mt-1.5 block text-xs", i === step ? "text-slate-100" : "text-slate-500")}>{s}</span>
          </li>
        ))}
      </ol>

      <div className="mt-6 flex-1">
        {step === 0 && (
          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm text-slate-400">What kind of business is this?</legend>
            {BUSINESS_TYPES.map((bt) => (
              <label
                key={bt}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition",
                  businessType === bt ? "border-indigo-400/60 bg-indigo-500/10" : "border-white/10 hover:bg-white/5",
                )}
              >
                <input type="radio" name="bt" className="accent-indigo-400" checked={businessType === bt} onChange={() => chooseType(bt)} />
                <span className="text-sm">{BUSINESS_TYPE_LABELS[bt]}</span>
              </label>
            ))}
          </fieldset>
        )}

        {step === 1 && (
          <RowEditor
            hint="Average monthly amounts. Margin is optional — we'll estimate it if blank."
            columns={["Revenue stream", "Monthly $", "Margin %"]}
            rows={revenue}
            onAdd={() => setRevenue((r) => [...r, { id: newId(), label: "", amount: "", margin: "" }])}
            onRemove={(id) => setRevenue((r) => r.filter((x) => x.id !== id))}
            render={(row) => (
              <>
                <TextInput aria-label="Revenue stream" value={row.label} onChange={(v) => setRevenue((r) => r.map((x) => (x.id === row.id ? { ...x, label: v } : x)))} />
                <NumInput aria-label="Monthly amount" value={row.amount} onChange={(v) => setRevenue((r) => r.map((x) => (x.id === row.id ? { ...x, amount: v } : x)))} />
                <NumInput aria-label="Margin percent" value={row.margin} placeholder="auto" onChange={(v) => setRevenue((r) => r.map((x) => (x.id === row.id ? { ...x, margin: v } : x)))} />
              </>
            )}
          />
        )}

        {step === 2 && (
          <RowEditor
            hint="We pre-filled the essentials for your business type. Leave a line at 0 if it truly doesn't apply — we'll flag it."
            columns={["Expense", "Monthly $", "Category"]}
            rows={expenses}
            onAdd={() => setExpenses((r) => [...r, { id: newId(), label: "", amount: "", category: "" }])}
            onRemove={(id) => setExpenses((r) => r.filter((x) => x.id !== id))}
            render={(row) => (
              <>
                <TextInput aria-label="Expense" value={row.label} onChange={(v) => setExpenses((r) => r.map((x) => (x.id === row.id ? { ...x, label: v } : x)))} />
                <NumInput aria-label="Monthly amount" value={row.amount} onChange={(v) => setExpenses((r) => r.map((x) => (x.id === row.id ? { ...x, amount: v } : x)))} />
                <select
                  aria-label="Category"
                  value={row.category}
                  onChange={(ev) => setExpenses((r) => r.map((x) => (x.id === row.id ? { ...x, category: ev.target.value } : x)))}
                  className="w-full rounded-lg border border-white/10 bg-slate-900/60 px-2 py-2 text-sm text-slate-100 focus:border-indigo-400 focus:outline-none"
                >
                  <option value="">Auto-classify</option>
                  {categoryOptions.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                  <option>Other</option>
                </select>
              </>
            )}
          />
        )}

        {step === 3 && (
          <dl className="space-y-3 text-sm">
            <ReviewRow label="Business type" value={BUSINESS_TYPE_LABELS[businessType]} />
            <ReviewRow label={`Revenue (${validRevenue.length} lines)`} value={usd.format(sum(validRevenue, (r) => Number(r.amount)))} />
            <ReviewRow label={`Expenses (${validExpenses.length} lines)`} value={usd.format(sum(validExpenses, (e) => Number(e.amount)))} />
            <ReviewRow
              label="Net per month"
              value={usd.format(sum(validRevenue, (r) => Number(r.amount)) - sum(validExpenses, (e) => Number(e.amount)))}
            />
          </dl>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-30"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        {step < STEPS.length - 1 ? (
          <button
            onClick={() => setStep((s) => s + 1)}
            disabled={!canNext}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/15 disabled:opacity-40"
          >
            Next <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={disabled || validRevenue.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            {disabled && <Loader2 className="h-4 w-4 animate-spin" />} Analyze
          </button>
        )}
      </div>
    </div>
  );
}

function RowEditor<T extends { id: number }>(props: {
  hint: string;
  columns: [string, string, string];
  rows: T[];
  onAdd: () => void;
  onRemove: (id: number) => void;
  render: (row: T) => ReactNode;
}) {
  return (
    <div>
      <p className="mb-3 text-sm text-slate-400">{props.hint}</p>
      <div className="grid grid-cols-[1fr_6.5rem_7.5rem_2rem] gap-2 px-1 pb-1 text-xs uppercase tracking-wide text-slate-500">
        {props.columns.map((c) => (
          <span key={c}>{c}</span>
        ))}
        <span />
      </div>
      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {props.rows.map((row) => (
          <div key={row.id} className="grid grid-cols-[1fr_6.5rem_7.5rem_2rem] items-center gap-2">
            {props.render(row)}
            <button onClick={() => props.onRemove(row.id)} aria-label="Remove line" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-rose-300">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <button onClick={props.onAdd} className="mt-3 inline-flex items-center gap-1.5 text-sm text-indigo-300 hover:text-indigo-200">
        <Plus className="h-4 w-4" /> Add line
      </button>
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-400 focus:outline-none";

function TextInput({ value, onChange, ...rest }: { value: string; onChange: (v: string) => void; "aria-label": string }) {
  return <input {...rest} value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />;
}

function NumInput({ value, onChange, placeholder = "0", ...rest }: { value: string; onChange: (v: string) => void; placeholder?: string; "aria-label": string }) {
  return <input {...rest} type="number" inputMode="decimal" min={0} step="any" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, "tabular-nums")} />;
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

function StatementUploader({ disabled, onSubmit }: { disabled: boolean; onSubmit: (init: RequestInit) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [businessType, setBusinessType] = useState<BusinessType | "">("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const ready = mode === "file" ? !!file : pasted.trim().length > 0;

  const submit = () => {
    if (mode === "file" && file) {
      const fd = new FormData();
      fd.append("file", file);
      if (businessType) fd.append("businessType", businessType);
      onSubmit({ body: fd });
    } else {
      onSubmit({
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "text", rawText: pasted, ...(businessType ? { businessType } : {}) }),
      });
    }
  };

  return (
    <div className={cn(glass, "flex h-full flex-col p-6")}>
      <div className="flex items-center gap-2">
        <Upload className="h-5 w-5 text-indigo-300" />
        <h2 className="text-lg font-semibold">Upload Bank / P&amp;L Statement</h2>
      </div>
      <p className="mt-1 text-sm text-slate-400">PDF, CSV or plain text. Scanned PDFs work too.</p>

      <div className="mt-5 inline-flex self-start rounded-lg border border-white/10 p-0.5 text-sm">
        {(["file", "paste"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={cn("rounded-md px-3 py-1.5", mode === m ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200")}>
            {m === "file" ? "Upload file" : "Paste text"}
          </button>
        ))}
      </div>

      <div className="mt-4 flex-1">
        {mode === "file" ? (
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
            placeholder={"Paste transactions or a P&L…\n03/02  Home Depot   -412.18\n03/05  Rent - Unit 2B  2,150.00"}
            className={cn(inputCls, "h-full min-h-48 resize-y font-mono text-xs")}
          />
        )}
      </div>

      <label className="mt-4 block text-sm">
        <span className="text-slate-400">Business type (optional)</span>
        <select
          value={businessType}
          onChange={(e) => setBusinessType(e.target.value as BusinessType | "")}
          className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
        >
          <option value="">Detect automatically</option>
          {BUSINESS_TYPES.map((bt) => (
            <option key={bt} value={bt}>
              {BUSINESS_TYPE_LABELS[bt]}
            </option>
          ))}
        </select>
      </label>

      <button
        onClick={submit}
        disabled={disabled || !ready}
        className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
      >
        {disabled && <Loader2 className="h-4 w-4 animate-spin" />} Analyze statement
      </button>
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
    const monthlyExpenses = sum(a.itemizedExpenses, (e) => e.amount);
    const net = a.monthlyRevenue - monthlyExpenses;
    const rows = projectionRows(a);
    const annualNet = rows.at(-1)?.cumulative ?? 0;
    const firstNegative = rows.find((r) => r.cumulative < 0)?.month ?? null;
    return { monthlyExpenses, net, rows, annualNet, firstNegative };
  }, [a]);
}

function KpiRow({ analysis }: { analysis: FinancialAnalysis }) {
  const d = useDerived(analysis);
  const tiles = [
    { label: "Monthly revenue", value: usd.format(analysis.monthlyRevenue) },
    { label: "Monthly expenses", value: usd.format(d.monthlyExpenses) },
    { label: "Net / month", value: usd.format(d.net), tone: d.net >= 0 ? "good" : "bad" },
    {
      label: "12-mo projected net",
      value: usd.format(d.annualNet),
      sub: d.firstNegative ? `Cash turns negative in ${d.firstNegative}` : `After ${pct(analysis.inflationRateAssumed)} inflation`,
      tone: d.annualNet >= 0 ? "good" : "bad",
    },
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className={cn(glass, "p-5")}>
          <p className="text-xs uppercase tracking-wide text-slate-400">{t.label}</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-50">{t.value}</p>
          {"sub" in t && (
            <p className={cn("mt-1 flex items-center gap-1 text-xs", "tone" in t && t.tone === "bad" ? "text-rose-300" : "text-slate-400")}>
              {"tone" in t && t.tone === "bad" && <AlertTriangle className="h-3 w-3" />}
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
                <th className="py-2 text-right font-medium">Revenue</th>
                <th className="py-2 text-right font-medium">Expenses</th>
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
                <Line name="Projected revenue" type="monotone" dataKey="projectedRevenue" stroke={COLOR.revenue} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#0f172a" }} />
                <Line name="Projected expenses" type="monotone" dataKey="projectedExpenses" stroke={COLOR.expenses} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#0f172a" }} />
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

const SEVERITY_STYLE: Record<Severity, { badge: string; Icon: typeof ShieldAlert }> = {
  HIGH: { badge: "border-rose-400/40 bg-rose-500/15 text-rose-200", Icon: ShieldAlert },
  MEDIUM: { badge: "border-amber-400/40 bg-amber-500/15 text-amber-200", Icon: AlertTriangle },
  LOW: { badge: "border-sky-400/40 bg-sky-500/15 text-sky-200", Icon: Info },
};

function AuditPanel({ analysis }: { analysis: FinancialAnalysis }) {
  const [showAll, setShowAll] = useState(false);
  const flags = analysis.auditFlags;
  const visible = showAll ? flags : flags.filter((f) => f.severity !== "LOW").slice(0, 6);
  const savings = sum(flags, (f) => f.potentialSavings);

  return (
    <div className={cn(glass, "p-6")}>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ShieldAlert className="h-5 w-5 text-rose-300" /> Audit Mode
        </h2>
        {savings > 0 && (
          <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-200">
            ~{usd.format(savings)}/mo potential
          </span>
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
      {flags.length > visible.length && (
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

function WinnerCard({ analysis }: { analysis: FinancialAnalysis }) {
  const { topService, message } = analysis.winnerInsight;
  return (
    <div className={cn(glass, "border-emerald-400/20 bg-gradient-to-br from-emerald-500/10 to-transparent p-6")}>
      <h2 className="flex items-center gap-2 text-sm font-medium text-emerald-200">
        <Trophy className="h-4 w-4" /> Top performer
      </h2>
      <p className="mt-2 text-xl font-semibold">{topService}</p>
      <p className="mt-2 text-sm text-slate-300">{message}</p>
    </div>
  );
}

function LineItems({ analysis }: { analysis: FinancialAnalysis }) {
  return (
    <div className={cn(glass, "grid gap-6 p-6 md:grid-cols-2")}>
      <div>
        <h3 className="text-sm font-medium text-slate-300">Revenue</h3>
        <ul className="mt-3 divide-y divide-white/5 text-sm">
          {analysis.itemizedRevenue.map((r) => (
            <li key={r.label} className="flex justify-between gap-3 py-2">
              <span className="text-slate-300">{r.label}</span>
              <span className="tabular-nums">
                {usd.format(r.amount)} <span className="text-xs text-slate-500">· {pct(r.margin)} margin</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-medium text-slate-300">Expenses</h3>
        <ul className="mt-3 divide-y divide-white/5 text-sm">
          {analysis.itemizedExpenses.map((e, i) => (
            <li key={`${e.label}-${i}`} className="py-2">
              <div className="flex justify-between gap-3">
                <span className="text-slate-300">
                  {e.label} <span className="text-xs text-slate-500">· {e.category}</span>
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
// Executive report (self-contained, printable HTML)
// ---------------------------------------------------------------------------

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function downloadExecutiveReport(a: FinancialAnalysis) {
  const monthlyExpenses = sum(a.itemizedExpenses, (e) => e.amount);
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
    .map(
      (f) =>
        `<li><strong>[${f.severity}] ${esc(f.title)}</strong> — ${esc(f.message)}${f.potentialSavings > 0 ? ` <em>(~${usd.format(f.potentialSavings)}/mo)</em>` : ""}</li>`,
    )
    .join("");
  const generated = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LedgerPulse Executive Report</title>
<style>
body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;max-width:860px;margin:40px auto;padding:0 20px}
h1{font-size:24px;margin:0}h2{font-size:16px;margin:28px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
.muted{color:#666}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px}
.kpi{border:1px solid #ddd;border-radius:8px;padding:12px}.kpi b{display:block;font-size:18px;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}td,th{padding:6px 8px;border-bottom:1px solid #eee;text-align:right}
td:first-child,th:first-child{text-align:left}.neg{color:#b42318}li{margin-bottom:6px}
@media print{body{margin:0}}
</style></head><body>
<h1>LedgerPulse Executive Report</h1>
<p class="muted">${esc(BUSINESS_TYPE_LABELS[a.businessType])} · Generated ${esc(generated)} · ${pct(a.inflationRateAssumed)} inflation assumed</p>
<div class="kpis">
<div class="kpi">Monthly revenue<b>${usd.format(a.monthlyRevenue)}</b></div>
<div class="kpi">Monthly expenses<b>${usd.format(monthlyExpenses)}</b></div>
<div class="kpi">Net / month<b class="${net < 0 ? "neg" : ""}">${usd.format(net)}</b></div>
<div class="kpi">12-mo projected net<b class="${cumulative < 0 ? "neg" : ""}">${usd.format(cumulative)}</b></div>
</div>
<h2>Top performer: ${esc(a.winnerInsight.topService)}</h2><p>${esc(a.winnerInsight.message)}</p>
<h2>Priority actions</h2>${flags ? `<ol>${flags}</ol>` : "<p>No issues found.</p>"}
${a.missingCategories.length ? `<h2>Missing categories</h2><p>${a.missingCategories.map(esc).join(", ")}</p>` : ""}
<h2>12-month projection</h2>
<table><thead><tr><th>Month</th><th>Revenue</th><th>Expenses</th><th>Net</th><th>Cumulative</th></tr></thead><tbody>${projRows}</tbody></table>
<p class="muted" style="margin-top:24px;font-size:12px">Projections apply business-type seasonality and inflation to current monthly averages. They are estimates, not financial advice.</p>
</body></html>`;

  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `LedgerPulse-Executive-Report-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
