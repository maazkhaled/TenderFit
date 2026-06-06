import Link from "next/link";
import type { HumanResourcesEstimate, WinProbability } from "@beta/shared";
import { Card, CardBody } from "@/components/ui/Card";
import { CountryFlag } from "./CountryFlag";
import { FitScore } from "./FitScore";
import { WinProbBadge } from "./WinProbBadge";

export interface MatchCardData {
  id: string;
  fitScore: number;
  winProbability: WinProbability;
  humanResourcesEstimate?: HumanResourcesEstimate | null;
  tender: {
    title: string;
    buyer: string;
    country: string | null;
    deadlineAt: string | Date | null;
    /** When TenderFit fetched this row from the upstream source. */
    ingestedAt?: string | Date | null;
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

/**
 * "Fetched 3 hours ago" copy for the ingestedAt timestamp on each card.
 * Falls back to a literal date once the gap is older than a week so users
 * aren't squinting at "67 hours ago".
 */
function formatIngestedAt(ingestedAt: string | Date | null | undefined) {
  if (!ingestedAt) return null;
  const date =
    typeof ingestedAt === "string" ? new Date(ingestedAt) : ingestedAt;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return "Fetched just now";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "Fetched just now";
  if (minutes < 60) return `Fetched ${minutes} min ago`;
  const hours = Math.round(diffMs / 3_600_000);
  if (hours < 24) return `Fetched ${hours} hr ago`;
  const days = Math.round(diffMs / 86_400_000);
  if (days <= 7) return `Fetched ${days} d ago`;
  return `Fetched ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

export function MatchCard({ match }: { match: MatchCardData }) {
  const minimumPeople = match.humanResourcesEstimate?.minimumPeople;
  const ingestedLabel = formatIngestedAt(match.tender.ingestedAt ?? null);
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
              {typeof minimumPeople === "number" ? (
                <span className="text-xs text-zinc-500">
                  Min HR: {minimumPeople}
                </span>
              ) : null}
              <span className="text-xs text-zinc-500">
                {formatDeadline(match.tender.deadlineAt)}
              </span>
              {ingestedLabel ? (
                <span className="text-xs text-zinc-400">{ingestedLabel}</span>
              ) : null}
            </div>
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}
