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
import { signupMetadata } from "@/lib/attribution";
import { vipLapsed } from "@/lib/proAccess";
import {
  isAnalysisResponse,
  isBusinessType,
  isExtractedLineItems,
  isScenarioAdjustment,
  modeOf,
  PLAN_CATEGORIES,
  type AnalysisResponse,
  type BusinessType,
  type ExpenseLine,
  type ExtractedLineItems,
  type PlanCategory,
  type RevenueLine,
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

/** Headers to attach to Sumhaven API calls so the server can resolve the caller's plan. */
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

const INCORRECT_PASSWORD = "Password incorrect. Please check your email and password.";

/**
 * Turns a Supabase auth error (or a raw network failure) into a sentence a person can act on. Supabase reports a
 * request that never reached it as `AuthRetryableFetchError("Failed to fetch", status 0)`, which used to be shown as-is.
 */
export function friendlyAuthError(err: unknown, action: "signin" | "signup" | "resend" = "signin"): string {
  const e = (err && typeof err === "object" ? err : {}) as { message?: unknown; code?: unknown; status?: unknown; name?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  const code = typeof e.code === "string" ? e.code : "";
  const status = typeof e.status === "number" ? e.status : undefined;
  const name = typeof e.name === "string" ? e.name : "";

  // Never reached the auth server: offline, DNS, an ad/tracker blocker, or a misconfigured Supabase URL.
  if (name === "AuthRetryableFetchError" || status === 0 || /failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    if (status && status >= 500) return "The sign-in service is temporarily unavailable. Please try again in a minute.";
    return "We couldn't reach the sign-in service. Check your internet connection (or pause any ad or privacy blocker for this site) and try again.";
  }
  switch (code) {
    case "invalid_credentials":
      // Supabase doesn't say which half was wrong (so accounts can't be probed); the password is the usual culprit.
      return INCORRECT_PASSWORD;
    case "email_not_confirmed":
      return "Confirm your email first: click the link we sent you, then sign in.";
    case "user_already_exists":
    case "email_exists":
      return "An account with this email already exists. Sign in instead.";
    case "weak_password":
      return message || "Choose a stronger password.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return action === "resend" ? "Too many emails sent. Wait a minute before requesting another." : "Too many attempts. Wait a minute and try again.";
    case "email_address_invalid":
      return "That email address isn't valid.";
    case "signup_disabled":
      return "New sign-ups are paused right now.";
    case "user_banned":
      return "This account has been suspended. Contact support.";
  }
  if (/invalid login credentials/i.test(message)) return INCORRECT_PASSWORD;
  // A bare AuthApiError 400 with no code on sign-in is a wrong email/password on older auth servers.
  if (action === "signin" && name === "AuthApiError" && status === 400 && !code) return INCORRECT_PASSWORD;
  return message || "Something went wrong. Please try again.";
}

/** Runs an auth call, retrying once on a network blip, and throws a friendly Error on failure. */
async function authCall<T extends { error: unknown }>(fn: () => Promise<T>, action: "signin" | "signup" | "resend"): Promise<T> {
  let res: T;
  try {
    res = await fn();
    const err = res.error as { name?: string } | null;
    if (err?.name === "AuthRetryableFetchError") res = await fn();
  } catch (err) {
    throw new Error(friendlyAuthError(err, action));
  }
  if (res.error) throw new Error(friendlyAuthError(res.error, action));
  return res;
}

export async function signInWithPassword(email: string, password: string) {
  await authCall(() => requireClient().auth.signInWithPassword({ email: email.trim(), password }), "signin");
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

/** Auth pages are never a post-auth destination: sending a signed-in user back to one loops or breaks. */
const AUTH_PATHS = /^\/(signup|login|auth)(\/|\?|#|$)/i;

/**
 * Only same-site relative paths are allowed as post-auth destinations (prevents open redirects). Anything else
 * (empty, absolute, protocol-relative, backslashed, control characters, or an auth page) falls back to `fallback`.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  const v = next?.trim();
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.includes("\\") || /[\u0000-\u001f]/.test(v) || AUTH_PATHS.test(v)) return fallback;
  return v;
}

/** Returns true when the project requires email confirmation before first sign-in. */
export async function signUpWithPassword(email: string, password: string, next = "/dashboard"): Promise<{ needsConfirmation: boolean }> {
  const site = getSiteUrl();
  const { data } = await authCall(
    () =>
      requireClient().auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: site ? `${site}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}` : undefined,
          // First-touch attribution (utm / ref / referrer), read by the admin signups dashboard. No financial data.
          data: signupMetadata(),
        },
      }),
    "signup",
  );
  return { needsConfirmation: !data.session };
}

/** Re-sends the sign-up confirmation email (Supabase rate-limits this server-side too). */
export async function resendSignupEmail(email: string, next = "/dashboard") {
  const site = getSiteUrl();
  await authCall(
    () =>
      requireClient().auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: site ? `${site}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}` : undefined },
      }),
    "resend",
  );
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
  /** Migration 0009; absent on older databases. */
  pro_expires_at?: string | null;
}

const PROFILE_COLUMNS = "id,email,plan_category,subscription_tier,subscription_status,report_unlocks,stripe_customer_id,default_workspace_id";

export function toUserProfile(row: ProfileRow): UserProfile {
  // Time-limited VIP Pro reads as free the moment it lapses, even before the server writes the downgrade.
  const pro = row.subscription_tier === "pro" && !vipLapsed(row.subscription_status, row.pro_expires_at);
  return {
    id: row.id,
    email: row.email,
    planCategory: (PLAN_CATEGORIES as readonly string[]).includes(row.plan_category) ? (row.plan_category as PlanCategory) : "SMALL_BUSINESS",
    tier: pro ? "pro" : "free",
    subscriptionStatus: row.subscription_status,
    reportUnlocks: Math.max(0, row.report_unlocks ?? 0),
    hasStripeCustomer: !!row.stripe_customer_id,
    defaultWorkspaceId: row.default_workspace_id,
    proExpiresAt: row.subscription_status === "vip" ? row.pro_expires_at ?? null : null,
  };
}

/** Works with either the browser client or a per-request server client. */
export async function fetchProfile(client: SupabaseClient | null = getSupabase(), userId?: string): Promise<UserProfile | null> {
  if (!client) return null;
  const id = userId ?? (await client.auth.getUser()).data.user?.id;
  if (!id) return null;
  let { data, error } = await client.from("profiles").select(`${PROFILE_COLUMNS},pro_expires_at`).eq("id", id).maybeSingle<ProfileRow>();
  // 42703: migration 0009 not applied yet, so there are no VIP expiries to read.
  if (error?.code === "42703") ({ data, error } = await client.from("profiles").select(PROFILE_COLUMNS).eq("id", id).maybeSingle<ProfileRow>());
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
  const c = requireClient();
  const row: Record<string, string> = {};
  if (patch.name !== undefined) {
    row.name = patch.name.trim().slice(0, 80);
    if (!row.name) throw new Error("Give the workspace a name.");
  }
  if (patch.businessType) {
    // A workspace is one book of one kind: a business can change its business type, but never become a personal
    // budget (or the reverse) — its report, tracker and documents would then show up under the other mode.
    const { data: cur, error: readError } = await c.from("workspaces").select("mode").eq("id", id).single<{ mode: string }>();
    if (readError) throw new Error(readError.message);
    if (cur.mode !== modeOf(patch.businessType)) {
      throw new Error(cur.mode === "PERSONAL" ? "A personal workspace can't be turned into a business one. Create a new business workspace instead." : "A business workspace can't be turned into a personal one. Create a new personal workspace instead.");
    }
    row.business_type = patch.businessType;
  }
  const { error } = await c.from("workspaces").update(row).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Per-workspace financial defaults (`workspaces.settings`, migration 0006). Both calls tolerate a database without the
 * column yet: load returns null and save is a no-op warning, so the device copy keeps working.
 */
export async function loadWorkspaceSettings(id: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await requireClient().from("workspaces").select("settings").eq("id", id).maybeSingle<{ settings: unknown }>();
  if (error) {
    if (error.code === "42703") return null; // column missing: migration 0006 not applied
    throw new Error(error.message);
  }
  const s = data?.settings;
  return s && typeof s === "object" && !Array.isArray(s) ? (s as Record<string, unknown>) : null;
}

export async function saveWorkspaceSettings(id: string, settings: Record<string, unknown>): Promise<void> {
  const { error } = await requireClient().from("workspaces").update({ settings }).eq("id", id);
  if (error && error.code !== "42703" && error.code !== "PGRST204") throw new Error(error.message);
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

// ---------------------------------------------------------------------------
// Workspace documents (parsed statements: name, month, reviewed line items, totals — never the file itself)
// ---------------------------------------------------------------------------

export type WorkspaceDocumentKind = "statement" | "pasted" | "form";

export interface WorkspaceDocumentTotals {
  revenue: number;
  expenses: number;
  oneTimeExpenses?: number;
}

/** One calendar month inside a multi-month document (an H1 / quarterly / annual report): that month's actual lines. */
export interface DocumentMonthSlice {
  /** "YYYY-MM" */
  period: string;
  revenue: RevenueLine[];
  expenses: ExpenseLine[];
}

export interface WorkspaceDocument {
  id: string;
  workspaceId: string;
  name: string;
  fileName: string | null;
  fileSize: number | null;
  contentHash: string | null;
  kind: WorkspaceDocumentKind;
  /** "YYYY-MM" the statement covers, or null (unknown, or a multi-month document — see `months`). */
  period: string | null;
  items: ExtractedLineItems | null;
  /** Per-month breakdown of a multi-month document (oldest first); empty for a single-month statement. */
  months: DocumentMonthSlice[];
  totals: WorkspaceDocumentTotals;
  createdAt: string;
  updatedAt: string;
}

interface DocumentRow {
  id: string;
  workspace_id: string;
  name: string;
  file_name: string | null;
  file_size: number | null;
  content_hash: string | null;
  kind: string;
  period: string | null;
  items: unknown;
  totals: unknown;
  created_at: string;
  updated_at: string;
}

const DOCUMENT_COLUMNS = "id,workspace_id,name,file_name,file_size,content_hash,kind,period,items,totals,created_at,updated_at";
const finiteOr0 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const PERIOD_RE = /^\d{4}-\d{2}$/;

/** The month breakdown is kept inside the `items` jsonb (`items.months`), so older rows simply have none. */
function monthsFromItems(items: unknown): DocumentMonthSlice[] {
  const raw = items && typeof items === "object" ? (items as { months?: unknown }).months : null;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is DocumentMonthSlice => !!m && typeof m === "object" && typeof m.period === "string" && PERIOD_RE.test(m.period) && Array.isArray(m.revenue) && Array.isArray(m.expenses))
    .map((m) => ({ period: m.period, revenue: m.revenue, expenses: m.expenses }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * The months a document covers, each with its own line items: one slice per month for a multi-month report, one
 * slice for a statement with a month, none for a document without one.
 */
export function documentSlices(d: WorkspaceDocument): { period: string; items: ExtractedLineItems }[] {
  const bt = d.items?.businessType ?? "OTHER_CUSTOM";
  if (d.months.length) return d.months.map((m) => ({ period: m.period, items: { businessType: bt, revenue: m.revenue, expenses: m.expenses } }));
  return d.period && d.items ? [{ period: d.period, items: d.items }] : [];
}

/** First and last month a document covers ("YYYY-MM"), or null when it has no month. */
export function documentRange(d: WorkspaceDocument): { from: string; to: string; months: number } | null {
  const periods = d.months.length ? d.months.map((m) => m.period) : d.period ? [d.period] : [];
  return periods.length ? { from: periods[0], to: periods[periods.length - 1], months: periods.length } : null;
}

function toDocument(r: DocumentRow): WorkspaceDocument {
  const t = (r.totals ?? {}) as Record<string, unknown>;
  const oneTime = finiteOr0(t.oneTimeExpenses);
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    fileName: r.file_name,
    fileSize: r.file_size,
    contentHash: r.content_hash,
    kind: r.kind === "pasted" || r.kind === "form" ? r.kind : "statement",
    period: r.period && PERIOD_RE.test(r.period) ? r.period : null,
    items: isExtractedLineItems(r.items) ? { businessType: r.items.businessType, revenue: r.items.revenue, expenses: r.items.expenses } : null,
    months: monthsFromItems(r.items),
    totals: { revenue: finiteOr0(t.revenue), expenses: finiteOr0(t.expenses), ...(oneTime > 0 ? { oneTimeExpenses: oneTime } : {}) },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listDocuments(workspaceId: string): Promise<WorkspaceDocument[]> {
  const { data, error } = await requireClient()
    .from("workspace_documents")
    .select(DOCUMENT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data as DocumentRow[]).map(toDocument);
}

export interface NewWorkspaceDocument {
  name: string;
  fileName?: string | null;
  fileSize?: number | null;
  contentHash?: string | null;
  kind: WorkspaceDocumentKind;
  period: string | null;
  items: ExtractedLineItems;
  /** Multi-month documents: each month's own lines (saved alongside the items). */
  months?: DocumentMonthSlice[];
  totals: WorkspaceDocumentTotals;
}

/** Saves parsed documents to a workspace. A file already saved there (same content hash) is updated, not duplicated. */
export async function saveDocuments(workspaceId: string, docs: NewWorkspaceDocument[]): Promise<WorkspaceDocument[]> {
  if (!docs.length) return [];
  const c = requireClient();
  const { data: u } = await c.auth.getUser();
  if (!u.user) throw new Error("Sign in to save documents.");
  const rows = docs.map((d) => ({
    user_id: u.user!.id,
    workspace_id: workspaceId,
    name: d.name.trim().slice(0, 160) || "Statement",
    file_name: d.fileName ? d.fileName.slice(0, 255) : null,
    file_size: d.fileSize ?? null,
    content_hash: d.contentHash ?? null,
    kind: d.kind,
    // A multi-month document has no single month; its months live in items.months.
    period: d.months && d.months.length > 1 ? null : d.period,
    items: d.months && d.months.length > 1 ? { ...d.items, months: d.months } : d.items,
    totals: d.totals,
  }));
  // The same file selected twice in one batch is saved once (the later entry wins), so the upsert can't hit itself.
  const byHash = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (r.content_hash) byHash.set(r.content_hash, r);
  const hashed = [...byHash.values()];
  const plain = rows.filter((r) => !r.content_hash);
  const out: WorkspaceDocument[] = [];
  if (hashed.length) {
    const { data, error } = await c.from("workspace_documents").upsert(hashed, { onConflict: "workspace_id,content_hash" }).select(DOCUMENT_COLUMNS);
    if (!error) out.push(...(data as DocumentRow[]).map(toDocument));
    // 42P10: the database still has the old partial unique index (migration 0006 not applied), which ON CONFLICT
    // can't target. Dedupe by hand instead of dropping the documents: update the files already saved, insert the rest.
    else if (error.code === "42P10") out.push(...(await saveHashedWithoutUpsert(c, workspaceId, hashed)));
    else throw new Error(error.message);
  }
  if (plain.length) {
    const { data, error } = await c.from("workspace_documents").insert(plain).select(DOCUMENT_COLUMNS);
    if (error) throw new Error(error.message);
    out.push(...(data as DocumentRow[]).map(toDocument));
  }
  return out;
}

/** Upsert fallback: same result (one row per file per workspace) without relying on an ON CONFLICT target. */
async function saveHashedWithoutUpsert(c: SupabaseClient, workspaceId: string, rows: { content_hash: string | null }[]): Promise<WorkspaceDocument[]> {
  const hashes = rows.map((r) => r.content_hash!);
  const { data: existing, error: findError } = await c.from("workspace_documents").select("id,content_hash").eq("workspace_id", workspaceId).in("content_hash", hashes);
  if (findError) throw new Error(findError.message);
  const idByHash = new Map((existing as { id: string; content_hash: string }[]).map((r) => [r.content_hash, r.id]));
  const out: WorkspaceDocument[] = [];
  const fresh = rows.filter((r) => !idByHash.has(r.content_hash!));
  for (const r of rows.filter((x) => idByHash.has(x.content_hash!))) {
    const { data, error } = await c.from("workspace_documents").update(r).eq("id", idByHash.get(r.content_hash!)!).select(DOCUMENT_COLUMNS).single<DocumentRow>();
    if (error) throw new Error(error.message);
    out.push(toDocument(data));
  }
  if (fresh.length) {
    const { data, error } = await c.from("workspace_documents").insert(fresh).select(DOCUMENT_COLUMNS);
    if (error) throw new Error(error.message);
    out.push(...(data as DocumentRow[]).map(toDocument));
  }
  return out;
}

export async function updateDocument(id: string, patch: { name?: string; period?: string | null }) {
  const row: Record<string, string | null> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim().slice(0, 160);
    if (!name) throw new Error("Give the document a name.");
    row.name = name;
  }
  if (patch.period !== undefined) {
    if (patch.period !== null && !/^\d{4}-\d{2}$/.test(patch.period)) throw new Error("Pick a valid month.");
    row.period = patch.period;
  }
  const { error } = await requireClient().from("workspace_documents").update(row).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Replaces a document's line items (e.g. after removing a line from the monthly breakdown). A multi-month document
 * keeps its lines in `items.months`; the top-level lists stay empty, as when it was first saved.
 */
export async function updateDocumentItems(doc: WorkspaceDocument, next: { items: ExtractedLineItems | null; months: DocumentMonthSlice[]; totals: WorkspaceDocumentTotals }): Promise<WorkspaceDocument> {
  const base: ExtractedLineItems = next.items ?? { businessType: doc.items?.businessType ?? "OTHER_CUSTOM", revenue: [], expenses: [] };
  const items = next.months.length ? { businessType: base.businessType, revenue: [], expenses: [], months: next.months } : base;
  const { data, error } = await requireClient().from("workspace_documents").update({ items, totals: next.totals }).eq("id", doc.id).select(DOCUMENT_COLUMNS).single<DocumentRow>();
  if (error) throw new Error(error.message);
  return toDocument(data);
}

export async function deleteDocument(id: string) {
  const { error } = await requireClient().from("workspace_documents").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Workspace report (the latest analysis per workspace, so it survives reloads and deploys)
// ---------------------------------------------------------------------------

export async function loadWorkspaceReport(workspaceId: string): Promise<AnalysisResponse | null> {
  const { data, error } = await requireClient().from("workspace_reports").select("report").eq("workspace_id", workspaceId).maybeSingle<{ report: unknown }>();
  if (error) throw new Error(error.message);
  return data && isAnalysisResponse(data.report) ? data.report : null;
}

export async function saveWorkspaceReport(workspaceId: string, report: AnalysisResponse): Promise<void> {
  const c = requireClient();
  const { data: u } = await c.auth.getUser();
  if (!u.user) throw new Error("Sign in to save reports.");
  const { error } = await c.from("workspace_reports").upsert({ workspace_id: workspaceId, user_id: u.user.id, report }, { onConflict: "workspace_id" });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Report versions (an immutable snapshot per analysis run, so new runs never erase earlier insights)
// ---------------------------------------------------------------------------

export type ReportVersionSource = "analysis" | "rebuild" | "unlock";

export interface ReportVersionSummary {
  source: ReportVersionSource;
  monthlyRevenue?: number;
  monthlyExpenses?: number;
  /** Months of data the analysis covered ("YYYY-MM", oldest first), when known. */
  months?: string[];
  documents?: number;
}

export interface ReportVersionMeta {
  id: string;
  createdAt: string;
  summary: ReportVersionSummary;
}

/** Versions kept per workspace (older ones are pruned after each save). */
export const REPORT_VERSION_LIMIT = 25;

function toVersionSummary(v: unknown): ReportVersionSummary {
  const s = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const source: ReportVersionSource = s.source === "rebuild" || s.source === "unlock" ? s.source : "analysis";
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
  const months = Array.isArray(s.months) ? s.months.filter((m): m is string => typeof m === "string" && PERIOD_RE.test(m)) : undefined;
  return { source, monthlyRevenue: num(s.monthlyRevenue), monthlyExpenses: num(s.monthlyExpenses), months: months?.length ? months : undefined, documents: num(s.documents) };
}

export async function listReportVersions(workspaceId: string): Promise<ReportVersionMeta[]> {
  const { data, error } = await requireClient()
    .from("workspace_report_versions")
    .select("id,summary,created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(REPORT_VERSION_LIMIT);
  if (error) throw new Error(error.message);
  return (data as { id: string; summary: unknown; created_at: string }[]).map((r) => ({ id: r.id, createdAt: r.created_at, summary: toVersionSummary(r.summary) }));
}

export async function loadReportVersion(id: string): Promise<AnalysisResponse | null> {
  const { data, error } = await requireClient().from("workspace_report_versions").select("report").eq("id", id).maybeSingle<{ report: unknown }>();
  if (error) throw new Error(error.message);
  return data && isAnalysisResponse(data.report) ? data.report : null;
}

/** Appends a version and prunes the workspace's history to the newest REPORT_VERSION_LIMIT. */
export async function saveReportVersion(workspaceId: string, report: AnalysisResponse, summary: ReportVersionSummary): Promise<ReportVersionMeta> {
  const c = requireClient();
  const { data: u } = await c.auth.getUser();
  if (!u.user) throw new Error("Sign in to save reports.");
  const { data, error } = await c
    .from("workspace_report_versions")
    .insert({ workspace_id: workspaceId, user_id: u.user.id, report, summary })
    .select("id,summary,created_at")
    .single<{ id: string; summary: unknown; created_at: string }>();
  if (error) throw new Error(error.message);
  const { data: old } = await c
    .from("workspace_report_versions")
    .select("id")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .range(REPORT_VERSION_LIMIT, REPORT_VERSION_LIMIT + 50);
  const stale = (old as { id: string }[] | null)?.map((r) => r.id) ?? [];
  if (stale.length) await c.from("workspace_report_versions").delete().in("id", stale);
  return { id: data.id, createdAt: data.created_at, summary: toVersionSummary(data.summary) };
}
