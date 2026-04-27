import { notFound } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Calendar, Wallet, Tag } from "lucide-react";
import type { MatchResult, WinProbability } from "@beta/shared";
import { apiGetSafe } from "@/lib/ui/fetch-server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { FitScore } from "@/components/domain/FitScore";
import { WinProbBadge } from "@/components/domain/WinProbBadge";
import { CountryFlag } from "@/components/domain/CountryFlag";
import { GapList } from "@/components/domain/GapList";
import { MatchActions } from "./MatchActions";

export const dynamic = "force-dynamic";

interface MatchDetail extends MatchResult {
  id: string;
  tender: {
    title: string;
    description: string;
    buyer: string;
    country: string | null;
    sector: string | null;
    url: string;
    deadlineAt: string | null;
    publishedAt: string | null;
    budgetMinUsd: number | null;
    budgetMaxUsd: number | null;
    currency: string | null;
  };
}

interface MatchResponse {
  match: MatchDetail;
}

function formatBudget(min: number | null, max: number | null) {
  if (!min && !max) return "Not disclosed";
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);
  if (min && max) return `${fmt(min)} – ${fmt(max)}`;
  return fmt((min ?? max) as number);
}

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function MatchDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const data = await apiGetSafe<MatchResponse>(
    `/api/v1/matches/${params.id}`,
  );
  if (!data?.match) notFound();
  const { match } = data;

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <CountryFlag iso2={match.tender.country} />
          <span>·</span>
          <span>{match.tender.buyer}</span>
        </div>
        <h1 className="text-balance text-3xl font-semibold tracking-tight">
          {match.tender.title}
        </h1>
        <div className="flex flex-wrap items-center gap-4">
          <FitScore score={match.fitScore} size="lg" />
          <div className="flex flex-col gap-1.5">
            <WinProbBadge value={match.winProbability as WinProbability} />
            <Link
              href={match.tender.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              View original source <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Tender description</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                {match.tender.description}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Metadata</CardTitle>
            </CardHeader>
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <MetaRow
                icon={<Calendar className="h-4 w-4 text-zinc-400" />}
                label="Deadline"
                value={formatDate(match.tender.deadlineAt)}
              />
              <MetaRow
                icon={<Calendar className="h-4 w-4 text-zinc-400" />}
                label="Published"
                value={formatDate(match.tender.publishedAt)}
              />
              <MetaRow
                icon={<Wallet className="h-4 w-4 text-zinc-400" />}
                label="Budget"
                value={formatBudget(
                  match.tender.budgetMinUsd,
                  match.tender.budgetMaxUsd,
                )}
              />
              <MetaRow
                icon={<Tag className="h-4 w-4 text-zinc-400" />}
                label="Sector"
                value={match.tender.sector ?? "—"}
              />
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Why this fits</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="space-y-2.5">
                {match.rationale.map((line, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm leading-snug text-ink-soft">
                    <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                    {line}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Capability gaps</CardTitle>
            </CardHeader>
            <CardBody>
              <GapList gaps={match.gaps} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Win-probability reasoning</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="text-sm leading-relaxed text-ink-soft">
                {match.winProbabilityReason}
              </p>
            </CardBody>
          </Card>
        </aside>
      </div>

      <MatchActions
        matchId={match.id}
        initialStatement={match.capabilityStatement ?? null}
      />
    </div>
  );
}

function MetaRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5">{icon}</div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          {label}
        </p>
        <p className="mt-0.5 text-sm text-ink-soft">{value}</p>
      </div>
    </div>
  );
}
