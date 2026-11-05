"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Star } from "lucide-react";
import { submitFeedback, type FeedbackContext } from "@/lib/supabase";
import { cn, inputCls } from "@/components/ui";

const RATING_WORDS = ["", "Poor", "Fair", "Good", "Great", "Excellent"];

/**
 * 5-star rating with an optional comment, saved to `user_feedback`. The comment box only opens after a star is picked.
 * `size="lg"` is the prominent version used at the bottom of the report.
 */
export function FeedbackWidget({
  context,
  workspaceId,
  prompt,
  className,
  size = "sm",
}: {
  context: FeedbackContext;
  workspaceId: string | null;
  prompt: string;
  className?: string;
  size?: "sm" | "lg";
}) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const lg = size === "lg";

  if (state === "sent") {
    return (
      <p className={cn("flex items-center gap-1.5 text-slate-300", lg ? "justify-center text-base" : "text-xs text-slate-400", className)} role="status">
        <CheckCircle2 className={cn("text-emerald-300", lg ? "h-5 w-5" : "h-3.5 w-3.5")} /> Thanks for the feedback.
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
    <div className={cn(lg ? "text-sm text-slate-300" : "text-xs text-slate-400", className)}>
      <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", lg && "justify-center gap-x-5")}>
        <span className={cn(lg && "text-lg font-semibold text-slate-100")}>{prompt}</span>
        <div role="radiogroup" aria-label="Rating" className={cn("inline-flex", lg && "gap-1")} onMouseLeave={() => setHover(0)}>
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
              // No scale/translate on hover: transforms on the hit target made stars jump as the pointer moved across them.
              className={cn("rounded leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300", lg ? "p-1" : "p-0.5")}
            >
              <Star className={cn("block transition-colors duration-150", lg ? "h-9 w-9" : "h-4 w-4", n <= shown ? "fill-amber-300 text-amber-300" : lg ? "text-slate-500" : "text-slate-600")} />
            </button>
          ))}
        </div>
        {/* Always rendered at a fixed width so the hover word appearing never re-wraps the row (which made the stars jump). */}
        <span aria-hidden className={cn("inline-block whitespace-nowrap text-slate-500", lg ? "w-[6rem] text-base text-slate-300" : "w-[4.5rem]")}>
          {shown > 0 ? RATING_WORDS[shown] : lg ? "Tap a star" : " "}
        </span>
      </div>
      {rating > 0 && (
        <div className={cn("mt-2 flex flex-col gap-2 sm:flex-row sm:items-start", lg && "mx-auto mt-4 max-w-2xl")}>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            rows={lg ? 3 : 2}
            placeholder="Anything we should improve? (optional)"
            aria-label="Feedback comment"
            className={cn(inputCls, "min-h-[2.5rem] flex-1 resize-y", lg ? "text-sm" : "text-xs")}
          />
          <button
            type="button"
            onClick={send}
            disabled={state === "sending"}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-lg border disabled:opacity-50",
              lg ? "border-indigo-400/50 bg-indigo-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-400" : "border-white/15 px-3 py-2 text-xs text-slate-200 hover:bg-white/10",
            )}
          >
            {state === "sending" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Send
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-rose-300">{error}</p>}
    </div>
  );
}
