import {
  findNearestTenders,
  markEmbeddingFailed,
  prisma,
  readEmbeddingMeta,
  writeEmbedding,
} from "@beta/db";
import {
  activeEmbeddingModelStamp,
  embedCapabilityProfile,
  embedTender,
  embeddingHashForProfile,
  embeddingHashForTender,
  scoreMatch,
  type SimilarHistoricalWin,
} from "@beta/llm";
import type {
  CapabilityProfile,
  NormalizedTender,
  PastProject,
  TenderSourceId,
} from "@beta/shared";

const MAX_NEW_MATCHES_PER_TENANT = 20;
const NEAREST_FETCH_LIMIT = 50;

function tenderRowToNormalized(row: any): NormalizedTender {
  return {
    externalId: row.externalId,
    source: row.source as TenderSourceId,
    title: row.title,
    description: row.description ?? "",
    url: row.url,
    buyer: row.buyer ?? "",
    country: row.country ?? null,
    sector: row.sector ?? null,
    cpvCodes: Array.isArray(row.cpvCodes) ? row.cpvCodes : [],
    budgetMinUsd: row.budgetMinUsd ?? null,
    budgetMaxUsd: row.budgetMaxUsd ?? null,
    currency: row.currency ?? null,
    publishedAt: row.publishedAt instanceof Date ? row.publishedAt : new Date(row.publishedAt),
    deadlineAt: row.deadlineAt
      ? row.deadlineAt instanceof Date
        ? row.deadlineAt
        : new Date(row.deadlineAt)
      : null,
    language: row.language ?? "en",
    raw: row.raw,
  };
}

function profileRowToCapability(row: any, companyName: string): CapabilityProfile {
  let pastProjects: PastProject[] = [];
  if (Array.isArray(row.pastProjects)) {
    pastProjects = row.pastProjects as PastProject[];
  } else if (row.pastProjects && typeof row.pastProjects === "object") {
    pastProjects = [];
  }

  return {
    companyName,
    oneLiner: row.oneLiner ?? "",
    industries: Array.isArray(row.industries) ? row.industries : [],
    techStack: Array.isArray(row.techStack) ? row.techStack : [],
    services: Array.isArray(row.services) ? row.services : [],
    certifications: Array.isArray(row.certifications) ? row.certifications : [],
    pastClients: Array.isArray(row.pastClients) ? row.pastClients : [],
    pastProjects,
    geographies: Array.isArray(row.geographies) ? row.geographies : [],
    teamSize: row.teamSize ?? 0,
    budgetRangeUsd: {
      min: row.budgetMinUsd ?? 0,
      max: row.budgetMaxUsd ?? 0,
    },
    languages: Array.isArray(row.languages) ? row.languages : ["en"],
  };
}

async function embedPendingTenders(): Promise<void> {
  // Pull rows that are explicitly pending OR have no hash stamped yet (legacy
  // rows from before the hash column existed).
  const pending = await prisma.tender.findMany({
    where: {
      OR: [{ embeddingStatus: "pending" }, { embeddingHash: null }],
    },
    take: 100,
  });
  if (pending.length === 0) return;
  const modelStamp = activeEmbeddingModelStamp();
  let embedded = 0;
  let skipped = 0;
  for (const row of pending) {
    try {
      const tender = tenderRowToNormalized(row);
      const wantedHash = embeddingHashForTender(tender);
      const meta = await readEmbeddingMeta("Tender", row.id);
      if (
        meta?.hash === wantedHash &&
        meta?.model === modelStamp &&
        row.embeddingStatus === "ready"
      ) {
        skipped += 1;
        continue;
      }
      const vec = await embedTender(tender);
      await writeEmbedding("Tender", row.id, vec, {
        hash: wantedHash,
        model: modelStamp,
      });
      embedded += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[match] tender embed failed id=${row.id}: ${msg}`);
      try {
        await markEmbeddingFailed("Tender", row.id);
      } catch (markErr) {
        console.error(`[match] markFailed error id=${row.id}:`, markErr);
      }
    }
  }
  console.log(
    `[match] tenders: embedded=${embedded} skipped=${skipped} (model=${modelStamp})`,
  );
}

async function embedPendingProfiles(): Promise<void> {
  const pending = await prisma.capabilityProfile.findMany({
    where: {
      OR: [{ embeddingStatus: "pending" }, { embeddingHash: null }],
    },
    include: { tenant: { select: { companyName: true } } },
    take: 100,
  });
  if (pending.length === 0) return;
  const modelStamp = activeEmbeddingModelStamp();
  let embedded = 0;
  let skipped = 0;
  for (const row of pending) {
    try {
      const profile = profileRowToCapability(
        row,
        row.tenant?.companyName ?? "",
      );
      const wantedHash = embeddingHashForProfile(profile);
      const meta = await readEmbeddingMeta("CapabilityProfile", row.id);
      if (
        meta?.hash === wantedHash &&
        meta?.model === modelStamp &&
        row.embeddingStatus === "ready"
      ) {
        skipped += 1;
        continue;
      }
      const vec = await embedCapabilityProfile(profile);
      await writeEmbedding("CapabilityProfile", row.id, vec, {
        hash: wantedHash,
        model: modelStamp,
      });
      embedded += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[match] profile embed failed id=${row.id}: ${msg}`);
      try {
        await markEmbeddingFailed("CapabilityProfile", row.id);
      } catch (markErr) {
        console.error(`[match] markFailed error id=${row.id}:`, markErr);
      }
    }
  }
  console.log(
    `[match] profiles: embedded=${embedded} skipped=${skipped} (model=${modelStamp})`,
  );
}

async function fetchHistoricalWins(
  tenantId: string,
): Promise<SimilarHistoricalWin[]> {
  const feedback = await prisma.matchFeedback.findMany({
    where: { tenantId, interested: true },
    take: 20,
    orderBy: { createdAt: "desc" },
    include: {
      match: {
        include: {
          tender: {
            select: {
              sector: true,
              country: true,
              buyer: true,
              budgetMaxUsd: true,
            },
          },
        },
      },
    },
  });

  return feedback
    .map((f: any) => ({
      sector: f.match?.tender?.sector ?? null,
      country: f.match?.tender?.country ?? null,
      buyer: f.match?.tender?.buyer ?? null,
      valueUsd: f.match?.tender?.budgetMaxUsd ?? null,
    }))
    .filter((w) => w.sector || w.country || w.buyer);
}

async function matchForTenant(tenant: {
  id: string;
  companyName: string;
  profile: any;
}): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  const profile = profileRowToCapability(tenant.profile, tenant.companyName);
  const nearest = await findNearestTenders(tenant.profile.id, NEAREST_FETCH_LIMIT);
  if (nearest.length === 0) return { created, skipped };

  const now = new Date();
  const tenderIds = nearest.map((n) => n.id);
  const tenderRows = await prisma.tender.findMany({
    where: {
      id: { in: tenderIds },
      OR: [{ deadlineAt: null }, { deadlineAt: { gt: now } }],
    },
  });
  const tendersById = new Map<string, any>(tenderRows.map((t: any) => [t.id, t]));

  const existing = await prisma.matchResult.findMany({
    where: { tenantId: tenant.id, tenderId: { in: tenderIds } },
    select: { tenderId: true },
  });
  const existingIds = new Set<string>(existing.map((m: any) => m.tenderId));

  const historicalWins = await fetchHistoricalWins(tenant.id);

  for (const { id: tenderId, distance } of nearest) {
    if (created >= MAX_NEW_MATCHES_PER_TENANT) break;
    if (existingIds.has(tenderId)) {
      skipped += 1;
      continue;
    }
    const row = tendersById.get(tenderId);
    if (!row) {
      skipped += 1;
      continue;
    }

    const tender = tenderRowToNormalized(row);
    const similarity = Math.max(0, Math.min(1, 1 - distance));

    try {
      const result = await scoreMatch(profile, tender, similarity, {
        similarHistoricalWins: historicalWins,
      });
      await prisma.matchResult.create({
        data: {
          tenantId: tenant.id,
          tenderId,
          fitScore: result.fitScore,
          rationale: result.rationale,
          gaps: result.gaps as any,
          winProbability: result.winProbability,
          winProbabilityReason: result.winProbabilityReason,
          modelVersion: result.modelVersion,
        },
      });
      created += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[match] tenant=${tenant.id} tender=${tenderId} score error: ${msg}`,
      );
    }
  }

  return { created, skipped };
}

export async function runMatch(): Promise<void> {
  console.log(
    `[match] active embedding stamp: ${activeEmbeddingModelStamp()} ` +
      `(provider switch invalidates the hash cache automatically)`,
  );

  console.log("[match] phase 1: embed pending tenders");
  await embedPendingTenders();

  console.log("[match] phase 2: embed pending capability profiles");
  await embedPendingProfiles();

  console.log("[match] phase 3: score matches per tenant");
  const tenants = await prisma.tenant.findMany({
    include: { profile: true },
  });

  let totalCreated = 0;
  for (const tenant of tenants) {
    if (!tenant.profile) {
      console.log(`[match] tenant=${tenant.slug} no profile, skipping`);
      continue;
    }
    if (tenant.profile.embeddingStatus !== "ready") {
      console.log(
        `[match] tenant=${tenant.slug} profile embedding=${tenant.profile.embeddingStatus}, skipping`,
      );
      continue;
    }
    const { created, skipped } = await matchForTenant(tenant);
    totalCreated += created;
    console.log(
      `[match] tenant=${tenant.slug} created=${created} skipped=${skipped}`,
    );
  }

  console.log(`[match] done. new matches: ${totalCreated}`);
}

const isDirect = (() => {
  const arg = process.argv[1] ?? "";
  return arg.endsWith("match-runner.ts") || arg.endsWith("match-runner.js");
})();

if (isDirect) {
  runMatch()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error("[match] fatal:", err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
