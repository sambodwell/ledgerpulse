"use client";

import { useState } from "react";
import { cn, inputCls } from "@/components/ui";

/**
 * Normalizes typed/pasted money to a plain decimal string: digits, at most one decimal point,
 * up to 2 decimals, no redundant leading zeros ("$1,00.0.5" → "100.05", "007" → "7", "." → "0.").
 */
export const cleanMoney = (raw: string) => {
  const [rawWhole, ...rest] = raw.replace(/[^\d.]/g, "").split(".");
  const whole = rawWhole.replace(/^0+(?=\d)/, "");
  if (!rest.length) return whole;
  return `${whole || "0"}.${rest.join("").slice(0, 2)}`;
};

/** On blur: "12" → "12.00", "12.5" → "12.50", "12." → "12.00". Empty stays empty so the placeholder shows. */
export const padMoney = (v: string) => (v === "" || !Number.isFinite(Number(v)) ? v : Number(v).toFixed(2));

/**
 * Text input (not type=number) so the bound value is exactly the normalized string, with a static $ prefix
 * and a faded 0.00 placeholder that typing replaces.
 */
export function MoneyInput({
  value,
  onChange,
  placeholder = "0.00",
  className,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  "aria-label": string;
}) {
  return (
    <div className="group relative">
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500 transition group-focus-within:text-indigo-300">
        $
      </span>
      <input
        {...rest}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(cleanMoney(e.target.value))}
        onBlur={() => {
          const padded = padMoney(value);
          if (padded !== value) onChange(padded);
        }}
        className={cn(inputCls, "pl-7 tabular-nums placeholder:text-slate-600/80", className)}
      />
    </div>
  );
}

const fmt = (v: number | null) => (v == null ? "" : v.toFixed(2));

/**
 * MoneyInput bound to a number (null = empty). Keeps the typed text while the number round-trips through state.
 * `zeroAsEmpty`: a stored 0 renders as an empty field (showing the faded placeholder) instead of a hard "0.00" the
 * user has to delete first — for fields where 0 just means "nothing entered yet".
 */
export function MoneyNumberInput({
  value: rawValue,
  onChange,
  zeroAsEmpty = false,
  ...rest
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  className?: string;
  zeroAsEmpty?: boolean;
  "aria-label": string;
}) {
  const norm = (v: number | null) => (zeroAsEmpty && v === 0 ? null : v);
  const value = norm(rawValue);
  const [text, setText] = useState(fmt(value));
  const [synced, setSynced] = useState(value);
  // External change (e.g. imported from a statement): adopt it, unless it's just our own text round-tripping.
  if (value !== synced) {
    setSynced(value);
    if (norm(text === "" ? null : Number(text)) !== value) setText(fmt(value));
  }
  return (
    <MoneyInput
      {...rest}
      value={text}
      onChange={(v) => {
        setText(v);
        const n = v === "" ? null : Number(v);
        const next = n != null && Number.isFinite(n) ? n : null;
        setSynced(norm(next));
        onChange(next);
      }}
    />
  );
}
