/**
 * Supabase client + data helpers for auth sessions, workspace profiles,
 * user profiles (plan/tier) and saved scenarios.
 *
 * Safe to import from client components: it only uses the public URL and
 * anon key. Row-level security (see supabase/migrations) scopes every query
 * to the signed-in user. Billing columns are read-only from here.
 */

import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";
import { clearAllDrafts } from "@/lib/formDraft";
import {
  isBusinessType,
  isScenarioAdjustment,
  modeOf,
  PLAN_CATEGORIES,
  type BusinessType,
  type PlanCategory,
  type SavedScenario,
  type ScenarioAdjustment,
  type UserProfile,
  type WorkspaceProfile,
} from "@/lib/schemas";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let browserClient: SupabaseClient | null = null;

/** Browser singleton. Returns null when env vars are missing so the app still runs in guest mode. */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!browserClient) {
    browserClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: { persistSession: typeof window !== "undefined", autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return browserClient;
}

/**
 * Server-side: a per-request client that acts as the caller (their JWT), so RLS
 * applies. Never cache this across requests.
 */
export function createRequestClient(accessToken: string): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export function bearerToken(request: Request): string | null {
  const h = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

function requireClient(): SupabaseClient {
  const c = getSupabase();
  if (!c) throw new Error("Accounts are not configured (missing Supabase environment variables).");
  return c;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function getSession(): Promise<Session | null> {
  const c = getSupabase();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return data.session;
}

export async function getAccessToken(): Promise<string | null> {
  return (await getSession())?.access_token ?? null;
}

/** Headers to attach to LedgerPulse API calls so the server can resolve the caller's plan. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function onAuthChange(cb: (user: User | null) => void): () => void {
  const c = getSupabase();
  if (!c) return () => {};
  const { data } = c.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null));
  return () => data.subscription.unsubscribe();
}

export async function signInWithPassword(email: string, password: string) {
  const { error } = await requireClient().auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

/**
 * Public origin of this deployment, used for links in auth emails. Order:
 * NEXT_PUBLIC_SITE_URL (set this in production) → NEXT_PUBLIC_VERCEL_URL
 * (Vercel preview/production host) → the browser's current origin. Never
 * hardcodes localhost.
 */
export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const vercel = process.env.NEXT_PUBLIC_VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

/** Only same-site relative paths are allowed as post-auth destinations (prevents open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

/** Returns true when the project requires email confirmation before first sign-in. */
export async function signUpWithPassword(email: string, password: string, next = "/dashboard"): Promise<{ needsConfirmation: boolean }> {
  const site = getSiteUrl();
  const { data, error } = await requireClient().auth.signUp({
    email,
    password,
    options: { emailRedirectTo: site ? `${site}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}` : undefined },
  });
  if (error) throw new Error(error.message);
  return { needsConfirmation: !data.session };
}

/** Re-sends the sign-up confirmation email (Supabase rate-limits this server-side too). */
export async function resendSignupEmail(email: string, next = "/dashboard") {
  const site = getSiteUrl();
  const { error } = await requireClient().auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: site ? `${site}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}` : undefined },
  });
  if (error) throw new Error(`Couldn't resend the confirmation email: ${error.message}`);
}

export async function signOut() {
  // Don't leave financial form drafts behind on a shared device.
  clearAllDrafts();
  const c = getSupabase();
  if (c) await c.auth.signOut();
}

// ---------------------------------------------------------------------------
// User profile (plan category + billing status)
// ---------------------------------------------------------------------------

interface ProfileRow {
  id: string;
  email: string | null;
  plan_category: string;
  subscription_tier: string;
  subscription_status: string | null;
  report_unlocks: number;
  stripe_customer_id: string | null;
  default_workspace_id: string | null;
}

const PROFILE_COLUMNS = "id,email,plan_category,subscription_tier,subscription_status,report_unlocks,stripe_customer_id,default_workspace_id";

export function toUserProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    planCategory: (PLAN_CATEGORIES as readonly string[]).includes(row.plan_category) ? (row.plan_category as PlanCategory) : "SMALL_BUSINESS",
    tier: row.subscription_tier === "pro" ? "pro" : "free",
    subscriptionStatus: row.subscription_status,
    reportUnlocks: Math.max(0, row.report_unlocks ?? 0),
    hasStripeCustomer: !!row.stripe_customer_id,
    defaultWorkspaceId: row.default_workspace_id,
  };
}

/** Works with either the browser client or a per-request server client. */
export async function fetchProfile(client: SupabaseClient | null = getSupabase(), userId?: string): Promise<UserProfile | null> {
  if (!client) return null;
  const id = userId ?? (await client.auth.getUser()).data.user?.id;
  if (!id) return null;
  const { data, error } = await client.from("profiles").select(PROFILE_COLUMNS).eq("id", id).maybeSingle<ProfileRow>();
  if (error) throw new Error(error.message);
  return data ? toUserProfile(data) : null;
}

export async function updatePlanCategory(planCategory: PlanCategory) {
  const c = requireClient();
  const { data: u } = await c.auth.getUser();
  if (!u.user) throw new Error("Sign in to change your plan.");
  const { error } = await c.from("profiles").update({ plan_category: planCategory }).eq("id", u.user.id);
  if (error) throw new Error(error.message);
}

export async function setDefaultWorkspace(workspaceId: string | null) {
  const c = requireClient();
  const { data: u } = await c.auth.getUser();
  if (!u.user) return;
  const { error } = await c.from("profiles").update({ default_workspace_id: workspaceId }).eq("id", u.user.id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

interface WorkspaceRow {
  id: string;
  name: string;
  mode: string;
  business_type: string;
  created_at: string;
}

function toWorkspace(r: WorkspaceRow): WorkspaceProfile {
  const businessType: BusinessType = isBusinessType(r.business_type) ? r.business_type : "OTHER_CUSTOM";
  return { id: r.id, name: r.name, businessType, mode: modeOf(businessType), createdAt: r.created_at };
}

export async function listWorkspaces(): Promise<WorkspaceProfile[]> {
  const c = requireClient();
  const { data, error } = await c.from("workspaces").select("id,name,mode,business_type,created_at").order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as WorkspaceRow[]).map(toWorkspace);
}

export async function createWorkspace(input: { name: string; businessType: BusinessType }): Promise<WorkspaceProfile> {
  const c = requireClient();
  const { data: u } = await c.auth.getUser();
  if (!u.user) throw new Error("Sign in to create workspaces.");
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new Error("Give the workspace a name.");
  const { data, error } = await c
    .from("workspaces")
    .insert({ user_id: u.user.id, name, business_type: input.businessType, mode: modeOf(input.businessType) })
    .select("id,name,mode,business_type,created_at")
    .single<WorkspaceRow>();
  if (error) throw new Error(error.message);
  return toWorkspace(data);
}

export async function updateWorkspace(id: string, patch: { name?: string; businessType?: BusinessType }) {
  const row: Record<string, string> = {};
  if (patch.name !== undefined) row.name = patch.name.trim().slice(0, 80);
  if (patch.businessType) {
    row.business_type = patch.businessType;
    row.mode = modeOf(patch.businessType);
  }
  const { error } = await requireClient().from("workspaces").update(row).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteWorkspace(id: string) {
  const { error } = await requireClient().from("workspaces").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Saved scenarios (opt-in; stores prompt + parameters + headline numbers only)
// ---------------------------------------------------------------------------

interface ScenarioRow {
  id: string;
  workspace_id: string;
  prompt: string;
  adjustments: unknown;
  summary: SavedScenario["summary"];
  created_at: string;
}

export async function listScenarios(workspaceId: string): Promise<SavedScenario[]> {
  const { data, error } = await requireClient()
    .from("scenarios")
    .select("id,workspace_id,prompt,adjustments,summary,created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data as ScenarioRow[]).map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    prompt: r.prompt,
    adjustments: Array.isArray(r.adjustments) ? (r.adjustments.filter(isScenarioAdjustment) as ScenarioAdjustment[]) : [],
    summary: r.summary,
    createdAt: r.created_at,
  }));
}

export async function saveScenario(input: Omit<SavedScenario, "id" | "createdAt">): Promise<void> {
  const c = requireClient();
  const { data: u } = await c.auth.getUser();
  if (!u.user) throw new Error("Sign in to save scenarios.");
  const { error } = await c.from("scenarios").insert({
    user_id: u.user.id,
    workspace_id: input.workspaceId,
    prompt: input.prompt.slice(0, 1000),
    adjustments: input.adjustments,
    summary: input.summary,
  });
  if (error) throw new Error(error.message);
}

export async function deleteScenario(id: string) {
  const { error } = await requireClient().from("scenarios").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Fiscal Year Tracker (one row per workspace; monthly totals only)
// ---------------------------------------------------------------------------

export async function loadFiscalTracker(workspaceId: string): Promise<{ state: unknown; updatedAt: string | null } | null> {
  const { data, error } = await requireClient()
    .from("fiscal_trackers")
    .select("state,updated_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle<{ state: unknown; updated_at: string | null }>();
  if (error) throw new Error(error.message);
  return data ? { state: data.state, updatedAt: data.updated_at } : null;
}

export async function saveFiscalTracker(workspaceId: string, state: unknown): Promise<void> {
  const c = requireClient();
  const { data: u } = await c.auth.getUser();
  if (!u.user) throw new Error("Sign in to save your tracker.");
  const { error } = await c.from("fiscal_trackers").upsert({ workspace_id: workspaceId, user_id: u.user.id, state }, { onConflict: "workspace_id" });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// User feedback (star rating + short comment)
// ---------------------------------------------------------------------------

export type FeedbackContext = "audit" | "report" | "tracker";

export async function submitFeedback(input: { rating: number; comment: string; context: FeedbackContext; workspaceId: string | null }): Promise<void> {
  const c = requireClient();
  const { data: u } = await c.auth.getUser();
  if (!u.user) throw new Error("Sign in to send feedback.");
  const rating = Math.round(input.rating);
  if (rating < 1 || rating > 5) throw new Error("Pick a rating from 1 to 5 stars.");
  const comment = input.comment.trim().slice(0, 1000);
  const { error } = await c.from("user_feedback").insert({
    user_id: u.user.id,
    workspace_id: input.workspaceId,
    context: input.context,
    rating,
    comment: comment || null,
  });
  if (error) throw new Error(error.message);
}
