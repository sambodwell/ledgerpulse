/**
 * Server-only Stripe + Supabase service-role helpers.
 *
 * Required env (all server-side, never NEXT_PUBLIC_):
 *   STRIPE_SECRET_KEY            sk_live_… / sk_test_…
 *   STRIPE_WEBHOOK_SECRET        whsec_… for /api/stripe/webhook (the legacy /api/billing/webhook path still works)
 *   STRIPE_PRICE_PRO_MONTHLY     price_… recurring $39/mo
 *   STRIPE_PRICE_ID_ANNUAL       price_… recurring $399/yr (STRIPE_PRICE_PRO_ANNUAL is accepted too)
 *   STRIPE_PRICE_REPORT_UNLOCK   price_… one-time $29
 *   SUPABASE_SERVICE_ROLE_KEY    lets the webhook write billing columns
 */

import Stripe from "stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** "pro" = Pro monthly, "pro_annual" = Pro yearly, "report" = one full-report credit. */
export type CheckoutKind = "pro" | "pro_annual" | "report";

export const isCheckoutKind = (v: unknown): v is CheckoutKind => v === "pro" || v === "pro_annual" || v === "report";
export const isProKind = (k: CheckoutKind) => k !== "report";

/** Shown on card statements for Pro subscription charges (set on the Stripe Product; max 22 chars). */
export const PRO_STATEMENT_DESCRIPTOR = "SUMHAVEN PRO";

/** Env names checked in order for each price id (the first one set wins). */
const PRICE_ENV: Record<CheckoutKind, readonly string[]> = {
  pro: ["STRIPE_PRICE_PRO_MONTHLY"],
  pro_annual: ["STRIPE_PRICE_ID_ANNUAL", "STRIPE_PRICE_PRO_ANNUAL"],
  report: ["STRIPE_PRICE_REPORT_UNLOCK"],
};
export const priceEnvName = (kind: CheckoutKind) => PRICE_ENV[kind].join(" / ");

let stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripe ??= new Stripe(key);
  return stripe;
}

/** Returns the configured Stripe price id, or null if it's missing or not a `price_…` id (e.g. a `prod_…` id pasted by mistake). */
export function priceFor(kind: CheckoutKind): string | null {
  const id = PRICE_ENV[kind].map((name) => process.env[name]?.trim()).find(Boolean);
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

/**
 * Reads an env var the way it's often pasted into a hosting dashboard (Vercel): trims whitespace / trailing newlines
 * and strips one pair of wrapping quotes, either of which makes Supabase reject the key ("Invalid API key").
 */
function cleanEnv(...names: string[]): string | null {
  for (const name of names) {
    const v = process.env[name]?.trim().replace(/^(['"])(.*)\1$/, "$2").trim();
    if (v) return v;
  }
  return null;
}

/** Supabase project URL (the public one is inlined at build time; SUPABASE_URL also works server-side). */
const supabaseUrl = () => cleanEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL")?.replace(/\/+$/, "") ?? null;
/** Service-role key. Supabase's newer "secret" key (sb_secret_…) is accepted under either name. */
const serviceKey = () => cleanEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY");

/**
 * Why the service-role client can't be used, or null when it's configured. Catches the most common deployment
 * mistake — the anon / publishable key pasted as SUPABASE_SERVICE_ROLE_KEY — which otherwise surfaces later as an
 * opaque "User not allowed" from the auth admin API.
 */
export function serviceRoleProblem(): string | null {
  if (!supabaseUrl()) return "NEXT_PUBLIC_SUPABASE_URL is missing from the server environment.";
  const key = serviceKey();
  if (!key) return "SUPABASE_SERVICE_ROLE_KEY is missing from the server environment (add it in Vercel → Settings → Environment Variables, then redeploy).";
  if (key.startsWith("sb_publishable_")) return "SUPABASE_SERVICE_ROLE_KEY holds the publishable key. Use the secret / service_role key from Supabase → Project Settings → API.";
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const role = (JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { role?: unknown }).role;
      if (role && role !== "service_role") return `SUPABASE_SERVICE_ROLE_KEY holds the "${String(role)}" key. Use the service_role key from Supabase → Project Settings → API.`;
    } catch {
      /* not a JWT we can read: let Supabase decide */
    }
  }
  return null;
}

let adminClient: { key: string; client: SupabaseClient } | null = null;

export function getAdminSupabase(): SupabaseClient | null {
  const url = supabaseUrl();
  const key = serviceKey();
  if (!url || !key || serviceRoleProblem()) return null;
  const cacheKey = `${url}|${key}`;
  if (adminClient?.key !== cacheKey) {
    adminClient = { key: cacheKey, client: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) };
  }
  return adminClient.client;
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
  if (!isProKind(kind)) {
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
  if (!userId || !isCheckoutKind(kind)) return "invalid";
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
    await grantEntitlement(admin, userId, kind, isProKind(kind) ? { customerId, subscriptionId } : { customerId });
  } catch (err) {
    // Release the key so a retry (webhook redelivery or another confirm) can fulfill it.
    await admin.from("stripe_events").delete().eq("id", key);
    throw err;
  }
  return "fulfilled";
}

/**
 * Local-testing override: never active in production builds. Enabled when
 * LEDGERPULSE_DEV_UNLOCK=1 (env name kept from before the Sumhaven rename), or automatically when Stripe keys / price ids are absent.
 * Checkout then grants the entitlement directly instead of redirecting to Stripe.
 */
export function devBillingBypass(kind: CheckoutKind): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.LEDGERPULSE_DEV_UNLOCK === "1") return true;
  return !getStripe() || !priceFor(kind);
}

/**
 * Subscription charges take their card-statement text from the Product, not the Checkout Session, so the Pro
 * products are given PRO_STATEMENT_DESCRIPTOR the first time each price is sold from this server process.
 * Best-effort: a failure is logged and checkout continues with the account's default descriptor.
 */
const descriptorChecked = new Set<string>();
export async function ensureProStatementDescriptor(stripe: Stripe, priceId: string): Promise<void> {
  if (descriptorChecked.has(priceId)) return;
  try {
    const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
    const product = price.product;
    if (product && typeof product === "object" && !("deleted" in product && product.deleted)) {
      const p = product as Stripe.Product;
      if (p.statement_descriptor !== PRO_STATEMENT_DESCRIPTOR) await stripe.products.update(p.id, { statement_descriptor: PRO_STATEMENT_DESCRIPTOR });
    }
    descriptorChecked.add(priceId);
  } catch (err) {
    console.warn("[billing] couldn't set the Pro statement descriptor", err instanceof Error ? err.message : err);
  }
}
