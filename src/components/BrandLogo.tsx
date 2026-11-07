import Image from "next/image";
import { cn } from "@/components/ui";

/** Native aspect ratio of the trimmed wordmark files in /public/brand (517×112). */
const RATIO = 517 / 112;

/**
 * Sumhaven wordmark that follows the app theme. Both variants are rendered and CSS shows the right one
 * (`.brand-logo-*` rules in globals.css keyed off `data-theme` on <html>), so the server-rendered HTML
 * already matches the theme the boot script picks — no flash, no hydration mismatch.
 */
export function BrandLogo({ height = 28, className, preload = false }: { height?: number; className?: string; preload?: boolean }) {
  const width = Math.round(height * RATIO);
  return (
    <span className={cn("inline-flex shrink-0 items-center", className)} style={{ height }}>
      <Image src="/brand/sumhaven-logo-dark.png" alt="Sumhaven" width={width} height={height} preload={preload} className="brand-logo-dark h-full w-auto" />
      <Image src="/brand/sumhaven-logo-light.png" alt="Sumhaven" width={width} height={height} preload={preload} className="brand-logo-light h-full w-auto" />
    </span>
  );
}
