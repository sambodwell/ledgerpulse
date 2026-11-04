"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { cn, errorMessage, glass, inputCls } from "@/components/ui";
import { authHeaders } from "@/lib/supabase";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "How do I upload a bank statement?",
  "What does the free plan include?",
  "What kinds of scenarios can I forecast?",
  "How do workspaces work?",
];

const GREETING: ChatMessage = {
  role: "assistant",
  content: "Hi! I'm the LedgerPulse guide. Ask me how to use the dashboard, what the plans include, or how to phrase a \"what if\" scenario.",
};

/** Bottom-right floating help + scenario-phrasing assistant. Sees no financial data. */
export function ChatAssistant() {
  const { profile, uiHints } = useApp();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setDraft("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          messages: next.filter((m) => m !== GREETING),
          context: { page: window.location.pathname, mode: uiHints.mode, hasAnalysis: uiHints.hasAnalysis, tier: profile?.tier ?? "free" },
        }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      const data = (await res.json()) as { reply?: string };
      setMessages((m) => [...m, { role: "assistant", content: data.reply ?? "…" }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: e instanceof Error ? e.message : "Something went wrong." }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {open && (
        <section aria-label="LedgerPulse assistant" className={cn(glass, "flex h-[min(32rem,calc(100vh-7rem))] w-[min(22rem,calc(100vw-2rem))] flex-col bg-slate-900/95")}>
          <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-indigo-300" /> LedgerPulse Guide
            </h2>
            <button onClick={() => setOpen(false)} aria-label="Close assistant" className="text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
            {messages.map((m, i) => (
              <p
                key={i}
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2",
                  m.role === "user" ? "ml-auto rounded-br-sm bg-indigo-500/80 text-white" : "rounded-bl-sm bg-white/[0.06] text-slate-200",
                )}
              >
                {m.content}
              </p>
            ))}
            {busy && (
              <p className="inline-flex items-center gap-2 rounded-2xl bg-white/[0.06] px-3 py-2 text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
              </p>
            )}
            {messages.length === 1 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 hover:bg-white/5">
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
            className="flex gap-2 border-t border-white/10 p-3"
          >
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask a question…" aria-label="Message" maxLength={2000} className={inputCls} />
            <button type="submit" disabled={busy || !draft.trim()} aria-label="Send" className="grid h-9 w-10 shrink-0 place-items-center rounded-lg bg-indigo-500 text-white hover:bg-indigo-400 disabled:opacity-40">
              <Send className="h-4 w-4" />
            </button>
          </form>
          <p className="px-3 pb-2 text-[10px] text-slate-500">General guidance only — not accounting, tax, or legal advice.</p>
        </section>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close assistant" : "Open assistant"}
        aria-expanded={open}
        className="grid h-14 w-14 place-items-center rounded-full bg-indigo-500 text-white shadow-xl shadow-indigo-500/30 transition hover:scale-105 hover:bg-indigo-400"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>
    </div>
  );
}
