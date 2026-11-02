import Anthropic from "@anthropic-ai/sdk";
import { PDFParse } from "pdf-parse";
import {
  BUSINESS_TYPES,
  CATEGORY_TEMPLATES,
  DEFAULT_INFLATION_RATE,
  SEVERITIES,
  buildMacroProjections,
  detectMissingCategories,
  isBusinessType,
  round2,
  sum,
  type AuditFlag,
  type BusinessType,
  type ExpenseLine,
  type FinancialAnalysis,
  type RevenueLine,
  type WinnerInsight,
} from "@/lib/schemas";

/**
 * POST /api/analyze
 *
 * Accepts one of:
 *   - multipart/form-data: `file` (PDF or .txt/.csv) + optional `businessType`
 *   - application/json:    { mode: "text", rawText, businessType? }
 *   - application/json:    { mode: "form", businessType, revenue: RevenueLine[], expenses: ExpenseLine[] }
 *
 * Claude classifies line items and writes audit flags + insight. Totals, the
 * 12-month macro projection and missing-category checks are computed here
 * deterministically so the numbers are reproducible.
 */

// Claude Sonnet 3.5 (claude-3-5-sonnet-20241022) is retired; this is the current Sonnet.
const MODEL = process.env.LEDGERPULSE_MODEL ?? "claude-sonnet-5-5";
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_CHARS = 600_000; // ~150k tokens; beyond this we ask the user to split the statement
const MIN_EXTRACTED_CHARS = 80; // below this, treat the PDF as scanned and send it to Claude directly

const client = new Anthropic();

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

type AnalysisInput =
  | { kind: "text"; text: string; businessType?: BusinessType; source: string }
  | { kind: "pdf"; base64: string; businessType?: BusinessType; source: string }
  | { kind: "form"; businessType: BusinessType; revenue: FormRevenueLine[]; expenses: ExpenseLine[] };

/** Owner-entered revenue; margin is optional and estimated by the model when absent. */
type FormRevenueLine = Omit<RevenueLine, "margin"> & { margin?: number };

async function readInput(request: Request): Promise<AnalysisInput> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    const bt = form.get("businessType");
    const businessType = isBusinessType(bt) ? bt : undefined;
    if (!(file instanceof File)) throw new HttpError(400, "Missing `file` in form data.");
    if (file.size === 0) throw new HttpError(400, "Uploaded file is empty.");
    if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "File exceeds the 15 MB limit.");

    const bytes = Buffer.from(await file.arrayBuffer());
    const isPdf = file.type === "application/pdf" || bytes.subarray(0, 5).toString() === "%PDF-";

    if (!isPdf) {
      return { kind: "text", text: bytes.toString("utf8"), businessType, source: file.name };
    }

    const parser = new PDFParse({ data: new Uint8Array(bytes) });
    try {
      const { text } = await parser.getText();
      if (text.replace(/\s+/g, "").length >= MIN_EXTRACTED_CHARS) {
        return { kind: "text", text, businessType, source: file.name };
      }
    } catch (err) {
      console.warn("[analyze] pdf-parse failed, falling back to native PDF input", err);
    } finally {
      await parser.destroy();
    }
    // Scanned / image-only PDF: let Claude read the pages itself.
    return { kind: "pdf", base64: bytes.toString("base64"), businessType, source: file.name };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Body must be JSON or multipart/form-data.");
  }
  if (!body || typeof body !== "object") throw new HttpError(400, "Invalid request body.");
  const b = body as Record<string, unknown>;

  if (b.mode === "text") {
    if (typeof b.rawText !== "string" || !b.rawText.trim()) throw new HttpError(400, "`rawText` is required.");
    return {
      kind: "text",
      text: b.rawText,
      businessType: isBusinessType(b.businessType) ? b.businessType : undefined,
      source: "pasted text",
    };
  }

  if (b.mode === "form") {
    if (!isBusinessType(b.businessType)) throw new HttpError(400, "`businessType` is required for form input.");
    const revenue = sanitizeRevenue(b.revenue);
    const expenses = sanitizeExpenses(b.expenses);
    if (revenue.length === 0) throw new HttpError(400, "Add at least one revenue line.");
    return { kind: "form", businessType: b.businessType, revenue, expenses };
  }

  throw new HttpError(400, "`mode` must be \"text\" or \"form\".");
}

function sanitizeRevenue(value: unknown): FormRevenueLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((r) => ({
      label: String(r?.label ?? "").trim(),
      amount: Number(r?.amount),
      ...(r?.margin == null || r.margin === "" ? {} : { margin: clamp(Number(r.margin), 0, 1) }),
    }))
    .filter((r) => r.label && Number.isFinite(r.amount) && r.amount > 0);
}

function sanitizeExpenses(value: unknown): ExpenseLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((e) => ({
      label: String(e?.label ?? "").trim(),
      amount: Number(e?.amount),
      category: String(e?.category ?? "Uncategorized").trim() || "Uncategorized",
    }))
    .filter((e) => e.label && Number.isFinite(e.amount) && e.amount > 0);
}

function clamp(n: number, lo: number, hi: number) {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}

// ---------------------------------------------------------------------------
// Claude call
// ---------------------------------------------------------------------------

/** What Claude returns; the route derives the rest of FinancialAnalysis. */
interface ModelExtraction {
  businessType: BusinessType;
  itemizedRevenue: RevenueLine[];
  itemizedExpenses: Array<{ label: string; amount: number; category: string; flag: string | null }>;
  auditFlags: AuditFlag[];
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
          margin: { type: "number", description: "Estimated gross margin, 0 to 1" },
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
    return `${bt}\n  revenue streams: ${t.revenue.join(", ")}\n  expense categories: ${t.expenses.map((e) => e.category).join(", ")}`;
  }).join("\n");

  return `You are LedgerPulse's financial analyst for small businesses and real estate owners. You turn bank statements, P&Ls and owner-entered figures into a structured monthly picture and a short, practical audit.

Classify the business as one of REAL_ESTATE, FIELD_SERVICE, or AGENCY_FREELANCE (use the owner's stated type when given). Use these category templates so dashboards stay consistent; use "Other" only when nothing fits:
${templates}

Normalize every amount to an average MONTHLY figure in USD. If the source covers several months, divide totals by the number of months covered; if it is annual, divide by 12. Merge duplicate transactions from the same vendor into one line. Do not invent lines that aren't supported by the source. Estimate a gross margin for each revenue stream from the direct costs you can attribute to it, or from typical margins for that kind of work when you can't.

On an expense line, set "flag" to a short note when something stands out (a price increase versus earlier periods, a duplicate or apparently unused subscription, an unusually large one-off), otherwise null.

Audit flags are what the owner should act on first: price jumps, unused or overlapping subscriptions, missed or likely-missed tax deductions, under-reserved essentials, revenue concentration. Severity HIGH means meaningful money or compliance risk now. Give a conservative monthly potentialSavings estimate (0 when the flag is about risk rather than savings). Write each message as one or two plain sentences an owner can act on.

missingCategories: essential expense categories for this business type that the source doesn't show at all.

winnerInsight: the revenue stream with the best combination of margin and volume, and one or two sentences on why and how to lean into it.`;
}

function buildUserContent(input: AnalysisInput): Anthropic.Beta.BetaContentBlockParam[] {
  const hint = input.businessType ? `The owner says this business is ${input.businessType}.` : "The owner did not state a business type.";

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
  return [
    {
      type: "text",
      text: `${hint}\nThe owner entered these monthly figures in a guided form. Keep their amounts as given; assign categories, flag issues, and write the audit.\n\n<form_input>\n${JSON.stringify(
        { revenue: input.revenue, expenses: input.expenses },
        null,
        2,
      )}\n</form_input>`,
    },
  ];
}

async function extractWithClaude(input: AnalysisInput): Promise<ModelExtraction> {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown> },
    },
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: buildUserContent(input) }],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new HttpError(422, "The model declined to analyze this document. Try removing unrelated content and resubmitting.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new HttpError(422, "This statement has too many line items to analyze in one pass. Try uploading fewer months at a time.");
  }

  const text = message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  try {
    return JSON.parse(text) as ModelExtraction;
  } catch {
    throw new HttpError(502, "The analysis came back malformed. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function assemble(extraction: ModelExtraction, input: AnalysisInput): FinancialAnalysis {
  const businessType: BusinessType = input.kind === "form" ? input.businessType : input.businessType ?? extraction.businessType;

  // Form input: the owner's numbers are authoritative; only take categories/flags from the model.
  const itemizedRevenue: RevenueLine[] =
    input.kind === "form"
      ? input.revenue.map((r) => {
          const m = extraction.itemizedRevenue.find((x) => x.label === r.label);
          return { ...r, margin: r.margin ?? clamp(m?.margin ?? 0.5, 0, 1) };
        })
      : extraction.itemizedRevenue.map((r) => ({ label: r.label, amount: round2(r.amount), margin: clamp(r.margin, 0, 1) }));

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

  const monthlyRevenue = round2(sum(itemizedRevenue, (r) => r.amount));
  const monthlyExpenses = round2(sum(itemizedExpenses, (e) => e.amount));

  const ruleBased = detectMissingCategories({ businessType, itemizedExpenses });
  const missingCategories = Array.from(new Set([...ruleBased.map((w) => w.category), ...extraction.missingCategories]));

  const severityRank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  const auditFlags = [
    ...extraction.auditFlags,
    ...ruleBased
      .filter((w) => !extraction.auditFlags.some((f) => f.title.toLowerCase().includes(w.category.toLowerCase())))
      .map<AuditFlag>((w) => ({ title: `Missing: ${w.category}`, severity: w.severity, message: w.message, potentialSavings: 0 })),
  ].sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.potentialSavings - a.potentialSavings);

  return {
    businessType,
    monthlyRevenue,
    itemizedRevenue,
    itemizedExpenses,
    inflationRateAssumed: DEFAULT_INFLATION_RATE,
    macroProjections: buildMacroProjections({ businessType, monthlyRevenue, monthlyExpenses }),
    auditFlags,
    missingCategories,
    winnerInsight: extraction.winnerInsight,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const input = await readInput(request);
    if (input.kind === "text" && input.text.length > MAX_TEXT_CHARS) {
      throw new HttpError(413, "This document is too long to analyze in one pass. Split it into smaller date ranges and upload each.");
    }
    const extraction = await extractWithClaude(input);
    return Response.json(assemble(extraction, input));
  } catch (err) {
    if (err instanceof HttpError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      console.error("[analyze] auth error", err.message);
      return Response.json({ error: "Analysis service is not configured (check ANTHROPIC_API_KEY)." }, { status: 500 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "We're handling a lot of analyses right now. Try again in a minute." }, { status: 429 });
    }
    if (err instanceof Anthropic.BadRequestError) {
      console.error("[analyze] bad request", err.message);
      return Response.json({ error: "The document couldn't be processed." }, { status: 400 });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("[analyze] API error", err.status, err.message);
      return Response.json({ error: "The analysis service is temporarily unavailable." }, { status: 502 });
    }
    console.error("[analyze] unexpected error", err);
    return Response.json({ error: "Unexpected error while analyzing." }, { status: 500 });
  }
}
