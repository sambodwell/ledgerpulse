/**
 * Server-only: resolves who is calling and what they're entitled to, redacts
 * analyses for free users, and seals full analyses so an unlock doesn't need
 * a second model run (and nothing is persisted server-side).
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bearerToken, createRequestClient, fetchProfile } from "@/lib/supabase";
import { isFinancialAnalysis, type AnalysisAccess, type FinancialAnalysis, type SubscriptionTier } from "@/lib/schemas";

export interface Viewer {
  userId: string | null;
  tier: SubscriptionTier;
  reportUnlocks: number;
  db: SupabaseClient | null;
}

const GUEST: Viewer = { userId: null, tier: "free", reportUnlocks: 0, db: null };

/** Verifies the bearer JWT with Supabase and loads the caller's billing columns. */
export async function resolveViewer(request: Request): Promise<Viewer> {
  const token = bearerToken(request);
  if (!token) return GUEST;
  const db = createRequestClient(token);
  if (!db) return GUEST;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return GUEST;
  try {
    const profile = await fetchProfile(db, data.user.id);
    return { userId: data.user.id, tier: profile?.tier ?? "free", reportUnlocks: profile?.reportUnlocks ?? 0, db };
  } catch (err) {
    console.error("[entitlements] profile lookup failed", err instanceof Error ? err.message : err);
    return { userId: data.user.id, tier: "free", reportUnlocks: 0, db };
  }
}

/** Atomically spends one report unlock. */
export async function consumeReportUnlock(viewer: Viewer): Promise<boolean> {
  if (!viewer.db || !viewer.userId) return false;
  const { data, error } = await viewer.db.rpc("consume_report_unlock");
  if (error) {
    console.error("[entitlements] consume_report_unlock failed", error.message);
    return false;
  }
  return data === true;
}

// ---------------------------------------------------------------------------
// AI query metering (assistant chat + scenario forecasting share one monthly pool)
// ---------------------------------------------------------------------------

export const AI_QUERY_CAP = { pro: 50, free: 3 } as const;

export type AiQuotaResult = { ok: true; used: number; cap: number } | { ok: false; status: 401 | 429 | 503; error: string };

/** Atomically counts one AI query against the caller's monthly cap. Fails closed if metering is unavailable. */
export async function consumeAiQuery(viewer: Viewer): Promise<AiQuotaResult> {
  if (!viewer.db || !viewer.userId) return { ok: false, status: 401, error: "Sign in to use the AI assistant." };
  const cap = AI_QUERY_CAP[viewer.tier];
  const { data, error } = await viewer.db.rpc("consume_ai_query", { cap });
  if (error || typeof data !== "number") {
    console.error("[entitlements] consume_ai_query failed", error?.message ?? data);
    return { ok: false, status: 503, error: "AI usage tracking is unavailable right now. Try again shortly." };
  }
  if (data < 0) {
    return {
      ok: false,
      status: 429,
      error:
        viewer.tier === "pro"
          ? `Monthly AI scenario limit reached (${cap}/${cap}). It resets on the 1st.`
          : `Monthly AI query limit reached (${cap}/${cap}). Upgrade to Pro for ${AI_QUERY_CAP.pro} queries a month.`,
    };
  }
  return { ok: true, used: data, cap };
}

// ---------------------------------------------------------------------------
// Teaser redaction
// ---------------------------------------------------------------------------

/** Free tier: totals + one HIGH flag. Everything else is stripped before leaving the server. */
export function redactForTeaser(full: FinancialAnalysis): FinancialAnalysis {
  const top = full.auditFlags.find((f) => f.severity === "HIGH") ?? full.auditFlags[0];
  return {
    ...full,
    itemizedExpenses: full.itemizedExpenses.map((e) => ({ label: e.label, amount: e.amount, category: e.category })),
    macroProjections: [],
    auditFlags: top ? [top] : [],
  };
}

export function buildAccess(full: FinancialAnalysis, viewer: Viewer, level: "full" | "teaser", sealed: string | null): AnalysisAccess {
  const shown = level === "full" ? full.auditFlags.length : Math.min(1, full.auditFlags.length);
  return {
    level,
    tier: viewer.tier,
    signedIn: !!viewer.userId,
    totalFlagCount: full.auditFlags.length,
    lockedFlagCount: full.auditFlags.length - shown,
    reportUnlocks: viewer.reportUnlocks,
    sealed,
  };
}

// ---------------------------------------------------------------------------
// Sealing (AES-256-GCM). The client holds the ciphertext; the server holds the key.
// ---------------------------------------------------------------------------

const SEAL_TTL_MS = 6 * 60 * 60 * 1000;

function sealKey(): Buffer | null {
  const secret = process.env.LEDGERPULSE_SEAL_SECRET;
  if (!secret || secret.length < 32) return null;
  return createHash("sha256").update(secret).digest();
}

export const isSealingConfigured = () => sealKey() !== null;

interface SealedPayload {
  v: 1;
  uid: string | null;
  exp: number;
  analysis: FinancialAnalysis;
}

export function seal(analysis: FinancialAnalysis, userId: string | null): string | null {
  const key = sealKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body: SealedPayload = { v: 1, uid: userId, exp: Date.now() + SEAL_TTL_MS, analysis };
  const ct = Buffer.concat([cipher.update(JSON.stringify(body), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
}

export type UnsealResult = { ok: true; analysis: FinancialAnalysis } | { ok: false; reason: string };

export function unseal(token: string, userId: string | null): UnsealResult {
  const key = sealKey();
  if (!key) return { ok: false, reason: "Unlocking is not configured on this server." };
  try {
    const raw = Buffer.from(token, "base64url");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const body = JSON.parse(json) as SealedPayload;
    if (body.v !== 1 || !isFinancialAnalysis(body.analysis)) return { ok: false, reason: "Invalid analysis token." };
    if (Date.now() > body.exp) return { ok: false, reason: "This analysis has expired. Run it again to unlock." };
    // An analysis run while signed in can only be unlocked by that same account.
    if (body.uid && body.uid !== userId) return { ok: false, reason: "This analysis belongs to a different account." };
    return { ok: true, analysis: body.analysis };
  } catch {
    return { ok: false, reason: "Invalid analysis token." };
  }
}
