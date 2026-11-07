"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn, glass } from "@/components/ui";

/**
 * Native <dialog> modal (focus trap, Esc to close, top layer) in the app's glass style. Mount it to open it;
 * `onClose` fires on Esc, backdrop click or the close button.
 */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  size = "md",
  tone = "default",
  dismissible = true,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  size?: "md" | "lg";
  tone?: "default" | "danger";
  /** false while a request is in flight, so the dialog can't be closed mid-action. */
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => dismissible && e.target === ref.current && onClose()}
      aria-labelledby={titleId}
      className={cn(
        "m-auto max-h-[calc(100dvh-2rem)] bg-transparent p-0 text-slate-100 backdrop:bg-slate-950/75 backdrop:backdrop-blur-sm",
        size === "lg" ? "w-[min(44rem,calc(100vw-2rem))]" : "w-[min(30rem,calc(100vw-2rem))]",
      )}
    >
      <div className={cn(glass, "flex max-h-[calc(100dvh-2rem)] flex-col bg-slate-900/95", tone === "danger" && "border-rose-400/30")}>
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 pt-5 pb-4">
          <div className="min-w-0">
            <h2 id={titleId} className={cn("text-lg font-semibold", tone === "danger" && "text-rose-200")}>
              {title}
            </h2>
            {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={!dismissible} aria-label="Close" className="shrink-0 text-slate-400 hover:text-white disabled:opacity-40">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </dialog>
  );
}
