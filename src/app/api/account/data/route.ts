import { resolveViewer } from "@/lib/server/entitlements";
import { getAdminSupabase } from "@/lib/server/billing";

/**
 * DELETE /api/account/data  { confirm: "DELETE" } → { deleted: { workspaces, feedback } }
 *
 * Danger Zone: permanently wipes every workspace the caller owns and everything stored under them (documents,
 * reports, report history, Fiscal Year Trackers, saved scenarios — all cascade from `workspaces`), plus their
 * feedback entries. The account itself, its plan and billing history are kept so an active subscription isn't lost.
 */
export async function DELETE(request: Request) {
  try {
    const viewer = await resolveViewer(request);
    if (!viewer.userId || !viewer.db) return Response.json({ error: "Your session has expired. Sign in again." }, { status: 401 });

    const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null;
    if (body?.confirm !== "DELETE") return Response.json({ error: "Type DELETE to confirm." }, { status: 400 });

    const userId = viewer.userId;
    // Service role when available (feedback rows have no client delete grant); otherwise the caller's own RLS-scoped client.
    const admin = getAdminSupabase();
    const db = admin ?? viewer.db;

    // The cascade covers these, but they're cleared by owner too so nothing survives if a row was ever orphaned.
    for (const table of ["scenarios", "fiscal_trackers", "workspace_report_versions", "workspace_reports", "workspace_documents"]) {
      const { error } = await db.from(table).delete().eq("user_id", userId);
      if (error && error.code !== "42P01") throw new Error(`${table}: ${error.message}`); // 42P01: table not migrated yet
    }
    const { data: ws, error: wsError } = await db.from("workspaces").delete().eq("user_id", userId).select("id");
    if (wsError) throw new Error(`workspaces: ${wsError.message}`);

    let feedback = 0;
    if (admin) {
      const { data: fb, error: fbError } = await admin.from("user_feedback").delete().eq("user_id", userId).select("id");
      if (fbError && fbError.code !== "42P01") throw new Error(`user_feedback: ${fbError.message}`);
      feedback = fb?.length ?? 0;
    }

    const { error: profileError } = await db.from("profiles").update({ default_workspace_id: null }).eq("id", userId);
    if (profileError) console.warn("[account/data] couldn't clear default workspace", profileError.message);

    return Response.json({ deleted: { workspaces: ws?.length ?? 0, feedback }, feedbackKept: !admin });
  } catch (err) {
    console.error("[account/data] delete failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Deletion didn't finish, so some data may remain. Please try again." }, { status: 500 });
  }
}
