"use client";

import { useState } from "react";
import { RotateCcw, SlidersHorizontal, Wand2 } from "lucide-react";
import {
  BUSINESS_TYPE_LABELS,
  MAX_SEASONALITY_STRENGTH,
  SEASONALITY,
  curveFromActuals,
  effectiveSeasonalCurve,
  type BusinessType,
  type SeasonalCurve,
} from "@/lib/schemas";
import { recurringExpenses, type MonthActual } from "@/lib/fiscal";
import { InfoTip } from "@/components/InfoTip";
import { cn } from "@/components/ui";

const MONTH_INITIALS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface SeasonalityPatch {
  seasonalityStrength?: number;
  seasonalCustom?: SeasonalCurve | null;
}

/** Logged actuals → one entry per calendar month (several years of the same month are averaged). */
export function actualsByCalendarMonth(actuals: Record<string, MonthActual>) {
  const acc = new Map<number, { revenue: number; expenses: number; n: number }>();
  for (const [key, a] of Object.entries(actuals)) {
    const month = Number(key.slice(5, 7)) - 1;
    if (!(month >= 0 && month <= 11)) continue;
    const cur = acc.get(month) ?? { revenue: 0, expenses: 0, n: 0 };
    acc.set(month, { revenue: cur.revenue + a.revenue, expenses: cur.expenses + recurringExpenses(a), n: cur.n + 1 });
  }
  return [...acc.entries()].map(([month, v]) => ({ month, revenue: v.revenue / v.n, expenses: v.expenses / v.n }));
}

/**
 * Seasonality transparency + control: shows the month-by-month multipliers actually applied, explains where they
 * come from, and lets the owner scale them (strength), edit individual months, or fit them to logged actuals.
 */
export function SeasonalityControls({
  businessType,
  strength,
  custom,
  actuals,
  onChange,
  compact = false,
  className,
}: {
  businessType: BusinessType;
  strength: number;
  custom: SeasonalCurve | null;
  /** Logged monthly actuals (Fiscal Year Tracker), for "Fit to my actuals". */
  actuals?: Record<string, MonthActual>;
  onChange: (patch: SeasonalityPatch) => void;
  compact?: boolean;
  className?: string;
}) {
  const [side, setSide] = useState<"revenue" | "expenses">("revenue");
  const [editing, setEditing] = useState(false);
  const effective = effectiveSeasonalCurve(businessType, strength, custom);
  const raw = custom ?? SEASONALITY[businessType];
  const values = effective[side];
  const fit = actuals ? curveFromActuals(actualsByCalendarMonth(actuals)) : null;
  const loggedMonths = actuals ? actualsByCalendarMonth(actuals).length : 0;
  const flatDefault = !custom && SEASONALITY[businessType][side].every((v) => v === 1);
  const peak = values.reduce((best, v, i) => (v > values[best] ? i : best), 0);
  const low = values.reduce((best, v, i) => (v < values[best] ? i : best), 0);
  const maxDev = Math.max(0.05, ...values.map((v) => Math.abs(v - 1)));

  const setMonth = (i: number, v: number) => {
    const next: SeasonalCurve = { revenue: [...raw.revenue], expenses: [...raw.expenses] };
    next[side][i] = Math.min(3, Math.max(0.2, v));
    onChange({ seasonalCustom: next });
  };

  return (
    <div className={cn("rounded-lg border border-white/10 bg-slate-950/40 p-3 text-xs", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-medium text-slate-200">
          <SlidersHorizontal className="h-3.5 w-3.5 text-indigo-300" aria-hidden /> Seasonal weighting
          <InfoTip label="How seasonality is calculated" align="left">
            <span className="block">
              <strong className="font-medium text-slate-100">Where the curve comes from:</strong>{" "}
              {custom
                ? "your custom month-by-month curve."
                : `typical historical month-to-month variance for ${BUSINESS_TYPE_LABELS[businessType].toLowerCase()} (e.g. field service peaks in summer, agencies see a Q4 budget flush).`}
            </span>
            <span className="mt-1 block">
              Each month gets a multiplier around 1.00. The 12 months always average exactly 1.00, so seasonality shifts <em>when</em> money arrives without changing the annual
              total.
            </span>
            <span className="mt-1 block">
              <strong className="font-medium text-slate-100">Strength</strong> scales the swing: multiplier = 1 + strength × (curve − 1). 0% = flat, 100% = the full curve, 200% =
              twice as pronounced.
            </span>
            <span className="mt-1 block">
              <strong className="font-medium text-slate-100">Fit to my actuals</strong> builds the curve from your logged months (each month ÷ your average month).
            </span>
          </InfoTip>
        </p>
        <div role="radiogroup" aria-label="Curve shown" className="inline-flex rounded-md border border-white/10 p-0.5">
          {(["revenue", "expenses"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={side === k}
              onClick={() => setSide(k)}
              className={cn("rounded px-2 py-0.5 capitalize transition", side === k ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200")}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* Strength knob */}
      <label className="mt-3 flex items-center gap-3">
        <span className="w-14 shrink-0 text-slate-400">Strength</span>
        <input
          type="range"
          min={0}
          max={MAX_SEASONALITY_STRENGTH * 100}
          step={5}
          value={Math.round(strength * 100)}
          onChange={(e) => onChange({ seasonalityStrength: Number(e.target.value) / 100 })}
          aria-valuetext={`${Math.round(strength * 100)} percent`}
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-indigo-400"
        />
        <span className="w-11 shrink-0 text-right font-medium tabular-nums text-slate-100">{Math.round(strength * 100)}%</span>
      </label>

      {/* Curve preview: bars above / below 1.00 */}
      <div className="mt-3" aria-label={`${side} multipliers by month`} role="img">
        <div className="grid h-16 grid-cols-12 items-center gap-0.5">
          {values.map((v, i) => {
            const h = (Math.abs(v - 1) / maxDev) * 50;
            return (
              <div key={i} className="relative h-full" title={`${MONTH_SHORT[i]}: × ${v.toFixed(2)}`}>
                <div className="absolute inset-x-0 top-1/2 h-px bg-white/15" />
                <div
                  className={cn("absolute inset-x-0.5 rounded-sm", v >= 1 ? (side === "revenue" ? "bg-emerald-400/70" : "bg-rose-400/70") : "bg-slate-500/60")}
                  style={v >= 1 ? { bottom: "50%", height: `${h}%` } : { top: "50%", height: `${h}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-0.5 grid grid-cols-12 gap-0.5 text-center text-[10px] text-slate-500">
          {MONTH_INITIALS.map((m, i) => (
            <span key={i}>{m}</span>
          ))}
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">
        {flatDefault
          ? `No default ${side} curve for this type — customize months or fit to your actuals.`
          : `Peak ${MONTH_SHORT[peak]} × ${values[peak].toFixed(2)} · low ${MONTH_SHORT[low]} × ${values[low].toFixed(2)} · ${custom ? "custom curve" : "historical curve"}`}
      </p>

      {editing && (
        <div className={cn("mt-3 grid gap-1.5", compact ? "grid-cols-4 sm:grid-cols-6" : "grid-cols-4 sm:grid-cols-6 lg:grid-cols-12")}>
          {raw[side].map((v, i) => (
            <label key={i} className="block">
              <span className="block text-center text-[10px] text-slate-500">{MONTH_SHORT[i]}</span>
              <input
                type="number"
                step={0.01}
                min={0.2}
                max={3}
                value={v}
                aria-label={`${MONTH_SHORT[i]} ${side} multiplier`}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && e.target.value !== "") setMonth(i, n);
                }}
                className="w-full rounded-md border border-white/10 bg-slate-900/70 px-1 py-1 text-center text-[11px] tabular-nums text-slate-100 [color-scheme:dark] focus:border-indigo-400 focus:outline-none"
              />
            </label>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setEditing((e) => !e)} aria-expanded={editing} className="rounded-md border border-white/10 px-2 py-1 text-slate-300 hover:bg-white/5">
          {editing ? "Done editing" : "Customize months"}
        </button>
        <button
          type="button"
          disabled={!fit}
          onClick={() => fit && onChange({ seasonalCustom: fit, seasonalityStrength: 1 })}
          title={fit ? "Build the curve from your logged months" : `Log at least 3 different months in the Fiscal Year Tracker first (${loggedMonths} so far)`}
          className="inline-flex items-center gap-1 rounded-md border border-indigo-300/30 px-2 py-1 text-indigo-100 hover:bg-indigo-400/10 disabled:opacity-40"
        >
          <Wand2 className="h-3 w-3" /> Fit to my actuals
        </button>
        {(custom || strength !== 1) && (
          <button type="button" onClick={() => onChange({ seasonalCustom: null, seasonalityStrength: 1 })} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-slate-400 hover:text-slate-200">
            <RotateCcw className="h-3 w-3" /> Reset to default
          </button>
        )}
      </div>
      {editing && <p className="mt-2 text-[11px] text-slate-500">1.00 = an average month. Values are re-scaled so the year still averages 1.00.</p>}
    </div>
  );
}
