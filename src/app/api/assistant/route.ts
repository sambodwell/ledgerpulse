import Anthropic from "@anthropic-ai/sdk";
import { PRICING } from "@/lib/schemas";
import { consumeAiQuery, resolveViewer } from "@/lib/server/entitlements";

/**
 * POST /api/assistant — floating site-guide chat.
 * Body: { messages: {role, content}[], context?: { page, mode, hasAnalysis, tier } }
 *
 * The assistant receives only the chat and a few UI flags, never statement
 * contents or analysis numbers, so it can't leak or retain financial data.
 */

const MODEL = process.env.LEDGERPULSE_ASSISTANT_MODEL ?? process.env.LEDGERPULSE_MODEL ?? "claude-sonnet-5-5";
const MAX_TURNS = 12;
const MAX_CHARS = 2000;

const client = new Anthropic();

const SYSTEM = `You are the LedgerPulse guide, a concise assistant inside the LedgerPulse web app. Answer questions about using the site and help people phrase "what if" scenarios. Keep answers to a few short sentences or a short list.

What LedgerPulse does:
- Dashboard (/dashboard): enter numbers in the Guided Input Form (business types: Real Estate, Field Service, Agency/Freelance, Other/Custom with your own line items) or upload a bank statement / P&L (PDF, CSV, text). A Personal / Business toggle switches to Personal Finance mode with household categories: Rent/Mortgage, Groceries, Subscriptions, Utilities, Investments, Debt.
- Results: monthly revenue (income) and expenses, Audit Mode flags with estimated savings, a 12-month projection adjusted for seasonality and inflation, and an executive report you can save as PDF.
- Free plan shows totals and one high-severity audit flag. "Unlock Full Audit & Report" is a one-time $${PRICING.reportUnlockUsd}; Pro is $${PRICING.proMonthlyUsd}/month and adds every flag, the projection chart, scenario forecasting and the report.
- Scenario Forecasting (Pro): type things like "What if fuel costs rise 15% and I add 2 clients next quarter?" and see baseline vs adjusted runway.
- Workspaces: signed-in users create separate profiles (e.g. "123 Main St Duplex", "Lawn Service Q3", "Personal Budget") from the profile menu at top right and switch between them.
- Settings (/settings): default plan category (Personal/Family or Small Business), saved workspaces, and Stripe billing.
- Privacy: uploads are parsed in memory and never stored by LedgerPulse; they are sent to an AI model for analysis.

You don't see the user's financial data. If they ask about their specific numbers, tell them where on the dashboard to look or suggest a scenario to run. Don't give individualized tax, legal, or investment advice; you can explain general concepts and suggest talking to a CPA or advisor for decisions. If you don't know something about the product, say so.`;

function sanitize(body: unknown): { messages: Anthropic.Beta.BetaMessageParam[]; context: string } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { messages?: unknown; context?: Record<string, unknown> };
  if (!Array.isArray(b.messages)) return null;
  const messages = b.messages
    .slice(-MAX_TURNS)
    .filter((m): m is { role: "user" | "assistant"; content: string } => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string" && m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages.at(-1)!.role !== "user") return null;

  const c = b.context ?? {};
  const context = [
    typeof c.page === "string" ? `page=${c.page.slice(0, 40)}` : null,
    c.mode === "PERSONAL" || c.mode === "BUSINESS" ? `mode=${c.mode}` : null,
    typeof c.hasAnalysis === "boolean" ? `hasAnalysis=${c.hasAnalysis}` : null,
    c.tier === "pro" || c.tier === "free" ? `tier=${c.tier}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return { messages, context };
}

export async function POST(request: Request) {
  const parsed = sanitize(await request.json().catch(() => null));
  if (!parsed) return Response.json({ error: "Send at least one user message." }, { status: 400 });

  // Meter before calling the model so the monthly cap protects API spend.
  const quota = await consumeAiQuery(await resolveViewer(request));
  if (!quota.ok) return Response.json({ error: quota.error }, { status: quota.status });

  try {
    const message = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: parsed.context ? `${SYSTEM}\n\nCurrent UI state: ${parsed.context}.` : SYSTEM,
      messages: parsed.messages,
    });
    if (message.stop_reason === "refusal") {
      return Response.json({ reply: "I can't help with that one, but I'm happy to answer questions about using LedgerPulse." });
    }
    const reply = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return Response.json({ reply: reply || "Sorry, I didn't catch that. Could you rephrase?" }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return Response.json({ error: "The assistant is busy. Try again shortly." }, { status: 429 });
    if (err instanceof Anthropic.APIError) {
      console.error("[assistant] API error", err.status, err.message);
      return Response.json({ error: "The assistant is temporarily unavailable." }, { status: 502 });
    }
    console.error("[assistant] unexpected error", err instanceof Error ? err.name : typeof err);
    return Response.json({ error: "The assistant is temporarily unavailable." }, { status: 500 });
  }
}
