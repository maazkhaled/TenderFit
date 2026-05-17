// MUST be the first import — populates process.env from .env before any
// downstream module reads provider config (LLM_PROVIDER, EMBEDDING_PROVIDER,
// RERANK_PROVIDER, VOYAGE_API_KEY, …). Side-effect import on purpose.
import "./util/load-env.js";

import {
  findNearestTenders,
  findTendersByText,
  markEmbeddingFailed,
  prisma,
  readEmbeddingMeta,
  writeEmbedding,
} from "@beta/db";
import {
  activeEmbeddingModelStamp,
  buildProfileQuery,
  embedCapabilityProfile,
  embedTender,
  embeddingHashForProfile,
  embeddingHashForTender,
  getRerankProvider,
  hybridRetrieve,
  renderProfileForLLM,
  renderTenderForLLM,
  scoreMatch,
  type HybridCandidate,
  type SimilarHistoricalWin,
} from "@beta/llm";
import type {
  CapabilityProfile,
  NormalizedTender,
  PastProject,
  TenderSourceId,
} from "@beta/shared";

const MAX_NEW_MATCHES_PER_TENANT = 20;

/**
 * Per-retriever fetch limit before fusion. The dense + text retrievers each
 * pull this many candidates, then RRF fuses them. 60 gives both rankers a
 * reasonable budget without making the LLM stage wait on a giant rerank batch.
 */
const RETRIEVAL_PER_RETRIEVER_LIMIT = Number.parseInt(
  process.env.MATCH_PER_RETRIEVER_LIMIT ?? "60",
  10,
);

/**
 * How many fused candidates flow into the cross-encoder reranker. The
 * reranker then picks the top N for LLM scoring. With Voyage rerank-2.5 a
 * batch of 40 is ~150ms — cheap enough to keep wider than MAX_NEW_MATCHES.
 */
const RERANK_INPUT_LIMIT = Number.parseInt(
  process.env.MATCH_RERANK_INPUT_LIMIT ?? "40",
  10,
);

const SCORE_TIMEOUT_MS = Number.parseInt(
  process.env.MATCH_SCORE_TIMEOUT_MS ?? "60000",
  10,
);

/**
 * Per-document text budget for the reranker. Voyage rerank-2.5 truncates
 * server-side but trimming up-front cuts request size and (more importantly)
 * keeps the most salient header info intact when truncation does kick in.
 */
const RERANK_DOC_CHARS = Number.parseInt(
  process.env.MATCH_RERANK_DOC_CHARS ?? "1500",
  10,
);

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

/** Compact representation of a tender for the cross-encoder reranker. */
function tenderRerankDoc(row: any): string {
  const title = String(row.title ?? "");
  const buyer = String(row.buyer ?? "");
  const sector = row.sector ? `Sector: ${row.sector}` : "";
  const country = row.country ? `Country: ${row.country}` : "";
  const cpv = Array.isArray(row.cpvCodes) && row.cpvCodes.length
    ? `CPV: ${row.cpvCodes.join(", ")}`
    : "";
  const desc = String(row.description ?? "").slice(0, RERANK_DOC_CHARS);
  return [`Title: ${title}`, `Buyer: ${buyer}`, sector, country, cpv, "", desc]
    .filter((s) => s.length > 0)
    .join("\n");
}

async function matchForTenant(tenant: {
  id: string;
  companyName: string;
  profile: any;
}): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  let scoreAttempts = 0;

  const profile = profileRowToCapability(tenant.profile, tenant.companyName);

  // ---- Stage 1: hybrid retrieval (dense + BM25) fused via RRF ----
  const candidates: HybridCandidate[] = await hybridRetrieve(
    profile,
    {
      dense: (limit) => findNearestTenders(tenant.profile.id, limit),
      text: (q, limit) => findTendersByText(q, limit),
      buildQuery: buildProfileQuery,
    },
    {
      perRetrieverLimit: RETRIEVAL_PER_RETRIEVER_LIMIT,
      fusedLimit: RERANK_INPUT_LIMIT,
    },
  );
  if (candidates.length === 0) return { created, skipped };

  // ---- Stage 2: filter to active, not-already-matched, fetch full rows ----
  const now = new Date();
  const candidateIds = candidates.map((c) => c.id);
  const tenderRows = await prisma.tender.findMany({
    where: {
      id: { in: candidateIds },
      OR: [{ deadlineAt: null }, { deadlineAt: { gt: now } }],
    },
  });
  const tendersById = new Map<string, any>(tenderRows.map((t: any) => [t.id, t]));

  const existing = await prisma.matchResult.findMany({
    where: { tenantId: tenant.id, tenderId: { in: candidateIds } },
    select: { tenderId: true },
  });
  const existingIds = new Set<string>(existing.map((m: any) => m.tenderId));

  // Preserve fusion order while dropping unavailable / already-scored candidates.
  const eligible = candidates.filter(
    (c) => tendersById.has(c.id) && !existingIds.has(c.id),
  );
  if (eligible.length === 0) return { created, skipped };

  // ---- Stage 3: cross-encoder rerank ----
  const reranker = getRerankProvider();
  const rerankQuery = renderProfileForLLM(profile);
  const rerankDocs = eligible.map((c) => tenderRerankDoc(tendersById.get(c.id)));
  let rerankedOrder: HybridCandidate[];
  try {
    const hits = await reranker.rerank(rerankQuery, rerankDocs, {
      topK: Math.min(MAX_NEW_MATCHES_PER_TENANT * 2, eligible.length),
    });
    if (hits.length === 0) {
      rerankedOrder = eligible;
    } else {
      rerankedOrder = hits
        .map((h) => eligible[h.index])
        .filter((c): c is HybridCandidate => c != null);
    }
    console.log(
      `[match] tenant=${tenant.id} rerank=${reranker.name} in=${rerankDocs.length} out=${rerankedOrder.length}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[match] tenant=${tenant.id} rerank failed (${msg}); using fusion order`,
    );
    rerankedOrder = eligible;
  }

  // ---- Stage 4: LLM scoring of the top-K ----
  const historicalWins = await fetchHistoricalWins(tenant.id);
  const processedIds = new Set<string>();
  for (const candidate of rerankedOrder) {
    if (created >= MAX_NEW_MATCHES_PER_TENANT) break;
    if (scoreAttempts >= MAX_NEW_MATCHES_PER_TENANT) break;
    if (processedIds.has(candidate.id)) {
      skipped += 1;
      continue;
    }
    processedIds.add(candidate.id);
    if (existingIds.has(candidate.id)) {
      skipped += 1;
      continue;
    }
    const row = tendersById.get(candidate.id);
    if (!row) {
      skipped += 1;
      continue;
    }

    const tender = tenderRowToNormalized(row);
    // Cosine similarity hint for the LLM. Text-only candidates carry null
    // (no dense match in the top-K) — pass 0 and let the LLM rely on rationale.
    const similarity = candidate.denseSimilarity ?? 0;

    try {
      scoreAttempts += 1;
      console.log(
        `[match] tenant=${tenant.id} scoring ${scoreAttempts}/${MAX_NEW_MATCHES_PER_TENANT} ` +
          `tender=${candidate.id} sources=${candidate.sources.join("+")} ` +
          `fused=${candidate.fusedScore.toFixed(4)} cos=${similarity.toFixed(4)}`,
      );
      const result = await withTimeout(
        scoreMatch(profile, tender, similarity, {
          similarHistoricalWins: historicalWins,
        }),
        SCORE_TIMEOUT_MS,
        `score timeout after ${SCORE_TIMEOUT_MS}ms`,
      );
      await prisma.matchResult.create({
        data: {
          tenantId: tenant.id,
          tenderId: candidate.id,
          fitScore: result.fitScore,
          rationale: result.rationale,
          gaps: result.gaps as any,
          winProbability: result.winProbability,
          winProbabilityReason: result.winProbabilityReason,
          humanResourcesEstimate: result.humanResourcesEstimate as any,
          modelVersion: result.modelVersion,
        },
      });
      existingIds.add(candidate.id);
      created += 1;
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        existingIds.add(candidate.id);
        skipped += 1;
        continue;
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[match] tenant=${tenant.id} tender=${candidate.id} score error: ${msg}`,
      );
    }
  }

  // Use `renderTenderForLLM` import to avoid "unused import" elsewhere when we
  // later wire fuller logging — referenced here as a noop guard.
  void renderTenderForLLM;

  return { created, skipped };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "P2002";
}

export async function runMatch(): Promise<void> {
  console.log(
    `[match] active embedding stamp: ${activeEmbeddingModelStamp()} ` +
      `(provider switch invalidates the hash cache automatically)`,
  );
  console.log(
    `[match] retrieval: hybrid (dense + BM25-ish FTS, RRF fused), ` +
      `rerank=${getRerankProvider().name}`,
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
