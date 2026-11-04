import type Stripe from "stripe";
import { fulfillCheckoutSession, getAdminSupabase, getStripe } from "@/lib/server/billing";

/**
 * POST /api/billing/webhook — Stripe → Supabase entitlement sync.
 * Subscribe to: checkout.session.completed, checkout.session.async_payment_succeeded,
 * customer.subscription.updated,
 * customer.subscription.deleted.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  const admin = getAdminSupabase();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !admin || !secret) return new Response("Billing not configured", { status: 503 });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await request.text(), signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  // Stripe retries deliveries; record the event id first so credits are granted once.
  const { error: dupError } = await admin.from("stripe_events").insert({ id: event.id, type: event.type });
  if (dupError) {
    if (dupError.code === "23505") return Response.json({ received: true, duplicate: true });
    console.error("[billing/webhook] idempotency insert failed", dupError.message);
    return new Response("Webhook handler failed", { status: 500 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        // Shared with /api/billing/confirm and keyed by session id, so a purchase is granted exactly once.
        const result = await fulfillCheckoutSession(admin, event.data.object);
        if (result === "invalid") console.warn("[billing/webhook] checkout session without userId/kind", event.data.object.id);
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const active = event.type === "customer.subscription.updated" && (sub.status === "active" || sub.status === "trialing");
        const { error } = await admin
          .from("profiles")
          .update({ subscription_tier: active ? "pro" : "free", subscription_status: sub.status, stripe_subscription_id: sub.id })
          .eq("stripe_customer_id", customerId);
        if (error) throw new Error(error.message);
        break;
      }
    }
  } catch (err) {
    console.error("[billing/webhook]", event.type, err instanceof Error ? err.message : err);
    // Let Stripe retry: forget the event id so the retry isn't treated as a duplicate.
    await admin.from("stripe_events").delete().eq("id", event.id);
    return new Response("Webhook handler failed", { status: 500 });
  }

  return Response.json({ received: true });
}
