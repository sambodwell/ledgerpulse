"use client";

import type { ScenarioPoint } from "@/lib/schemas";
import { cn, usd, usdCompact } from "@/components/ui";

/** Chart colors on the dark surface. `gain`/`loss` are the scenario net-impact pair (validated ≥3:1 vs #0f172a; baseline is dashed). */
export const COLOR = {
  revenue: "#3987e5",
  expenses: "#d95926",
  cash: "#199e70",
  baseline: "#94a3b8",
  gain: "#10b981",
  loss: "#f87171",
} as const;

export const impactColor = (delta: number) => (delta >= 0 ? COLOR.gain : COLOR.loss);

export const axisProps = { stroke: "#64748b", tick: { fill: "#94a3b8", fontSize: 12 }, tickLine: false, axisLine: false } as const;

/** X-axis tick: "Jan" for a 12-month view, "Jan '27" when the horizon spans several years. */
export const monthTick = (long: boolean) => (m: string) => {
  const [mon, yr] = m.split(" ");
  return long && yr ? `${mon} '${yr.slice(2)}` : mon;
};

export function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ name?: string | number; value?: unknown; color?: string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <p className="mb-1 font-medium text-slate-200">{label}</p>
      {payload.map((p) => (
        <p key={String(p.name)} className="flex items-center gap-2 text-slate-300">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-400">{p.name}</span>
          <span className="ml-auto pl-3 tabular-nums text-slate-100">{usd.format(Number(p.value))}</span>
        </p>
      ))}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn("mt-1 font-semibold tabular-nums", tone === "good" && "text-emerald-300", tone === "bad" && "text-rose-300")}>{value}</p>
    </div>
  );
}

export const signedUsd = (n: number) => `${n >= 0 ? "+" : "−"}${usd.format(Math.abs(n))}`;

export function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Opens the browser's print dialog on a hidden iframe so the user can save the HTML as a PDF. */
export function printHtml(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.srcdoc = html;
  frame.onload = () => {
    const w = frame.contentWindow;
    if (!w) return frame.remove();
    w.addEventListener("afterprint", () => setTimeout(() => frame.remove(), 0));
    w.focus();
    w.print();
    // Fallback cleanup for browsers that don't fire afterprint.
    setTimeout(() => frame.isConnected && frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}

/** Static SVG of baseline vs adjusted cumulative runway, for printed scenario summaries (light paper). */
export function scenarioSvg(points: ScenarioPoint[], delta: number): string {
  const W = 760;
  const H = 260;
  const pad = { l: 64, r: 16, t: 12, b: 28 };
  if (!points.length) return "";
  const ys = points.flatMap((p) => [p.baselineCumulative, p.adjustedCumulative, 0]);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const x = (i: number) => pad.l + (points.length === 1 ? 0 : (i / (points.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);
  const path = (key: "baselineCumulative" | "adjustedCumulative") => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
  const ticks = [min, (min + max) / 2, max];
  const every = Math.max(1, Math.ceil(points.length / 12));
  const adjusted = delta >= 0 ? "#047857" : "#c2410c"; // darker emerald / coral for print contrast
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Baseline vs adjusted cumulative cash" style="font:11px system-ui,sans-serif">
${ticks.map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="#e5e7eb"/><text x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end" fill="#6b7280">${esc(usdCompact.format(t))}</text>`).join("")}
<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}" stroke="#9ca3af"/>
${points
  .map((p, i) => (i % every === 0 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" fill="#6b7280">${esc(monthTick(points.length > 12)(p.month))}</text>` : ""))
  .join("")}
<path d="${path("baselineCumulative")}" fill="none" stroke="#6b7280" stroke-width="2" stroke-dasharray="5 4"/>
<path d="${path("adjustedCumulative")}" fill="none" stroke="${adjusted}" stroke-width="2.5"/>
</svg>
<p style="font-size:12px;color:#374151;margin:4px 0 0"><span style="display:inline-block;width:18px;border-top:2px dashed #6b7280;vertical-align:middle"></span> Baseline &nbsp; <span style="display:inline-block;width:18px;border-top:3px solid ${adjusted};vertical-align:middle"></span> Adjusted (${delta >= 0 ? "net gain" : "net loss"})</p>`;
}
