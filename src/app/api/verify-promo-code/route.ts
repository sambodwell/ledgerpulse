import { resolveViewer } from "@/lib/server/entitlements";
import { getAdminSupabase } from "@/lib/server/billing";

/**
 * POST /api/verify-promo-code  { code } → { status: "granted" | "already_pro" }
 *
 * VIP / friends-and-family access codes. Codes live only in the `promo_codes` table (migration 0007), which has no
 * client access at all: the check and the Pro grant happen inside the service-role-only `redeem_promo_code`
 * function, atomically, with per-account rate limiting. Nothing about valid codes ever reaches the browser bundle.
 */

const CODE_RE = /^[A-Za-z0-9_-]{3,64}$/;

const FAILURES: Record<string, { status: number; error: string }> = {
  invalid: { status: 400, error: "That access code isn't valid." },
  expired: { status: 400, error: "That access code has expired." },
  exhausted: { status: 400, error: "That access code has already been fully claimed." },
  rate_limited: { status: 429, error: "Too many attempts. Please wait an hour and try again." },
};

export async function POST(request: Request) {
  try {
    const viewer = await resolveViewer(request);
    if (!viewer.userId) return Response.json({ error: "Sign in to redeem an access code." }, { status: 401 });

    const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    if (!CODE_RE.test(code)) return Response.json({ error: FAILURES.invalid.error }, { status: 400 });

    if (viewer.tier === "pro") return Response.json({ status: "already_pro" });

    const admin = getAdminSupabase();
    if (!admin) return Response.json({ error: "Access codes aren't available right now." }, { status: 503 });

    const { data, error } = await admin.rpc("redeem_promo_code", { target: viewer.userId, input: code });
    if (error) {
      console.error("[verify-promo-code] redeem failed", error.message);
      return Response.json({ error: "Couldn't verify the code right now. Please try again." }, { status: 502 });
    }
    if (data === "granted" || data === "already_pro") return Response.json({ status: data });
    const failure = FAILURES[String(data)] ?? FAILURES.invalid;
    return Response.json({ error: failure.error }, { status: failure.status });
  } catch (err) {
    console.error("[verify-promo-code] unexpected error", err instanceof Error ? err.message : err);
    return Response.json({ error: "Couldn't verify the code right now. Please try again." }, { status: 502 });
  }
}
