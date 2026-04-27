import type { WinProbability } from "@beta/shared";
import { Badge } from "@/components/ui/Badge";

const map: Record<WinProbability, { tone: "green" | "amber" | "zinc"; label: string }> = {
  high: { tone: "green", label: "High win probability" },
  medium: { tone: "amber", label: "Medium win probability" },
  low: { tone: "zinc", label: "Low win probability" },
};

export function WinProbBadge({ value }: { value: WinProbability }) {
  const cfg = map[value];
  return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
}
