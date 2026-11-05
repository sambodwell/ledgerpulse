/**
 * Server-only: creator/admin access. Admins are listed by email in `ADMIN_EMAILS` (comma-separated, server env,
 * never exposed to the browser). Every admin request re-verifies the caller's Supabase JWT.
 */

import { bearerToken, createRequestClient } from "@/lib/supabase";

export function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
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
  if (!data.user.email_confirmed_at || !allow.has(email)) return { ok: false, status: 403, error: "This page is only available to the LedgerPulse team." };
  return { ok: true, email };
}
