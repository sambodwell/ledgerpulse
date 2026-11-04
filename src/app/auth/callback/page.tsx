"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { AlertTriangle, Loader2 } from "lucide-react";
import { getSupabase, safeNextPath } from "@/lib/supabase";
import { cn, glass, primaryBtn } from "@/components/ui";

/**
 * Landing page for Supabase email links (signup confirmation, magic links, recovery).
 *
 * Sessions are kept in browser storage by supabase-js, so this has to run on the
 * client: a server route can't hand the session to the browser. All redirects are
 * relative to the current origin, so links work on any deployment, never localhost.
 *
 * Handles:
 *   - #access_token=…            (implicit flow; consumed by detectSessionInUrl)
 *   - ?code=…                    (PKCE flow)
 *   - ?token_hash=…&type=signup  (custom email templates using {{ .TokenHash }})
 *   - ?error_description=… / #error_description=…
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
      const next = safeNextPath(url.searchParams.get("next"));

      const linkError = url.searchParams.get("error_description") ?? hash.get("error_description");
      if (linkError) throw new Error(linkError.replace(/\+/g, " "));

      const sb = getSupabase();
      if (!sb) throw new Error("Accounts aren't configured on this deployment.");

      // getSession() waits for the client to finish reading any tokens/code in the URL.
      let { data } = await sb.auth.getSession();

      if (!data.session) {
        const tokenHash = url.searchParams.get("token_hash");
        const type = url.searchParams.get("type") as EmailOtpType | null;
        const code = url.searchParams.get("code");
        if (tokenHash && type) {
          const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type });
          if (error) throw error;
        } else if (code) {
          const { error } = await sb.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }
        ({ data } = await sb.auth.getSession());
      }

      if (cancelled) return;
      if (!data.session) {
        // Confirmed but not signed in (e.g. link opened in another browser): ask them to sign in.
        router.replace(`/signup?mode=signin&confirmed=1&next=${encodeURIComponent(next)}`);
        return;
      }
      router.replace(next);
    };

    run().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : "This link is invalid or has expired.");
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="grid min-h-[70vh] place-items-center px-4">
      <div className={cn(glass, "w-full max-w-md p-6 text-center")}>
        {error ? (
          <>
            <AlertTriangle className="mx-auto h-6 w-6 text-amber-300" />
            <h1 className="mt-3 text-lg font-semibold">We couldn&apos;t confirm your email</h1>
            <p className="mt-2 text-sm text-slate-400">{error}</p>
            <button onClick={() => router.replace("/signup?mode=signin")} className={cn(primaryBtn, "mt-5")}>
              Go to sign in
            </button>
          </>
        ) : (
          <p className="inline-flex items-center gap-2 text-sm text-slate-300" role="status">
            <Loader2 className="h-4 w-4 animate-spin text-indigo-300" /> Confirming your account…
          </p>
        )}
      </div>
    </main>
  );
}
