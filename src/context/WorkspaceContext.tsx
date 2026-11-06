"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import type { WorkspaceMode } from "@/lib/schemas";

/**
 * Personal Net Worth ↔ Enterprise P&L mode.
 *
 * Not the same thing as AppProvider's `activeWorkspace` (a saved, named workspace row such as "123 Main St Duplex").
 *
 * Isolation rule: a saved workspace IS one book of one type, so while one is active the mode is locked to that
 * workspace's type. (It used to be a free toggle, which re-labelled the same workspace's report, tracker and documents
 * as "Personal" — the Business book's data appeared to bleed into a Personal one.) Switching to personal finances now
 * means switching to — or creating — a personal workspace from the sidebar.
 *
 * Only with no saved workspace selected (a temporary, unsaved analysis) can the mode be toggled freely; it then
 * defaults to the user's plan category.
 */

export type WorkspaceType = "personal" | "enterprise";

interface WorkspaceContextType {
  activeWorkspace: WorkspaceType;
  setActiveWorkspace: (workspace: WorkspaceType) => void;
  toggleWorkspace: () => void;
  /** The same value in the domain vocabulary used by schemas and the API. */
  mode: WorkspaceMode;
  /** True while a saved workspace is active: its type decides the mode and it can't be toggled. */
  locked: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export const toMode = (w: WorkspaceType): WorkspaceMode => (w === "personal" ? "PERSONAL" : "BUSINESS");
export const fromMode = (m: WorkspaceMode): WorkspaceType => (m === "PERSONAL" ? "personal" : "enterprise");

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const app = useApp();
  const saved = app.activeWorkspace;
  const planDefault: WorkspaceType = app.profile?.planCategory === "PERSONAL_FAMILY" ? "personal" : "enterprise";

  // Applies only to the temporary (no saved workspace) context.
  const [unsavedOverride, setUnsavedOverride] = useState<WorkspaceType | null>(null);
  const locked = !!saved;
  const activeWorkspace: WorkspaceType = saved ? fromMode(saved.mode) : unsavedOverride ?? planDefault;

  const setActiveWorkspace = useCallback(
    (workspace: WorkspaceType) => {
      if (!locked) setUnsavedOverride(workspace);
    },
    [locked],
  );
  const toggleWorkspace = useCallback(() => {
    if (!locked) setUnsavedOverride((cur) => ((cur ?? planDefault) === "enterprise" ? "personal" : "enterprise"));
  }, [locked, planDefault]);

  const value = useMemo(
    () => ({ activeWorkspace, setActiveWorkspace, toggleWorkspace, mode: toMode(activeWorkspace), locked }),
    [activeWorkspace, setActiveWorkspace, toggleWorkspace, locked],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return context;
}
