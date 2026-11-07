"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { GripHorizontal, Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { cn, errorMessage, glass, inputCls } from "@/components/ui";
import { authHeaders } from "@/lib/supabase";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "What's the difference between trailing average and baseline?",
  "How do I set a year-end goal?",
  "What kinds of scenarios can I forecast?",
  "How do workspaces work?",
];

const GREETING: ChatMessage = {
  role: "assistant",
  content: "Hi! I'm the Sumhaven guide. Ask about anything on this page — the projection, the Fiscal Year Tracker, goals, plans, or how to phrase a \"what if\" scenario. Drag me anywhere if I'm in the way.",
};

/** Offset of the launcher from the bottom-right corner of the viewport, in px. */
interface Offset {
  right: number;
  bottom: number;
}

const POS_KEY = "lp:chatPos";
const BUBBLE = 56; // launcher size (h-14)
const MARGIN = 8;
const DRAG_THRESHOLD = 5;

function clampOffset(o: Offset): Offset {
  if (typeof window === "undefined") return o;
  const maxRight = Math.max(MARGIN, window.innerWidth - BUBBLE - MARGIN);
  const maxBottom = Math.max(MARGIN, window.innerHeight - BUBBLE - MARGIN);
  return { right: Math.min(maxRight, Math.max(MARGIN, o.right)), bottom: Math.min(maxBottom, Math.max(MARGIN, o.bottom)) };
}

function readOffset(): Offset | null {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(POS_KEY) ?? "null");
    if (v && typeof v === "object" && Number.isFinite((v as Offset).right) && Number.isFinite((v as Offset).bottom)) return clampOffset(v as Offset);
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Floating help + scenario-phrasing assistant. Draggable (launcher or panel header) so it never blocks data; the
 * position is remembered on this device. Sees no financial data — only which page and features are on screen.
 */
export function ChatAssistant() {
  const { profile, uiHints } = useApp();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState<Offset>({ right: 24, bottom: 24 });
  const [dragging, setDragging] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; start: Offset; moved: boolean; pointerId: number } | null>(null);
  const suppressClick = useRef(false);

  // Restore the saved position after mount (localStorage is client-only) and keep it on-screen on resize.
  useEffect(() => {
    const saved = readOffset();
    if (saved) setOffset(saved);
    const onResize = () => setOffset((o) => clampOffset(o));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      drag.current = { x: e.clientX, y: e.clientY, start: offset, moved: false, pointerId: e.pointerId };
    },
    [offset],
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setOffset(clampOffset({ right: d.start.right - dx, bottom: d.start.bottom - dy }));
  }, []);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.moved) return;
    // The click that ends a drag must not toggle the panel. Cleared on the next tick so a drag that ends without a
    // click (released over the panel header, or cancelled) can never swallow a later click and leave the chat stuck.
    suppressClick.current = true;
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setOffset((o) => {
      try {
        window.localStorage.setItem(POS_KEY, JSON.stringify(o));
      } catch {
        /* ignore */
      }
      return o;
    });
  }, []);

  const dragHandlers = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onLostPointerCapture: onPointerUp };

  // Escape always closes the panel, wherever it ended up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Other parts of the app (e.g. an audit deep-dive) can open the guide with a question: lp:ask-assistant { question }.
  const sendRef = useRef<(text: string) => void>(() => {});
  useEffect(() => {
    const onAsk = (e: Event) => {
      const q = (e as CustomEvent<{ question?: unknown }>).detail?.question;
      setOpen(true);
      if (typeof q === "string" && q.trim()) sendRef.current(q);
    };
    window.addEventListener("lp:ask-assistant", onAsk);
    return () => window.removeEventListener("lp:ask-assistant", onAsk);
  }, []);

  // Viewport size, so the open panel is always laid out fully on screen.
  const [vp, setVp] = useState({ w: 1280, h: 800 });
  useEffect(() => {
    const read = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  /** Arrow keys nudge the widget for keyboard users (with the launcher focused). */
  const onKeyNudge = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16;
    const delta: Record<string, Offset> = { ArrowLeft: { right: step, bottom: 0 }, ArrowRight: { right: -step, bottom: 0 }, ArrowUp: { right: 0, bottom: step }, ArrowDown: { right: 0, bottom: -step } };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    setOffset((o) => clampOffset({ right: o.right + d.right, bottom: o.bottom + d.bottom }));
  };

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
          context: { page: window.location.pathname, tier: profile?.tier ?? "free", ...uiHints },
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

  useEffect(() => {
    sendRef.current = (text: string) => void send(text);
  });

  // The launcher stays exactly where it was dropped. The panel is placed beside it (toward the roomier side) and
  // clamped to the viewport, so it — and its close button — can never end up off-screen.
  const bubbleLeft = vp.w - offset.right - BUBBLE;
  const bubbleTop = vp.h - offset.bottom - BUBBLE;
  const panelW = Math.min(352, vp.w - 2 * MARGIN);
  const panelH = Math.min(512, vp.h - BUBBLE - 3 * MARGIN - 12);
  const clampX = (x: number) => Math.min(Math.max(MARGIN, x), Math.max(MARGIN, vp.w - panelW - MARGIN));
  const clampY = (y: number) => Math.min(Math.max(MARGIN, y), Math.max(MARGIN, vp.h - panelH - MARGIN));
  const onLeftHalf = bubbleLeft + BUBBLE / 2 < vp.w / 2;
  const above = bubbleTop - 12 - panelH >= MARGIN || bubbleTop > vp.h / 2;
  const panelLeft = clampX(onLeftHalf ? bubbleLeft : bubbleLeft + BUBBLE - panelW);
  const panelTop = clampY(above ? bubbleTop - 12 - panelH : bubbleTop + BUBBLE + 12);

  return (
    <div className={cn(dragging && "select-none")}>
      {open && (
        <section
          aria-label="Sumhaven assistant"
          className={cn(glass, "fixed z-50 flex flex-col bg-slate-900/95")}
          style={{ left: panelLeft, top: panelTop, width: panelW, height: panelH }}
        >
          <header className={cn("flex touch-none items-center justify-between border-b border-white/10 px-4 py-3", dragging ? "cursor-grabbing" : "cursor-grab")} {...dragHandlers} title="Drag to move">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-indigo-300" /> Sumhaven Guide
              <GripHorizontal className="h-4 w-4 text-slate-500" aria-hidden />
            </h2>
            <button onPointerDown={(e) => e.stopPropagation()} onClick={() => setOpen(false)} aria-label="Close assistant" className="text-slate-400 hover:text-white">
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
        {...dragHandlers}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          setOpen((o) => !o);
        }}
        onKeyDown={onKeyNudge}
        aria-label={open ? "Close assistant (drag or use arrow keys to move)" : "Open assistant (drag or use arrow keys to move)"}
        aria-expanded={open}
        title="Click to chat · drag to move"
        onDoubleClick={() => {
          // Escape hatch: double-click snaps the launcher back to the default corner.
          const home = { right: 24, bottom: 24 };
          setOffset(home);
          try {
            window.localStorage.setItem(POS_KEY, JSON.stringify(home));
          } catch {
            /* ignore */
          }
        }}
        style={{ right: offset.right, bottom: offset.bottom }}
        className={cn(
          "fixed z-[51] grid h-14 w-14 touch-none place-items-center rounded-full bg-indigo-500 text-white shadow-xl shadow-indigo-500/30 transition-colors hover:bg-indigo-400",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>
    </div>
  );
}
