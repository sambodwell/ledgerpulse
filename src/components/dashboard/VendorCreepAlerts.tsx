"use client";

import { useMemo, useState } from "react";
import { ArrowRight, TrendingUp } from "lucide-react";
import { documentSlices, type WorkspaceDocument } from "@/lib/supabase";
import { creepHeadline, creepTitle, creepToFlag, detectVendorCreep, type MonthLines, type VendorCreep } from "@/lib/vendorCreep";
import { exactMoney } from "@/lib/fiscal";
import { periodLabel } from "@/lib/statementPeriod";
import type { AuditFlag, Severity } from "@/lib/schemas";
import { AuditDeepDive } from "@/components/dashboard/AuditDeepDive";
import { ImplementedToggle } from "@/components/dashboard/FiscalYearTracker";
import { cn, glass } from "@/components/ui";

const SEVERITY_CHIP: Record<Severity, string> = {
  HIGH: "border-rose-400/40 bg-rose-500/15 text-rose-200",
  MEDIUM: "border-amber-400/40 bg-amber-500/15 text-amber-200",
  LOW: "border-sky-400/40 bg-sky-500/15 text-sky-200",
};

/**
 * Every saved document → one expense list per calendar month. A line repeated identically in two documents for the
 * same month (an overlapping or re-uploaded statement) is counted once, matching the batch uploader's rule.
 */
export function monthLinesFromDocs(docs: WorkspaceDocument[]): MonthLines[] {
  // period → (line key → index of the document that contributed it) + that month's lines
  const byMonth = new Map<string, { from: Map<string, number>; expenses: MonthLines["expenses"] }>();
  docs.forEach((d, di) => {
    for (const sl of documentSlices(d)) {
      const m = byMonth.get(sl.period) ?? { from: new Map<string, number>(), expenses: [] };
      for (const e of sl.items.expenses) {
        const k = `${e.label.trim().toLowerCase()}|${e.category.toLowerCase()}|${Math.round(e.amount * 100)}|${e.oneTime ? 1 : 0}`;
        const src = m.from.get(k);
        if (src !== undefined && src !== di) continue; // same line already counted from another document
        m.from.set(k, di);
        m.expenses.push(e);
      }
      byMonth.set(sl.period, m);
    }
  });
  return [...byMonth.entries()].map(([period, m]) => ({ period, expenses: m.expenses }));
}

export function useVendorCreep(docs: WorkspaceDocument[]): VendorCreep[] {
  return useMemo(() => detectVendorCreep(monthLinesFromDocs(docs)), [docs]);
}

/** Tiny bar sparkline of a vendor's monthly bill. */
function PriceSpark({ c }: { c: VendorCreep }) {
  const max = Math.max(...c.history.map((h) => h.amount));
  return (
    <span className="flex h-6 items-end gap-0.5" aria-hidden title={c.history.map((h) => `${periodLabel(h.period)}: ${exactMoney(h.amount)}`).join(" · ")}>
      {c.history.slice(-12).map((h, i, arr) => (
        <span key={h.period} className={cn("w-1.5 rounded-sm", i === arr.length - 1 ? "bg-rose-300" : "bg-slate-500/70")} style={{ height: `${Math.max(12, (h.amount / max) * 100)}%` }} />
      ))}
    </span>
  );
}

export function VendorCreepAlerts({
  creep,
  figures,
  implemented = [],
  onToggleImplemented,
}: {
  creep: VendorCreep[];
  figures: { monthlyRevenue: number; monthlyExpenses: number; personal: boolean };
  implemented?: { title: string; status: "IDENTIFIED" | "IMPLEMENTED"; since?: string }[];
  onToggleImplemented?: (flag: AuditFlag) => void;
}) {
  const [open, setOpen] = useState<VendorCreep | null>(null);
  const [showAll, setShowAll] = useState(false);
  if (!creep.length) return null;
  const visible = showAll ? creep : creep.slice(0, 4);
  const doneFor = (c: VendorCreep) => implemented.find((x) => x.title === creepTitle(c) && x.status === "IMPLEMENTED");
  const totalMonthly = creep.reduce((a, c) => a + c.increase, 0);

  return (
    <div className={cn(glass, "border-rose-300/25 p-6")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <TrendingUp className="h-5 w-5 text-rose-300" /> Vendor Price Creep
          </h2>
          <p className="mt-1 text-xs text-slate-400">Recurring {figures.personal ? "bills" : "vendor, software and utility charges"} that rose across your saved statement months.</p>
        </div>
        <span className="rounded-full border border-rose-400/30 bg-rose-500/10 px-2.5 py-1 text-xs tabular-nums text-rose-100">
          +{exactMoney(totalMonthly)}/mo · {exactMoney(totalMonthly * 12)}/yr leakage
        </span>
      </div>

      <ul className="mt-4 space-y-3">
        {visible.map((c) => {
          const done = doneFor(c);
          return (
            <li key={c.key} className={cn("rounded-xl border bg-white/[0.03] p-4", c.severity === "HIGH" ? "border-rose-300/30" : "border-white/10")}>
              <button type="button" onClick={() => setOpen(c)} className="group block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-300" aria-label={`${creepTitle(c)}: open price history and recommendations`}>
                <span className="flex items-start justify-between gap-3">
                  <span className="text-sm font-medium text-slate-100 group-hover:text-white">
                    <span className="text-rose-200">Warning:</span> {creepHeadline(c)}
                  </span>
                  <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", SEVERITY_CHIP[c.severity])}>{c.severity}</span>
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                  <PriceSpark c={c} />
                  <span className="tabular-nums">
                    +{exactMoney(c.increase)}/mo · {exactMoney(c.annualImpact)}/yr
                  </span>
                  {c.leakedToDate > 0 && <span className="tabular-nums">{exactMoney(c.leakedToDate)} overpaid so far</span>}
                  <span className="text-slate-500">{c.category}</span>
                  <span className="ml-auto inline-flex items-center gap-1 font-medium text-indigo-300 group-hover:text-indigo-200">
                    Deep dive &amp; ROI <ArrowRight className="h-3 w-3" />
                  </span>
                </span>
              </button>
              {onToggleImplemented && (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-2">
                  <p className="text-xs text-emerald-300">{done ? `Recovering ~${exactMoney(c.increase)}/mo` : `Win back ~${exactMoney(c.increase)}/mo`}</p>
                  <ImplementedToggle on={!!done} title={creepTitle(c)} since={done?.since} onToggle={() => onToggleImplemented(creepToFlag(c))} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {creep.length > visible.length && (
        <button type="button" onClick={() => setShowAll(true)} className="mt-3 text-sm text-indigo-300 hover:text-indigo-200">
          Show all {creep.length} vendors
        </button>
      )}

      {open && (
        <AuditDeepDive
          flag={creepToFlag(open)}
          figures={figures}
          priceHistory={open.history}
          implemented={!!doneFor(open)}
          implementedSince={doneFor(open)?.since}
          onClose={() => setOpen(null)}
          onToggleImplemented={onToggleImplemented ? () => onToggleImplemented(creepToFlag(open)) : undefined}
        />
      )}
    </div>
  );
}
