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

/** Returns the configured Stripe price id, or null if it's missing or not a `price_…` id (e.g. a `prod_…` id pasted by mistake). */
export function priceFor(kind: CheckoutKind): string | null {
  const id = (kind === "pro" ? process.env.STRIPE_PRICE_PRO_MONTHLY : process.env.STRIPE_PRICE_REPORT_UNLOCK)?.trim();
  return id && /^price_[A-Za-z0-9]+$/.test(id) ? id : null;
}

/** Maps a thrown error from a billing route to a clean JSON response (never an unhandled 500). */
export function billingError(route: string, err: unknown): Response {
  if (err instanceof Stripe.errors.StripeError) {
    console.error(`[billing/${route}] Stripe ${err.type}`, err.code ?? "", err.param ?? "", err.message);
    if (err instanceof Stripe.errors.StripeAuthenticationError) return billingNotConfigured();
    if (err instanceof Stripe.errors.StripeInvalidRequestError) {
      return Response.json({ error: "Billing is misconfigured on the server. Please contact support." }, { status: 502 });
    }
    return Response.json({ error: "Stripe is unavailable right now. Please try again in a moment." }, { status: 502 });
  }
  console.error(`[billing/${route}] unexpected error`, err instanceof Error ? err.message : err);
  return Response.json({ error: "Billing is temporarily unavailable. Please try again." }, { status: 502 });
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

// ---------------------------------------------------------------------------
// Fulfillment (shared by the webhook, the post-checkout confirm call and the dev bypass)
// ---------------------------------------------------------------------------

/** Applies a purchase to the user's profile. Pro is idempotent; report unlocks are guarded by `fulfillCheckoutSession`. */
export async function grantEntitlement(
  admin: SupabaseClient,
  userId: string,
  kind: CheckoutKind,
  ids: { customerId?: string | null; subscriptionId?: string | null } = {},
): Promise<void> {
  if (kind === "report") {
    if (ids.customerId) await admin.from("profiles").update({ stripe_customer_id: ids.customerId }).eq("id", userId);
    const { error } = await admin.rpc("grant_report_unlock", { target: userId, amount: 1 });
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await admin
    .from("profiles")
    .update({
      subscription_tier: "pro",
      subscription_status: "active",
      ...(ids.customerId !== undefined ? { stripe_customer_id: ids.customerId } : {}),
      ...(ids.subscriptionId !== undefined ? { stripe_subscription_id: ids.subscriptionId } : {}),
    })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

export type FulfillResult = "fulfilled" | "duplicate" | "unpaid" | "invalid";

/**
 * Fulfills a completed Checkout Session exactly once, keyed by the session id, so the
 * webhook and the dashboard's confirm call can both run without double-granting credits.
 */
export async function fulfillCheckoutSession(admin: SupabaseClient, s: Stripe.Checkout.Session): Promise<FulfillResult> {
  const userId = s.client_reference_id ?? s.metadata?.userId;
  const kind = s.metadata?.kind;
  if (!userId || (kind !== "pro" && kind !== "report")) return "invalid";
  if (s.status !== "complete" || (s.payment_status !== "paid" && s.payment_status !== "no_payment_required")) return "unpaid";

  const key = `fulfill:${s.id}`;
  const { error: dupError } = await admin.from("stripe_events").insert({ id: key, type: "checkout.fulfilled" });
  if (dupError) {
    if (dupError.code === "23505") return "duplicate";
    throw new Error(`idempotency insert failed: ${dupError.message}`);
  }
  try {
    const customerId = typeof s.customer === "string" ? s.customer : s.customer?.id ?? null;
    const subscriptionId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null;
    await grantEntitlement(admin, userId, kind, kind === "pro" ? { customerId, subscriptionId } : { customerId });
  } catch (err) {
    // Release the key so a retry (webhook redelivery or another confirm) can fulfill it.
    await admin.from("stripe_events").delete().eq("id", key);
    throw err;
  }
  return "fulfilled";
}

/**
 * Local-testing override: never active in production builds. Enabled when
 * LEDGERPULSE_DEV_UNLOCK=1, or automatically when Stripe keys / price ids are absent.
 * Checkout then grants the entitlement directly instead of redirecting to Stripe.
 */
export function devBillingBypass(kind: CheckoutKind): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.LEDGERPULSE_DEV_UNLOCK === "1") return true;
  return !getStripe() || !priceFor(kind);
}
