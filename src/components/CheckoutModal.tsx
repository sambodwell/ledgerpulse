"use client";

import { useState } from "react";
import { Check, CreditCard, KeyRound, Loader2, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { Modal } from "@/components/Modal";
import { ANNUAL_SAVINGS_PCT, ANNUAL_SAVINGS_USD, PRICING } from "@/lib/schemas";
import { authHeaders } from "@/lib/supabase";
import { cn, errorMessage, inputCls, primaryBtn } from "@/components/ui";

export type ProInterval = "monthly" | "annual";
export type CheckoutKind = "pro" | "pro_annual" | "report";
export type CheckoutBusy = CheckoutKind | "unlock" | null;

const PRO_UNLOCKS = [
  "Interactive Pro dashboard: cash-flow charts, what-if sliders and scenario forecasting",
  "Rolling 12–60 month projections with seasonality and live inflation",
  "Every audit flag with savings estimates and strategy deep-dives",
  "Downloadable Executive PDF reports",
  "Unlimited analyses across Business and Personal workspaces",
  "50 AI assistant queries a month",
];

/**
 * The paywall. Pro monthly / annual go to Stripe Checkout (via `onCheckout`); a VIP access code is verified
 * server-side (/api/verify-promo-code) and calls `onUnlocked` on success.
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
  /** Optional one-time purchase / credit spend for just the current analysis. */
  report?: { credits: number; onUseCredit?: () => void };
}) {
  const [interval, setBillingInterval] = useState<ProInterval>("annual");
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeOk, setCodeOk] = useState(false);
  const annual = interval === "annual";
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
      setCodeOk(true);
      await onUnlocked();
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : "Couldn't verify the code.");
    } finally {
      setCodeBusy(false);
    }
  };

  return (
    <Modal
      size="lg"
      dismissible={!working}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber-200" aria-hidden /> Unlock Sumhaven Pro
        </span>
      }
      subtitle={
        lockedFlagCount > 0
          ? `Your preview is ready. ${lockedFlagCount} more audit finding${lockedFlagCount === 1 ? "" : "s"}, your projections and the executive report are waiting.`
          : "Your preview is ready. Upgrade to open the full interactive dashboard, projections and reports."
      }
    >
      <div className="grid gap-5 md:grid-cols-[1fr_17rem]">
        <ul className="space-y-2.5 text-sm text-slate-300">
          {PRO_UNLOCKS.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden /> {f}
            </li>
          ))}
        </ul>

        <div className="rounded-xl border border-amber-300/25 bg-gradient-to-br from-amber-400/10 via-indigo-500/5 to-transparent p-4">
          <div role="radiogroup" aria-label="Billing interval" className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-slate-950/40 p-1 text-xs font-medium">
            {(["monthly", "annual"] as const).map((i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={interval === i}
                onClick={() => setBillingInterval(i)}
                className={cn("rounded-md px-2 py-1.5 transition", interval === i ? "bg-indigo-500 text-white" : "text-slate-300 hover:bg-white/5")}
              >
                {i === "monthly" ? "Monthly" : "Annual"}
              </button>
            ))}
          </div>

          <p className="mt-4 flex items-baseline gap-1">
            <span className="text-4xl font-semibold tracking-tight tabular-nums">${annual ? PRICING.proAnnualUsd : PRICING.proMonthlyUsd}</span>
            <span className="text-sm text-slate-400">/{annual ? "year" : "month"}</span>
          </p>
          <p className="mt-1 min-h-[2.5rem] text-xs text-slate-400">
            {annual ? (
              <>
                <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 font-medium text-emerald-200">Save {ANNUAL_SAVINGS_PCT}%</span> ≈ ${(PRICING.proAnnualUsd / 12).toFixed(2)}/mo · ${ANNUAL_SAVINGS_USD} less than monthly, about 2 months free
              </>
            ) : (
              <>Billed monthly. Cancel anytime.</>
            )}
          </p>

          <button type="button" onClick={() => onCheckout(annual ? "pro_annual" : "pro")} disabled={working} className={cn(primaryBtn, "mt-4 w-full shadow-lg shadow-indigo-500/25")}>
            {busy === "pro" || busy === "pro_annual" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
            {signedIn ? "Continue to secure checkout" : "Sign in to upgrade"}
          </button>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
            <Lock className="h-3 w-3" aria-hidden /> Secure payment by Stripe · shows as SUMHAVEN PRO
          </p>
        </div>
      </div>

      {message && <p className="mt-4 rounded-lg border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">{message}</p>}

      <div className="mt-5 flex flex-col gap-3 border-t border-white/10 pt-4 text-sm">
        {report && (report.credits > 0 && report.onUseCredit ? (
          <button type="button" onClick={report.onUseCredit} disabled={working} className="self-start text-indigo-300 hover:text-indigo-200 disabled:opacity-50">
            {busy === "unlock" && <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />}
            Use 1 of your {report.credits} full-report credit{report.credits === 1 ? "" : "s"} for just this analysis
          </button>
        ) : (
          <button type="button" onClick={() => onCheckout("report")} disabled={working} className="self-start text-slate-400 hover:text-slate-200 disabled:opacity-50">
            {busy === "report" && <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />}
            Just need this one report? Unlock it for ${PRICING.reportUnlockUsd} one-time
          </button>
        ))}

        {codeOk ? (
          <p className="flex items-center gap-2 text-emerald-200" role="status">
            <ShieldCheck className="h-4 w-4" /> Access code accepted. Pro is unlocked{busy === "unlock" ? ", opening your full report…" : "."}
          </p>
        ) : !showCode ? (
          <button type="button" onClick={() => setShowCode(true)} className="inline-flex items-center gap-1.5 self-start text-amber-200 hover:text-amber-100">
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
