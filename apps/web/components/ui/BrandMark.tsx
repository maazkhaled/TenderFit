import { cn } from "@/lib/ui/cn";

/**
 * Brand mark used everywhere TenderFit appears with a logo lockup.
 *
 * Renders /detex-logo.svg from the public folder. Replace that file with
 * your real Detex logo (SVG preferred, but PNG/JPG also work — just update
 * the `src` here if you switch format).
 *
 * Size is controlled via Tailwind classes; default mirrors what the
 * previous Sparkles icon used (h-4 w-4). Pass `className` to override.
 */
export function BrandMark({
  className,
  alt = "Detex",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src="/detex-logo.png"
      alt={alt}
      className={cn("h-4 w-4 shrink-0", className)}
      width={16}
      height={16}
    />
  );
}
