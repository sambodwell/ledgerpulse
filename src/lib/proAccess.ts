/**
 * Shared (client + server) Pro access rules.
 */

import type { AnalysisAccess } from "@/lib/schemas";

/** VIP Pro is the only time-limited kind; it has lapsed once its expiry has passed (or is missing). */
export function vipLapsed(status: string | null | undefined, expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (status !== "vip") return false;
  const t = expiresAt ? Date.parse(expiresAt) : NaN;
  return !Number.isFinite(t) || t <= now;
}

/**
 * How a full report was paid for. `access.tier` is stamped when the report is generated: "pro" means it came with a
 * Pro plan (subscription, VIP code or admin); a full report generated on the free tier was paid for with a one-time
 * Executive Report credit, which the owner keeps forever. Teasers were never paid for.
 */
export function reportPaidWith(access: Pick<AnalysisAccess, "level" | "tier">): "pro" | "purchase" | null {
  if (access.level !== "full") return null;
  return access.tier === "pro" ? "pro" : "purchase";
}

/** A Pro-generated report is locked once its owner no longer has Pro; purchased reports never lock. */
export function reportLockedFor(access: Pick<AnalysisAccess, "level" | "tier">, viewerIsPro: boolean): boolean {
  return reportPaidWith(access) === "pro" && !viewerIsPro;
}
