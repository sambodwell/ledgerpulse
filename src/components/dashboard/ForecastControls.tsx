"use client";

import { useState } from "react";
import { CalendarRange } from "lucide-react";
import { HORIZON_OPTIONS, MONTH_NAMES, effectiveInflationRate, monthKey, resolveForecastStart, type BusinessType, type CpiReading, type ForecastSettings, type ForecastStartMode } from "@/lib/schemas";
import type { MonthActual } from "@/lib/fiscal";
import { SeasonalityControls } from "@/components/dashboard/SeasonalityControls";
import { InfoTip } from "@/components/InfoTip";
import { cn, inputCls, pct } from "@/components/ui";

const START_LABELS: Record<ForecastStartMode, string> = {
  NEXT: "Next month",
  CURRENT: "Current month",
  CUSTOM: "Custom month",
  FISCAL: "Fiscal year start",
};

const RANGE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** Projection start month + horizon quick-selects, plus the seasonality / inflation switches and the inflation rate source. */
export function ForecastControls({
  settings,
  onChange,
  className,
  cpi,
  businessType,
  actuals,
}: {
  settings: ForecastSettings;
  onChange: (s: ForecastSettings) => void;
  className?: string;
  /** Latest live CPI reading (null while loading). */
  cpi: CpiReading | null;
  /** Enables the seasonal weighting controls when seasonality is on. */
  businessType?: BusinessType;
  /** Logged monthly actuals, for fitting the seasonal curve. */
  actuals?: Record<string, MonthActual>;
}) {
  const rate = effectiveInflationRate(settings, cpi);
  const start = resolveForecastStart(settings);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + settings.months - 1, 1));
  const set = (patch: Partial<ForecastSettings>) => onChange({ ...settings, ...patch });

  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-xs", className)}>
      <CalendarRange className="h-4 w-4 text-slate-400" aria-hidden />
      <div role="radiogroup" aria-label="Forecast horizon" className="inline-flex rounded-lg border border-white/10 p-0.5">
        {HORIZON_OPTIONS.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={settings.months === m}
            onClick={() => set({ months: m })}
            className={cn("rounded-md px-2.5 py-1 font-medium tabular-nums transition", settings.months === m ? "bg-indigo-500/80 text-white" : "text-slate-400 hover:text-slate-200")}
          >
            {m}M
          </button>
        ))}
      </div>
      <label className="inline-flex items-center gap-1.5">
        <span className="sr-only">Projection start</span>
        <select
          value={settings.startMode}
          onChange={(e) => {
            const startMode = e.target.value as ForecastStartMode;
            set({ startMode, ...(startMode === "CUSTOM" && !settings.customMonth ? { customMonth: monthKey(start) } : {}) });
          }}
          className={cn(inputCls, "w-auto py-1 pr-7 text-xs")}
        >
          {(Object.keys(START_LABELS) as ForecastStartMode[]).map((k) => (
            <option key={k} value={k}>
              Start: {START_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      {settings.startMode === "CUSTOM" && (
        <input
          type="month"
          aria-label="Custom start month"
          value={settings.customMonth}
          onChange={(e) => set({ customMonth: e.target.value })}
          className={cn(inputCls, "w-auto py-1 text-xs [color-scheme:dark]")}
        />
      )}
      {settings.startMode === "FISCAL" && (
        <select aria-label="Fiscal year starts in" value={settings.fiscalStartMonth} onChange={(e) => set({ fiscalStartMonth: Number(e.target.value) })} className={cn(inputCls, "w-auto py-1 pr-7 text-xs")}>
          {MONTH_NAMES.map((n, i) => (
            <option key={n} value={i}>
              FY starts {n}
            </option>
          ))}
        </select>
      )}
      <span className="text-slate-500 tabular-nums">
        {RANGE_FMT.format(start)} – {RANGE_FMT.format(end)}
      </span>
      <div className="flex w-full flex-wrap items-center gap-2 border-t border-white/5 pt-2">
        <StatusSwitch label="Seasonality" on={settings.seasonality} onChange={(seasonality) => set({ seasonality })} title="Reshape months with your business type's typical seasonal curve (annual total unchanged)" detail={settings.seasonality && (settings.seasonalityStrength !== 1 || settings.seasonalCustom) ? `${Math.round(settings.seasonalityStrength * 100)}%${settings.seasonalCustom ? " custom" : ""}` : undefined} />
        <SeasonalityHelp />
        <StatusSwitch
          label="Inflation"
          detail={settings.inflation ? `${pct(rate)}/yr` : undefined}
          on={settings.inflation}
          onChange={(inflation) => set({ inflation })}
          title={`Compound ${pct(rate)}/yr inflation on costs (partly passed through to revenue)`}
        />
        {settings.inflation && (
          <div className="inline-flex flex-wrap items-center gap-1.5">
            <div role="radiogroup" aria-label="Inflation rate source" className="inline-flex rounded-lg border border-white/10 p-0.5">
              <button
                type="button"
                role="radio"
                aria-checked={settings.inflationSource === "CPI"}
                onClick={() => set({ inflationSource: "CPI" })}
                title={cpi?.live ? `Latest year-over-year CPI-U from the U.S. Bureau of Labor Statistics (${cpi.period})` : "Live CPI unavailable right now — using the default assumption"}
                className={cn("rounded-md px-2.5 py-1 font-medium transition", settings.inflationSource === "CPI" ? "bg-indigo-500/80 text-white" : "text-slate-400 hover:text-slate-200")}
              >
                {cpi === null ? "Live CPI…" : cpi.live ? `Live CPI ${pct(cpi.rate)} · ${cpi.period}` : `CPI unavailable · ${pct(cpi.rate)} default`}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={settings.inflationSource === "CUSTOM"}
                onClick={() => set({ inflationSource: "CUSTOM" })}
                title="Set your own rate, e.g. for rent growth or a niche cost index"
                className={cn("rounded-md px-2.5 py-1 font-medium transition", settings.inflationSource === "CUSTOM" ? "bg-amber-500/80 text-white" : "text-slate-400 hover:text-slate-200")}
              >
                Custom rate
              </button>
            </div>
            {settings.inflationSource === "CUSTOM" && <RateInput value={settings.customInflationRate} onChange={(customInflationRate) => set({ customInflationRate })} />}
          </div>
        )}
        <InfoTip label="Flat by default">
          Projections repeat your monthly inputs exactly — $4,100/mo stays $4,100 every month. Turn on Seasonality or Inflation only if you want those adjustments layered on top. Inflation
          defaults to the latest live CPI reading; choose Custom rate for real estate or niche projections (e.g. 5% rent growth).
        </InfoTip>
      </div>
      {settings.seasonality && businessType && (
        <SeasonalityControls
          businessType={businessType}
          strength={settings.seasonalityStrength}
          custom={settings.seasonalCustom}
          actuals={actuals}
          onChange={(patch) => set(patch)}
          className="w-full"
        />
      )}
    </div>
  );
}

/** Annual % input bound to a rate (0.05 = 5%). Keeps the typed text while it round-trips. */
function RateInput({ value, onChange }: { value: number; onChange: (rate: number) => void }) {
  const fmt = (r: number) => String(Math.round(r * 10000) / 100);
  const [text, setText] = useState(fmt(value));
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setText(fmt(value));
  }
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Custom annual inflation rate (percent)</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          const neg = e.target.value.trim().startsWith("-");
          const [w, ...rest] = e.target.value.replace(/[^\d.]/g, "").split(".");
          const t = `${neg ? "-" : ""}${rest.length ? `${w || "0"}.${rest.join("").slice(0, 2)}` : w}`;
          setText(t);
          const n = Number(t);
          if (t !== "" && t !== "-" && Number.isFinite(n)) {
            const rate = Math.min(50, Math.max(-10, n)) / 100;
            setSynced(rate);
            onChange(rate);
          }
        }}
        className={cn(inputCls, "w-20 border-amber-300/40 py-1 pr-6 text-xs tabular-nums")}
      />
      <span aria-hidden className="pointer-events-none absolute right-2 text-xs text-slate-500">
        %/yr
      </span>
    </label>
  );
}

/**
 * On/off switch with an explicit ON / OFF label, colored track and knob, so its state is unmistakable at a glance.
 * Shared by the projection controls and the Fiscal Year Tracker.
 */
export const SEASONALITY_HELP = "Adjusts your 12-month forward projections up or down using typical seasonal revenue and expense curves for your specific business type.";

/** The "(?)" beside every Seasonality toggle. */
export function SeasonalityHelp({ align = "left", className }: { align?: "left" | "right"; className?: string }) {
  return (
    <InfoTip label="What is Seasonality?" icon="help" align={align} className={cn("-ml-1", className)}>
      {SEASONALITY_HELP}
    </InfoTip>
  );
}

export function StatusSwitch({ label, detail, on, onChange, title }: { label: string; detail?: string; on: boolean; onChange: (v: boolean) => void; title: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${label}: ${on ? "on" : "off"}`}
      title={title}
      onClick={() => onChange(!on)}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border py-1 pl-1.5 pr-2.5 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300",
        on ? "border-emerald-300/50 bg-emerald-500/15 text-emerald-50" : "border-white/15 bg-slate-900/60 text-slate-400 hover:text-slate-200",
      )}
    >
      <span aria-hidden className={cn("relative h-4 w-7 shrink-0 rounded-full transition", on ? "bg-emerald-400" : "bg-slate-700")}>
        <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all", on ? "left-3.5" : "left-0.5")} />
      </span>
      {label}
      {detail && <span className="tabular-nums text-emerald-200/90">{detail}</span>}
      <span aria-hidden className={cn("rounded px-1 py-px text-[10px] font-bold tracking-wide", on ? "bg-emerald-400/25 text-emerald-100" : "bg-white/5 text-slate-500")}>{on ? "ON" : "OFF"}</span>
    </button>
  );
}
