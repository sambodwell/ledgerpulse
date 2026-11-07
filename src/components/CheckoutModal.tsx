"use client";

import { useState } from "react";
import { Check, CreditCard, FileText, KeyRound, Loader2, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { Modal } from "@/components/Modal";
import { ANNUAL_SAVINGS_PCT, ANNUAL_SAVINGS_USD, PRICING } from "@/lib/schemas";
import { authHeaders } from "@/lib/supabase";
import { cn, errorMessage, inputCls, primaryBtn, secondaryBtn } from "@/components/ui";

export type ProInterval = "monthly" | "annual";
export type CheckoutKind = "pro" | "pro_annual" | "report";
export type CheckoutBusy = CheckoutKind | "unlock" | null;
/** Why the paywall opened: before an analysis (strict gate), on an old locked preview, or from Settings / a menu. */
export type PaywallReason = "analyze" | "preview" | "upgrade";

const PRO_UNLOCKS = [
  "Unlimited statement uploads and AI analyses across Business and Personal workspaces",
  "Every audit flag with savings estimates and strategy deep-dives",
  "Interactive dashboard: cash-flow charts, what-if sliders and scenario forecasting",
  "Rolling 12–60 month projections with seasonality and live inflation",
  "Executive PDF reports you can download and share by link",
  "50 AI assistant queries a month",
];

const PLANS: { id: ProInterval; kind: CheckoutKind; label: string; price: number; per: string; note: string }[] = [
  { id: "monthly", kind: "pro", label: "Monthly", price: PRICING.proMonthlyUsd, per: "/month", note: "Billed monthly. Cancel anytime." },
  { id: "annual", kind: "pro_annual", label: "Annual", price: PRICING.proAnnualUsd, per: "/year", note: `≈ $${(PRICING.proAnnualUsd / 12).toFixed(2)}/mo · $${ANNUAL_SAVINGS_USD} less than monthly` },
];

const SUBTITLE: Record<PaywallReason, string> = {
  analyze: "Analyses and reports are part of Sumhaven Pro. Choose a plan to upload statements and generate your full audit.",
  preview: "Upgrade to open the full audit, projections and executive report for this analysis.",
  upgrade: "Unlock unlimited analyses, the interactive dashboard and shareable executive reports.",
};

/**
 * The paywall. Pro (monthly $39 / annual $399) is the primary choice; a one-time Executive Report is the secondary
 * option. All three go to Stripe Checkout via `onCheckout`. A VIP access code is verified server-side
 * (/api/verify-promo-code) and calls `onUnlocked` on success.
 */
export function CheckoutModal({
  onClose,
  onCheckout,
  onUnlocked,
  busy,
  message,
  signedIn,
  onSignIn,
  lockedFlagCount = 0,
  report,
  reason = "upgrade",
}: {
  onClose: () => void;
  onCheckout: (kind: CheckoutKind) => void;
  /** After a valid access code: refresh the plan and unlock whatever was locked. */
  onUnlocked: () => Promise<void> | void;
  busy: CheckoutBusy;
  message?: string | null;
  signedIn: boolean;
  onSignIn: () => void;
  lockedFlagCount?: number;
  /** Credits on hand; `onUseCredit` spends one on the analysis currently on screen (old locked previews only). */
  report?: { credits: number; onUseCredit?: () => void };
  reason?: PaywallReason;
}) {
  const [interval, setBillingInterval] = useState<ProInterval>("annual");
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  /** true = accepted; a string = accepted, with time-limited (VIP) Pro ending at that ISO date. */
  const [codeOk, setCodeOk] = useState<boolean | string>(false);
  const plan = PLANS.find((p) => p.id === interval)!;
  const working = !!busy || codeBusy;

  const redeem = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!signedIn) return onSignIn();
    const value = code.trim();
    if (!value) return setCodeError("Enter your access code.");
    setCodeBusy(true);
    setCodeError(null);
    try {
      const res = await fetch("/api/verify-promo-code", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ code: value }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      const out = (await res.json().catch(() => ({}))) as { expiresAt?: unknown };
      setCodeOk(typeof out.expiresAt === "string" ? out.expiresAt : true);
      await onUnlocked();
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : "Couldn't verify the code.");
    } finally {
      setCodeBusy(false);
    }
  };

  const subtitle =
    reason === "preview" && lockedFlagCount > 0
      ? `${lockedFlagCount} more audit finding${lockedFlagCount === 1 ? "" : "s"}, your projections and the executive report are waiting.`
      : SUBTITLE[reason];
  const canUseCredit = !!report && report.credits > 0 && !!report.onUseCredit;

  return (
    <Modal
      size="lg"
      dismissible={!working}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber-200" aria-hidden /> Upgrade to Sumhaven Pro
        </span>
      }
      subtitle={subtitle}
    >
      {/* Primary: Pro */}
      <section aria-labelledby="pro-heading" className="rounded-2xl border border-amber-300/30 bg-gradient-to-br from-amber-400/10 via-indigo-500/5 to-transparent p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="pro-heading" className="flex items-center gap-2 font-semibold">
            Sumhaven Pro <span className="rounded-full border border-amber-300/40 bg-amber-400/15 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-200">Recommended</span>
          </h3>
          <p className="text-xs text-slate-400">Everything, unlimited</p>
        </div>

        <div role="radiogroup" aria-label="Pro billing" className="mt-4 grid gap-3 sm:grid-cols-2">
          {PLANS.map((p) => {
            const selected = interval === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setBillingInterval(p.id)}
                className={cn(
                  "relative rounded-xl border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300",
                  selected ? "border-indigo-400 bg-indigo-500/15 ring-1 ring-indigo-400/60" : "border-white/10 bg-slate-950/30 hover:border-white/25",
                )}
              >
                {p.id === "annual" && (
                  <span className="absolute -top-2.5 right-3 rounded-full bg-emerald-400/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-950">Save {ANNUAL_SAVINGS_PCT}%</span>
                )}
                <span className="flex items-center justify-between gap-2 text-sm font-medium text-slate-200">
                  {p.label}
                  <span className={cn("grid h-4 w-4 place-items-center rounded-full border", selected ? "border-indigo-300 bg-indigo-400" : "border-white/30")} aria-hidden>
                    {selected && <Check className="h-3 w-3 text-white" />}
                  </span>
                </span>
                <span className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-semibold tracking-tight tabular-nums">${p.price}</span>
                  <span className="text-sm text-slate-400">{p.per}</span>
                </span>
                <span className="mt-1 block text-xs text-slate-400">{p.note}</span>
              </button>
            );
          })}
        </div>

        <ul className="mt-4 grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
          {PRO_UNLOCKS.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden /> {f}
            </li>
          ))}
        </ul>

        <button type="button" onClick={() => onCheckout(plan.kind)} disabled={working} className={cn(primaryBtn, "mt-5 w-full shadow-lg shadow-indigo-500/25")}>
          {busy === "pro" || busy === "pro_annual" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
          {signedIn ? `Get Pro ${plan.label.toLowerCase()} · $${plan.price}${plan.per}` : "Sign in to upgrade"}
        </button>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
          <Lock className="h-3 w-3" aria-hidden /> Secure payment by Stripe · shows as SUMHAVEN PRO
        </p>
      </section>

      {message && <p className="mt-4 rounded-lg border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">{message}</p>}

      {/* Secondary: one-time Executive Report */}
      <section aria-labelledby="report-heading" className="mt-4 flex flex-col gap-3 rounded-xl border border-white/10 bg-slate-950/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <FileText className="mt-0.5 h-5 w-5 shrink-0 text-indigo-300" aria-hidden />
          <div>
            <h3 id="report-heading" className="text-sm font-medium text-slate-200">
              Just need one report? <span className="tabular-nums text-slate-100">${PRICING.reportUnlockUsd} one-time</span>
            </h3>
            <p className="mt-0.5 text-xs text-slate-400">
              {canUseCredit
                ? `You have ${report!.credits} Executive Report credit${report!.credits === 1 ? "" : "s"}.`
                : "One full analysis with the complete audit and a downloadable Executive PDF report. No subscription."}
            </p>
          </div>
        </div>
        {canUseCredit ? (
          <button type="button" onClick={report!.onUseCredit} disabled={working} className={cn(secondaryBtn, "shrink-0")}>
            {busy === "unlock" && <Loader2 className="h-4 w-4 animate-spin" />} Use 1 credit
          </button>
        ) : (
          <button type="button" onClick={() => onCheckout("report")} disabled={working} className={cn(secondaryBtn, "shrink-0")}>
            {busy === "report" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} {signedIn ? `Buy one report · $${PRICING.reportUnlockUsd}` : "Sign in to buy"}
          </button>
        )}
      </section>

      <div className="mt-4 border-t border-white/10 pt-4 text-sm">
        {codeOk ? (
          <p className="flex items-center gap-2 text-emerald-200" role="status">
            <ShieldCheck className="h-4 w-4" /> Access code accepted. Pro is unlocked{typeof codeOk === "string" ? ` until ${new Date(codeOk).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : ""}{busy === "unlock" ? ", opening your full report…" : "."}
          </p>
        ) : !showCode ? (
          <button type="button" onClick={() => setShowCode(true)} className="inline-flex items-center gap-1.5 text-amber-200 hover:text-amber-100">
            <KeyRound className="h-4 w-4" aria-hidden /> Have a VIP Access Code?
          </button>
        ) : (
          <form onSubmit={redeem} className="flex flex-col gap-2">
            <label htmlFor="vip-code" className="text-xs font-medium text-slate-300">
              VIP access code
            </label>
            <div className="flex gap-2">
              <input
                id="vip-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={64}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="Enter code"
                className={cn(inputCls, "font-mono uppercase tracking-wider")}
                autoFocus
              />
              <button type="submit" disabled={working} className={cn(primaryBtn, "shrink-0")}>
                {codeBusy && <Loader2 className="h-4 w-4 animate-spin" />} {signedIn ? "Apply" : "Sign in"}
              </button>
            </div>
            {codeError && <p className="text-sm text-rose-300">{codeError}</p>}
          </form>
        )}
      </div>
    </Modal>
  );
}
