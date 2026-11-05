/** Shared by the root layout (server) and ThemeToggle (client); kept out of the "use client" module so the layout gets real strings. */
export type Theme = "dark" | "light";
export const THEME_KEY = "lp:theme";

/**
 * Runs before first paint (inlined in <head> by the root layout) so a light-mode user never sees a dark flash.
 * Dark is the default; only an explicit "light" choice is honored.
 */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(THEME_KEY)})==="light")document.documentElement.dataset.theme="light"}catch(e){}`;
