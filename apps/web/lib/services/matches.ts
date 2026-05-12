import { prisma } from "../db";
import type { TenderSourceId } from "@beta/shared";

export type MatchListParams = {
  tenantId: string;
  from?: Date;
  to?: Date;
  minScore?: number;
  sources?: TenderSourceId[];
  sourceFilter?: boolean;
};

export async function listMatchesForTenant(params: MatchListParams) {
  const { tenantId, from, to, minScore = 0, sources, sourceFilter = false } = params;
  return prisma.matchResult.findMany({
    where: {
      tenantId,
      fitScore: { gte: minScore },
      ...(sourceFilter
        ? {
            tender: {
              source: { in: sources ?? [] },
            },
          }
        : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    orderBy: { fitScore: "desc" },
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
        },
      },
    },
  });
}

export async function getMatchForTenant(tenantId: string, matchId: string) {
  return prisma.matchResult.findFirst({
    where: { id: matchId, tenantId },
    include: {
      tender: true,
      feedback: true,
    },
  });
}
