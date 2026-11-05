"use client";

import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { PieChart as PieIcon } from "lucide-react";
import { MODE_COPY, modeOf, splitTotals, type FinancialAnalysis } from "@/lib/schemas";
import { InfoTip } from "@/components/InfoTip";
import { cn, glass, usd } from "@/components/ui";

/**
 * Categorical slots (dark steps), fixed order; validated on #0f172a: CVD ΔE ≥ 8.4, normal-vision ≥ 19.3, ≥ 3:1 contrast.
 * Slices beyond the top five fold into a neutral "Other" — never a generated hue.
 */
const SLOTS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"] as const;
const OTHER = "#64748b";
const SURFACE = "#0f172a";
const MAX_SLICES = SLOTS.length;

interface Slice {
  name: string;
  value: number;
  share: number;
  color: string;
  lines: number;
}

/** Recurring monthly expenses by category, largest first, top five + "Other". */
export function expenseSlices(a: Pick<FinancialAnalysis, "itemizedExpenses">): Slice[] {
  const byCat = new Map<string, { value: number; lines: number }>();
  for (const e of a.itemizedExpenses) {
    if (e.oneTime || !(e.amount > 0)) continue;
    const k = e.category?.trim() || "Other";
    const cur = byCat.get(k) ?? { value: 0, lines: 0 };
    byCat.set(k, { value: cur.value + e.amount, lines: cur.lines + 1 });
  }
  const sorted = [...byCat.entries()].sort((x, y) => y[1].value - x[1].value);
  const total = sorted.reduce((s, [, v]) => s + v.value, 0);
  if (total <= 0) return [];
  const head = sorted.length > MAX_SLICES ? sorted.slice(0, MAX_SLICES - 1) : sorted;
  const tail = sorted.length > MAX_SLICES ? sorted.slice(MAX_SLICES - 1) : [];
  const slices: Slice[] = head.map(([name, v], i) => ({ name, value: v.value, share: v.value / total, color: SLOTS[i], lines: v.lines }));
  if (tail.length) {
    const value = tail.reduce((s, [, v]) => s + v.value, 0);
    slices.push({ name: `Other (${tail.length} categories)`, value, share: value / total, color: OTHER, lines: tail.reduce((s, [, v]) => s + v.lines, 0) });
  }
  return slices;
}

const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Donut of where the money goes each month, with a labelled legend that doubles as the data table. */
export function ExpenseShareCard({ analysis, className }: { analysis: FinancialAnalysis; className?: string }) {
  const copy = MODE_COPY[modeOf(analysis.businessType)];
  const slices = expenseSlices(analysis);
  const [active, setActive] = useState<number | null>(null);
  const totals = splitTotals(analysis.itemizedExpenses);
  const revenue = analysis.monthlyRevenue;
  const shown = active != null ? slices[active] : null;

  return (
    <section aria-label={`${copy.expenses} share`} className={cn(glass, "p-6", className)}>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <PieIcon className="h-5 w-5 text-indigo-300" aria-hidden /> {copy.expenses} share
        <InfoTip label="How expense share is calculated" align="left">
          Recurring monthly {copy.expenses.toLowerCase()} grouped by category, as a share of the monthly total. One-time items are left out so a single purchase
          doesn&apos;t distort your run-rate. The five largest categories are shown; the rest are grouped as &ldquo;Other&rdquo;.
        </InfoTip>
      </h2>
      {slices.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">No recurring {copy.expenses.toLowerCase()} to break down yet.</p>
      ) : (
        <>
          <div className="relative mx-auto mt-4 aspect-square w-full max-w-[15rem]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="64%"
                  outerRadius="96%"
                  startAngle={90}
                  endAngle={-270}
                  stroke={SURFACE}
                  strokeWidth={2}
                  isAnimationActive={false}
                  onMouseEnter={(_, i) => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                >
                  {slices.map((s, i) => (
                    <Cell key={s.name} fill={s.color} fillOpacity={active == null || active === i ? 1 : 0.35} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active: on, payload }) => {
                    const p = on && payload?.[0] ? (payload[0].payload as Slice) : null;
                    return p ? (
                      <div className="rounded-lg border border-white/10 bg-slate-900/95 px-3 py-2 text-xs shadow-xl">
                        <p className="font-medium text-slate-100">{p.name}</p>
                        <p className="tabular-nums text-slate-300">
                          {usd.format(p.value)}/mo · {pct1(p.share)}
                        </p>
                      </div>
                    ) : null;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Hero number in the hole: total, or the hovered slice. */}
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center" aria-hidden>
              <div className="max-w-[60%]">
                <p className="truncate text-[11px] uppercase tracking-wide text-slate-400">{shown ? shown.name : "Per month"}</p>
                <p className="text-xl font-semibold tabular-nums text-slate-50">{usd.format(shown ? shown.value : totals.recurring)}</p>
                <p className="text-[11px] tabular-nums text-slate-400">{shown ? pct1(shown.share) : revenue > 0 ? `${pct1(totals.recurring / revenue)} of ${copy.revenue.toLowerCase()}` : ""}</p>
              </div>
            </div>
          </div>

          <table className="mt-4 w-full text-sm tabular-nums">
            <caption className="sr-only">{copy.expenses} by category</caption>
            <thead className="sr-only">
              <tr>
                <th>Category</th>
                <th>Monthly</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {slices.map((s, i) => (
                <tr
                  key={s.name}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  className={cn("transition", active != null && active !== i && "opacity-50")}
                >
                  <td className="py-1 pr-2">
                    <span className="flex min-w-0 items-center gap-2 text-slate-300">
                      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
                      <span className="truncate" title={s.name}>
                        {s.name}
                      </span>
                    </span>
                  </td>
                  <td className="py-1 text-right text-slate-200">{usd.format(s.value)}</td>
                  <td className="w-14 py-1 text-right text-slate-400">{pct1(s.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {totals.oneTime > 0 && <p className="mt-2 text-xs text-slate-500">+ {usd.format(totals.oneTime)} one-time, not included above.</p>}
        </>
      )}
    </section>
  );
}
