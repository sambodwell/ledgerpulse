"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { THEME_KEY, type Theme } from "@/lib/theme";

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

/** Subtle Sun/Moon switch pinned to the bottom-left corner. */
export function ThemeToggle() {
  const theme = useTheme();
  const light = theme === "light";
  return (
    <button
      type="button"
      onClick={() => setTheme(light ? "dark" : "light")}
      aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
      title={light ? "Dark mode" : "Light mode"}
      className="fixed bottom-4 left-4 z-40 grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-slate-900/80 text-slate-400 shadow-lg backdrop-blur-xl transition hover:border-white/20 hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
    >
      {light ? <Moon className="h-4 w-4" aria-hidden /> : <Sun className="h-4 w-4" aria-hidden />}
    </button>
  );
}
