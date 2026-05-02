/**
 * In-memory LRU cache for embeddings, keyed by sha256(model:text).
 *
 * Why: local embedders are CPU-bound and re-running the same flatten+embed
 * for every match-runner pass is wasteful. The match worker re-embeds
 * unchanged tenders each cron tick because we don't yet persist a content
 * hash. This is a no-op for cloud embedders too — saving network round-trips.
 *
 * Bounded so the worker doesn't OOM if it sees a million tenders. Eviction
 * is "delete the oldest insertion" — Map preserves insertion order in JS.
 */

import { createHash } from "node:crypto";

const DEFAULT_MAX_ENTRIES = 4096;

export class EmbeddingCache {
  private readonly cache = new Map<string, number[]>();
  constructor(private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {}

  private key(model: string, text: string): string {
    return createHash("sha256").update(`${model}${text}`).digest("hex");
  }

  get(model: string, text: string): number[] | null {
    const k = this.key(model, text);
    const v = this.cache.get(k);
    if (!v) return null;
    // refresh LRU position
    this.cache.delete(k);
    this.cache.set(k, v);
    return v;
  }

  set(model: string, text: string, vec: number[]): void {
    const k = this.key(model, text);
    if (this.cache.has(k)) this.cache.delete(k);
    this.cache.set(k, vec);
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  size(): number {
    return this.cache.size;
  }
}

export const embeddingCache = new EmbeddingCache();
