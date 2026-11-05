"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import {
  deleteWorkspace,
  fetchProfile,
  getSupabase,
  isSupabaseConfigured,
  listWorkspaces,
  onAuthChange,
  setDefaultWorkspace,
} from "@/lib/supabase";
import type { UserProfile, WorkspaceMode, WorkspaceProfile } from "@/lib/schemas";
import { AuthDialog } from "@/components/AuthDialog";
import { DEV_UNLOCK } from "@/lib/devUnlock";

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
  workspaces: WorkspaceProfile[];
  activeWorkspace: WorkspaceProfile | null;
  setActiveWorkspaceId: (id: string | null) => void;
  refreshProfile: () => Promise<UserProfile | null>;
  refreshWorkspaces: () => Promise<WorkspaceProfile[]>;
  /** Deletes a workspace (and, by cascade, its tracker and scenarios) and switches to another one if it was active. */
  removeWorkspace: (id: string) => Promise<void>;
  openAuth: (mode?: "signin" | "signup") => void;
  uiHints: UiHints;
  setUiHints: (h: Partial<UiHints>) => void;
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

  const refreshProfile = useCallback(async () => {
    try {
      const fetched = await fetchProfile();
      // Local testing (NEXT_PUBLIC_DEV_UNLOCK=1): present every account as Pro, matching the server override.
      const p = DEV_UNLOCK && fetched ? { ...fetched, tier: "pro" as const } : fetched;
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
        setProfile(null);
        setWorkspaces([]);
        setActiveId(null);
        setReady(true);
        return;
      }
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

  const setUiHints = useCallback((h: Partial<UiHints>) => setUiHintsState((cur) => ({ ...cur, ...h })), []);

  const value = useMemo<AppState>(
    () => ({
      configured: isSupabaseConfigured,
      ready,
      user,
      profile,
      workspaces,
      activeWorkspace: workspaces.find((w) => w.id === activeId) ?? null,
      setActiveWorkspaceId,
      refreshProfile,
      refreshWorkspaces,
      removeWorkspace,
      openAuth: (mode = "signin") => setAuthMode(mode),
      uiHints,
      setUiHints,
    }),
    [ready, user, profile, workspaces, activeId, setActiveWorkspaceId, refreshProfile, refreshWorkspaces, removeWorkspace, uiHints, setUiHints],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      {authMode && <AuthDialog initialMode={authMode} onClose={() => setAuthMode(null)} />}
    </AppContext.Provider>
  );
}
