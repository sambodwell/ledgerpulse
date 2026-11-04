"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { AuthForm, type AuthMode } from "@/components/AuthForm";
import { cn, glass } from "@/components/ui";

export function AuthDialog({ initialMode, onClose }: { initialMode: AuthMode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState(initialMode);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

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
        <AuthForm initialMode={initialMode} onSignedIn={onClose} onModeChange={setMode} />
      </div>
    </dialog>
  );
}
