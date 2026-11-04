"use client";

import { useId, useState } from "react";
import { Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { isSupabaseConfigured, signInWithPassword, signUpWithPassword } from "@/lib/supabase";
import { cn, inputCls, primaryBtn } from "@/components/ui";

export type AuthMode = "signin" | "signup";

const MIN_PASSWORD = 8;

/**
 * Email + password form used by the auth dialog and the /signup page.
 * `onSignedIn` fires once a session exists (sign-in, or sign-up without email confirmation).
 */
export function AuthForm({
  initialMode,
  next = "/dashboard",
  onSignedIn,
  onModeChange,
  notice: initialNotice,
}: {
  initialMode: AuthMode;
  next?: string;
  onSignedIn: () => void;
  onModeChange?: (m: AuthMode) => void;
  notice?: string | null;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initialNotice ?? null);

  const signup = mode === "signup";
  const mismatch = signup && confirm.length > 0 && confirm !== password;

  const switchMode = () => {
    const m: AuthMode = signup ? "signin" : "signup";
    setMode(m);
    onModeChange?.(m);
    setError(null);
    setNotice(null);
    setConfirm("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (signup) {
      if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for your password.`);
      if (password !== confirm) return setError("Passwords don't match.");
    }
    setBusy(true);
    try {
      if (!signup) {
        await signInWithPassword(email, password);
        onSignedIn();
      } else {
        const { needsConfirmation } = await signUpWithPassword(email, password, next);
        if (needsConfirmation) {
          setNotice("Check your inbox and click the confirmation link to finish creating your account.");
          setPassword("");
          setConfirm("");
        } else onSignedIn();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  if (!isSupabaseConfigured) {
    return <p className="mt-4 text-sm text-amber-200">Accounts aren&apos;t configured on this deployment.</p>;
  }

  return (
    <>
      <form onSubmit={submit} className="mt-5 space-y-3">
        <label className="block text-sm">
          <span className="text-slate-400">Email</span>
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={cn(inputCls, "mt-1")} />
        </label>
        <PasswordField label="Password" value={password} onChange={setPassword} autoComplete={signup ? "new-password" : "current-password"} minLength={signup ? MIN_PASSWORD : undefined} />
        {signup && (
          <PasswordField
            label="Confirm password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            invalid={mismatch}
            describedBy={mismatch ? "pw-mismatch" : undefined}
          />
        )}
        {mismatch && (
          <p id="pw-mismatch" className="text-xs text-rose-300">
            Passwords don&apos;t match.
          </p>
        )}
        {error && (
          <p className="text-sm text-rose-300" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="text-sm text-emerald-300" role="status">
            {notice}
          </p>
        )}
        <button type="submit" disabled={busy || mismatch} className={cn(primaryBtn, "w-full")}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {signup ? "Create account" : "Sign in"}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-slate-400">
        {signup ? "Already have an account? " : "New here? "}
        <button type="button" onClick={switchMode} className="text-indigo-300 hover:text-indigo-200">
          {signup ? "Sign in" : "Create an account"}
        </button>
      </p>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-500">
        <Lock className="h-3 w-3" /> Your statements are never stored, even when signed in.
      </p>
    </>
  );
}

function PasswordField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  minLength?: number;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return (
    <div className="text-sm">
      <label htmlFor={id} className="text-slate-400">
        {props.label}
      </label>
      <div className="relative mt-1">
        <input
          id={id}
          type={visible ? "text" : "password"}
          required
          minLength={props.minLength}
          autoComplete={props.autoComplete}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          aria-invalid={props.invalid || undefined}
          aria-describedby={props.describedBy}
          className={cn(inputCls, "pr-10", props.invalid && "border-rose-400/60 focus:border-rose-400")}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? `Hide ${props.label.toLowerCase()}` : `Show ${props.label.toLowerCase()}`}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-lg text-slate-400 hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
