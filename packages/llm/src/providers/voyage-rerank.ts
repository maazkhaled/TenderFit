/**
 * Voyage AI cross-encoder reranker.
 *
 * Endpoint: POST https://api.voyageai.com/v1/rerank
 *
 * Why a separate file from voyage.ts: the embedding and rerank surfaces have
 * different request/response shapes, different defaults (rerank-2.5 vs
 * voyage-3-large), and different config knobs (RERANK_TOP_K, RERANK_MODEL).
 * Keeping them apart makes the doctor CLI's "what's wired up" output clearer
 * and lets the rerank stage be disabled without touching embeddings.
 *
 * Voyage docs: https://docs.voyageai.com/docs/reranker
 */

// Explicit .ts extensions: Node's --experimental-strip-types test runner
// resolves ESM imports without extension inference. tsx (used by the worker
// runners) is fine either way, but the test runner is the strict path.
import type { RerankHit, RerankProvider } from "./types.ts";
import { ProviderError } from "./types.ts";
import { fetchWithTimeout, type RerankProviderConfig } from "./config.ts";

interface VoyageRerankResponse {
  data?: Array<{ index: number; relevance_score: number }>;
  detail?: string;
  error?: string;
}

const MAX_BATCH = 1000; // Voyage rerank caps at 1000 docs per call

export class VoyageRerankProvider implements RerankProvider {
  readonly name = "voyage" as const;
  // Explicit field rather than a parameter property — Node's
  // --experimental-strip-types (used by our test runner) doesn't yet support
  // the constructor-shorthand form.
  private readonly cfg: RerankProviderConfig;
  constructor(cfg: RerankProviderConfig) {
    this.cfg = cfg;
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    if (!this.cfg.apiKey) {
      return { ok: false, detail: "VOYAGE_API_KEY not set" };
    }
    return { ok: true, detail: `API key present (model=${this.cfg.model})` };
  }

  async rerank(
    query: string,
    documents: string[],
    opts: { topK?: number } = {},
  ): Promise<RerankHit[]> {
    if (documents.length === 0) return [];
    if (!this.cfg.apiKey) {
      throw new ProviderError("voyage", "VOYAGE_API_KEY is not set");
    }
    if (documents.length > MAX_BATCH) {
      throw new ProviderError(
        "voyage",
        `rerank: ${documents.length} documents exceeds the ${MAX_BATCH} per-call limit. Batch from the caller.`,
      );
    }

    const body: Record<string, unknown> = {
      model: this.cfg.model,
      query,
      documents,
      truncation: true,
    };
    if (opts.topK != null && opts.topK > 0) body.top_k = opts.topK;

    const res = await fetchWithTimeout(
      `${this.cfg.baseUrl}/rerank`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      this.cfg.timeoutMs,
    );
    const json = (await res.json().catch(() => ({}))) as VoyageRerankResponse;
    if (!res.ok || json.error || json.detail) {
      throw new ProviderError(
        "voyage",
        `rerank ${res.status}: ${json.error ?? json.detail ?? res.statusText}`,
      );
    }
    const data = json.data ?? [];
    return data
      .map((d) => ({ index: d.index, relevanceScore: d.relevance_score }))
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }
}

/**
 * No-op reranker. Returns the input order unchanged with a flat score of 0.
 * Used when RERANK_PROVIDER is unset or the API key is missing — the
 * orchestrator still composes cleanly; only the precision boost is missing.
 */
export class NoopRerankProvider implements RerankProvider {
  readonly name = "noop" as const;
  async ping(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: "noop reranker — pass-through" };
  }
  async rerank(
    _query: string,
    documents: string[],
    opts: { topK?: number } = {},
  ): Promise<RerankHit[]> {
    const limit =
      opts.topK != null && opts.topK > 0
        ? Math.min(opts.topK, documents.length)
        : documents.length;
    const out: RerankHit[] = [];
    for (let i = 0; i < limit; i++) out.push({ index: i, relevanceScore: 0 });
    return out;
  }
}
