import { prisma } from "@beta/db";
import { DEFAULT_MIN_FIT_SCORE, type DigestPayload } from "@beta/shared";

export async function buildDigestForTenant(
  tenantId: string,
  since: Date,
): Promise<DigestPayload | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { schedule: true },
  });
  if (!tenant) return null;

  const minFitScore =
    tenant.schedule?.minFitScore ?? DEFAULT_MIN_FIT_SCORE;

  const matches = await prisma.matchResult.findMany({
    where: {
      tenantId,
      fitScore: { gte: minFitScore },
      createdAt: { gte: since },
    },
    orderBy: [{ fitScore: "desc" }, { createdAt: "desc" }],
    take: 25,
    include: {
      tender: {
        select: {
          id: true,
          title: true,
          url: true,
          buyer: true,
          deadlineAt: true,
        },
      },
    },
  });

  if (matches.length === 0) return null;

  return {
    tenantId,
    companyName: tenant.companyName,
    generatedAt: new Date(),
    // Surface the effective threshold so the email renderer can show it
    // verbatim instead of falling back to the build-time DEFAULT constant.
    minFitScore,
    recipients: Array.isArray(tenant.schedule?.recipients)
      ? tenant.schedule!.recipients
      : [],
    matches: matches.map((m: any) => ({
      matchId: m.id,
      tenderTitle: m.tender.title,
      tenderUrl: m.tender.url,
      buyer: m.tender.buyer,
      deadlineAt: m.tender.deadlineAt,
      fitScore: m.fitScore,
      rationale: Array.isArray(m.rationale) ? m.rationale.slice(0, 3) : [],
      winProbability: m.winProbability,
      humanResourcesEstimate: m.humanResourcesEstimate as any,
    })),
  };
}
