import { getAdminSupabase } from "@/lib/server/billing";
import { sanitizeReportHtml, sharedReportPage } from "@/lib/reportShare";

/**
 * GET /share/[token] — the public, read-only view of a shared Executive Report.
 *
 * Served as a standalone HTML document under a sandboxing CSP (no scripts, no forms, no external loads) and
 * re-sanitized on the way out, so even a tampered row can only render report-shaped markup. Never indexed or cached.
 */

const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-popups",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "private, no-store",
};

function notice(status: number, heading: string, text: string): Response {
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${heading} · Sumhaven</title><style>body{font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;max-width:520px;margin:15vh auto;padding:0 20px}h1{font-size:20px}p{color:#555}</style></head>
<body><h1>${heading}</h1><p>${text}</p></body></html>`;
  return new Response(page, { status, headers: HEADERS });
}

export async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!TOKEN.test(token)) return notice(404, "Report not found", "This share link isn't valid. Check that you copied the whole link.");

  const db = getAdminSupabase();
  if (!db) return notice(503, "Unavailable", "Shared reports are temporarily unavailable.");

  const { data, error } = await db
    .from("report_shares")
    .select("title,body,created_at,expires_at,revoked_at")
    .eq("token", token)
    .maybeSingle<{ title: string; body: string; created_at: string; expires_at: string; revoked_at: string | null }>();
  if (error) {
    console.error("[share] lookup failed", error.code);
    return notice(503, "Unavailable", "Shared reports are temporarily unavailable. Try again shortly.");
  }
  if (!data) return notice(404, "Report not found", "This share link doesn't exist or was removed.");
  if (data.revoked_at) return notice(410, "Link revoked", "The owner has turned off this share link.");
  if (Date.parse(data.expires_at) <= Date.now()) return notice(410, "Link expired", "This share link has expired. Ask the owner for a new one.");

  // Best-effort view counter; never blocks the page.
  await db.rpc("bump_report_share_view", { share_token: token }).then(
    () => undefined,
    () => undefined,
  );

  return new Response(sharedReportPage(sanitizeReportHtml(data.body), { title: data.title, createdAt: data.created_at, expiresAt: data.expires_at }), { status: 200, headers: HEADERS });
}
