import { cn } from "@/lib/ui/cn";

function tone(score: number) {
  if (score >= 80) return "text-emerald-600 ring-emerald-200 bg-emerald-50";
  if (score >= 60) return "text-amber-700 ring-amber-200 bg-amber-50";
  return "text-zinc-500 ring-zinc-200 bg-zinc-50";
}

export function FitScore({
  score,
  size = "md",
  className,
}: {
  score: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    sm: "h-12 w-12 text-lg",
    md: "h-16 w-16 text-2xl",
    lg: "h-24 w-24 text-4xl",
  } as const;
  return (
    <div
      className={cn(
        "inline-flex flex-col items-center justify-center rounded-full ring-1 font-semibold tabular-nums",
        sizes[size],
        tone(score),
        className,
      )}
      aria-label={`Fit score ${score}`}
    >
      <span className="leading-none">{Math.round(score)}</span>
      <span className="mt-0.5 text-[9px] font-medium uppercase tracking-wider opacity-70">
        fit
      </span>
    </div>
  );
}
