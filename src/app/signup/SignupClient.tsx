"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { AuthForm, type AuthMode } from "@/components/AuthForm";
import { safeNextPath } from "@/lib/supabase";
import { cn, glass } from "@/components/ui";
import { BrandLogo } from "@/components/BrandLogo";

/**
 * Sign-up / sign-in gate. Guided input and statement uploads require an account
 * so every analysis request is tied to a row-level-security identity.
 * Query: ?next=/path (same-site only), ?mode=signin, ?confirmed=1
 */
type Query = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export function SignupClient({ searchParams }: { searchParams: Promise<Query> }) {
  const app = useApp();
  const router = useRouter();
  const q = use(searchParams);
  const params = {
    next: safeNextPath(first(q.next)),
    mode: (first(q.mode) === "signin" ? "signin" : "signup") as AuthMode,
    confirmed: first(q.confirmed) === "1",
  };
  const [mode, setMode] = useState<AuthMode>(params.mode);

  // Already signed in (or just signed in): continue to the destination.
  useEffect(() => {
    if (app.ready && app.user) router.replace(params.next);
  }, [params.next, app.ready, app.user, router]);

  return (
    <main className="relative grid min-h-[80vh] place-items-center px-4 py-10">
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div className="absolute -top-40 left-1/4 h-[28rem] w-[28rem] rounded-full bg-indigo-600/20 blur-[120px]" />
      </div>
      <div className={cn(glass, "relative w-full max-w-md p-6")}>
        <BrandLogo height={28} preload />
        <h1 className="mt-1 text-2xl font-semibold">{mode === "signin" ? "Sign in to continue" : "Create your account"}</h1>
        <p className="mt-2 flex items-start gap-2 text-sm text-slate-400">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
          An account is required before entering or uploading financial data, so your workspaces are private to you from the first step.
        </p>
        {!app.ready || app.user ? (
          <p className="mt-6 inline-flex items-center gap-2 text-sm text-slate-400" role="status">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : (
          <AuthForm
            key={params.mode}
            initialMode={params.mode}
            next={params.next}
            onModeChange={setMode}
            notice={params.confirmed ? "Your email is confirmed. Sign in to continue." : null}
            onSignedIn={() => router.replace(params.next)}
          />
        )}
      </div>
    </main>
  );
}
