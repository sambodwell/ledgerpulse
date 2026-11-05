import { requireAdmin } from "@/lib/server/admin";
import { getAdminSupabase } from "@/lib/server/billing";

/**
 * GET /api/admin/feedback — every rating + comment submitted through the in-app feedback widget, newest first,
 * with the submitter's email and workspace name. Admin-only (ADMIN_EMAILS); reads with the service role because
 * row-level security limits normal users to their own rows.
 *
 * Query: ?limit=1..1000 (default 500). Reads the request (auth header), so it always runs per request.
 */

const NO_STORE = { "Cache-Control": "no-store" };

export interface AdminFeedbackRow {
  id: string;
  createdAt: string;
  context: "audit" | "report" | "tracker";
  rating: number;
  comment: string | null;
  userEmail: string | null;
  workspaceName: string | null;
}

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return Response.json({ error: admin.error }, { status: admin.status, headers: NO_STORE });

  const db = getAdminSupabase();
  if (!db) return Response.json({ error: "Add SUPABASE_SERVICE_ROLE_KEY to the server environment to read feedback." }, { status: 503, headers: NO_STORE });

  const limit = Math.min(1000, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 500));
  const { data, error } = await db
    .from("user_feedback")
    .select("id, user_id, workspace_id, context, rating, comment, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[admin/feedback] query failed", error.message);
    return Response.json({ error: "Couldn't load feedback." }, { status: 502, headers: NO_STORE });
  }
  const rows = (data ?? []) as { id: string; user_id: string; workspace_id: string | null; context: AdminFeedbackRow["context"]; rating: number; comment: string | null; created_at: string }[];

  // Workspace names (one query) and submitter emails (auth admin API, per distinct user, capped).
  const wsIds = [...new Set(rows.map((r) => r.workspace_id).filter((x): x is string => !!x))];
  const wsNames = new Map<string, string>();
  if (wsIds.length) {
    const { data: ws } = await db.from("workspaces").select("id, name").in("id", wsIds);
    for (const w of (ws ?? []) as { id: string; name: string }[]) wsNames.set(w.id, w.name);
  }
  const userIds = [...new Set(rows.map((r) => r.user_id))].slice(0, 200);
  const emails = new Map<string, string>();
  await Promise.all(
    userIds.map(async (id) => {
      const { data: u } = await db.auth.admin.getUserById(id);
      if (u.user?.email) emails.set(id, u.user.email);
    }),
  );

  const feedback: AdminFeedbackRow[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    context: r.context,
    rating: r.rating,
    comment: r.comment,
    userEmail: emails.get(r.user_id) ?? null,
    workspaceName: r.workspace_id ? (wsNames.get(r.workspace_id) ?? null) : null,
  }));
  return Response.json({ feedback, truncated: rows.length === limit }, { headers: NO_STORE });
}
