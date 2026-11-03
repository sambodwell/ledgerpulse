import { resolveViewer } from "@/lib/server/entitlements";
import { appOrigin, billingNotConfigured, getStripe, priceFor, type CheckoutKind } from "@/lib/server/billing";

/** POST /api/billing/checkout  { kind: "pro" | "report" } → { url } (Stripe Checkout) */
export async function POST(request: Request) {
  const viewer = await resolveViewer(request);
  if (!viewer.userId || !viewer.db) return Response.json({ error: "Sign in to purchase." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { kind?: unknown } | null;
  const kind: CheckoutKind | null = body?.kind === "pro" || body?.kind === "report" ? body.kind : null;
  if (!kind) return Response.json({ error: "`kind` must be \"pro\" or \"report\"." }, { status: 400 });

  const stripe = getStripe();
  const price = priceFor(kind);
  if (!stripe || !price) return billingNotConfigured();
  if (kind === "pro" && viewer.tier === "pro") return Response.json({ error: "You're already on Pro." }, { status: 409 });

  const { data: profile } = await viewer.db
    .from("profiles")
    .select("email,stripe_customer_id")
    .eq("id", viewer.userId)
    .maybeSingle<{ email: string | null; stripe_customer_id: string | null }>();

  const origin = appOrigin(request);
  const session = await stripe.checkout.sessions.create({
    mode: kind === "pro" ? "subscription" : "payment",
    line_items: [{ price, quantity: 1 }],
    client_reference_id: viewer.userId,
    metadata: { userId: viewer.userId, kind },
    ...(kind === "pro" ? { subscription_data: { metadata: { userId: viewer.userId } } } : {}),
    ...(profile?.stripe_customer_id
      ? { customer: profile.stripe_customer_id }
      : { customer_email: profile?.email ?? undefined, ...(kind === "report" ? { customer_creation: "always" as const } : {}) }),
    // The dashboard picks up a pending (sealed) analysis from sessionStorage and offers to unlock it.
    success_url: `${origin}/dashboard?checkout=success`,
    cancel_url: `${origin}/settings?checkout=cancelled`,
  });

  return Response.json({ url: session.url });
}
