"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import {
  fetchProfile,
  getSupabase,
  isSupabaseConfigured,
  listWorkspaces,
  onAuthChange,
  setDefaultWorkspace,
} from "@/lib/supabase";
import type { UserProfile, WorkspaceMode, WorkspaceProfile } from "@/lib/schemas";
import { AuthDialog } from "@/components/AuthDialog";

interface UiHints {
  mode: WorkspaceMode;
  hasAnalysis: boolean;
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
  const [uiHints, setUiHintsState] = useState<UiHints>({ mode: "BUSINESS", hasAnalysis: false });
  const loadedFor = useRef<string | null | undefined>(undefined);

  const refreshProfile = useCallback(async () => {
    try {
      const p = await fetchProfile();
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
      openAuth: (mode = "signin") => setAuthMode(mode),
      uiHints,
      setUiHints,
    }),
    [ready, user, profile, workspaces, activeId, setActiveWorkspaceId, refreshProfile, refreshWorkspaces, uiHints, setUiHints],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      {authMode && <AuthDialog initialMode={authMode} onClose={() => setAuthMode(null)} />}
    </AppContext.Provider>
  );
}
