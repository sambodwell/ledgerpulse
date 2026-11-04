"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import type { WorkspaceMode } from "@/lib/schemas";

/**
 * Global Personal Net Worth ↔ Enterprise P&L toggle.
 *
 * Not the same thing as AppProvider's `activeWorkspace` (a saved, named workspace
 * row such as "123 Main St Duplex"). This is the dashboard *mode*. Its default
 * follows the saved workspace's type, then the user's plan category, then
 * 'enterprise'. A manual toggle is remembered per saved workspace for this tab.
 */

export type WorkspaceType = "personal" | "enterprise";

interface WorkspaceContextType {
  activeWorkspace: WorkspaceType;
  setActiveWorkspace: (workspace: WorkspaceType) => void;
  toggleWorkspace: () => void;
  /** The same value in the domain vocabulary used by schemas and the API. */
  mode: WorkspaceMode;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export const toMode = (w: WorkspaceType): WorkspaceMode => (w === "personal" ? "PERSONAL" : "BUSINESS");
export const fromMode = (m: WorkspaceMode): WorkspaceType => (m === "PERSONAL" ? "personal" : "enterprise");

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const app = useApp();
  const key = app.activeWorkspace?.id ?? "guest";
  const fallback: WorkspaceType = app.activeWorkspace
    ? fromMode(app.activeWorkspace.mode)
    : app.profile?.planCategory === "PERSONAL_FAMILY"
      ? "personal"
      : "enterprise";

  const [overrides, setOverrides] = useState<Record<string, WorkspaceType>>({});
  const activeWorkspace = overrides[key] ?? fallback;

  const setActiveWorkspace = useCallback((workspace: WorkspaceType) => setOverrides((cur) => ({ ...cur, [key]: workspace })), [key]);

  const toggleWorkspace = useCallback(() => {
    setOverrides((cur) => ({ ...cur, [key]: (cur[key] ?? fallback) === "enterprise" ? "personal" : "enterprise" }));
  }, [key, fallback]);

  const value = useMemo(
    () => ({ activeWorkspace, setActiveWorkspace, toggleWorkspace, mode: toMode(activeWorkspace) }),
    [activeWorkspace, setActiveWorkspace, toggleWorkspace],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return context;
}
