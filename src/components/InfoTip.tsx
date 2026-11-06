"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CircleHelp, Info } from "lucide-react";
import { cn } from "@/components/ui";

/**
 * Small "(i)" bubble with a concise explanatory tooltip. Opens on hover and keyboard focus, toggles on tap
 * (touch screens), and closes on Escape or an outside click. `align` sets which edge the popover hangs from;
 * `icon="help"` shows a "(?)" instead, for "what does this control do?" help beside a toggle.
 */
export function InfoTip({
  label,
  children,
  align = "right",
  icon = "info",
  className,
}: {
  label: string;
  children: ReactNode;
  align?: "left" | "right";
  icon?: "info" | "help";
  className?: string;
}) {
  const Glyph = icon === "help" ? CircleHelp : Info;
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setPinned(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span
      ref={rootRef}
      className={cn("relative inline-flex align-middle", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => !pinned && setOpen(false)}
    >
      <button
        type="button"
        aria-label={`About: ${label}`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => !pinned && setOpen(false)}
        onClick={() => {
          const next = !pinned;
          setPinned(next);
          setOpen(next);
        }}
        className="grid h-4 w-4 place-items-center rounded-full text-slate-500 transition hover:text-indigo-200 focus-visible:text-indigo-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300"
      >
        <Glyph className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            "absolute top-full z-40 mt-1.5 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-200 shadow-xl",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <span className="mb-0.5 block font-medium text-slate-100">{label}</span>
          {children}
        </span>
      )}
    </span>
  );
}
