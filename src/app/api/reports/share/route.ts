import { randomBytes } from "node:crypto";
import { resolveViewer } from "@/lib/server/entitlements";
import { appOrigin, getAdminSupabase } from "@/lib/server/billing";
import { MAX_SHARE_HTML, SHARE_TTL_DAYS, sanitizeReportHtml, type ShareTtlDays } from "@/lib/reportShare";

/**
 * Shareable Executive Report links (table: report_shares, migration 0008).
 *
 *   POST   { html, title, workspaceId?, ttlDays? } → { share }   create a read-only link to a sanitized snapshot
 *   GET    ?workspaceId=…                        → { shares }  the caller's links (newest first)
 *   DELETE ?id=…                                 → { ok }      revoke one of the caller's links
 *
 * The public viewer is /share/[token]. Writes use the service role after verifying the caller's JWT.
 */

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_ACTIVE_SHARES = 50;
const MAX_PER_DAY = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReportShare {
  id: string;
  url: string;
  title: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  views: number;
}

interface ShareRow {
  id: string;
  token: string;
  title: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  view_count: number;
}

const toShare = (r: ShareRow, origin: string): ReportShare => ({
  id: r.id,
  url: `${origin}/share/${r.token}`,
  title: r.title,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  revoked: !!r.revoked_at,
  views: r.view_count,
});

const fail = (error: string, status: number) => Response.json({ error }, { status, headers: NO_STORE });

async function caller(request: Request) {
  const viewer = await resolveViewer(request);
  if (!viewer.userId || !viewer.db) return { error: fail("Sign in to share reports.", 401) } as const;
  const admin = getAdminSupabase();
  if (!admin) return { error: fail("Report sharing isn't configured on this server (SUPABASE_SERVICE_ROLE_KEY is missing).", 503) } as const;
  return { viewer: { ...viewer, userId: viewer.userId, db: viewer.db }, admin } as const;
}

/** Postgres "relation does not exist": migration 0008 hasn't been applied yet. */
const missingTable = (e: { code?: string } | null) => e?.code === "42P01" || e?.code === "PGRST205";

export async function POST(request: Request) {
  const c = await caller(request);
  if ("error" in c) return c.error;
  const { viewer, admin } = c;

  const body = (await request.json().catch(() => null)) as { html?: unknown; title?: unknown; workspaceId?: unknown; ttlDays?: unknown } | null;
  const html = typeof body?.html === "string" ? body.html : "";
  if (!html || html.length > MAX_SHARE_HTML * 2) return fail("This report can't be shared (it's empty or too large).", 400);
  const sanitized = sanitizeReportHtml(html);
  if (!sanitized.trim() || sanitized.length > MAX_SHARE_HTML) return fail("This report can't be shared (it's empty or too large).", 400);
  const title = (typeof body?.title === "string" ? body.title : "").replace(/\s+/g, " ").trim().slice(0, 160) || "Executive Report";
  const ttl: ShareTtlDays = SHARE_TTL_DAYS.includes(body?.ttlDays as ShareTtlDays) ? (body!.ttlDays as ShareTtlDays) : 30;

  let workspaceId: string | null = null;
  if (typeof body?.workspaceId === "string" && UUID.test(body.workspaceId)) {
    // RLS-scoped read: only succeeds for a workspace the caller owns.
    const { data } = await viewer.db.from("workspaces").select("id").eq("id", body.workspaceId).maybeSingle<{ id: string }>();
    if (!data) return fail("That workspace isn't yours.", 403);
    workspaceId = data.id;
  }

  const now = Date.now();
  const [{ count: active, error: countError }, { count: today }] = await Promise.all([
    admin.from("report_shares").select("id", { count: "exact", head: true }).eq("user_id", viewer.userId).is("revoked_at", null).gt("expires_at", new Date(now).toISOString()),
    admin.from("report_shares").select("id", { count: "exact", head: true }).eq("user_id", viewer.userId).gt("created_at", new Date(now - 86_400_000).toISOString()),
  ]);
  if (missingTable(countError)) return fail("Report sharing needs the latest database migration (0008_report_shares.sql).", 503);
  if ((active ?? 0) >= MAX_ACTIVE_SHARES) return fail(`You have ${MAX_ACTIVE_SHARES} active share links. Revoke some before creating more.`, 429);
  if ((today ?? 0) >= MAX_PER_DAY) return fail("You've created a lot of share links today. Try again tomorrow.", 429);

  const { data, error } = await admin
    .from("report_shares")
    .insert({
      token: randomBytes(24).toString("base64url"),
      user_id: viewer.userId,
      workspace_id: workspaceId,
      title,
      body: sanitized,
      expires_at: new Date(now + ttl * 86_400_000).toISOString(),
    })
    .select("id,token,title,created_at,expires_at,revoked_at,view_count")
    .single<ShareRow>();
  if (error) {
    console.error("[reports/share] insert failed", error.code, error.message);
    return fail(missingTable(error) ? "Report sharing needs the latest database migration (0008_report_shares.sql)." : "Couldn't create the share link.", missingTable(error) ? 503 : 502);
  }
  return Response.json({ share: toShare(data, appOrigin(request)) }, { headers: NO_STORE });
}

export async function GET(request: Request) {
  const c = await caller(request);
  if ("error" in c) return c.error;
  const ws = new URL(request.url).searchParams.get("workspaceId");
  let q = c.admin
    .from("report_shares")
    .select("id,token,title,created_at,expires_at,revoked_at,view_count")
    .eq("user_id", c.viewer.userId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(MAX_ACTIVE_SHARES);
  if (ws && UUID.test(ws)) q = q.eq("workspace_id", ws);
  const { data, error } = await q;
  if (error) return missingTable(error) ? Response.json({ shares: [] }, { headers: NO_STORE }) : fail("Couldn't load your share links.", 502);
  const origin = appOrigin(request);
  return Response.json({ shares: (data as ShareRow[]).map((r) => toShare(r, origin)) }, { headers: NO_STORE });
}

export async function DELETE(request: Request) {
  const c = await caller(request);
  if ("error" in c) return c.error;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return fail("Invalid share id.", 400);
  const { data, error } = await c.admin
    .from("report_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", c.viewer.userId)
    .select("id");
  if (error) return fail("Couldn't revoke the link.", 502);
  if (!data?.length) return fail("That link doesn't exist.", 404);
  return Response.json({ ok: true }, { headers: NO_STORE });
}
