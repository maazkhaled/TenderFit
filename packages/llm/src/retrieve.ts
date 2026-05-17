/**
 * Hybrid retrieval orchestrator: dense vector + BM25-style FTS fused via
 * Reciprocal Rank Fusion (RRF).
 *
 * The 2024-2026 industry consensus (see ZeroEntropy's 2026 reranker guide and
 * the Genzeon hybrid-retrieval study) is:
 *
 *   1. Run dense retrieval (cosine over embeddings) for top-K candidates.
 *   2. Run lexical retrieval (BM25 or Postgres ts_rank_cd) for top-K.
 *   3. Fuse the two lists via RRF — score(d) = Σ_i 1 / (k + rank_i(d)).
 *   4. Send the fused top-N into a cross-encoder reranker.
 *   5. LLM-score the rerank top-R.
 *
 * This module owns steps 1-3. The reranker (step 4) lives in providers/. The
 * LLM scorer (step 5) is the existing scoreMatch() in ./score.ts.
 *
 * Why RRF over weighted-sum: RRF is parameter-light (just k), robust to
 * different score scales across rankers, and consistently within 1-2% of
 * tuned weighted-sum fusion in published benchmarks. We expose a fusionK
 * override but the default (60) comes from the original RRF paper and has
 * been the de-facto choice across most modern hybrid-retrieval implementations.
 *
 * Why this layer rather than baking it into match-runner: testability. The
 * fuse() helper is pure and gets exercised by unit tests; the orchestrator
 * itself is dependency-injected so it can run against fake retrievers.
 */

import type { CapabilityProfile } from "@beta/shared";

/** Default RRF constant from the original Cormack et al. paper. */
const DEFAULT_RRF_K = 60;

/** How many candidates each retriever pulls before fusion. */
const DEFAULT_PER_RETRIEVER_LIMIT = 50;

/** How many fused candidates the orchestrator returns by default. */
const DEFAULT_FUSED_LIMIT = 50;

export interface DenseHit {
  id: string;
  /** pgvector cosine distance in [0, 2]. similarity = 1 - distance. */
  distance: number;
}

export interface TextHit {
  id: string;
  /** ts_rank_cd score, bounded in [0, 1) with normalization=32. */
  rank: number;
}

export interface HybridCandidate {
  id: string;
  /** RRF-fused score. Higher = better. */
  fusedScore: number;
  /** Cosine similarity (1 - distance), present iff the candidate came from dense retrieval. */
  denseSimilarity: number | null;
  /** ts_rank_cd, present iff the candidate came from text retrieval. */
  textRank: number | null;
  /** Which retrievers produced this candidate. */
  sources: Array<"dense" | "text">;
}

export interface HybridRetrieveOptions {
  /** Total candidates per retriever before fusion. Default 50. */
  perRetrieverLimit?: number;
  /** Candidates returned after fusion. Default 50. */
  fusedLimit?: number;
  /** RRF k. Default 60. Smaller k = sharper rank discrimination; larger k = smoother. */
  fusionK?: number;
  /**
   * Skip BM25 retrieval — pure dense. Used for fallback paths when the FTS
   * column is unavailable or the profile has no keyword surface.
   */
  denseOnly?: boolean;
}

export interface HybridRetrievers {
  /** Dense retrieval — usually `findNearestTenders` from @beta/db. */
  dense: (limit: number) => Promise<DenseHit[]>;
  /** Text retrieval — usually `findTendersByText(query, limit)` from @beta/db. */
  text: (query: string, limit: number) => Promise<TextHit[]>;
  /** Builds the FTS query string from a profile. Defaults to `defaultProfileKeywords`. */
  buildQuery?: (profile: CapabilityProfile) => string;
}

/**
 * Profile → keyword list for FTS. Pulled from the fields that map closest to
 * tender language: services + tech stack + certifications + industries.
 *
 * We deliberately exclude long-form fields (oneLiner, past-project summaries)
 * — those are useful for dense embedding but noisy as keyword tokens.
 */
export function defaultProfileKeywords(profile: CapabilityProfile): string[] {
  const out: string[] = [];
  out.push(...profile.services);
  out.push(...profile.techStack);
  out.push(...profile.certifications);
  out.push(...profile.industries);
  return out
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0 && s.length < 80);
}

/**
 * Build a websearch_to_tsquery-friendly query string from arbitrary keyword
 * terms. Mirrors `buildTextQuery` in @beta/db so callers without DB access
 * can still construct queries.
 */
export function buildProfileQuery(profile: CapabilityProfile): string {
  const terms = defaultProfileKeywords(profile);
  if (terms.length === 0) return "";
  return terms
    .map((t) => (t.includes(" ") ? `"${t.replace(/"/g, "")}"` : t))
    .join(" OR ");
}

/**
 * Reciprocal Rank Fusion over an arbitrary number of ranked id lists.
 *
 * - Each list is treated as ordered best-first.
 * - score(d) = Σ_i 1 / (k + rank_i(d))   where rank_i is 1-indexed.
 * - Documents missing from a list contribute 0 from that list.
 *
 * Pure function. No I/O. Stable: ties broken by first-list-rank ascending.
 */
export function reciprocalRankFusion(
  lists: ReadonlyArray<ReadonlyArray<string>>,
  k: number = DEFAULT_RRF_K,
): Array<{ id: string; fusedScore: number }> {
  if (k <= 0) throw new Error("reciprocalRankFusion: k must be > 0");
  const scores = new Map<string, number>();
  const firstSeenRank = new Map<string, number>();
  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      const id = list[i] as string;
      const contribution = 1 / (k + i + 1); // i+1 → 1-indexed rank
      scores.set(id, (scores.get(id) ?? 0) + contribution);
      if (!firstSeenRank.has(id)) firstSeenRank.set(id, i);
    }
  }
  const out = [...scores.entries()].map(([id, fusedScore]) => ({ id, fusedScore }));
  out.sort((a, b) => {
    if (b.fusedScore !== a.fusedScore) return b.fusedScore - a.fusedScore;
    return (firstSeenRank.get(a.id) ?? 0) - (firstSeenRank.get(b.id) ?? 0);
  });
  return out;
}

/**
 * Run dense + text retrieval in parallel and fuse the results.
 *
 * - Empty / whitespace-only FTS queries cause text retrieval to be skipped
 *   silently (dense-only mode).
 * - If both retrievers return [] the function returns [] without throwing.
 * - Errors from one retriever do not abort the other; the failing one is
 *   logged via console.warn and degraded to an empty list.
 */
export async function hybridRetrieve(
  profile: CapabilityProfile,
  retrievers: HybridRetrievers,
  options: HybridRetrieveOptions = {},
): Promise<HybridCandidate[]> {
  const perLimit = options.perRetrieverLimit ?? DEFAULT_PER_RETRIEVER_LIMIT;
  const fusedLimit = options.fusedLimit ?? DEFAULT_FUSED_LIMIT;
  const k = options.fusionK ?? DEFAULT_RRF_K;
  const denseOnly = options.denseOnly ?? false;

  const buildQuery = retrievers.buildQuery ?? buildProfileQuery;
  const query = denseOnly ? "" : buildQuery(profile);

  const [denseHits, textHits] = await Promise.all([
    safeDense(retrievers.dense, perLimit),
    query.length > 0 ? safeText(retrievers.text, query, perLimit) : Promise.resolve([]),
  ]);

  if (denseHits.length === 0 && textHits.length === 0) return [];

  const fused = reciprocalRankFusion(
    [denseHits.map((h) => h.id), textHits.map((h) => h.id)],
    k,
  );

  const denseById = new Map<string, DenseHit>(denseHits.map((h) => [h.id, h]));
  const textById = new Map<string, TextHit>(textHits.map((h) => [h.id, h]));

  return fused.slice(0, fusedLimit).map(({ id, fusedScore }) => {
    const d = denseById.get(id);
    const t = textById.get(id);
    const sources: Array<"dense" | "text"> = [];
    if (d) sources.push("dense");
    if (t) sources.push("text");
    return {
      id,
      fusedScore,
      denseSimilarity: d ? clampUnit(1 - d.distance) : null,
      textRank: t ? t.rank : null,
      sources,
    };
  });
}

function clampUnit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

async function safeDense(
  fn: HybridRetrievers["dense"],
  limit: number,
): Promise<DenseHit[]> {
  try {
    return await fn(limit);
  } catch (err) {
    console.warn(
      `[retrieve] dense retrieval failed: ${err instanceof Error ? err.message : err}`,
    );
    return [];
  }
}

async function safeText(
  fn: HybridRetrievers["text"],
  query: string,
  limit: number,
): Promise<TextHit[]> {
  try {
    return await fn(query, limit);
  } catch (err) {
    console.warn(
      `[retrieve] text retrieval failed: ${err instanceof Error ? err.message : err}`,
    );
    return [];
  }
}

export const __test__ = {
  DEFAULT_RRF_K,
  DEFAULT_PER_RETRIEVER_LIMIT,
  DEFAULT_FUSED_LIMIT,
};
