import type { User } from "@supabase/supabase-js";
import { adminEmails, adminRoute, isMissingTable, isServiceKeyRejected } from "@/lib/server/admin";

/**
 * GET /api/admin/stats — signups and conversion analytics for the admin overview. Admin-only (ADMIN_EMAILS); reads
 * with the service role: auth users (signup time, confirmation, first-touch origin from user metadata set at
 * sign-up), profile billing columns and feedback ratings. Admin accounts are excluded from the counts.
 */

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_USERS = 20_000;
const DAY = 86_400_000;

export interface OriginRow {
  source: string;
  signups: number;
  confirmed: number;
  /** Accounts currently on paid Pro (subscription), excluding access codes / admins. */
  pro: number;
  /** Accounts that bought at least once (Pro or a one-time report). */
  paid: number;
}

export interface AdminStats {
  generatedAt: string;
  totals: { signups: number; confirmed: number; last7: number; last30: number; today: number; pro: number; proViaCode: number; paidCustomers: number; reportCredits: number };
  /** Signups per UTC day, oldest first, last 30 days. */
  daily: { day: string; signups: number }[];
  origins: OriginRow[];
  recent: { email: string | null; createdAt: string; confirmed: boolean; source: string; tier: "free" | "pro" }[];
  feedback: { total: number; average: number | null; last7: number; byContext: { context: string; count: number; average: number | null }[] };
  truncated: boolean;
  /** Sections that couldn't be loaded (shown as a note; the rest of the overview still renders). */
  warnings: string[];
}

const sourceOf = (u: User) => {
  const s = (u.user_metadata as Record<string, unknown> | undefined)?.signup_source;
  return typeof s === "string" && s.trim() ? s.trim().toLowerCase().slice(0, 80) : "unknown";
};

export async function GET(request: Request) {
  const guard = await adminRoute(request);
  if (!guard.ok) return guard.response;
  const { db } = guard;
  const warnings: string[] = [];

  // All auth users (paged), minus the team's own accounts.
  const staff = adminEmails();
  const users: User[] = [];
  let truncated = false;
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      console.error("[admin/stats] listUsers failed", error.status, error.message);
      // A rejected key is a configuration problem for the whole page; anything else is noted and the rest still loads.
      if (isServiceKeyRejected(error)) {
        return Response.json(
          { error: "Supabase rejected SUPABASE_SERVICE_ROLE_KEY. Copy the service_role (secret) key from Supabase → Project Settings → API into Vercel, then redeploy.", code: "service_role" },
          { status: 503, headers: NO_STORE },
        );
      }
      warnings.push("Signups couldn't be loaded right now; refresh to try again.");
      break;
    }
    users.push(...data.users.filter((u) => !staff.has(u.email?.toLowerCase() ?? "")));
    if (data.users.length < 1000) break;
    if (users.length >= MAX_USERS) {
      truncated = true;
      break;
    }
  }

  const [{ data: profiles, error: profileError }, { data: feedback, error: feedbackError }] = await Promise.all([
    db.from("profiles").select("id,subscription_tier,subscription_status,stripe_customer_id,report_unlocks").limit(MAX_USERS),
    db.from("user_feedback").select("rating,context,created_at").order("created_at", { ascending: false }).limit(10_000),
  ]);
  if (profileError) {
    console.error("[admin/stats] profiles query failed", profileError.code, profileError.message);
    warnings.push("Plan data couldn't be loaded, so Pro and paid counts may read zero.");
  }
  if (feedbackError) {
    console.error("[admin/stats] feedback query failed", feedbackError.code, feedbackError.message);
    warnings.push(isMissingTable(feedbackError) ? "Feedback needs migration 0003_fiscal_tracker_feedback.sql." : "Feedback couldn't be loaded right now.");
  }
  type P = { id: string; subscription_tier: string; subscription_status: string | null; stripe_customer_id: string | null; report_unlocks: number };
  const byId = new Map(((profiles ?? []) as P[]).map((p) => [p.id, p]));

  const now = Date.now();
  const startOfToday = new Date(new Date().toISOString().slice(0, 10)).getTime();
  const isPro = (p?: P) => p?.subscription_tier === "pro";
  /** Pro from an access code / manual grant rather than a Stripe subscription. */
  const viaCode = (p?: P) => isPro(p) && (!p!.stripe_customer_id || ["promo", "vip", "admin"].includes(p!.subscription_status ?? ""));
  const paid = (p?: P) => !!p?.stripe_customer_id;

  const origins = new Map<string, OriginRow>();
  const dailyCounts = new Map<string, number>();
  for (let i = 29; i >= 0; i--) dailyCounts.set(new Date(startOfToday - i * DAY).toISOString().slice(0, 10), 0);
  const totals = { signups: users.length, confirmed: 0, last7: 0, last30: 0, today: 0, pro: 0, proViaCode: 0, paidCustomers: 0, reportCredits: 0 };

  for (const u of users) {
    const p = byId.get(u.id);
    const created = Date.parse(u.created_at);
    const confirmed = !!u.email_confirmed_at;
    if (confirmed) totals.confirmed++;
    if (created >= now - 7 * DAY) totals.last7++;
    if (created >= now - 30 * DAY) totals.last30++;
    if (created >= startOfToday) totals.today++;
    if (isPro(p) && !viaCode(p)) totals.pro++;
    if (viaCode(p)) totals.proViaCode++;
    if (paid(p)) totals.paidCustomers++;
    totals.reportCredits += Math.max(0, p?.report_unlocks ?? 0);
    const day = u.created_at.slice(0, 10);
    if (dailyCounts.has(day)) dailyCounts.set(day, dailyCounts.get(day)! + 1);

    const src = sourceOf(u);
    const row = origins.get(src) ?? { source: src, signups: 0, confirmed: 0, pro: 0, paid: 0 };
    row.signups++;
    if (confirmed) row.confirmed++;
    if (isPro(p) && !viaCode(p)) row.pro++;
    if (paid(p)) row.paid++;
    origins.set(src, row);
  }

  const fb = (feedback ?? []) as { rating: number; context: string; created_at: string }[];
  const avg = (xs: { rating: number }[]) => (xs.length ? xs.reduce((a, r) => a + r.rating, 0) / xs.length : null);
  const contexts = [...new Set(fb.map((f) => f.context))];

  const stats: AdminStats = {
    generatedAt: new Date(now).toISOString(),
    totals,
    daily: [...dailyCounts].map(([day, signups]) => ({ day, signups })),
    origins: [...origins.values()].sort((a, b) => b.signups - a.signups),
    recent: [...users]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 25)
      .map((u) => ({ email: u.email ?? null, createdAt: u.created_at, confirmed: !!u.email_confirmed_at, source: sourceOf(u), tier: isPro(byId.get(u.id)) ? "pro" : "free" })),
    feedback: {
      total: fb.length,
      average: avg(fb),
      last7: fb.filter((f) => Date.parse(f.created_at) >= now - 7 * DAY).length,
      byContext: contexts.map((c) => ({ context: c, count: fb.filter((f) => f.context === c).length, average: avg(fb.filter((f) => f.context === c)) })),
    },
    truncated,
    warnings,
  };
  return Response.json(stats, { headers: NO_STORE });
}
