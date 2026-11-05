/**
 * Guided-form drafts in localStorage, so a refresh restores the user's step and inputs.
 *
 * Drafts stay on this device only (never sent to the server), are scoped per user,
 * workspace and mode, expire after DRAFT_TTL_MS, and are cleared on successful
 * report generation and on sign-out.
 */

const PREFIX = "lp:guidedForm:";
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface FormDraft<R, E> {
  step: number;
  businessType: string;
  revenue: R[];
  expenses: E[];
}

interface Stored<R, E> extends FormDraft<R, E> {
  v: 1;
  savedAt: number;
}

export const draftKey = (userId: string, wsKey: string, mode: string) => `${PREFIX}${userId}:${wsKey}:${mode}`;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadDraft<R, E>(key: string): FormDraft<R, E> | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Stored<R, E>>;
    const valid =
      d?.v === 1 &&
      typeof d.savedAt === "number" &&
      Date.now() - d.savedAt < DRAFT_TTL_MS &&
      typeof d.step === "number" &&
      typeof d.businessType === "string" &&
      Array.isArray(d.revenue) &&
      Array.isArray(d.expenses);
    if (!valid) {
      s.removeItem(key);
      return null;
    }
    return { step: d.step!, businessType: d.businessType!, revenue: d.revenue!, expenses: d.expenses! };
  } catch {
    return null;
  }
}

export function saveDraft<R, E>(key: string, draft: FormDraft<R, E>): void {
  try {
    storage()?.setItem(key, JSON.stringify({ v: 1, savedAt: Date.now(), ...draft } satisfies Stored<R, E>));
  } catch {
    /* quota exceeded or storage blocked — persistence is best-effort */
  }
}

export function clearDraft(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Every device-only key that can hold financial numbers: guided-form drafts, tracker copies (guest tracker and
 * not-yet-synced edits), per-workspace forecast preferences and this tab's analysis results.
 */
export const DEVICE_DATA_PREFIXES = [PREFIX, "lp:fiscalTracker:", "lp:forecast:", "lp:results:", "lp:reportCallout:"] as const;

/** Removes every guided-form draft and other device-only financial data (used on sign-out). */
export function clearAllDrafts(): void {
  const stores: (Storage | null)[] = [storage()];
  try {
    stores.push(typeof window === "undefined" ? null : window.sessionStorage);
  } catch {
    /* blocked */
  }
  for (const s of stores) {
    if (!s) continue;
    try {
      const keys: string[] = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k && DEVICE_DATA_PREFIXES.some((p) => k.startsWith(p))) keys.push(k);
      }
      keys.forEach((k) => s.removeItem(k));
    } catch {
      /* ignore */
    }
  }
}
