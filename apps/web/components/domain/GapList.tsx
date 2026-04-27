import type { CapabilityGap, GapSeverity } from "@beta/shared";
import { cn } from "@/lib/ui/cn";

const dotColor: Record<GapSeverity, string> = {
  blocker: "bg-red-500",
  major: "bg-amber-500",
  minor: "bg-zinc-400",
};

const labelColor: Record<GapSeverity, string> = {
  blocker: "text-red-700",
  major: "text-amber-700",
  minor: "text-zinc-600",
};

export function GapList({ gaps }: { gaps: CapabilityGap[] }) {
  if (!gaps.length) {
    return (
      <p className="text-sm text-zinc-500">
        No capability gaps identified — you meet the stated requirements.
      </p>
    );
  }
  return (
    <ul className="space-y-2.5">
      {gaps.map((gap, i) => (
        <li key={i} className="flex items-start gap-3">
          <span
            className={cn(
              "mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full",
              dotColor[gap.severity],
            )}
            aria-hidden
          />
          <div className="flex-1">
            <p className="text-sm leading-snug text-ink-soft">
              {gap.requirement}
            </p>
            <p
              className={cn(
                "mt-0.5 text-xs font-medium uppercase tracking-wide",
                labelColor[gap.severity],
              )}
            >
              {gap.severity}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
