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

  // Digest includes:
  //   - Every match created since the last digest send (createdAt >= since).
  //     This naturally spans multiple ingest runs — e.g. a Monday 9am digest
  //     after a Friday 9am one will pull everything scored Fri→Mon.
  //   - Only matches whose tender is still active (deadline in the future
  //     OR no deadline at all). Past-deadline tenders are skipped.
  //   - The top 50 by fit-score — enough headroom for a busy weekend gap
  //     but still readable. Anything below makes it to the dashboard but
  //     gets cut from the email.
  const now = new Date();
  const matches = await prisma.matchResult.findMany({
    where: {
      tenantId,
      fitScore: { gte: minFitScore },
      createdAt: { gte: since },
      tender: {
        OR: [{ deadlineAt: null }, { deadlineAt: { gt: now } }],
      },
    },
    orderBy: [{ fitScore: "desc" }, { createdAt: "desc" }],
    take: 50,
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
