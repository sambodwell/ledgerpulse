import { resolveViewer } from "@/lib/server/entitlements";
import { DEV_UNLOCK } from "@/lib/devUnlock";
import { billingError, billingNotConfigured, fulfillCheckoutSession, getAdminSupabase, getStripe } from "@/lib/server/billing";

/**
 * POST /api/billing/confirm  { sessionId: "cs_…" } → { status, kind }
 *
 * Called by the dashboard on return from Stripe Checkout. Verifies the session with
 * Stripe and fulfills it right away, so the unlock never waits on (or depends on)
 * webhook delivery — which never reaches localhost without `stripe listen`.
 */
export async function POST(request: Request) {
  try {
    const viewer = await resolveViewer(request);
    if (!viewer.userId) return Response.json({ error: "Your session has expired. Sign in again." }, { status: 401 });

    const body = (await request.json().catch(() => null)) as { sessionId?: unknown } | null;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return Response.json({ error: "Invalid checkout session." }, { status: 400 });

    const stripe = getStripe();
    const admin = getAdminSupabase();
    if (!stripe || !admin) return DEV_UNLOCK ? Response.json({ status: "duplicate", kind: "pro" }) : billingNotConfigured();

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const owner = session.client_reference_id ?? session.metadata?.userId;
    if (owner !== viewer.userId) return Response.json({ error: "This checkout belongs to a different account." }, { status: 403 });

    const status = await fulfillCheckoutSession(admin, session);
    if (status === "invalid") return Response.json({ error: "This checkout session can't be applied." }, { status: 400 });
    return Response.json({ status, kind: session.metadata?.kind ?? null });
  } catch (err) {
    return billingError("confirm", err);
  }
}
