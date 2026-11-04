import type { ReactNode } from "react";
import { Check, Sparkles } from "lucide-react";
import { PLANS } from "@/lib/schemas";
import { cn } from "@/components/ui";

/** Pricing card with target-audience badge and feature list; `children` is the CTA slot. */
export function PlanCard({ plan, children, className }: { plan: keyof typeof PLANS; children?: ReactNode; className?: string }) {
  const p = PLANS[plan];
  const pro = plan === "pro";
  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border p-4 text-left",
        pro ? "border-amber-300/25 bg-gradient-to-br from-amber-400/10 to-transparent" : "border-white/10 bg-white/[0.03]",
        className,
      )}
    >
      <span
        className={cn(
          "self-start rounded-full px-2.5 py-0.5 text-[11px] font-medium",
          pro ? "bg-amber-300/15 text-amber-100" : "bg-indigo-400/15 text-indigo-200",
        )}
      >
        {p.badge}
      </span>
      <p className="mt-3 flex items-center gap-2 font-medium">
        {pro && <Sparkles className="h-4 w-4 text-amber-200" />} {p.name} — {p.price}
      </p>
      <ul className="mt-2 flex-1 space-y-1 text-sm text-slate-300">
        {p.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", pro ? "text-amber-200" : "text-emerald-300")} /> {f}
          </li>
        ))}
      </ul>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
