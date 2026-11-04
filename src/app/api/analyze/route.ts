import Anthropic from "@anthropic-ai/sdk";
import {
  BUSINESS_TYPES,
  CATEGORY_TEMPLATES,
  DEFAULT_INFLATION_RATE,
  MAX_PROJECTION_MONTHS,
  SEVERITIES,
  clampHorizon,
  defaultProjectionStart,
  detectMissingCategories,
  evaluatePersonalBudget,
  isBusinessType,
  parseMonthKey,
  projectBaseline,
  projectionFactors,
  round2,
  splitTotals,
  validShare,
  type AnalysisResponse,
  type ExtractedLineItems,
  type AuditFlag,
  type BusinessType,
  type ExpenseLine,
  type FinancialAnalysis,
  type RevenueLine,
  type ScenarioAdjustment,
  type ScenarioBaseline,
  type ScenarioPlan,
  type WinnerInsight,
} from "@/lib/schemas";
import { isSupabaseConfigured } from "@/lib/supabase";
import { buildAccess, consumeAiQuery, consumeReportUnlock, redactForTeaser, resolveViewer, seal, unseal, type Viewer } from "@/lib/server/entitlements";

/**
 * POST /api/analyze
 *
 * Accepts one of:
 *   - multipart/form-data: `file` (PDF or .txt/.csv) + optional `businessType`
 *   - application/json:    { mode: "text", rawText, businessType? }
 *   - multipart `mode=extract` or JSON { mode: "extract", rawText, businessType? }
 *                          → { items: ExtractedLineItems } only (no audit), so the owner can review
 *                            and edit the parsed lines, then submit them back as mode "form"
 *   - application/json:    { mode: "form", businessType, revenue: RevenueLine[], expenses: ExpenseLine[], origin? }
 *   - application/json:    { mode: "unlock", sealed }                 (signed-in; Pro or 1 report unlock)
 *   - application/json:    { mode: "scenario", prompt, baseline, horizon?, start? }  (Pro; start = "YYYY-MM" first projected month)
 *
 * Responds with AnalysisResponse ({ analysis, access }) for analysis/unlock, or
 * { scenario: ScenarioPlan } for scenario mode. Free callers get a teaser that
 * is redacted on the server, not just blurred in the UI.
 *
 * Zero retention: uploads are read into a Buffer, parsed in memory, zeroed, and
 * dropped when the request ends. Nothing is written to disk or a database, and
 * request bodies are never logged. Content is sent to the Anthropic API for
 * analysis; its retention is governed by your Anthropic account's data policy.
 */

// Claude Sonnet 3.5 (claude-3-5-sonnet-20241022) is retired; this is the current Sonnet.
const MODEL = process.env.LEDGERPULSE_MODEL ?? "claude-sonnet-5-5";
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_CHARS = 600_000; // ~150k tokens; beyond this we ask the user to split the statement
const MIN_EXTRACTED_CHARS = 80; // below this, treat the PDF as scanned and send it to Claude directly
const MAX_SCENARIO_PROMPT = 1000;
const ALLOWED_UPLOAD_TYPES = new Set(["application/pdf", "text/plain", "text/csv", "application/vnd.ms-excel", "application/octet-stream", ""]);

// Large statements can take a minute or more; don't let the platform default (often 10–60s) cut them off.
export const maxDuration = 300;

// Created on first use, inside the request's try/catch. Constructing it at module
// scope throws when ANTHROPIC_API_KEY is missing, which crashes the whole route
// with an HTML 500 before any error handling can run.
let anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!anthropic) {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      throw new HttpError(503, "The analysis service isn't configured on this server (missing ANTHROPIC_API_KEY).");
    }
    anthropic = new Anthropic();
  }
  return anthropic;
}

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
} as const;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type DocumentInput =
  | { kind: "text"; text: string; businessType?: BusinessType; source: string }
  | { kind: "pdf"; base64: string; businessType?: BusinessType; source: string };

type AnalysisInput =
  | DocumentInput
  /** `origin: "statement"` = lines parsed from an upload and then reviewed by the owner. */
  | { kind: "form"; businessType: BusinessType; revenue: FormRevenueLine[]; expenses: ExpenseLine[]; origin: "manual" | "statement" };

type RequestInput =
  | AnalysisInput
  | { kind: "extract"; document: DocumentInput }
  | { kind: "unlock"; sealed: string }
  | { kind: "scenario"; prompt: string; baseline: ScenarioBaseline; horizon: number; start: Date };

/** Owner-entered revenue; margin is optional and estimated by the model when absent. */
type FormRevenueLine = Omit<RevenueLine, "margin"> & { margin?: number };

async function readUpload(file: File, businessType: BusinessType | undefined): Promise<DocumentInput> {
  if (file.size === 0) throw new HttpError(400, "Uploaded file is empty.");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "File exceeds the 15 MB limit.");
  if (!ALLOWED_UPLOAD_TYPES.has(file.type)) throw new HttpError(415, "Upload a PDF, CSV or plain-text statement.");

  // Generic label only: file names often contain account holder names or numbers.
  const source = /\.pdf$/i.test(file.name) ? "uploaded PDF" : "uploaded statement";

  // In-memory only. The buffer is zeroed in `finally` so the plaintext doesn't
  // linger in the heap until GC; derived strings are released with the request.
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const isPdf = file.type === "application/pdf" || bytes.subarray(0, 5).toString() === "%PDF-";
    if (!isPdf) {
      return { kind: "text", text: bytes.toString("utf8"), businessType, source };
    }

    // Loaded lazily: pdfjs can fail to initialise in some serverless runtimes, and a
    // top-level import would then break every request, including guided-form ones.
    let parser: { getText(): Promise<{ text: string }>; destroy(): Promise<void> } | null = null;
    try {
      const { PDFParse } = await import("pdf-parse");
      parser = new PDFParse({ data: new Uint8Array(bytes) });
      const { text } = await parser.getText();
      if (text.replace(/\s+/g, "").length >= MIN_EXTRACTED_CHARS) {
        return { kind: "text", text, businessType, source };
      }
    } catch (err) {
      console.warn("[analyze] pdf-parse failed, falling back to native PDF input:", err instanceof Error ? err.name : "unknown");
    } finally {
      await parser?.destroy().catch(() => {});
    }
    // Scanned / image-only PDF: let Claude read the pages itself.
    return { kind: "pdf", base64: bytes.toString("base64"), businessType, source };
  } finally {
    bytes.fill(0);
  }
}

async function readInput(request: Request): Promise<RequestInput> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, "The upload couldn't be read. Choose the file again and resubmit.");
    }
    const file = form.get("file");
    const bt = form.get("businessType");
    if (!(file instanceof File)) throw new HttpError(400, "Missing `file` in form data.");
    const document = await readUpload(file, isBusinessType(bt) ? bt : undefined);
    return form.get("mode") === "extract" ? { kind: "extract", document } : document;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Body must be JSON or multipart/form-data.");
  }
  if (!body || typeof body !== "object") throw new HttpError(400, "Invalid request body.");
  const b = body as Record<string, unknown>;

  if (b.mode === "text" || b.mode === "extract") {
    if (typeof b.rawText !== "string" || !b.rawText.trim()) throw new HttpError(400, "`rawText` is required.");
    const document: DocumentInput = {
      kind: "text",
      text: b.rawText,
      businessType: isBusinessType(b.businessType) ? b.businessType : undefined,
      source: "pasted text",
    };
    return b.mode === "extract" ? { kind: "extract", document } : document;
  }

  if (b.mode === "form") {
    if (!isBusinessType(b.businessType)) throw new HttpError(400, "`businessType` is required for form input.");
    const revenue = sanitizeRevenue(b.revenue);
    const expenses = sanitizeExpenses(b.expenses);
    if (revenue.length === 0) throw new HttpError(400, b.businessType === "PERSONAL_FAMILY" ? "Add at least one income line." : "Add at least one revenue line.");
    return { kind: "form", businessType: b.businessType, revenue, expenses, origin: b.origin === "statement" ? "statement" : "manual" };
  }

  if (b.mode === "unlock") {
    if (typeof b.sealed !== "string" || !b.sealed) throw new HttpError(400, "`sealed` is required.");
    return { kind: "unlock", sealed: b.sealed };
  }

  if (b.mode === "scenario") {
    const prompt = typeof b.prompt === "string" ? b.prompt.trim() : "";
    if (!prompt) throw new HttpError(400, "Describe the scenario you want to test.");
    if (prompt.length > MAX_SCENARIO_PROMPT) throw new HttpError(400, `Keep scenarios under ${MAX_SCENARIO_PROMPT} characters.`);
    const base = (b.baseline ?? {}) as Record<string, unknown>;
    if (!isBusinessType(base.businessType)) throw new HttpError(400, "`baseline.businessType` is required.");
    const baseline: ScenarioBaseline = {
      businessType: base.businessType,
      itemizedRevenue: sanitizeRevenue(base.itemizedRevenue).map(({ label, amount, oneTime, firstMonthShare }) => ({
        label,
        amount,
        ...(oneTime ? { oneTime } : {}),
        ...(firstMonthShare ? { firstMonthShare } : {}),
      })),
      itemizedExpenses: sanitizeExpenses(base.itemizedExpenses),
      inflationRateAssumed: typeof base.inflationRateAssumed === "number" ? clamp(base.inflationRateAssumed, 0, 0.5) : DEFAULT_INFLATION_RATE,
    };
    if (baseline.itemizedRevenue.length === 0) throw new HttpError(400, "Run an analysis before forecasting scenarios.");
    const horizon = clampHorizon(typeof b.horizon === "number" ? b.horizon : 12);
    const start = parseMonthKey(typeof b.start === "string" ? b.start : null) ?? defaultProjectionStart();
    return { kind: "scenario", prompt, baseline, horizon, start };
  }

  throw new HttpError(400, "`mode` must be \"text\", \"extract\", \"form\", \"unlock\" or \"scenario\".");
}

function sanitizeRevenue(value: unknown): FormRevenueLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 200)
    .map((r) => ({
      label: String(r?.label ?? "").trim().slice(0, 120),
      amount: Number(r?.amount),
      ...(r?.margin == null || r.margin === "" ? {} : { margin: clamp(Number(r.margin), 0, 1) }),
      ...(r?.oneTime === true ? { oneTime: true } : validShare(r?.firstMonthShare) ? { firstMonthShare: validShare(r.firstMonthShare) } : {}),
    }))
    .filter((r) => r.label && Number.isFinite(r.amount) && r.amount > 0);
}

function sanitizeExpenses(value: unknown): ExpenseLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 400)
    .map((e) => ({
      label: String(e?.label ?? "").trim().slice(0, 120),
      amount: Number(e?.amount),
      category: String(e?.category ?? "Uncategorized").trim().slice(0, 60) || "Uncategorized",
      ...(e?.oneTime === true ? { oneTime: true } : validShare(e?.firstMonthShare) ? { firstMonthShare: validShare(e.firstMonthShare) } : {}),
    }))
    .filter((e) => e.label && Number.isFinite(e.amount) && e.amount > 0);
}

function clamp(n: number, lo: number, hi: number) {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}

// ---------------------------------------------------------------------------
// Claude calls
// ---------------------------------------------------------------------------

async function callStructured<T>(params: { system: string; content: Anthropic.Beta.BetaContentBlockParam[]; schema: object; maxTokens: number }): Promise<T> {
  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: params.maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: params.schema as unknown as Record<string, unknown> },
    },
    system: params.system,
    messages: [{ role: "user", content: params.content }],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new HttpError(422, "The model declined to process this request. Try removing unrelated content and resubmitting.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new HttpError(422, "This input has too many line items to analyze in one pass. Try uploading fewer months at a time.");
  }

  const text = message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(502, "The analysis came back malformed. Please try again.");
  }
  if (!parsed || typeof parsed !== "object") throw new HttpError(502, "The analysis came back malformed. Please try again.");
  return parsed as T;
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

/** Structured outputs should match the schema, but a fallback model or partial output must never crash assembly. */
function normalizeExtraction(raw: Partial<ModelExtraction>): ModelExtraction {
  const severities = SEVERITIES as readonly string[];
  return {
    businessType: isBusinessType(raw.businessType) ? raw.businessType : "OTHER_CUSTOM",
    itemizedRevenue: arr<RevenueLine>(raw.itemizedRevenue)
      .filter((r) => r && typeof r === "object")
      .map((r) => ({ label: str(r.label, "Revenue"), amount: num(r.amount), margin: num(r.margin) })),
    itemizedExpenses: arr<ModelExtraction["itemizedExpenses"][number]>(raw.itemizedExpenses)
      .filter((e) => e && typeof e === "object")
      .map((e) => ({ label: str(e.label, "Expense"), amount: num(e.amount), category: str(e.category, "Other") || "Other", flag: typeof e.flag === "string" ? e.flag : null })),
    auditFlags: arr<ModelExtraction["auditFlags"][number]>(raw.auditFlags)
      .filter((f) => f && typeof f === "object" && typeof f.title === "string")
      .map((f) => ({ title: f.title, severity: severities.includes(f.severity) ? f.severity : "LOW", message: str(f.message), potentialSavings: Math.max(0, num(f.potentialSavings)) })),
    missingCategories: arr<unknown>(raw.missingCategories).filter((c): c is string => typeof c === "string"),
    winnerInsight: {
      topService: str(raw.winnerInsight?.topService, "—"),
      message: str(raw.winnerInsight?.message),
    },
  };
}

/** What Claude returns; the route derives the rest of FinancialAnalysis. */
interface ModelExtraction {
  businessType: BusinessType;
  itemizedRevenue: RevenueLine[];
  itemizedExpenses: Array<{ label: string; amount: number; category: string; flag: string | null }>;
  auditFlags: Omit<AuditFlag, "source">[];
  missingCategories: string[];
  winnerInsight: WinnerInsight;
}

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["businessType", "itemizedRevenue", "itemizedExpenses", "auditFlags", "missingCategories", "winnerInsight"],
  properties: {
    businessType: { type: "string", enum: [...BUSINESS_TYPES] },
    itemizedRevenue: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "amount", "margin"],
        properties: {
          label: { type: "string" },
          amount: { type: "number", description: "Average MONTHLY amount in USD" },
          margin: { type: "number", description: "Estimated gross margin, 0 to 1 (use 1 for personal income)" },
        },
      },
    },
    itemizedExpenses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "amount", "category", "flag"],
        properties: {
          label: { type: "string" },
          amount: { type: "number", description: "Average MONTHLY amount in USD" },
          category: { type: "string" },
          flag: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
      },
    },
    auditFlags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "severity", "message", "potentialSavings"],
        properties: {
          title: { type: "string" },
          severity: { type: "string", enum: [...SEVERITIES] },
          message: { type: "string" },
          potentialSavings: { type: "number", description: "Estimated MONTHLY savings in USD" },
        },
      },
    },
    missingCategories: { type: "array", items: { type: "string" } },
    winnerInsight: {
      type: "object",
      additionalProperties: false,
      required: ["topService", "message"],
      properties: { topService: { type: "string" }, message: { type: "string" } },
    },
  },
} as const;

function buildSystemPrompt(): string {
  const templates = BUSINESS_TYPES.map((bt) => {
    const t = CATEGORY_TEMPLATES[bt];
    return `${bt}\n  ${bt === "PERSONAL_FAMILY" ? "income sources" : "revenue streams"}: ${t.revenue.join(", ")}\n  expense categories: ${t.expenses.map((e) => e.category).join(", ")}`;
  }).join("\n");

  return `You are LedgerPulse's financial analyst for small businesses, real estate owners and households. You turn bank statements, P&Ls and owner-entered figures into a structured monthly picture and a short, practical audit.

Classify the source as one of ${BUSINESS_TYPES.join(", ")} (use the owner's stated type when given). Choose PERSONAL_FAMILY when it is a personal or household account: paycheck deposits, groceries, rent or mortgage paid, consumer subscriptions, card payments. Choose OTHER_CUSTOM for a business that fits none of the other types. Use these category templates so dashboards stay consistent; for OTHER_CUSTOM keep the owner's own category names when they gave them. Use "Other" only when nothing fits:
${templates}

Normalize every amount to an average MONTHLY figure in USD. If the source covers several months, divide totals by the number of months covered; if it is annual, divide by 12. Merge duplicate transactions from the same vendor into one line. Do not invent lines that aren't supported by the source. Transfers between the owner's own accounts are neither revenue nor expense, except transfers into savings or brokerage accounts, which are the "Investments" category for PERSONAL_FAMILY.

For businesses, estimate a gross margin for each revenue stream from the direct costs you can attribute to it, or from typical margins for that kind of work when you can't. For PERSONAL_FAMILY, revenue lines are income sources and margin is always 1.

On an expense line, set "flag" to a short note when something stands out (a price increase versus earlier periods, a duplicate or apparently unused subscription, an unusually large one-off), otherwise null.

Audit flags are what the owner should act on first. For businesses: price jumps, unused or overlapping subscriptions, missed or likely-missed tax deductions, under-reserved essentials, revenue concentration. For households: subscriptions that overlap or look unused, bills that rose, high-interest debt, missing emergency savings, fees and interest charges. Severity HIGH means meaningful money or compliance risk now. Give a conservative monthly potentialSavings estimate (0 when the flag is about risk rather than savings). Write each message as one or two plain sentences an owner can act on.

missingCategories: essential expense categories for this type that the source doesn't show at all.

winnerInsight: for businesses, the revenue stream with the best combination of margin and volume, and one or two sentences on why and how to lean into it. For PERSONAL_FAMILY, the single highest-impact budget lever (topService is a short name for it) and one or two sentences on how to act on it.`;
}

function buildUserContent(input: AnalysisInput): Anthropic.Beta.BetaContentBlockParam[] {
  const hint = input.businessType ? `The owner says this is ${input.businessType}.` : "The owner did not state a type.";

  if (input.kind === "pdf") {
    return [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.base64 }, title: input.source },
      { type: "text", text: `${hint}\nAnalyze the attached statement.` },
    ];
  }
  if (input.kind === "text") {
    return [
      {
        type: "text",
        text: `${hint}\nAnalyze this financial statement (source: ${input.source}).\n\n<statement>\n${input.text}\n</statement>`,
      },
    ];
  }
  const origin =
    input.origin === "statement"
      ? "These line items were extracted from the owner's uploaded statement, then reviewed and edited by the owner."
      : "The owner entered these figures in a guided form.";
  return [
    {
      type: "text",
      text: `${hint}\n${origin} Amounts are monthly, except lines with "oneTime": true, which are single non-recurring amounts (don't treat them as monthly costs or income, and don't base recurring savings estimates on them). A "firstMonthShare" (0–1) marks a recurring line that only applies for part of the first month (e.g. rent starting mid-month); its amount is still the full monthly figure. Keep their amounts as given; assign categories, flag issues, and write the audit.\n\n<form_input>\n${JSON.stringify(
        { revenue: input.revenue, expenses: input.expenses },
        null,
        2,
      )}\n</form_input>`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const SEVERITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

function assemble(extraction: ModelExtraction, input: AnalysisInput): FinancialAnalysis {
  const businessType: BusinessType = input.kind === "form" ? input.businessType : input.businessType ?? extraction.businessType;
  const personal = businessType === "PERSONAL_FAMILY";

  // Form input: the owner's numbers are authoritative; only take categories/flags from the model.
  const itemizedRevenue: RevenueLine[] =
    input.kind === "form"
      ? input.revenue.map((r) => {
          const m = extraction.itemizedRevenue.find((x) => x.label === r.label);
          return { ...r, margin: personal ? 1 : r.margin ?? clamp(m?.margin ?? 0.5, 0, 1) };
        })
      : extraction.itemizedRevenue.map((r) => ({ label: r.label, amount: round2(r.amount), margin: personal ? 1 : clamp(r.margin, 0, 1) }));

  const itemizedExpenses: ExpenseLine[] =
    input.kind === "form"
      ? input.expenses.map((e) => {
          const m = extraction.itemizedExpenses.find((x) => x.label === e.label);
          const category = e.category && e.category !== "Uncategorized" ? e.category : m?.category ?? "Other";
          return { ...e, category, ...(m?.flag ? { flag: m.flag } : {}) };
        })
      : extraction.itemizedExpenses.map((e) => ({
          label: e.label,
          amount: round2(e.amount),
          category: e.category,
          ...(e.flag ? { flag: e.flag } : {}),
        }));

  // Monthly figures are recurring-only; one-time lines land once in the first projected month.
  const monthlyRevenue = splitTotals(itemizedRevenue).recurring;

  const ruleBased = detectMissingCategories({ businessType, itemizedExpenses });
  const missingCategories = Array.from(new Set([...ruleBased.map((w) => w.category), ...extraction.missingCategories]));

  const modelFlags: AuditFlag[] = extraction.auditFlags.map((f) => ({ ...f, source: "MODEL" }));
  const missingFlags = ruleBased
    .filter((w) => !modelFlags.some((f) => f.title.toLowerCase().includes(w.category.toLowerCase())))
    .map<AuditFlag>((w) => ({ title: `Missing: ${w.category}`, severity: w.severity, message: w.message, potentialSavings: 0, source: "MISSING_CATEGORY" }));
  const budgetFlags = personal
    ? evaluatePersonalBudget(monthlyRevenue, itemizedExpenses.filter((e) => !e.oneTime)).filter((b) => !modelFlags.some((f) => f.title.toLowerCase() === b.title.toLowerCase()))
    : [];

  const auditFlags = [...modelFlags, ...budgetFlags, ...missingFlags].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.potentialSavings - a.potentialSavings,
  );

  return {
    businessType,
    monthlyRevenue,
    itemizedRevenue,
    itemizedExpenses,
    inflationRateAssumed: DEFAULT_INFLATION_RATE,
    macroProjections: projectBaseline({ businessType, itemizedRevenue, itemizedExpenses, inflationRateAssumed: DEFAULT_INFLATION_RATE }),
    auditFlags,
    missingCategories,
    winnerInsight: extraction.winnerInsight,
  };
}

// ---------------------------------------------------------------------------
// Extract only (statement → editable line items, no audit)
// ---------------------------------------------------------------------------

const LINE_ITEMS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["businessType", "itemizedRevenue", "itemizedExpenses"],
  properties: {
    businessType: EXTRACTION_SCHEMA.properties.businessType,
    itemizedRevenue: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "amount", "margin", "oneTime"],
        properties: {
          ...EXTRACTION_SCHEMA.properties.itemizedRevenue.items.properties,
          oneTime: { type: "boolean", description: "True only for a clearly non-recurring amount" },
        },
      },
    },
    itemizedExpenses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "amount", "category", "oneTime"],
        properties: {
          label: { type: "string" },
          amount: { type: "number", description: "Average MONTHLY amount in USD, or the full amount when oneTime" },
          category: { type: "string" },
          oneTime: { type: "boolean", description: "True only for a clearly non-recurring charge" },
        },
      },
    },
  },
} as const;

const EXTRACT_INSTRUCTIONS = `Extract only the line items; the owner will review and edit them before the audit runs.
Mark a line "oneTime": true only when it is clearly non-recurring (a single late fee, a one-off purchase, a tax refund); give its full amount rather than a monthly average. Everything else is recurring ("oneTime": false) with an average MONTHLY amount.`;

async function handleExtract(document: DocumentInput) {
  const raw = await callStructured<{ businessType?: unknown; itemizedRevenue?: unknown; itemizedExpenses?: unknown }>({
    system: buildSystemPrompt(),
    content: [...buildUserContent(document), { type: "text", text: EXTRACT_INSTRUCTIONS }],
    schema: LINE_ITEMS_SCHEMA,
    maxTokens: 16000,
  });
  const businessType: BusinessType = document.businessType ?? (isBusinessType(raw.businessType) ? raw.businessType : "OTHER_CUSTOM");
  const personal = businessType === "PERSONAL_FAMILY";
  const items: ExtractedLineItems = {
    businessType,
    revenue: sanitizeRevenue(raw.itemizedRevenue).map((r) => ({ ...r, amount: round2(r.amount), margin: personal ? 1 : r.margin ?? 0.5 })),
    expenses: sanitizeExpenses(raw.itemizedExpenses).map((e) => ({ ...e, amount: round2(e.amount) })),
  };
  if (items.revenue.length === 0 && items.expenses.length === 0) {
    throw new HttpError(422, "No transactions could be read from this document. Check that it's a readable statement.");
  }
  return json({ items });
}

function respondWithAnalysis(full: FinancialAnalysis, viewer: Viewer) {
  if (viewer.tier === "pro") {
    return json({ analysis: full, access: buildAccess(full, viewer, "full", null) } satisfies AnalysisResponse);
  }
  const sealed = seal(full, viewer.userId);
  return json({ analysis: redactForTeaser(full), access: buildAccess(full, viewer, "teaser", sealed) } satisfies AnalysisResponse);
}

// ---------------------------------------------------------------------------
// Unlock
// ---------------------------------------------------------------------------

async function handleUnlock(sealed: string, viewer: Viewer) {
  if (!viewer.userId) throw new HttpError(401, "Sign in to unlock your full audit.");
  const opened = unseal(sealed, viewer.userId);
  if (!opened.ok) throw new HttpError(400, opened.reason);
  if (viewer.tier !== "pro") {
    const spent = await consumeReportUnlock(viewer);
    if (!spent) throw new HttpError(402, "You don't have a report unlock available. Purchase one or upgrade to Pro.");
    viewer = { ...viewer, reportUnlocks: Math.max(0, viewer.reportUnlocks - 1) };
  }
  return json({ analysis: opened.analysis, access: buildAccess(opened.analysis, viewer, "full", null) } satisfies AnalysisResponse);
}

// ---------------------------------------------------------------------------
// Scenario forecasting
// ---------------------------------------------------------------------------

interface ModelScenario {
  adjustments: Array<{
    type: ScenarioAdjustment["type"];
    match: string | null;
    label: string | null;
    pct: number | null;
    amount: number | null;
    startMonth: number;
    description: string;
  }>;
  assumptions: string[];
  explanation: string;
}

const SCENARIO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["adjustments", "assumptions", "explanation"],
  properties: {
    adjustments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "match", "label", "pct", "amount", "startMonth", "description"],
        properties: {
          type: { type: "string", enum: ["REVENUE_PCT", "EXPENSE_PCT", "REVENUE_ADD", "EXPENSE_ADD"] },
          match: {
            anyOf: [{ type: "string" }, { type: "null" }],
            description: "For *_PCT: an existing category or line label to scale (copy it exactly), or null for all lines",
          },
          label: { anyOf: [{ type: "string" }, { type: "null" }], description: "For *_ADD: short name of the new line" },
          pct: { anyOf: [{ type: "number" }, { type: "null" }], description: "For *_PCT: fractional change, e.g. 0.15 for +15%, -0.1 for -10%" },
          amount: { anyOf: [{ type: "number" }, { type: "null" }], description: "For *_ADD: MONTHLY USD amount added (negative to remove)" },
          startMonth: { type: "integer", description: `Projection month the change starts, 1..${MAX_PROJECTION_MONTHS} (may be beyond the current horizon)` },
          description: { type: "string", description: "One short phrase describing this change" },
        },
      },
    },
    assumptions: { type: "array", items: { type: "string" } },
    explanation: { type: "string" },
  },
} as const;

async function handleScenario(prompt: string, baseline: ScenarioBaseline, horizon: number, start: Date, viewer: Viewer) {
  if (viewer.tier !== "pro") throw new HttpError(402, "Scenario forecasting is a Pro feature.");
  const quota = await consumeAiQuery(viewer);
  if (!quota.ok) throw new HttpError(quota.status, quota.error);

  // List every month up to the maximum so prompts like "starting month 30" or "in March 2028" map even past the current horizon.
  const months = projectionFactors({ businessType: baseline.businessType, start, months: MAX_PROJECTION_MONTHS }).map((f, i) => `${i + 1}=${f.month}`).join(", ");
  const system = `You convert a "what if" question about a ${baseline.businessType} budget into structured adjustments for a deterministic ${horizon}-month projection. You do not compute the projection.

Projection months: ${months}. The user is currently viewing months 1..${horizon}. "Next quarter" means the first month of the next calendar quarter; "now" or no timing means month 1. When the user names a month number ("starting month 30", "in year 3") use it directly (year N starts at month 12×(N−1)+1); when they name a calendar month, map it with the list above.

Rules:
- Scale existing lines with REVENUE_PCT / EXPENSE_PCT. Set "match" to an existing category or label copied exactly from the baseline, or null to scale every line of that side.
- Add new recurring money with REVENUE_ADD / EXPENSE_ADD and a MONTHLY amount. For things like "2 new clients", estimate the per-client monthly value from the baseline (state how in assumptions) and multiply.
- One-off amounts: spread nothing; treat them as a single month only if the user says so, otherwise model them as recurring and say so in assumptions.
- Leave unused fields null. Only include changes the user asked for.
- assumptions: every estimate you had to make. explanation: one or two plain sentences restating the scenario.
If the request isn't a financial scenario, return no adjustments and explain what you can model.`;

  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    {
      type: "text",
      text: `<baseline>\n${JSON.stringify({ revenue: baseline.itemizedRevenue, expenses: baseline.itemizedExpenses }, null, 2)}\n</baseline>\n\n<scenario>\n${prompt}\n</scenario>`,
    },
  ];
  const out = await callStructured<Partial<ModelScenario>>({ system, content, schema: SCENARIO_SCHEMA, maxTokens: 8000 });

  const adjustments: ScenarioAdjustment[] = arr<ModelScenario["adjustments"][number]>(out.adjustments).slice(0, 12).flatMap<ScenarioAdjustment>((a) => {
    const startMonth = Math.round(clamp(a.startMonth, 1, MAX_PROJECTION_MONTHS));
    const description = String(a.description ?? "").slice(0, 160);
    if ((a.type === "REVENUE_PCT" || a.type === "EXPENSE_PCT") && typeof a.pct === "number" && Number.isFinite(a.pct)) {
      return [{ type: a.type, match: a.match ? a.match.slice(0, 80) : null, pct: clamp(a.pct, -1, 10), startMonth, description }];
    }
    if ((a.type === "REVENUE_ADD" || a.type === "EXPENSE_ADD") && typeof a.amount === "number" && Number.isFinite(a.amount)) {
      return [{ type: a.type, label: (a.label ?? description).slice(0, 80), amount: round2(clamp(a.amount, -10_000_000, 10_000_000)), startMonth, description }];
    }
    return [];
  });

  const scenario: ScenarioPlan = {
    prompt,
    adjustments,
    assumptions: arr<unknown>(out.assumptions).slice(0, 8).map((s) => String(s).slice(0, 300)),
    explanation: String(out.explanation ?? "").slice(0, 600),
  };
  return json({ scenario });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured) throw new HttpError(503, "Accounts aren't configured on this server, so analyses are disabled.");
    const viewer = await resolveViewer(request);
    // Financial data is only accepted from signed-in users, so every request is tied to an RLS-scoped identity.
    if (!viewer.userId) throw new HttpError(401, "Sign in or create an account to analyze your finances.");
    const input = await readInput(request);

    if (input.kind === "unlock") return await handleUnlock(input.sealed, viewer);
    if (input.kind === "scenario") return await handleScenario(input.prompt, input.baseline, input.horizon, input.start, viewer);

    const textLength = input.kind === "text" ? input.text.length : input.kind === "extract" && input.document.kind === "text" ? input.document.text.length : 0;
    if (textLength > MAX_TEXT_CHARS) {
      throw new HttpError(413, "This document is too long to analyze in one pass. Split it into smaller date ranges and upload each.");
    }
    if (input.kind === "extract") return await handleExtract(input.document);

    const extraction = await callStructured<Partial<ModelExtraction>>({
      system: buildSystemPrompt(),
      content: buildUserContent(input),
      schema: EXTRACTION_SCHEMA,
      maxTokens: 32000,
    });
    return respondWithAnalysis(assemble(normalizeExtraction(extraction), input), viewer);
  } catch (err) {
    if (err instanceof HttpError) {
      return json({ error: err.message }, err.status);
    }
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      console.error("[analyze] credentials rejected", err.status);
      return json({ error: "The analysis service is misconfigured on this server. Please try again later." }, 503);
    }
    if (err instanceof Anthropic.RateLimitError) {
      return json({ error: "We're handling a lot of analyses right now. Try again in a minute." }, 429);
    }
    if (err instanceof Anthropic.BadRequestError) {
      console.error("[analyze] bad request", err.message);
      return json({ error: "The document couldn't be processed. Check that it's a readable statement and try again." }, 400);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      console.error("[analyze] connection error", err.name);
      return json({ error: "Couldn't reach the analysis service. Check your connection and try again." }, 503);
    }
    if (err instanceof Anthropic.APIError) {
      console.error("[analyze] API error", err.status, err.message);
      return json({ error: "The analysis service is temporarily unavailable." }, 502);
    }
    // Log the error type only; messages from parsers can echo document content.
    console.error("[analyze] unexpected error", err instanceof Error ? err.name : typeof err);
    return json({ error: "Unexpected error while analyzing." }, 500);
  }
}
