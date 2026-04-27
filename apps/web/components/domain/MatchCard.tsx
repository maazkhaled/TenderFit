import Link from "next/link";
import type { WinProbability } from "@beta/shared";
import { Card, CardBody } from "@/components/ui/Card";
import { CountryFlag } from "./CountryFlag";
import { FitScore } from "./FitScore";
import { WinProbBadge } from "./WinProbBadge";

export interface MatchCardData {
  id: string;
  fitScore: number;
  winProbability: WinProbability;
  tender: {
    title: string;
    buyer: string;
    country: string | null;
    deadlineAt: string | Date | null;
  };
}

function formatDeadline(deadline: string | Date | null) {
  if (!deadline) return "No deadline";
  const date = typeof deadline === "string" ? new Date(deadline) : deadline;
  const ms = date.getTime() - Date.now();
  const days = Math.round(ms / (1000 * 60 * 60 * 24));
  if (days < 0) return "Closed";
  if (days === 0) return "Closes today";
  if (days === 1) return "Closes tomorrow";
  if (days <= 14) return `Closes in ${days} days`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function MatchCard({ match }: { match: MatchCardData }) {
  return (
    <Link
      href={`/matches/${match.id}`}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded-xl"
    >
      <Card className="transition-all hover:border-indigo-200 hover:shadow-sm">
        <CardBody className="flex items-start gap-5">
          <FitScore score={match.fitScore} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <CountryFlag iso2={match.tender.country} />
              <span aria-hidden>·</span>
              <span className="truncate">{match.tender.buyer}</span>
            </div>
            <h3 className="mt-1 text-base font-semibold leading-snug text-ink line-clamp-2">
              {match.tender.title}
            </h3>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <WinProbBadge value={match.winProbability} />
              <span className="text-xs text-zinc-500">
                {formatDeadline(match.tender.deadlineAt)}
              </span>
            </div>
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}
