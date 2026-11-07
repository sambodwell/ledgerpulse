import { resolveViewer } from "@/lib/server/entitlements";

/**
 * POST /api/account/sync → { tier, admin }
 *
 * Called by the app on sign-in. Resolving the viewer applies server-side overrides (ADMIN_EMAILS accounts are
 * written as Pro), so the profile the browser reads right after reflects them. `admin` lets the client show the
 * admin links; every admin route still re-checks the allowlist itself.
 */
export async function POST(request: Request) {
  const viewer = await resolveViewer(request);
  if (!viewer.userId) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  return Response.json({ tier: viewer.tier, admin: viewer.admin }, { headers: { "Cache-Control": "no-store" } });
}
