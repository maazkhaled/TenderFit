import Link from "next/link";
import { Archive as ArchiveIcon, LayoutDashboard } from "lucide-react";
import { TENDER_SOURCE_CATALOG, TenderSourceSchema, type TenderSourceId } from "@beta/shared";
import { apiGetSafe } from "@/lib/ui/fetch-server";
import { Card, CardBody } from "@/components/ui/Card";
import { MatchCard, type MatchCardData } from "@/components/domain/MatchCard";
import { SourceFilter } from "@/components/domain/SourceFilter";

export const dynamic = "force-dynamic";

interface MatchesResponse {
  matches: MatchCardData[];
}

const DEFAULT_MIN = Number.parseInt(
  process.env.DASHBOARD_MIN_FIT_SCORE ?? "30",
  10,
);

function parseSourceSelection(value: string | string[] | undefined): TenderSourceId[] {
  const raw = Array.isArray(value) ? value.join(",") : value ?? "";
  const seen = new Set<TenderSourceId>();
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => TenderSourceSchema.safeParse(s))
    .filter((r): r is { success: true; data: TenderSourceId } => r.success)
    .map((r) => r.data)
    .filter((source) => {
      if (seen.has(source)) return false;
      seen.add(source);
      return true;
    });
}

/**
 * Archive page — matches whose tender deadline has passed.
 *
 * Same shape as /dashboard but server-side filtered to `status=archived`.
 * Ordering is by deadline desc (most-recently-closed first) so operators can
 * scan "what just closed" without paging through ancient history. Re-uses the
 * MatchCard component, which already renders a "Closed" badge for past
 * deadlines — no styling change needed.
 */
export default async function ArchivePage({
  searchParams,
}: {
  searchParams?: { sources?: string | string[]; sourceFilter?: string };
}) {
  const minScore = Number.isFinite(DEFAULT_MIN) ? DEFAULT_MIN : 30;
  const sourceFilterApplied =
    searchParams?.sourceFilter === "1" || searchParams?.sources !== undefined;
  const selectedSources = sourceFilterApplied
    ? parseSourceSelection(searchParams?.sources)
    : TENDER_SOURCE_CATALOG.map((source) => source.id);

  const apiParams = new URLSearchParams({
    minScore: String(minScore),
    status: "archived",
  });
  if (sourceFilterApplied) {
    apiParams.set("sourceFilter", "1");
    for (const source of selectedSources) apiParams.append("sources", source);
  }
  const data = await apiGetSafe<MatchesResponse>(
    `/api/v1/matches?${apiParams.toString()}`,
  );
  const matches = data?.matches ?? [];

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-zinc-500">
          <ArchiveIcon className="h-4 w-4" />
          Archive
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Closed tenders</h1>
        <p className="text-sm text-zinc-600">
          Matches whose tender deadline has passed. Kept for reference, eval
          backtesting, and capability-statement reuse — not surfaced on the
          live dashboard.
        </p>
      </header>

      <SourceFilter
        filterApplied={sourceFilterApplied}
        selectedSources={selectedSources}
        sources={TENDER_SOURCE_CATALOG}
      />

      {matches.length === 0 ? (
        <EmptyState />
      ) : (
        <section className="space-y-3">
          <div className="flex items-end justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
              {matches.length} archived
            </h2>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-indigo-600"
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              Back to dashboard
            </Link>
          </div>
          <div className="space-y-3">
            {matches.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardBody className="space-y-3 py-10 text-center">
        <h2 className="text-lg font-semibold">Nothing archived yet.</h2>
        <p className="mx-auto max-w-md text-sm text-zinc-600">
          Once a tender you've been matched with passes its deadline, it'll
          move from the dashboard to here automatically — no action needed.
        </p>
      </CardBody>
    </Card>
  );
}
