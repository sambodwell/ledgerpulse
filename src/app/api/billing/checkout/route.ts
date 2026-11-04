import Stripe from "stripe";
import { resolveViewer } from "@/lib/server/entitlements";
import { appOrigin, billingError, billingNotConfigured, getStripe, priceFor, type CheckoutKind } from "@/lib/server/billing";

/** POST /api/billing/checkout  { kind: "pro" | "report" } → { url } (Stripe Checkout) */
export async function POST(request: Request) {
  try {
    const viewer = await resolveViewer(request);
    if (!viewer.userId || !viewer.db) return Response.json({ error: "Your session has expired. Sign in again to purchase." }, { status: 401 });

    const body = (await request.json().catch(() => null)) as { kind?: unknown } | null;
    const kind: CheckoutKind | null = body?.kind === "pro" || body?.kind === "report" ? body.kind : null;
    if (!kind) return Response.json({ error: "`kind` must be \"pro\" or \"report\"." }, { status: 400 });

    const stripe = getStripe();
    if (!stripe) return billingNotConfigured();
    const price = priceFor(kind);
    if (!price) {
      const env = kind === "pro" ? "STRIPE_PRICE_PRO_MONTHLY" : "STRIPE_PRICE_REPORT_UNLOCK";
      console.error(`[billing/checkout] ${env} is missing or not a price_… id`);
      return Response.json({ error: "This plan isn't available for purchase right now." }, { status: 503 });
    }
    if (kind === "pro" && viewer.tier === "pro") return Response.json({ error: "You're already on Pro." }, { status: 409 });

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
      // The dashboard picks up a pending (sealed) analysis from sessionStorage and offers to unlock it.
      success_url: `${origin}/dashboard?checkout=success`,
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
