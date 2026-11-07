"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import {
  authHeaders,
  createWorkspace,
  deleteWorkspace,
  fetchProfile,
  getSupabase,
  isSupabaseConfigured,
  listWorkspaces,
  onAuthChange,
  setDefaultWorkspace,
} from "@/lib/supabase";
import type { BusinessType, UserProfile, WorkspaceMode, WorkspaceProfile } from "@/lib/schemas";
import { AuthDialog } from "@/components/AuthDialog";
import { DEV_UNLOCK } from "@/lib/devUnlock";
import { captureAttribution } from "@/lib/attribution";

/** Non-financial UI state shared with the chat assistant so it can talk about what's on screen. */
export interface UiHints {
  mode: WorkspaceMode;
  hasAnalysis: boolean;
  hasWorkspace: boolean;
  seasonality: boolean;
  inflation: boolean;
  horizonMonths: number;
  trackerForecastMode: "TRAILING" | "BASELINE" | null;
  goalMetric: "NET" | "REVENUE" | "EXPENSE" | null;
}

interface AppState {
  configured: boolean;
  ready: boolean;
  user: User | null;
  profile: UserProfile | null;
  /** True for ADMIN_EMAILS accounts (decided server-side); shows the admin links. Admin routes re-check it themselves. */
  isAdmin: boolean;
  /**
   * Single source of truth for Pro access in the UI: a Pro subscription, an admin account, or the dev unlock. Admins
   * count as Pro even when their profile row is missing or hasn't been updated yet. The server enforces the same rule.
   */
  isPro: boolean;
  workspaces: WorkspaceProfile[];
  activeWorkspace: WorkspaceProfile | null;
  setActiveWorkspaceId: (id: string | null) => void;
  refreshProfile: () => Promise<UserProfile | null>;
  refreshWorkspaces: () => Promise<WorkspaceProfile[]>;
  /** Deletes a workspace (and, by cascade, its tracker, documents, report and scenarios) and switches to another one if it was active. */
  removeWorkspace: (id: string) => Promise<void>;
  /**
   * Creates a workspace from a menu, makes it active and flags it as fresh so the dashboard opens it on a clean
   * slate: inputs open on the statement upload, nothing carried over from the previous workspace.
   */
  createFreshWorkspace: (input: { name: string; businessType: BusinessType }) => Promise<WorkspaceProfile>;
  /** Id of a workspace just created via `createFreshWorkspace` that the dashboard hasn't set up yet. */
  freshWorkspaceId: string | null;
  clearFreshWorkspace: () => void;
  openAuth: (mode?: "signin" | "signup") => void;
  uiHints: UiHints;
  setUiHints: (h: Partial<UiHints>) => void;
}

interface ServerEntitlement {
  tier: "free" | "pro";
  admin: boolean;
}

/** Best-effort: never blocks sign-in if the route is unavailable. Returns the server's view of the caller's plan. */
async function syncEntitlements(): Promise<ServerEntitlement | null> {
  try {
    const res = await fetch("/api/account/sync", { method: "POST", headers: await authHeaders() });
    if (!res.ok) return null;
    const v = (await res.json()) as { tier?: unknown; admin?: unknown };
    return { tier: v.tier === "pro" ? "pro" : "free", admin: v.admin === true };
  } catch {
    /* offline or route unavailable: the stored profile is used as-is */
    return null;
  }
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!isSupabaseConfigured);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"signin" | "signup" | null>(null);
  const [uiHints, setUiHintsState] = useState<UiHints>({
    mode: "BUSINESS",
    hasAnalysis: false,
    hasWorkspace: false,
    seasonality: false,
    inflation: false,
    horizonMonths: 12,
    trackerForecastMode: null,
    goalMetric: null,
  });
  const loadedFor = useRef<string | null | undefined>(undefined);
  const [isAdmin, setIsAdmin] = useState(false);
  /** Admin accounts are Pro by server decision, even before (or without) the profile row being updated. */
  const adminPro = useRef(false);

  useEffect(() => captureAttribution(), []);

  const refreshProfile = useCallback(async () => {
    try {
      const fetched = await fetchProfile();
      // Local testing (NEXT_PUBLIC_DEV_UNLOCK=1) and ADMIN_EMAILS accounts: present as Pro, matching the server.
      const p = (DEV_UNLOCK || adminPro.current) && fetched ? { ...fetched, tier: "pro" as const } : fetched;
      setProfile(p);
      return p;
    } catch (e) {
      console.error("[app] profile", e);
      return null;
    }
  }, []);

  const refreshWorkspaces = useCallback(async () => {
    try {
      const ws = await listWorkspaces();
      setWorkspaces(ws);
      return ws;
    } catch (e) {
      console.error("[app] workspaces", e);
      return [];
    }
  }, []);

  // Load session, then profile + workspaces whenever the signed-in user changes.
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let cancelled = false;

    const load = async (u: User | null) => {
      setUser(u);
      if (!u) {
        adminPro.current = false;
        setIsAdmin(false);
        setProfile(null);
        setWorkspaces([]);
        setActiveId(null);
        setReady(true);
        return;
      }
      // Server-side entitlement sync first (e.g. ADMIN_EMAILS accounts are made Pro), so the profile read below reflects it.
      const ent = await syncEntitlements();
      if (cancelled) return;
      adminPro.current = !!ent?.admin;
      setIsAdmin(!!ent?.admin);
      const [p, ws] = await Promise.all([refreshProfile(), refreshWorkspaces()]);
      if (cancelled) return;
      setActiveId((cur) => (cur && ws.some((w) => w.id === cur) ? cur : p?.defaultWorkspaceId && ws.some((w) => w.id === p.defaultWorkspaceId) ? p.defaultWorkspaceId : ws[0]?.id ?? null));
      setReady(true);
    };

    // onAuthStateChange fires INITIAL_SESSION on subscribe, then on sign-in/out and token refresh.
    const unsub = onAuthChange((u) => {
      if (cancelled) return;
      // Token refreshes fire this too; only reload when the identity changes.
      if (loadedFor.current !== (u?.id ?? null)) {
        loadedFor.current = u?.id ?? null;
        void load(u);
      } else {
        setUser(u);
      }
    });
    return () => {
      cancelled = true;
      loadedFor.current = undefined;
      unsub();
    };
  }, [refreshProfile, refreshWorkspaces]);

  const setActiveWorkspaceId = useCallback((id: string | null) => {
    setActiveId(id);
    void setDefaultWorkspace(id).catch(() => {});
  }, []);

  const activeIdRef = useRef(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const removeWorkspace = useCallback(
    async (id: string) => {
      await deleteWorkspace(id);
      const ws = await refreshWorkspaces();
      if (activeIdRef.current === id || !ws.some((w) => w.id === activeIdRef.current)) {
        const next = ws[0]?.id ?? null;
        setActiveId(next);
        void setDefaultWorkspace(next).catch(() => {});
      }
    },
    [refreshWorkspaces],
  );

  const [freshWorkspaceId, setFreshWorkspaceId] = useState<string | null>(null);
  const createFreshWorkspace = useCallback(
    async (input: { name: string; businessType: BusinessType }) => {
      const ws = await createWorkspace(input);
      await refreshWorkspaces();
      setFreshWorkspaceId(ws.id);
      setActiveId(ws.id);
      void setDefaultWorkspace(ws.id).catch(() => {});
      return ws;
    },
    [refreshWorkspaces],
  );
  const clearFreshWorkspace = useCallback(() => setFreshWorkspaceId(null), []);

  const setUiHints = useCallback((h: Partial<UiHints>) => setUiHintsState((cur) => ({ ...cur, ...h })), []);

  const value = useMemo<AppState>(
    () => ({
      configured: isSupabaseConfigured,
      ready,
      user,
      profile,
      isAdmin,
      isPro: !!user && (DEV_UNLOCK || isAdmin || profile?.tier === "pro"),
      workspaces,
      activeWorkspace: workspaces.find((w) => w.id === activeId) ?? null,
      setActiveWorkspaceId,
      refreshProfile,
      refreshWorkspaces,
      removeWorkspace,
      createFreshWorkspace,
      freshWorkspaceId,
      clearFreshWorkspace,
      openAuth: (mode = "signin") => setAuthMode(mode),
      uiHints,
      setUiHints,
    }),
    [ready, user, profile, isAdmin, workspaces, activeId, setActiveWorkspaceId, refreshProfile, refreshWorkspaces, removeWorkspace, createFreshWorkspace, freshWorkspaceId, clearFreshWorkspace, uiHints, setUiHints],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      {authMode && <AuthDialog initialMode={authMode} onClose={() => setAuthMode(null)} />}
    </AppContext.Provider>
  );
}
