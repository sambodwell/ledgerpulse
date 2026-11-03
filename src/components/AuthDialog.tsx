"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Lock, X } from "lucide-react";
import { isSupabaseConfigured, signInWithPassword, signUpWithPassword } from "@/lib/supabase";
import { cn, glass, inputCls, primaryBtn } from "@/components/ui";

export function AuthDialog({ initialMode, onClose }: { initialMode: "signin" | "signup"; onClose: () => void }) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signin") {
        await signInWithPassword(email, password);
        onClose();
      } else {
        const { needsConfirmation } = await signUpWithPassword(email, password);
        if (needsConfirmation) setNotice("Check your inbox to confirm your email, then sign in.");
        else onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] bg-transparent p-0 text-slate-100 backdrop:bg-slate-950/70 backdrop:backdrop-blur-sm"
      aria-labelledby="auth-title"
    >
      <div className={cn(glass, "bg-slate-900/90 p-6")}>
        <div className="flex items-start justify-between">
          <h2 id="auth-title" className="text-lg font-semibold">
            {mode === "signin" ? "Sign in to LedgerPulse" : "Create your account"}
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-400">Save workspaces and scenarios, and unlock full audits.</p>

        {!isSupabaseConfigured ? (
          <p className="mt-4 text-sm text-amber-200">Accounts aren&apos;t configured on this deployment.</p>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-3">
            <label className="block text-sm">
              <span className="text-slate-400">Email</span>
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={cn(inputCls, "mt-1")} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-400">Password</span>
              <input
                type="password"
                required
                minLength={8}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={cn(inputCls, "mt-1")}
              />
            </label>
            {error && <p className="text-sm text-rose-300" role="alert">{error}</p>}
            {notice && <p className="text-sm text-emerald-300" role="status">{notice}</p>}
            <button type="submit" disabled={busy} className={cn(primaryBtn, "w-full")}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-sm text-slate-400">
          {mode === "signin" ? "New here? " : "Already have an account? "}
          <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="text-indigo-300 hover:text-indigo-200">
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <Lock className="h-3 w-3" /> Your statements are never stored, even when signed in.
        </p>
      </div>
    </dialog>
  );
}
