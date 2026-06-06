import { prisma } from "../db";
import type { TenderSourceId } from "@beta/shared";

/**
 * `active`   — tender deadline is null OR in the future (default for /dashboard)
 * `archived` — tender deadline is in the past (default for /archive)
 * `all`      — no expiry filter at all
 *
 * We filter on tender.deadlineAt rather than archiving the MatchResult itself,
 * so a tender that gets a new deadline upstream automatically moves back to
 * the active list without any worker run.
 */
export type MatchListStatus = "active" | "archived" | "all";

export type MatchListParams = {
  tenantId: string;
  from?: Date;
  to?: Date;
  minScore?: number;
  sources?: TenderSourceId[];
  sourceFilter?: boolean;
  /** Defaults to "active" — dashboards should never accidentally show closed tenders. */
  status?: MatchListStatus;
};

/**
 * Build the `tender: { ... }` relation filter from a status + optional source list.
 * Factored out so list and count helpers stay in lockstep.
 */
function buildTenderFilter(opts: {
  status: MatchListStatus;
  sourceFilter: boolean;
  sources?: TenderSourceId[];
  now: Date;
}) {
  const tender: Record<string, unknown> = {};
  if (opts.sourceFilter) {
    tender.source = { in: opts.sources ?? [] };
  }
  if (opts.status === "active") {
    tender.OR = [{ deadlineAt: null }, { deadlineAt: { gt: opts.now } }];
  } else if (opts.status === "archived") {
    tender.deadlineAt = { lte: opts.now };
  }
  return tender;
}

export async function listMatchesForTenant(params: MatchListParams) {
  const {
    tenantId,
    from,
    to,
    minScore = 0,
    sources,
    sourceFilter = false,
    status = "active",
  } = params;
  const now = new Date();
  const tenderFilter = buildTenderFilter({ status, sourceFilter, sources, now });

  // Archived view is most useful when ordered by recency-of-expiry — operators
  // glance at "what just closed". Active view stays ranked by fit (the original
  // behaviour).
  const orderBy =
    status === "archived"
      ? [{ tender: { deadlineAt: "desc" as const } }, { fitScore: "desc" as const }]
      : { fitScore: "desc" as const };

  return prisma.matchResult.findMany({
    where: {
      tenantId,
      fitScore: { gte: minScore },
      ...(Object.keys(tenderFilter).length > 0 ? { tender: tenderFilter } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    orderBy,
    include: {
      tender: {
        select: {
          id: true,
          title: true,
          buyer: true,
          country: true,
          source: true,
          url: true,
          publishedAt: true,
          deadlineAt: true,
          budgetMinUsd: true,
          budgetMaxUsd: true,
          currency: true,
          // When TenderFit fetched this tender from the source — shown on
          // the dashboard cards so the user can see freshness at a glance.
          ingestedAt: true,
        },
      },
    },
  });
}

/**
 * Cheap COUNT(*) used by the dashboard to render a "View archive (N)" link
 * without round-tripping the full match list.
 */
export async function countMatchesForTenant(
  params: Pick<MatchListParams, "tenantId" | "status" | "minScore">,
): Promise<number> {
  const { tenantId, status = "active", minScore = 0 } = params;
  const now = new Date();
  const tenderFilter = buildTenderFilter({ status, sourceFilter: false, now });
  return prisma.matchResult.count({
    where: {
      tenantId,
      fitScore: { gte: minScore },
      ...(Object.keys(tenderFilter).length > 0 ? { tender: tenderFilter } : {}),
    },
  });
}

export async function getMatchForTenant(tenantId: string, matchId: string) {
  // Explicit select on tender to avoid pulling Unsupported pgvector/tsvector
  // columns (which would force Prisma to serialise types it can't handle).
  // Keep this list in sync with the Tender fields the match-detail page uses.
  return prisma.matchResult.findFirst({
    where: { id: matchId, tenantId },
    include: {
      tender: {
        select: {
          id: true,
          source: true,
          externalId: true,
          title: true,
          description: true,
          url: true,
          buyer: true,
          country: true,
          sector: true,
          cpvCodes: true,
          budgetMinUsd: true,
          budgetMaxUsd: true,
          currency: true,
          language: true,
          publishedAt: true,
          deadlineAt: true,
          ingestedAt: true,
        },
      },
      feedback: true,
    },
  });
}
