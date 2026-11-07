import { useId } from "react";
import { cn } from "@/components/ui";

/**
 * Sumhaven logo: the arch-and-bars mark as inline SVG plus the wordmark set in the app's own sans-serif (Geist,
 * from the body font stack), so it matches the rest of the UI instead of the serif in the old PNG wordmark.
 * `text-slate-50` is remapped to ink by the light theme (globals.css), so one render works in both themes.
 */
export function BrandLogo({ height = 28, className }: { height?: number; className?: string }) {
  const id = useId();
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-2", className)} style={{ height }} role="img" aria-label="Sumhaven">
      <svg viewBox="0 0 32 32" width={height} height={height} aria-hidden focusable="false" className="shrink-0">
        <defs>
          <linearGradient id={`${id}-arch`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#818cf8" />
            <stop offset="1" stopColor="#6366f1" />
          </linearGradient>
          <linearGradient id={`${id}-bars`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#2dd4bf" />
            <stop offset="1" stopColor="#3b82f6" />
          </linearGradient>
        </defs>
        <path d="M6 28V14.5a10 10 0 0 1 20 0V28" fill="none" stroke={`url(#${id}-arch)`} strokeWidth="3.2" strokeLinecap="round" />
        <rect x="10.4" y="20" width="3" height="6.5" rx="0.8" fill={`url(#${id}-bars)`} />
        <rect x="14.5" y="16.5" width="3" height="10" rx="0.8" fill={`url(#${id}-bars)`} />
        <rect x="18.6" y="12.5" width="3" height="14" rx="0.8" fill={`url(#${id}-bars)`} />
        <path d="M3.5 29.5h25" stroke={`url(#${id}-arch)`} strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <span aria-hidden className="font-sans font-semibold leading-none tracking-tight text-slate-50" style={{ fontSize: Math.round(height * 0.72) }}>
        Sumhaven
      </span>
    </span>
  );
}
