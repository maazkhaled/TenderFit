import type { HTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";

type Tone = "neutral" | "indigo" | "green" | "amber" | "red" | "zinc";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

const tones: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-700 border-zinc-200",
  indigo: "bg-indigo-50 text-indigo-700 border-indigo-100",
  green: "bg-emerald-50 text-emerald-700 border-emerald-100",
  amber: "bg-amber-50 text-amber-800 border-amber-100",
  red: "bg-red-50 text-red-700 border-red-100",
  zinc: "bg-zinc-50 text-zinc-600 border-zinc-100",
};

export function Badge({ className, tone = "neutral", ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...rest}
    />
  );
}
