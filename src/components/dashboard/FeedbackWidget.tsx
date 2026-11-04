"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Star } from "lucide-react";
import { submitFeedback, type FeedbackContext } from "@/lib/supabase";
import { cn, inputCls } from "@/components/ui";

const RATING_WORDS = ["", "Poor", "Fair", "Good", "Great", "Excellent"];

/** Compact 5-star rating with an optional comment, saved to `user_feedback`. The comment box only opens after a star is picked. */
export function FeedbackWidget({ context, workspaceId, prompt, className }: { context: FeedbackContext; workspaceId: string | null; prompt: string; className?: string }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  if (state === "sent") {
    return (
      <p className={cn("flex items-center gap-1.5 text-xs text-slate-400", className)} role="status">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> Thanks for the feedback.
      </p>
    );
  }

  const send = async () => {
    setState("sending");
    setError(null);
    try {
      await submitFeedback({ rating, comment, context, workspaceId });
      setState("sent");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send feedback.");
      setState("idle");
    }
  };

  const shown = hover || rating;
  return (
    <div className={cn("text-xs text-slate-400", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{prompt}</span>
        <div role="radiogroup" aria-label="Rating" className="inline-flex" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} star${n === 1 ? "" : "s"} — ${RATING_WORDS[n]}`}
              onMouseEnter={() => setHover(n)}
              onFocus={() => setHover(n)}
              onBlur={() => setHover(0)}
              onClick={() => setRating(n)}
              className="rounded p-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300"
            >
              <Star className={cn("h-4 w-4 transition", n <= shown ? "fill-amber-300 text-amber-300" : "text-slate-600")} />
            </button>
          ))}
        </div>
        {shown > 0 && <span className="text-slate-500">{RATING_WORDS[shown]}</span>}
      </div>
      {rating > 0 && (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="Anything we should improve? (optional)"
            aria-label="Feedback comment"
            className={cn(inputCls, "min-h-[2.5rem] flex-1 resize-y text-xs")}
          />
          <button
            type="button"
            onClick={send}
            disabled={state === "sending"}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50"
          >
            {state === "sending" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Send
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-rose-300">{error}</p>}
    </div>
  );
}
