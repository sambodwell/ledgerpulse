"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BarChart3, Briefcase, CreditCard, Home, LogIn, LogOut, User as UserIcon } from "lucide-react";
import { signOut } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { cn, glass } from "@/components/ui";

export function TierBadge({ tier }: { tier: "free" | "pro" }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        tier === "pro" ? "border-amber-300/40 bg-amber-400/15 text-amber-200" : "border-white/15 bg-white/5 text-slate-300",
      )}
    >
      {tier === "pro" ? "Pro" : "Free"}
    </span>
  );
}

/** "3 full-report credits" (singular-aware). */
export const creditsLabel = (n: number) => `${n} full-report credit${n === 1 ? "" : "s"}`;

/**
 * Top-right avatar: account info, billing and sign-out. Workspace switching and creation live in the sidebar
 * (they used to be buried here, which made it unclear which book you were in or how to start a new one).
 */
export function ProfileMenu() {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = app.user?.email?.[0]?.toUpperCase();
  const ws = app.activeWorkspace;
  const credits = app.profile?.reportUnlocks ?? 0;

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-gradient-to-br from-indigo-500/40 to-emerald-500/30 text-sm font-semibold text-white shadow-lg transition hover:border-white/30"
      >
        {initial ?? <UserIcon className="h-5 w-5" />}
      </button>

      {open && (
        <div role="menu" className={cn(glass, "absolute right-0 z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] bg-slate-900/95 p-2 text-sm")}>
          <div className="border-b border-white/10 px-3 pb-3 pt-2">
            {app.user ? (
              <>
                <p className="truncate font-medium text-slate-100">{app.user.email}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <TierBadge tier={app.profile?.tier ?? "free"} />
                  {credits > 0 && app.profile?.tier !== "pro" && <span className="text-xs text-slate-400">{creditsLabel(credits)}</span>}
                </div>
              </>
            ) : (
              <>
                <p className="font-medium text-slate-100">Guest</p>
                <p className="mt-0.5 text-xs text-slate-400">Sign in to save workspaces and unlock audits.</p>
              </>
            )}
          </div>

          {app.user && (
            <div className="border-b border-white/10 px-3 py-2.5 text-xs">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Current workspace</p>
              <p className="mt-1 flex items-center gap-1.5 text-slate-200">
                {ws ? ws.mode === "PERSONAL" ? <Home className="h-3.5 w-3.5 text-emerald-300" /> : <Briefcase className="h-3.5 w-3.5 text-indigo-300" /> : null}
                <span className="truncate">{ws?.name ?? "None selected"}</span>
              </p>
              <p className="mt-1 text-slate-500">Switch or create workspaces from the sidebar.</p>
            </div>
          )}

          <div className="pt-1">
            <Link href="/settings" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/5">
              <CreditCard className="h-4 w-4 text-slate-400" /> Account &amp; subscription
            </Link>
            {app.isAdmin && (
              <Link href="/admin" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/5">
                <BarChart3 className="h-4 w-4 text-slate-400" /> Admin: signups &amp; feedback
              </Link>
            )}
            {app.user ? (
              <button
                role="menuitem"
                onClick={async () => {
                  setOpen(false);
                  await signOut();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-white/5"
              >
                <LogOut className="h-4 w-4 text-slate-400" /> Sign out
              </button>
            ) : (
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  app.openAuth("signin");
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-white/5"
              >
                <LogIn className="h-4 w-4 text-slate-400" /> Sign in / Create account
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
