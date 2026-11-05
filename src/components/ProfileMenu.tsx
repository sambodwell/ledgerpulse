"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Briefcase, Check, CreditCard, Home, Loader2, LogIn, LogOut, Plus, User as UserIcon } from "lucide-react";
import { signOut } from "@/lib/supabase";
import { BUSINESS_TYPES, BUSINESS_TYPE_LABELS, type BusinessType } from "@/lib/schemas";
import { useApp } from "@/components/AppProvider";
import { cn, glass, inputCls } from "@/components/ui";

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

/** Top-right avatar with account info, workspace switcher, billing link and sign-out. */
export function ProfileMenu() {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<BusinessType>("REAL_ESTATE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

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

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Fresh workspace: the dashboard opens it on a clean statement-upload / guided-input screen.
      await app.createFreshWorkspace({ name, businessType: type });
      setCreating(false);
      setName("");
      setOpen(false);
      if (pathname !== "/dashboard") router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create workspace.");
    } finally {
      setBusy(false);
    }
  };

  const initial = app.user?.email?.[0]?.toUpperCase();

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
          {/* Profile info */}
          <div className="border-b border-white/10 px-3 pb-3 pt-2">
            {app.user ? (
              <>
                <p className="truncate font-medium text-slate-100">{app.user.email}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <TierBadge tier={app.profile?.tier ?? "free"} />
                  {!!app.profile?.reportUnlocks && <span className="text-xs text-slate-400">{app.profile.reportUnlocks} report unlock(s)</span>}
                </div>
              </>
            ) : (
              <>
                <p className="font-medium text-slate-100">Guest</p>
                <p className="mt-0.5 text-xs text-slate-400">Sign in to save workspaces and unlock audits.</p>
              </>
            )}
          </div>

          {/* Workspace switcher */}
          <div className="border-b border-white/10 py-2">
            <p className="px-3 pb-1 text-[11px] uppercase tracking-wide text-slate-500">Workspaces</p>
            {app.user ? (
              <>
                {app.workspaces.length === 0 && <p className="px-3 py-1.5 text-xs text-slate-400">No workspaces yet.</p>}
                <ul className="max-h-56 overflow-y-auto">
                  {app.workspaces.map((w) => {
                    const Icon = w.mode === "PERSONAL" ? Home : Briefcase;
                    const active = app.activeWorkspace?.id === w.id;
                    return (
                      <li key={w.id}>
                        <button
                          role="menuitemradio"
                          aria-checked={active}
                          onClick={() => {
                            app.setActiveWorkspaceId(w.id);
                            setOpen(false);
                          }}
                          className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-white/5", active && "bg-white/[0.07]")}
                        >
                          <Icon className="h-4 w-4 shrink-0 text-slate-400" />
                          <span className="flex-1 truncate">{w.name}</span>
                          {active && <Check className="h-4 w-4 text-indigo-300" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {creating ? (
                  <form onSubmit={create} className="space-y-2 px-3 pt-2">
                    <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "123 Main St Duplex"' aria-label="Workspace name" className={inputCls} maxLength={80} required />
                    <select value={type} onChange={(e) => setType(e.target.value as BusinessType)} aria-label="Workspace type" className={inputCls}>
                      {BUSINESS_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {BUSINESS_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                    {error && <p className="text-xs text-rose-300">{error}</p>}
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setCreating(false)} className="rounded-lg px-3 py-1.5 text-slate-300 hover:bg-white/5">
                        Cancel
                      </button>
                      <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 font-medium text-white hover:bg-indigo-400 disabled:opacity-50">
                        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create
                      </button>
                    </div>
                  </form>
                ) : (
                  <button onClick={() => setCreating(true)} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-indigo-300 hover:bg-white/5">
                    <Plus className="h-4 w-4" /> New workspace
                  </button>
                )}
              </>
            ) : (
              <p className="px-3 py-1.5 text-xs text-slate-400">Using a temporary guest workspace.</p>
            )}
          </div>

          {/* Actions */}
          <div className="pt-1">
            <Link href="/settings" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/5">
              <CreditCard className="h-4 w-4 text-slate-400" /> Manage subscription
            </Link>
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
