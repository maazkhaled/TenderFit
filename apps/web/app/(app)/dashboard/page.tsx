import { Inbox, TrendingUp, Trophy } from "lucide-react";
import { TENDER_SOURCE_CATALOG, TenderSourceSchema, type TenderSourceId } from "@beta/shared";
import { apiGetSafe } from "@/lib/ui/fetch-server";
import { Card, CardBody } from "@/components/ui/Card";
import { MatchCard, type MatchCardData } from "@/components/domain/MatchCard";
import { SourceFilter } from "@/components/domain/SourceFilter";

export const dynamic = "force-dynamic";

interface MatchesResponse {
  matches: MatchCardData[];
}

function avg(nums: number[]) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function isToday(d: string | Date | null | undefined) {
  if (!d) return false;
  const date = typeof d === "string" ? new Date(d) : d;
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

// Local LLMs (qwen2.5:7b etc.) score conservatively — a "60" cutoff that
// makes sense for Claude Opus produces an empty dashboard on local. Lower
// the default and let operators override via DASHBOARD_MIN_FIT_SCORE.
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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: { sources?: string | string[]; sourceFilter?: string };
}) {
  const minScore = Number.isFinite(DEFAULT_MIN) ? DEFAULT_MIN : 30;
  const sourceFilterApplied = searchParams?.sourceFilter === "1" || searchParams?.sources !== undefined;
  const selectedSources = sourceFilterApplied
    ? parseSourceSelection(searchParams?.sources)
    : TENDER_SOURCE_CATALOG.map((source) => source.id);
  const apiParams = new URLSearchParams({ minScore: String(minScore) });
  if (sourceFilterApplied) {
    apiParams.set("sourceFilter", "1");
    for (const source of selectedSources) apiParams.append("sources", source);
  }
  const data = await apiGetSafe<MatchesResponse>(
    `/api/v1/matches?${apiParams.toString()}`,
  );
  const matches = data?.matches ?? [];

  const todayMatches = matches.filter((m) =>
    isToday((m as unknown as { createdAt?: string }).createdAt ?? null),
  );
  const avgFit = Math.round(avg(matches.map((m) => m.fitScore)));
  const highWin = matches.filter((m) => m.winProbability === "high").length;

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-zinc-600">
          Tenders matched against your capability profile, fit-score {minScore}+.
        </p>
      </header>

      <SourceFilter
        filterApplied={sourceFilterApplied}
        selectedSources={selectedSources}
        sources={TENDER_SOURCE_CATALOG}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={<Inbox className="h-5 w-5 text-indigo-600" />}
          label="Matches today"
          value={todayMatches.length}
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5 text-emerald-600" />}
          label="Average fit score"
          value={matches.length ? avgFit : "—"}
        />
        <StatCard
          icon={<Trophy className="h-5 w-5 text-amber-600" />}
          label="High win-prob"
          value={highWin}
        />
      </div>

      {matches.length === 0 ? (
        <EmptyState />
      ) : (
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
            Matches
          </h2>
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

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <Card>
      <CardBody className="flex items-center gap-4">
        <div className="rounded-lg bg-zinc-50 p-2.5">{icon}</div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            {label}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        </div>
      </CardBody>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardBody className="space-y-4 py-10 text-center">
        <h2 className="text-lg font-semibold">No matches yet.</h2>
        <p className="mx-auto max-w-md text-sm text-zinc-600">
          The ingestion + matching workers haven't run yet. Run them locally to
          populate this dashboard.
        </p>
        <pre className="mx-auto mt-4 max-w-md overflow-x-auto rounded-md bg-zinc-900 px-4 py-3 text-left text-xs text-zinc-100">
          <code>pnpm worker:ingest && pnpm worker:match</code>
        </pre>
      </CardBody>
    </Card>
  );
}
