import Link from "next/link";
import { Lock } from "lucide-react";

export const LEGAL_DISCLAIMER =
  "LedgerPulse provides AI-driven financial analysis and projections for informational purposes only. It does not constitute professional accounting, tax, or legal advice.";

/** Legal & financial disclaimer shown on every page (rendered from the root layout). */
export function Footer() {
  return (
    <footer className="relative border-t border-white/10 bg-slate-950/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-xs text-slate-500 sm:px-6 lg:px-8">
        <p className="max-w-3xl leading-relaxed text-slate-400">{LEGAL_DISCLAIMER}</p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-3 w-3" /> Statements are parsed in memory and never stored.
          </span>
          <Link href="/dashboard" className="hover:text-slate-300">
            Dashboard
          </Link>
          <Link href="/settings" className="hover:text-slate-300">
            Settings &amp; Billing
          </Link>
          <span>© LedgerPulse</span>
        </div>
      </div>
    </footer>
  );
}
