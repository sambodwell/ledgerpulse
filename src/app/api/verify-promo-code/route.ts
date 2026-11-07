import { resolveViewer } from "@/lib/server/entitlements";
import { getAdminSupabase } from "@/lib/server/billing";
import { matchVipCode, vipDurationDays } from "@/lib/server/vip";

/**
 * POST /api/verify-promo-code  { code } → { status: "granted" | "already_pro", expiresAt? }
 *
 * Two kinds of access code, both checked only on the server:
 *  - Friends-and-family codes in the `promo_codes` table (migration 0007). Checked and granted inside the
 *    service-role-only `redeem_promo_code` function, atomically, with per-account rate limiting (10 tries / hour).
 *  - Rotating VIP codes from the VIP_CODE env var (src/lib/server/vip.ts, migration 0009). These grant Pro for
 *    VIP_DURATION_DAYS (default 30) and then lapse back to free; each account can redeem a given code once.
 * Nothing about valid codes ever reaches the browser bundle.
 */

const CODE_RE = /^[A-Za-z0-9_-]{3,64}$/;

const FAILURES: Record<string, { status: number; error: string }> = {
  invalid: { status: 400, error: "That access code isn't valid." },
  expired: { status: 400, error: "That access code has expired." },
  exhausted: { status: 400, error: "That access code has already been fully claimed." },
  rate_limited: { status: 429, error: "Too many attempts. Please wait an hour and try again." },
  reused: { status: 400, error: "You've already used this VIP code. Watch for next month's code, or upgrade to keep Pro." },
};

const fail = (key: keyof typeof FAILURES) => Response.json({ error: FAILURES[key].error }, { status: FAILURES[key].status });

export async function POST(request: Request) {
  try {
    const viewer = await resolveViewer(request);
    if (!viewer.userId) return Response.json({ error: "Sign in to redeem an access code." }, { status: 401 });

    const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    if (!CODE_RE.test(code)) return fail("invalid");

    if (viewer.tier === "pro") return Response.json({ status: "already_pro" });

    const admin = getAdminSupabase();
    if (!admin) return Response.json({ error: "Access codes aren't available right now." }, { status: 503 });

    // 1) Table codes. This also logs the attempt, which rate-limits guessing for VIP codes below.
    const { data, error } = await admin.rpc("redeem_promo_code", { target: viewer.userId, input: code });
    if (error) console.error("[verify-promo-code] redeem failed", error.message);
    else if (data === "granted" || data === "already_pro") return Response.json({ status: data });
    else if (data !== "invalid") return fail(String(data) in FAILURES ? (String(data) as keyof typeof FAILURES) : "invalid");

    // 2) Rotating VIP code.
    const vip = matchVipCode(code);
    if (!vip) return error ? Response.json({ error: "Couldn't verify the code right now. Please try again." }, { status: 502 }) : fail("invalid");

    const { data: row, error: readError } = await admin.from("profiles").select("vip_code").eq("id", viewer.userId).maybeSingle<{ vip_code: string | null }>();
    if (readError) {
      console.error("[verify-promo-code] VIP read failed", readError.code, readError.message);
      return Response.json(
        { error: readError.code === "42703" ? "VIP codes need the latest database migration (0009_vip_access.sql)." : "Couldn't verify the code right now. Please try again." },
        { status: readError.code === "42703" ? 503 : 502 },
      );
    }
    if (row?.vip_code === vip) return fail("reused");

    const expiresAt = new Date(Date.now() + vipDurationDays() * 86_400_000).toISOString();
    const { error: grantError } = await admin
      .from("profiles")
      .update({ subscription_tier: "pro", subscription_status: "vip", pro_expires_at: expiresAt, vip_code: vip })
      .eq("id", viewer.userId)
      .neq("subscription_tier", "pro"); // never overwrite a paid plan that started meanwhile
    if (grantError) {
      console.error("[verify-promo-code] VIP grant failed", grantError.message);
      return Response.json({ error: "Couldn't apply the code right now. Please try again." }, { status: 502 });
    }
    return Response.json({ status: "granted", expiresAt });
  } catch (err) {
    console.error("[verify-promo-code] unexpected error", err instanceof Error ? err.message : err);
    return Response.json({ error: "Couldn't verify the code right now. Please try again." }, { status: 502 });
  }
}
