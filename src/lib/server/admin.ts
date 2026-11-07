/**
 * Server-only: creator/admin access. Admins are listed by email in `ADMIN_EMAILS` (comma-separated, server env,
 * never exposed to the browser). Every admin request re-verifies the caller's Supabase JWT.
 */

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { bearerToken, createRequestClient } from "@/lib/supabase";
import { getAdminSupabase, serviceRoleProblem } from "@/lib/server/billing";

/**
 * Built-in owner account(s): always admin (and so always Pro), even if ADMIN_EMAILS is missing from a deployment's
 * environment. Server-only, so the address never ships in the browser bundle. Still requires a confirmed email.
 */
const OWNER_EMAILS = ["sambodwellpolitics@gmail.com"];

export function adminEmails(): Set<string> {
  return new Set(
    [...OWNER_EMAILS, ...(process.env.ADMIN_EMAILS ?? "").split(",")]
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** True for a user whose confirmed email is on ADMIN_EMAILS (an unconfirmed address could be anyone's). */
export function isAdminUser(user: Pick<User, "email" | "email_confirmed_at"> | null | undefined): boolean {
  const email = user?.email?.trim().toLowerCase();
  return !!email && !!user?.email_confirmed_at && adminEmails().has(email);
}

export type AdminCheck = { ok: true; email: string } | { ok: false; status: 401 | 403 | 503; error: string };

/** Verifies the bearer token and that its (confirmed) email is on the admin allowlist. */
export async function requireAdmin(request: Request): Promise<AdminCheck> {
  const allow = adminEmails();
  if (allow.size === 0) return { ok: false, status: 503, error: "Admin access isn't configured. Add ADMIN_EMAILS to the server environment." };
  const token = bearerToken(request);
  const db = token ? createRequestClient(token) : null;
  if (!token || !db) return { ok: false, status: 401, error: "Sign in to continue." };
  const { data, error } = await db.auth.getUser(token);
  const email = data.user?.email?.toLowerCase();
  if (error || !data.user || !email) return { ok: false, status: 401, error: "Your session has expired. Sign in again." };
  // An unconfirmed address could be anyone's: only confirmed emails count.
  if (!data.user.email_confirmed_at || !allow.has(email)) return { ok: false, status: 403, error: "This page is only available to the Sumhaven team." };
  return { ok: true, email };
}

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Shared guard for every /api/admin/* route: verifies the caller is on the admin allowlist (401 / 403 otherwise),
 * then hands back the service-role client. Non-admins never learn anything about the server's configuration.
 */
export async function adminRoute(request: Request): Promise<{ ok: true; email: string; db: SupabaseClient } | { ok: false; response: Response }> {
  const admin = await requireAdmin(request);
  if (!admin.ok) return { ok: false, response: Response.json({ error: admin.error }, { status: admin.status, headers: NO_STORE }) };
  const db = getAdminSupabase();
  if (!db) {
    const problem = serviceRoleProblem() ?? "The service-role client couldn't be created.";
    console.error("[admin] service role unavailable:", problem);
    return { ok: false, response: Response.json({ error: problem, code: "service_role" }, { status: 503, headers: NO_STORE }) };
  }
  return { ok: true, email: admin.email, db };
}

/** True when a Supabase error means the service key itself was rejected (wrong project, anon key, revoked key). */
export function isServiceKeyRejected(err: { status?: number; message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.status === 401 || err.status === 403 || /not allowed|invalid api key|jwt|unauthorized/i.test(err.message ?? "");
}

/** Postgres / PostgREST "table not found": a migration hasn't been applied yet. */
export const isMissingTable = (e: { code?: string } | null | undefined) => e?.code === "42P01" || e?.code === "PGRST205";
