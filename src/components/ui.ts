import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Shared design-system tokens for the dark glassmorphism UI. */
export const cn = (...inputs: Parameters<typeof clsx>) => twMerge(clsx(inputs));

export const glass = "rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.35)]";

export const inputCls =
  "w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-400 focus:outline-none";

export const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300";

export const secondaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10 disabled:opacity-50";

export const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const usdCompact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
export const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Reads an `{ error }` body from a failed fetch, falling back to the status. */
export async function errorMessage(res: Response): Promise<string> {
  const data: unknown = await res.json().catch(() => null);
  if (data && typeof data === "object" && "error" in data) return String((data as { error: unknown }).error);
  if (res.status === 401) return "Your session has expired. Sign in again to continue.";
  if (res.status === 504) return "The analysis took too long. Try a shorter statement or fewer line items.";
  if (res.status >= 500) return `The server hit an error (${res.status}). Please try again in a moment.`;
  return `Request failed (${res.status})`;
}
