/**
 * Server-only: rotating, time-limited VIP access codes.
 *
 *   VIP_CODE            Comma-separated codes or templates (case-insensitive). Tokens are filled in from the current
 *                       UTC date, so a template rotates by itself:
 *                         {MON}  → NOV        {MONTH} → NOVEMBER     {MM} → 11
 *                         {YYYY} → 2026       {YY}    → 26
 *                       e.g. VIP_CODE="SUMHAVEN-{MON}{YYYY}" accepts SUMHAVEN-NOV2026 during November 2026 only.
 *                       A plain code (VIP_CODE="LAUNCHWEEK") works until the variable is changed. Unset = no VIP codes.
 *   VIP_DURATION_DAYS   How long a redemption grants Pro (default 30, 1–365).
 *
 * Nothing here is sent to the browser: the client only learns whether the code it typed was accepted.
 */

const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const DEFAULT_DAYS = 30;

/** The VIP codes valid at `now`, upper-cased. */
export function activeVipCodes(now = new Date()): string[] {
  const raw = process.env.VIP_CODE ?? "";
  const month = MONTHS[now.getUTCMonth()];
  const year = String(now.getUTCFullYear());
  return raw
    .split(",")
    .map((t) =>
      t
        .trim()
        .replace(/^(['"])(.*)\1$/, "$2")
        .toUpperCase()
        .replace(/\{MONTH\}/g, month)
        .replace(/\{MON\}/g, month.slice(0, 3))
        .replace(/\{MM\}/g, String(now.getUTCMonth() + 1).padStart(2, "0"))
        .replace(/\{YYYY\}/g, year)
        .replace(/\{YY\}/g, year.slice(2)),
    )
    .filter((c) => /^[A-Z0-9_-]{3,64}$/.test(c));
}

export function vipDurationDays(): number {
  const n = Math.round(Number(process.env.VIP_DURATION_DAYS));
  return Number.isFinite(n) && n >= 1 ? Math.min(365, n) : DEFAULT_DAYS;
}

/** Returns the normalized code when `input` is a currently valid VIP code, else null. */
export function matchVipCode(input: string, now = new Date()): string | null {
  const code = input.trim().toUpperCase();
  return activeVipCodes(now).includes(code) ? code : null;
}

