/**
 * Server-only Stripe + Supabase service-role helpers.
 *
 * Required env (all server-side, never NEXT_PUBLIC_):
 *   STRIPE_SECRET_KEY            sk_live_… / sk_test_…
 *   STRIPE_WEBHOOK_SECRET        whsec_… for /api/billing/webhook
 *   STRIPE_PRICE_PRO_MONTHLY     price_… recurring $39/mo
 *   STRIPE_PRICE_REPORT_UNLOCK   price_… one-time $29
 *   SUPABASE_SERVICE_ROLE_KEY    lets the webhook write billing columns
 */

import Stripe from "stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type CheckoutKind = "pro" | "report";

let stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripe ??= new Stripe(key);
  return stripe;
}

export function priceFor(kind: CheckoutKind): string | null {
  return (kind === "pro" ? process.env.STRIPE_PRICE_PRO_MONTHLY : process.env.STRIPE_PRICE_REPORT_UNLOCK) ?? null;
}

export function getAdminSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function appOrigin(request: Request): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? new URL(request.url).origin;
}

export function billingNotConfigured() {
  return Response.json(
    { error: "Billing isn't set up yet. Add STRIPE_SECRET_KEY, price IDs and SUPABASE_SERVICE_ROLE_KEY to the server environment." },
    { status: 503 },
  );
}
