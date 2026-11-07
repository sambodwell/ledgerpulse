/**
 * Server-only: creator/admin access. Admins are listed by email in `ADMIN_EMAILS` (comma-separated, server env,
 * never exposed to the browser). Every admin request re-verifies the caller's Supabase JWT.
 */

import type { User } from "@supabase/supabase-js";
import { bearerToken, createRequestClient } from "@/lib/supabase";

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
