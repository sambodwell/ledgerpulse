"use client";

import { useCallback, useState } from "react";

/**
 * A per-workspace, per-device preference kept in localStorage (e.g. cash on hand, benchmark peer group).
 * When `storageKey` changes (another workspace or user), that key's stored value is adopted during render so nothing
 * shows the previous workspace's value. Storage failures (private mode, blocked site data) fall back to `fallback`.
 */
export function useWorkspacePref<T>(storageKey: string | null, fallback: T, validate: (raw: unknown) => T | null): [T, (v: T) => void] {
  const [state, setState] = useState<{ key: string | null; value: T }>({ key: null, value: fallback });
  if (state.key !== storageKey) {
    let next = fallback;
    try {
      const raw = storageKey && typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
      const parsed = raw == null ? null : validate(JSON.parse(raw));
      if (parsed != null) next = parsed;
    } catch {
      /* fall back */
    }
    setState({ key: storageKey, value: next });
  }
  const set = useCallback(
    (value: T) => {
      setState({ key: storageKey, value });
      try {
        if (storageKey) {
          if (value == null) window.localStorage.removeItem(storageKey);
          else window.localStorage.setItem(storageKey, JSON.stringify(value));
        }
      } catch {
        /* per-device convenience only */
      }
    },
    [storageKey],
  );
  return [state.key === storageKey ? state.value : fallback, set];
}
