/**
 * First-touch signup attribution. On a visitor's first page view we remember where they came from (utm_* / ?ref= /
 * external referrer / direct) in localStorage; at sign-up it's attached to the Supabase user's metadata so the admin
 * dashboard can count signups and conversions by origin. Only marketing context is stored, never financial data.
 */

const KEY = "sh:attribution";

export interface Attribution {
  /** utm_source, ?ref=, the referring host, or "direct". */
  source: string;
  medium: string | null;
  campaign: string | null;
  referrer: string | null;
  /** Path of the first page seen (no query string). */
  landing: string;
  /** ISO time of the first visit. */
  at: string;
}

const clip = (v: string | null | undefined, n = 80) => {
  const s = v?.trim().toLowerCase().slice(0, n);
  return s ? s : null;
};

function read(): Attribution | null {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" && typeof (v as Attribution).source === "string" ? (v as Attribution) : null;
  } catch {
    return null;
  }
}

/** Records the first touch once per browser. Call on every page load; later visits never overwrite it. */
export function captureAttribution(): void {
  if (typeof window === "undefined" || read()) return;
  try {
    const q = new URLSearchParams(window.location.search);
    let refHost: string | null = null;
    try {
      const r = document.referrer ? new URL(document.referrer) : null;
      if (r && r.host !== window.location.host) refHost = r.host.replace(/^www\./, "");
    } catch {
      /* malformed referrer */
    }
    const source = clip(q.get("utm_source")) ?? clip(q.get("ref")) ?? clip(q.get("source")) ?? refHost ?? "direct";
    const a: Attribution = {
      source,
      medium: clip(q.get("utm_medium")) ?? (refHost && !q.get("utm_source") ? "referral" : null),
      campaign: clip(q.get("utm_campaign")),
      referrer: refHost,
      landing: window.location.pathname.slice(0, 120),
      at: new Date().toISOString(),
    };
    window.localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* storage blocked: attribution is best-effort */
  }
}

/** Metadata attached to `auth.signUp` (stored in auth.users.raw_user_meta_data). */
export function signupMetadata(): Record<string, string> {
  const a = read();
  const out: Record<string, string> = { signup_source: a?.source ?? "direct" };
  if (a?.medium) out.signup_medium = a.medium;
  if (a?.campaign) out.signup_campaign = a.campaign;
  if (a?.referrer) out.signup_referrer = a.referrer;
  if (a?.landing) out.signup_landing = a.landing;
  if (a?.at) out.first_visit_at = a.at;
  return out;
}
