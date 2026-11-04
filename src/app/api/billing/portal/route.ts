import { resolveViewer } from "@/lib/server/entitlements";
import { appOrigin, billingError, billingNotConfigured, getStripe } from "@/lib/server/billing";

/** POST /api/billing/portal → { url } (Stripe Customer Portal for managing the subscription) */
export async function POST(request: Request) {
  try {
    const viewer = await resolveViewer(request);
    if (!viewer.userId || !viewer.db) return Response.json({ error: "Your session has expired. Sign in again to manage billing." }, { status: 401 });

    const stripe = getStripe();
    if (!stripe) return billingNotConfigured();

    const { data } = await viewer.db
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", viewer.userId)
      .maybeSingle<{ stripe_customer_id: string | null }>();
    if (!data?.stripe_customer_id) return Response.json({ error: "No billing account yet — make a purchase first." }, { status: 404 });

    const session = await stripe.billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: `${appOrigin(request)}/settings`,
    });
    return Response.json({ url: session.url });
  } catch (err) {
    return billingError("portal", err);
  }
}
