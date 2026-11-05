"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Lightbulb, Loader2, MessageCircle, Send, ShieldAlert, Sparkles, Target, X } from "lucide-react";
import type { AuditFlag, Severity } from "@/lib/schemas";
import { exactMoney } from "@/lib/fiscal";
import { authHeaders } from "@/lib/supabase";
import { cn, errorMessage, glass, inputCls, primaryBtn } from "@/components/ui";

interface Playbook {
  why: string;
  strategy: string;
  steps: string[];
  questions: string[];
}

interface Figures {
  monthlyRevenue: number;
  monthlyExpenses: number;
  personal: boolean;
}

/** General strategy for the kind of issue a flag describes, matched on its title / message. */
function playbookFor(flag: AuditFlag, f: Figures): Playbook {
  const text = `${flag.title} ${flag.message}`.toLowerCase();
  const has = (...words: string[]) => words.some((w) => text.includes(w));
  const three = exactMoney(f.monthlyExpenses * 3);
  const six = exactMoney(f.monthlyExpenses * 6);
  const tenPct = exactMoney(Math.max(0, f.monthlyRevenue * 0.1));

  if (has("emergency", "cash reserve", "rainy", "reserve fund", "cushion")) {
    return {
      why: "Without a cash cushion, one surprise — a repair, a slow month, a medical bill — goes straight onto high-interest credit and can undo months of progress.",
      strategy: f.personal
        ? `Build an emergency fund of 3–6 months of essential spending. At your current spending that's roughly ${three} to ${six}. Start with a first milestone of one month, then grow it automatically.`
        : `Hold an operating reserve of 3–6 months of fixed costs (about ${three} to ${six} at your current expense level) in a separate account, so payroll, rent and suppliers are covered through a slow stretch.`,
      steps: [
        "Open a separate high-yield savings account so the reserve isn't mixed with day-to-day money.",
        `Automate a transfer on payday — even ${tenPct}/mo (about 10% of income) builds a meaningful buffer within a year.`,
        "Route windfalls (tax refunds, bonuses, one-time revenue) straight into the reserve until the first milestone is hit.",
        "Only use it for true emergencies, and refill it before resuming extra investing.",
      ],
      questions: ["How many months of expenses should my reserve cover?", "Where should I keep an emergency fund?", "Should I build savings before paying off debt?"],
    };
  }
  if (has("invest", "retirement", "401", "ira", "brokerage", "saving less", "savings rate", "20%")) {
    return {
      why: "Money that isn't invested loses ground to inflation, and starting late means missing years of compound growth that are hard to make up later.",
      strategy: f.personal
        ? "Aim to direct 15–20% of take-home pay to savings and investments once a starter emergency fund is in place. Capture any employer match first — it's an instant return."
        : "Once a cash reserve is in place, set aside a fixed share of profit for the owner's retirement (e.g. a SEP-IRA or Solo 401(k)) and for reinvestment in the highest-margin parts of the business.",
      steps: [
        "Confirm you have a starter emergency fund and no high-interest debt first.",
        f.personal ? "Contribute at least enough to get the full employer 401(k) match." : "Compare a SEP-IRA vs. Solo 401(k) for contribution limits and tax deductions.",
        "Automate contributions right after each paycheck or owner draw so it happens before spending.",
        "Use low-cost, diversified index funds unless you have a specific reason not to; revisit the allocation yearly.",
      ],
      questions: ["What's the difference between a Roth and traditional account?", "How much should I invest each month?", "Should I invest or pay down my mortgage?"],
    };
  }
  if (has("subscription", "unused", "overlap", "duplicate")) {
    return {
      why: "Recurring charges are easy to forget and add up quietly — overlapping or unused services are often the fastest savings available.",
      strategy: "List every recurring charge, cancel what you haven't used in the last 30–60 days, and consolidate overlapping services onto one plan.",
      steps: ["Export the last 2–3 months of statements and highlight every repeating charge.", "Cancel or downgrade anything unused; ask for a retention discount on the rest.", "Move annual-billing items to a calendar reminder a week before renewal.", "Mark this saving Implemented in the ROI & Savings Tracker once it's done."],
      questions: ["How do I find all my subscriptions?", "Is annual billing worth it?"],
    };
  }
  if (has("debt", "interest", "apr", "credit card", "loan")) {
    return {
      why: "High-interest balances compound against you; every dollar of interest is a dollar that can't go to savings or growth.",
      strategy: "Pay minimums on everything, then put every extra dollar on the highest-rate balance first (avalanche) — or the smallest balance first if quick wins keep you motivated (snowball).",
      steps: ["List each balance with its APR and minimum payment.", "Ask issuers for a lower rate, or consider a 0% balance transfer if you can repay within the promo period.", "Automate an extra fixed payment toward the target balance.", "Avoid adding new balances while paying down."],
      questions: ["Avalanche or snowball — which is better for me?", "Is a balance transfer worth the fee?"],
    };
  }
  if (has("tax", "deduct", "write-off", "1099", "estimated")) {
    return {
      why: "Missed deductions and under-reserved taxes mean paying more than you owe — or a large surprise bill with penalties.",
      strategy: "Set aside a fixed percentage of revenue for taxes in a separate account, track deductible expenses as they happen, and review with a CPA before year-end.",
      steps: ["Move 25–30% of net profit to a tax savings account each month (adjust with your CPA).", "Categorize every business expense as it clears — receipts included.", "Pay quarterly estimated taxes on time to avoid underpayment penalties.", "Review common deductions for your business type (home office, mileage, equipment, software)."],
      questions: ["How much should I set aside for taxes?", "What deductions do small businesses often miss?"],
    };
  }
  if (has("concentration", "single client", "one client", "depend")) {
    return {
      why: "When one customer or stream makes up most of revenue, losing it can wipe out the business overnight.",
      strategy: "Keep the anchor client, but deliberately grow the next two or three streams until no single one is more than ~30–40% of revenue.",
      steps: ["Identify the next-best stream by margin in Line Items.", "Set a monthly target for new clients outside the anchor account.", "Put longer-term contracts or notice periods in place with the anchor client.", "Use Scenario Forecasting to test losing the largest client."],
      questions: ["How do I model losing my biggest client?", "What's a healthy revenue concentration?"],
    };
  }
  if (has("increase", "rose", "price", "jump", "higher than")) {
    return {
      why: "A cost that quietly rises month over month compounds into a much bigger annual expense.",
      strategy: "Confirm the increase, then renegotiate, re-quote with a competitor, or switch plans.",
      steps: ["Compare the last 3 statements for this line to confirm the trend.", "Get two competing quotes and use them to renegotiate.", "Ask for a loyalty discount or lock-in rate.", "Track the new rate in Line Items and mark the saving Implemented."],
      questions: ["How do I negotiate a lower rate?", "When is it worth switching providers?"],
    };
  }
  if (flag.source === "MISSING_CATEGORY" || has("missing")) {
    return {
      why: "An essential cost that isn't in your numbers usually means the plan is too optimistic — or there's a real gap in protection.",
      strategy: "Either add the missing cost so the forecast is realistic, or put coverage in place if it's genuinely missing.",
      steps: ["Check whether you pay this from another account that wasn't uploaded.", "If it's paid elsewhere, add it in Edit Items so the projection is accurate.", "If you don't have it, get quotes and decide whether the risk is worth covering."],
      questions: ["Why is this category considered essential?", "How do I add a missing expense?"],
    };
  }
  return {
    why: "This item stood out in your numbers compared with typical benchmarks for your category.",
    strategy: "Confirm the figure, decide whether it's a one-off or recurring, then act on the recurring part first — that's where the savings compound.",
    steps: ["Verify the amount against your latest statement.", "If it's recurring, pick one concrete change (cancel, renegotiate, re-quote).", "Mark the saving Implemented in the ROI & Savings Tracker to watch the realized savings add up."],
    questions: ["How should I prioritize these recommendations?", "What does this flag mean?"],
  };
}

const SEVERITY_TONE: Record<Severity, string> = {
  HIGH: "border-rose-400/40 bg-rose-500/15 text-rose-200",
  MEDIUM: "border-amber-400/40 bg-amber-500/15 text-amber-200",
  LOW: "border-sky-400/40 bg-sky-500/15 text-sky-200",
};

interface Msg {
  role: "user" | "assistant";
  content: string;
}

/** Detail view for one audit flag: why it matters, the strategy, concrete steps, and follow-up Q&A with the guide. */
export function AuditDeepDive({ flag, figures, onClose, implemented, onToggleImplemented }: { flag: AuditFlag; figures: Figures; onClose: () => void; implemented?: boolean; onToggleImplemented?: () => void }) {
  const titleId = useId();
  const pb = playbookFor(flag, figures);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  // The first question carries the recommendation it's about, so the guide can answer in context.
  const context = `About my LedgerPulse audit recommendation "${flag.title}" (${flag.severity} priority): ${flag.message}`.slice(0, 900);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const shown: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(shown);
    setDraft("");
    setBusy(true);
    try {
      const sent = shown.map((m, i) => (i === 0 ? { ...m, content: `${context}\n\nMy question: ${m.content}` } : m));
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ messages: sent, context: { page: "/dashboard#audit", mode: figures.personal ? "PERSONAL" : "BUSINESS", hasAnalysis: true } }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      const data = (await res.json()) as { reply?: string };
      setMessages((m) => [...m, { role: "assistant", content: data.reply ?? "…" }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: e instanceof Error ? e.message : "Something went wrong." }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn(glass, "flex max-h-[92vh] w-full max-w-2xl flex-col bg-slate-900/95")}>
        <header className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-xs">
              <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium", SEVERITY_TONE[flag.severity])}>
                {flag.severity === "HIGH" ? <ShieldAlert className="h-3 w-3" /> : flag.severity === "MEDIUM" ? <AlertTriangle className="h-3 w-3" /> : <Info className="h-3 w-3" />} {flag.severity} priority
              </span>
              {flag.potentialSavings > 0 && (
                <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
                  ~{exactMoney(flag.potentialSavings)}/mo · {exactMoney(flag.potentialSavings * 12)}/yr
                </span>
              )}
            </p>
            <h2 id={titleId} className="mt-2 text-lg font-semibold text-slate-50">
              {flag.title}
            </h2>
            <p className="mt-1 text-sm text-slate-300">{flag.message}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div ref={listRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4 text-sm">
          <section>
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-300" /> Why it matters
            </h3>
            <p className="mt-1.5 text-slate-300">{pb.why}</p>
          </section>
          <section>
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Target className="h-3.5 w-3.5 text-indigo-300" /> Strategy
            </h3>
            <p className="mt-1.5 text-slate-200">{pb.strategy}</p>
          </section>
          <section>
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Lightbulb className="h-3.5 w-3.5 text-emerald-300" /> Recommended steps
            </h3>
            <ol className="mt-2 space-y-2">
              {pb.steps.map((s, i) => (
                <li key={s} className="flex gap-2.5 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-slate-300">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-indigo-500/25 text-[11px] font-semibold text-indigo-100">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            {onToggleImplemented && flag.potentialSavings > 0 && (
              <button
                type="button"
                onClick={onToggleImplemented}
                className={cn(
                  "mt-3 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs",
                  implemented ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100" : "border-white/15 text-slate-200 hover:bg-white/10",
                )}
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> {implemented ? "Marked implemented" : "Mark as implemented"}
              </button>
            )}
          </section>

          <section aria-label="Ask a follow-up question" className="rounded-xl border border-indigo-300/20 bg-indigo-500/[0.05] p-3">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-200">
              <Sparkles className="h-3.5 w-3.5" /> Ask the LedgerPulse guide
            </h3>
            {messages.length === 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {pb.questions.map((q) => (
                  <button key={q} type="button" onClick={() => void ask(q)} className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 hover:bg-white/5">
                    {q}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2 space-y-2" aria-live="polite">
              {messages.map((m, i) => (
                <p
                  key={i}
                  className={cn(
                    "max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2",
                    m.role === "user" ? "ml-auto rounded-br-sm bg-indigo-500/80 text-white" : "rounded-bl-sm bg-white/[0.06] text-slate-200",
                  )}
                >
                  {m.content}
                </p>
              ))}
              {busy && (
                <p className="inline-flex items-center gap-2 rounded-2xl bg-white/[0.06] px-3 py-2 text-slate-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
                </p>
              )}
            </div>
          </section>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(draft);
          }}
          className="flex gap-2 border-t border-white/10 p-3"
        >
          <MessageCircle className="mt-2 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask a follow-up about this recommendation…" aria-label="Follow-up question" maxLength={1000} className={inputCls} />
          <button type="submit" disabled={busy || !draft.trim()} aria-label="Send" className={cn(primaryBtn, "px-3")}>
            <Send className="h-4 w-4" />
          </button>
        </form>
        <p className="px-4 pb-3 text-[10px] text-slate-500">General guidance only — not accounting, tax, legal or investment advice. Your question includes this recommendation&apos;s title and text.</p>
      </section>
    </div>
  );
}
