import Stripe from "stripe";
import { resolveViewer } from "@/lib/server/entitlements";
import { DEV_UNLOCK } from "@/lib/devUnlock";
import {
  appOrigin,
  billingError,
  billingNotConfigured,
  devBillingBypass,
  ensureProStatementDescriptor,
  getAdminSupabase,
  getStripe,
  grantEntitlement,
  isCheckoutKind,
  isProKind,
  priceEnvName,
  priceFor,
} from "@/lib/server/billing";

/**
 * POST /api/stripe/checkout  { kind: "pro" | "pro_annual" | "report", from?: "dashboard" | "settings" } → { url }
 *
 * Creates a Stripe Checkout Session server-side. The tier itself is only ever granted by the webhook
 * (/api/stripe/webhook) or the post-checkout confirm call, both of which verify the session with Stripe.
 */
export async function POST(request: Request) {
  try {
    const viewer = await resolveViewer(request);
    if (!viewer.userId || !viewer.db) return Response.json({ error: "Your session has expired. Sign in again to purchase." }, { status: 401 });

    const body = (await request.json().catch(() => null)) as { kind?: unknown; from?: unknown } | null;
    const kind = isCheckoutKind(body?.kind) ? body.kind : null;
    if (!kind) return Response.json({ error: "`kind` must be \"pro\", \"pro_annual\" or \"report\"." }, { status: 400 });
    const returnPath = body?.from === "settings" ? "/settings" : "/dashboard";

    // Pro unlock override: everyone is already Pro, so skip Stripe and the service-role key entirely.
    if (DEV_UNLOCK) return Response.json({ url: `${appOrigin(request)}/dashboard?checkout=success&dev=1`, dev: true });

    if (isProKind(kind) && viewer.tier === "pro") return Response.json({ error: "You're already on Pro." }, { status: 409 });

    // Local testing without Stripe: grant the purchase directly and send the user through the normal return flow.
    if (devBillingBypass(kind)) {
      const admin = getAdminSupabase();
      if (!admin) {
        return Response.json({ error: "Dev unlock needs SUPABASE_SERVICE_ROLE_KEY in .env.local to record the simulated purchase." }, { status: 503 });
      }
      await grantEntitlement(admin, viewer.userId, kind);
      console.warn(`[stripe/checkout] DEV BYPASS: granted "${kind}" to ${viewer.userId} without Stripe`);
      return Response.json({ url: `${appOrigin(request)}/dashboard?checkout=success&dev=1`, dev: true });
    }

    const stripe = getStripe();
    if (!stripe) return billingNotConfigured();
    const price = priceFor(kind);
    if (!price) {
      console.error(`[stripe/checkout] ${priceEnvName(kind)} is missing or not a price_… id`);
      return Response.json({ error: "This plan isn't available for purchase right now." }, { status: 503 });
    }
    if (isProKind(kind)) await ensureProStatementDescriptor(stripe, price);

    const { data: profile } = await viewer.db
      .from("profiles")
      .select("email,stripe_customer_id")
      .eq("id", viewer.userId)
      .maybeSingle<{ email: string | null; stripe_customer_id: string | null }>();

    const origin = appOrigin(request);
    const base: Stripe.Checkout.SessionCreateParams = {
      mode: isProKind(kind) ? "subscription" : "payment",
      line_items: [{ price, quantity: 1 }],
      client_reference_id: viewer.userId,
      metadata: { userId: viewer.userId, kind },
      ...(isProKind(kind)
        ? { subscription_data: { metadata: { userId: viewer.userId, kind } } }
        : // One-time card charges can't override the full descriptor; the suffix follows the account's short prefix.
          { payment_intent_data: { statement_descriptor_suffix: "REPORT" } }),
      // The dashboard confirms the session (so fulfillment doesn't wait on the webhook), then
      // unlocks the pending sealed analysis it kept in sessionStorage.
      success_url: `${origin}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${returnPath}?checkout=cancelled`,
    };
    const asNewCustomer: Stripe.Checkout.SessionCreateParams = {
      ...base,
      ...(profile?.email ? { customer_email: profile.email } : {}),
      ...(kind === "report" ? { customer_creation: "always" as const } : {}),
    };

    let session: Stripe.Checkout.Session;
    if (profile?.stripe_customer_id) {
      try {
        session = await stripe.checkout.sessions.create({ ...base, customer: profile.stripe_customer_id });
      } catch (err) {
        // A customer id from another Stripe mode/account (e.g. test → live) — start fresh instead of failing.
        if (!(err instanceof Stripe.errors.StripeInvalidRequestError && err.param === "customer")) throw err;
        session = await stripe.checkout.sessions.create(asNewCustomer);
      }
    } else {
      session = await stripe.checkout.sessions.create(asNewCustomer);
    }

    if (!session.url) return Response.json({ error: "Checkout is unavailable right now." }, { status: 502 });
    return Response.json({ url: session.url });
  } catch (err) {
    return billingError("checkout", err);
  }
}
