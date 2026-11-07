import { adminRoute, isMissingTable, isServiceKeyRejected } from "@/lib/server/admin";

/**
 * GET /api/admin/feedback — every rating + comment submitted through the in-app feedback widget, newest first,
 * with the submitter's email and workspace name. Admin-only (ADMIN_EMAILS); reads with the service role because
 * row-level security limits normal users to their own rows.
 *
 * Query: ?limit=1..1000 (default 500). Reads the request (auth header), so it always runs per request.
 */

const NO_STORE = { "Cache-Control": "no-store" };
/** Submitters whose email isn't on their profile row are looked up one by one; cap that fallback. */
const MAX_AUTH_LOOKUPS = 50;

export interface AdminFeedbackRow {
  id: string;
  createdAt: string;
  context: "audit" | "report" | "tracker";
  rating: number;
  comment: string | null;
  userEmail: string | null;
  workspaceName: string | null;
}

type FeedbackDbRow = { id: string; user_id: string; workspace_id: string | null; context: AdminFeedbackRow["context"]; rating: number; comment: string | null; created_at: string };

export async function GET(request: Request) {
  const guard = await adminRoute(request);
  if (!guard.ok) return guard.response;
  const { db } = guard;

  const limit = Math.min(1000, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 500));
  const { data, error } = await db
    .from("user_feedback")
    .select("id, user_id, workspace_id, context, rating, comment, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[admin/feedback] query failed", error.code, error.message);
    if (isMissingTable(error)) return Response.json({ feedback: [], truncated: false, warning: "Feedback needs migration 0003_fiscal_tracker_feedback.sql." }, { headers: NO_STORE });
    if (isServiceKeyRejected(error)) {
      return Response.json({ error: "Supabase rejected SUPABASE_SERVICE_ROLE_KEY. Copy the service_role (secret) key into Vercel, then redeploy.", code: "service_role" }, { status: 503, headers: NO_STORE });
    }
    return Response.json({ error: "Couldn't load feedback right now. Try again in a moment." }, { status: 502, headers: NO_STORE });
  }
  const rows = (data ?? []) as FeedbackDbRow[];

  // Names and emails are enrichment only: a failed lookup leaves them blank, it never hides the reviews.
  const wsIds = [...new Set(rows.map((r) => r.workspace_id).filter((x): x is string => !!x))];
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const [wsResult, profileResult] = await Promise.all([
    wsIds.length ? db.from("workspaces").select("id, name").in("id", wsIds) : Promise.resolve({ data: [], error: null }),
    userIds.length ? db.from("profiles").select("id, email").in("id", userIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (wsResult.error) console.warn("[admin/feedback] workspace names unavailable", wsResult.error.message);
  if (profileResult.error) console.warn("[admin/feedback] profile emails unavailable", profileResult.error.message);
  const wsNames = new Map(((wsResult.data ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name]));
  const emails = new Map(((profileResult.data ?? []) as { id: string; email: string | null }[]).filter((p) => p.email).map((p) => [p.id, p.email!]));

  const missing = userIds.filter((id) => !emails.has(id)).slice(0, MAX_AUTH_LOOKUPS);
  await Promise.all(
    missing.map(async (id) => {
      try {
        const { data: u } = await db.auth.admin.getUserById(id);
        if (u?.user?.email) emails.set(id, u.user.email);
      } catch {
        /* enrichment only */
      }
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
