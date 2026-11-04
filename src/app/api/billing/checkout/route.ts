import Stripe from "stripe";
import { resolveViewer } from "@/lib/server/entitlements";
import { DEV_UNLOCK } from "@/lib/devUnlock";
import {
  appOrigin,
  billingError,
  billingNotConfigured,
  devBillingBypass,
  getAdminSupabase,
  getStripe,
  grantEntitlement,
  priceFor,
  type CheckoutKind,
} from "@/lib/server/billing";

/** POST /api/billing/checkout  { kind: "pro" | "report" } → { url } (Stripe Checkout) */
export async function POST(request: Request) {
  try {
    const viewer = await resolveViewer(request);
    if (!viewer.userId || !viewer.db) return Response.json({ error: "Your session has expired. Sign in again to purchase." }, { status: 401 });

    const body = (await request.json().catch(() => null)) as { kind?: unknown } | null;
    const kind: CheckoutKind | null = body?.kind === "pro" || body?.kind === "report" ? body.kind : null;
    if (!kind) return Response.json({ error: "`kind` must be \"pro\" or \"report\"." }, { status: 400 });

    // Pro unlock override: everyone is already Pro, so skip Stripe and the service-role key entirely.
    if (DEV_UNLOCK) return Response.json({ url: `${appOrigin(request)}/dashboard?checkout=success&dev=1`, dev: true });

    if (kind === "pro" && viewer.tier === "pro") return Response.json({ error: "You're already on Pro." }, { status: 409 });

    // Local testing without Stripe: grant the purchase directly and send the user through the normal return flow.
    if (devBillingBypass(kind)) {
      const admin = getAdminSupabase();
      if (!admin) {
        return Response.json({ error: "Dev unlock needs SUPABASE_SERVICE_ROLE_KEY in .env.local to record the simulated purchase." }, { status: 503 });
      }
      await grantEntitlement(admin, viewer.userId, kind);
      console.warn(`[billing/checkout] DEV BYPASS: granted "${kind}" to ${viewer.userId} without Stripe`);
      return Response.json({ url: `${appOrigin(request)}/dashboard?checkout=success&dev=1`, dev: true });
    }

    const stripe = getStripe();
    if (!stripe) return billingNotConfigured();
    const price = priceFor(kind);
    if (!price) {
      const env = kind === "pro" ? "STRIPE_PRICE_PRO_MONTHLY" : "STRIPE_PRICE_REPORT_UNLOCK";
      console.error(`[billing/checkout] ${env} is missing or not a price_… id`);
      return Response.json({ error: "This plan isn't available for purchase right now." }, { status: 503 });
    }
    const { data: profile } = await viewer.db
      .from("profiles")
      .select("email,stripe_customer_id")
      .eq("id", viewer.userId)
      .maybeSingle<{ email: string | null; stripe_customer_id: string | null }>();

    const origin = appOrigin(request);
    const base: Stripe.Checkout.SessionCreateParams = {
      mode: kind === "pro" ? "subscription" : "payment",
      line_items: [{ price, quantity: 1 }],
      client_reference_id: viewer.userId,
      metadata: { userId: viewer.userId, kind },
      ...(kind === "pro" ? { subscription_data: { metadata: { userId: viewer.userId } } } : {}),
      // The dashboard confirms the session (so fulfillment doesn't wait on the webhook), then
      // unlocks the pending sealed analysis it kept in sessionStorage.
      success_url: `${origin}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/settings?checkout=cancelled`,
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
