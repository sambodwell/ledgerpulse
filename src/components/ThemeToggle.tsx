"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { THEME_KEY, type Theme } from "@/lib/theme";
import { cn } from "@/components/ui";

const readTheme = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

function subscribe(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}

/** Current theme, kept in sync with the `data-theme` attribute on <html>. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => "dark");
}

export function setTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.add("theme-transition");
  if (theme === "light") root.dataset.theme = "light";
  else delete root.dataset.theme;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode: the choice just won't persist */
  }
  window.setTimeout(() => root.classList.remove("theme-transition"), 250);
}

/*
 * The floating toggle (root layout) is on every route — sign-up, auth callback, admin, error and 404 pages included —
 * so the theme can always be switched. Pages with navigation (the sidebar) render an inline toggle there instead; while
 * one is mounted the floating one steps aside so there's exactly one control on screen.
 */
let inlineCount = 0;
const inlineListeners = new Set<() => void>();
const emitInline = () => inlineListeners.forEach((l) => l());
const subscribeInline = (l: () => void) => {
  inlineListeners.add(l);
  return () => inlineListeners.delete(l);
};

function ToggleIcon({ light, className }: { light: boolean; className?: string }) {
  return light ? <Moon className={className} aria-hidden /> : <Sun className={className} aria-hidden />;
}

/** Sun/Moon switch. `floating` (default) pins it to the bottom-left corner; `inline` sits in a nav bar with a label. */
export function ThemeToggle({ variant = "floating", compact = false, className }: { variant?: "floating" | "inline"; /** inline only: icon without the label. */ compact?: boolean; className?: string }) {
  const theme = useTheme();
  const light = theme === "light";
  const hasInline = useSyncExternalStore(subscribeInline, () => inlineCount > 0, () => false);

  useEffect(() => {
    if (variant !== "inline") return;
    inlineCount++;
    emitInline();
    return () => {
      inlineCount--;
      emitInline();
    };
  }, [variant]);

  const label = light ? "Switch to dark mode" : "Switch to light mode";
  const toggle = () => setTheme(light ? "dark" : "light");

  if (variant === "inline") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 transition hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400",
          className,
        )}
      >
        <ToggleIcon light={light} className="h-4 w-4" />
        {!compact && <span>{light ? "Dark mode" : "Light mode"}</span>}
      </button>
    );
  }

  if (hasInline) return null;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={light ? "Dark mode" : "Light mode"}
      // z-[55]: above sticky bars, drawers and the chat panel (z-50), below modal dialogs (z-[60]).
      className={cn(
        "fixed bottom-4 left-4 z-[55] grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-slate-900/90 text-slate-300 shadow-lg backdrop-blur-xl transition hover:border-white/30 hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400",
        className,
      )}
    >
      <ToggleIcon light={light} className="h-4 w-4" />
    </button>
  );
}
