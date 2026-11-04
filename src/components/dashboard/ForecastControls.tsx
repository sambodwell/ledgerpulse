"use client";

import { CalendarRange } from "lucide-react";
import { DEFAULT_INFLATION_RATE, HORIZON_OPTIONS, MONTH_NAMES, monthKey, resolveForecastStart, type ForecastSettings, type ForecastStartMode } from "@/lib/schemas";
import { InfoTip } from "@/components/InfoTip";
import { cn, inputCls, pct } from "@/components/ui";

const START_LABELS: Record<ForecastStartMode, string> = {
  NEXT: "Next month",
  CURRENT: "Current month",
  CUSTOM: "Custom month",
  FISCAL: "Fiscal year start",
};

const RANGE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** Projection start month + horizon quick-selects. Shared by the baseline projection and scenario forecasting. */
export function ForecastControls({
  settings,
  onChange,
  className,
  inflationRate = DEFAULT_INFLATION_RATE,
}: {
  settings: ForecastSettings;
  onChange: (s: ForecastSettings) => void;
  className?: string;
  inflationRate?: number;
}) {
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
      <span className="ml-auto inline-flex flex-wrap items-center gap-1.5">
        <MacroToggle label="Seasonality" on={settings.seasonality} onChange={(seasonality) => set({ seasonality })} title="Reshape months with your business type's typical seasonal curve (annual total unchanged)" />
        <MacroToggle
          label={`Inflation ${pct(inflationRate)}`}
          on={settings.inflation}
          onChange={(inflation) => set({ inflation })}
          title={`Compound ${pct(inflationRate)}/yr inflation on costs (partly passed through to revenue)`}
        />
        <InfoTip label="Flat by default">
          Projections repeat your monthly inputs exactly — $4,100/mo stays $4,100 every month. Turn on Seasonality or Inflation only if you want those adjustments layered on top.
        </InfoTip>
      </span>
    </div>
  );
}

function MacroToggle({ label, on, onChange, title }: { label: string; on: boolean; onChange: (v: boolean) => void; title: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={title}
      onClick={() => onChange(!on)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300",
        on ? "border-indigo-300/50 bg-indigo-500/20 text-indigo-100" : "border-white/10 text-slate-400 hover:text-slate-200",
      )}
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-indigo-300" : "bg-slate-600")} />
      {label}
      <span className="sr-only">{on ? "on" : "off"}</span>
    </button>
  );
}
