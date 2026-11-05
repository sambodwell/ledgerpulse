"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BusinessType } from "@/lib/schemas";
import {
  currentFiscalYearStart,
  defaultTrackerState,
  fiscalYearLabel,
  goalForMetric,
  goalPace,
  normalizeTrackerState,
  summarizeFiscalYear,
  type FiscalSummary,
  type FiscalTrackerState,
  type GoalPace,
} from "@/lib/fiscal";
import { loadFiscalTracker, saveFiscalTracker } from "@/lib/supabase";

export type SaveStatus = "idle" | "loading" | "saving" | "saved" | "error";

/**
 * Fiscal Year Tracker state for the active workspace: loads from Supabase (`fiscal_trackers`, one row per
 * workspace) or, without a workspace, from this device; autosaves every change.
 *
 * Persistence guarantees (each one fixes a way edits used to be lost):
 *  - A pending save is flushed — not cancelled — when the workspace changes, the component unmounts or the tab is hidden.
 *  - Toggling Business/Personal mode never reloads the tracker (the business type only seeds a brand-new tracker).
 *  - Until the server confirms a save, the edit is also kept on this device and restored on the next load, so a
 *    closed tab or dropped connection doesn't lose it.
 *  - If loading fails, nothing is saved (defaults would otherwise overwrite the real data) until a retry succeeds.
 *  - Saves run one at a time, in order, and always target the workspace the state was loaded for.
 */
export interface FiscalTrackerHandle {
  state: FiscalTrackerState;
  update: (fn: (s: FiscalTrackerState) => FiscalTrackerState) => void;
  status: SaveStatus;
  error: string | null;
  /** Loading failed: edits are disabled until `retry` succeeds. */
  loadFailed: boolean;
  /** Retries the failed load or save. */
  retry: () => void;
  /** Saves any pending change now. */
  flush: () => Promise<void>;
  workspaceId: string | null;
  summary: FiscalSummary;
  goal: number | null;
  pace: GoalPace | null;
  fyLabel: string;
}

const LOCAL_PREFIX = "lp:fiscalTracker:";
const PLACEHOLDER_DATE = new Date(Date.UTC(2000, 0, 1));
/** Device-only tracker used before a workspace exists (moved into the workspace when one is created). */
const guestKey = (userId: string) => `${LOCAL_PREFIX}${userId}:guest`;
/** Edits not yet confirmed by the server, per workspace. */
const unsyncedKey = (userId: string, workspaceId: string) => `${LOCAL_PREFIX}${userId}:${workspaceId}:unsynced`;

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the tracker still works for this session */
  }
}
function removeKey(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export const readLocalTracker = (userId: string): unknown => readJson(guestKey(userId));
export const clearLocalTracker = (userId: string) => removeKey(guestKey(userId));
/** Drops this device's unsynced copy for a workspace (e.g. after the workspace is deleted). */
export const clearUnsyncedTracker = (userId: string, workspaceId: string) => removeKey(unsyncedKey(userId, workspaceId));

export function useFiscalTracker({ userId, workspaceId, businessType }: { userId: string; workspaceId: string | null; businessType: BusinessType }): FiscalTrackerHandle {
  // Placeholder until the first load finishes. Fixed date: the page prerenders, and reading the clock there is not allowed.
  const [state, setState] = useState<FiscalTrackerState>(() => defaultTrackerState(businessType, PLACEHOLDER_DATE));
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  /** Which load the current state/status belongs to; anything else means a (re)load is in flight. */
  const loadKey = `${userId}|${workspaceId ?? "guest"}|${reloadTick}`;
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const loading = readyKey !== loadKey;

  const stateRef = useRef(state);
  /** The workspace (or null = this device) the current state belongs to; undefined while loading. */
  const ownerRef = useRef<string | null | undefined>(undefined);
  const pendingRef = useRef(false);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const businessTypeRef = useRef(businessType);
  useEffect(() => {
    businessTypeRef.current = businessType;
  }, [businessType]);

  /** Queues a save of the latest state for its owner. Saves are serialized so an older one can't land last. */
  const flush = useCallback((): Promise<void> => {
    if (!pendingRef.current || ownerRef.current === undefined) return chainRef.current;
    const owner = ownerRef.current;
    const snapshot = stateRef.current;
    pendingRef.current = false;
    chainRef.current = chainRef.current.then(async () => {
      if (owner === null) {
        writeJson(guestKey(userId), snapshot);
        return;
      }
      const isCurrent = () => ownerRef.current === owner;
      if (isCurrent()) {
        setStatus("saving");
        setError(null);
      }
      try {
        await saveFiscalTracker(owner, snapshot);
        // Only drop the device backup if nothing newer was queued meanwhile.
        if (!(isCurrent() && pendingRef.current)) removeKey(unsyncedKey(userId, owner));
        if (isCurrent()) setStatus("saved");
      } catch (e) {
        if (isCurrent()) {
          pendingRef.current = true;
          setError(e instanceof Error ? e.message : "Couldn't save.");
          setStatus("error");
        }
      }
    });
    return chainRef.current;
  }, [userId]);

  // Load once per workspace. Leaving a workspace flushes its pending save first.
  useEffect(() => {
    let cancelled = false;
    ownerRef.current = undefined;
    (async () => {
      try {
        let raw: unknown = null;
        let restoredUnsynced = false;
        if (workspaceId) {
          const remote = await loadFiscalTracker(workspaceId);
          raw = remote?.state ?? null;
          // An edit this device made that the server never confirmed wins if it is newer than the saved row.
          const backup = readJson(unsyncedKey(userId, workspaceId)) as { savedAt?: number; state?: unknown } | null;
          if (backup && typeof backup.savedAt === "number" && backup.state) {
            const remoteAt = remote?.updatedAt ? Date.parse(remote.updatedAt) : 0;
            if (backup.savedAt > remoteAt) {
              raw = backup.state;
              restoredUnsynced = true;
            } else removeKey(unsyncedKey(userId, workspaceId));
          }
        } else {
          raw = readJson(guestKey(userId));
        }
        if (cancelled) return;
        const s = raw ? normalizeTrackerState(raw, businessTypeRef.current) : defaultTrackerState(businessTypeRef.current);
        if (!raw) s.fyStartYear = currentFiscalYearStart(s.fyStartMonth);
        stateRef.current = s;
        ownerRef.current = workspaceId;
        pendingRef.current = restoredUnsynced;
        setState(s);
        setStatus("idle");
        setError(null);
        setLoadFailed(false);
        setReadyKey(loadKey);
        if (restoredUnsynced) void flush();
      } catch (e) {
        if (cancelled) return;
        // Don't fall back to an empty tracker that autosave would then write over the real data.
        setLoadFailed(true);
        setError(e instanceof Error ? `Couldn't load your tracker: ${e.message}` : "Couldn't load your tracker.");
        setStatus("error");
        setReadyKey(loadKey);
      }
    })();
    return () => {
      cancelled = true;
      void flush();
      ownerRef.current = undefined;
    };
  }, [workspaceId, userId, reloadTick, loadKey, flush]);

  // Debounced autosave. A guest (device-only) tracker is written immediately.
  useEffect(() => {
    if (!pendingRef.current) return;
    if (ownerRef.current === null) {
      void flush();
      return;
    }
    const t = setTimeout(() => void flush(), 700);
    return () => clearTimeout(t);
  }, [state, flush]);

  // Never lose the last edit to a closed or backgrounded tab.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const onPageHide = () => void flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [flush]);

  const update = useCallback(
    (fn: (s: FiscalTrackerState) => FiscalTrackerState) => {
      const owner = ownerRef.current;
      if (owner === undefined) return; // still loading, or the load failed
      const next = fn(stateRef.current);
      stateRef.current = next;
      pendingRef.current = true;
      if (owner) writeJson(unsyncedKey(userId, owner), { savedAt: Date.now(), state: next });
      setState(next);
    },
    [userId],
  );

  const failed = !loading && loadFailed;
  const retry = useCallback(() => {
    if (failed) setReloadTick((n) => n + 1);
    else void flush();
  }, [failed, flush]);

  const summary = useMemo(() => summarizeFiscalYear(state, loading ? PLACEHOLDER_DATE : new Date()), [state, loading]);
  const goal = goalForMetric(state, state.goalMetric);
  const pace = useMemo(() => goalPace(summary, state.goalMetric, goal), [summary, state.goalMetric, goal]);
  const fyLabel = fiscalYearLabel(state);

  return {
    state,
    update,
    status: loading ? "loading" : status,
    error: loading ? null : error,
    loadFailed: failed,
    retry,
    flush,
    workspaceId,
    summary,
    goal,
    pace: loading || failed ? null : pace,
    fyLabel,
  };
}
