/**
 * Voyage AI embeddings (cloud).
 *
 * Kept around so a deployment can flip EMBEDDING_PROVIDER=voyage and pay for
 * better-quality vectors than local models without code changes.
 */

import type { EmbeddingProvider } from "./types";
import { ProviderError } from "./types";
import { fetchWithTimeout, type EmbeddingProviderConfig } from "./config";

interface VoyageResponse {
  data?: Array<{ index: number; embedding: number[] }>;
  detail?: string;
  error?: string;
}

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly name = "voyage" as const;
  readonly dim: number;
  constructor(private readonly cfg: EmbeddingProviderConfig) {
    this.dim = cfg.dim;
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    if (!this.cfg.apiKey) {
      return { ok: false, detail: "VOYAGE_API_KEY not set" };
    }
    return { ok: true, detail: "API key present (no liveness endpoint)" };
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (!this.cfg.apiKey) {
      throw new ProviderError("voyage", "VOYAGE_API_KEY is not set");
    }
    const res = await fetchWithTimeout(
      `${this.cfg.baseUrl}/embeddings`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: this.cfg.model,
          input: texts,
          input_type: "document",
          output_dimension: this.dim,
        }),
      },
      this.cfg.timeoutMs,
    );
    const json = (await res.json().catch(() => ({}))) as VoyageResponse;
    if (!res.ok || json.error || json.detail) {
      throw new ProviderError(
        "voyage",
        `embed ${res.status}: ${json.error ?? json.detail ?? res.statusText}`,
      );
    }
    const data = json.data ?? [];
    if (data.length !== texts.length) {
      throw new ProviderError(
        "voyage",
        `embed: expected ${texts.length} vectors, got ${data.length}`,
      );
    }
    const sorted = [...data].sort((a, b) => a.index - b.index);
    const vectors = sorted.map((d) => d.embedding);
    for (const v of vectors) {
      if (!Array.isArray(v) || v.length !== this.dim) {
        throw new ProviderError(
          "voyage",
          `embed: vector dim ${v?.length} != EMBEDDING_DIM ${this.dim}`,
        );
      }
    }
    return vectors;
  }
}
