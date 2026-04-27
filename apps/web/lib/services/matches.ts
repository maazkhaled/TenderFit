import { prisma } from "../db";

export type MatchListParams = {
  tenantId: string;
  from?: Date;
  to?: Date;
  minScore?: number;
};

export async function listMatchesForTenant(params: MatchListParams) {
  const { tenantId, from, to, minScore = 0 } = params;
  return prisma.matchResult.findMany({
    where: {
      tenantId,
      fitScore: { gte: minScore },
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
