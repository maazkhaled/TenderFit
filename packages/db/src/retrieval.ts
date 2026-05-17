/**
 * BM25-style text retrieval over the Tender table.
 *
 * Why this lives in @beta/db: it's a thin wrapper over a raw SQL query against
 * the `fts_doc` tsvector column (added in migration 005). Keeping it next to
 * `findNearestTenders` (the dense-vector counterpart) makes the hybrid
 * orchestrator in @beta/llm a true composition of two retrievers.
 *
 * Ranking: `ts_rank_cd` with normalization=32 → rank/(rank+1), giving bounded
 * scores in [0,1). Closer to BM25's behaviour than the un-normalized default,
 * and lets us compare scores across queries without re-tuning.
 *
 * Query strategy: callers pass a free-text string built from the profile
 * (services, tech stack, certifications, industries). We use
 * `websearch_to_tsquery` so the string can contain ordinary words, quoted
 * phrases, and OR — it's the most forgiving tsquery builder Postgres ships.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "./index";

export interface TextSearchHit {
  id: string;
  rank: number;
}

/**
 * Run a Postgres websearch_to_tsquery against `Tender.fts_doc` and return the
 * top `limit` rows ordered by ts_rank_cd descending. Returns [] when the query
 * is empty or matches nothing.
 *
 * The caller is responsible for filtering to non-expired tenders downstream
 * (this function returns plain id+rank pairs by design so it composes with the
 * existing dense-retrieval flow).
 */
export async function findTendersByText(
  query: string,
  limit: number,
): Promise<TextSearchHit[]> {
  const trimmed = (query ?? "").trim();
  if (trimmed.length === 0 || limit <= 0) return [];

  // websearch_to_tsquery is null-safe with empty strings but we guard above for
  // clarity. Normalization 32 → rank / (rank + 1), bounding the result in [0,1).
  const rows = await prisma.$queryRaw<{ id: string; rank: number }[]>(
    Prisma.sql`SELECT id, ts_rank_cd(fts_doc, websearch_to_tsquery('simple', ${trimmed}), 32) AS rank
      FROM "Tender"
      WHERE fts_doc @@ websearch_to_tsquery('simple', ${trimmed})
      ORDER BY rank DESC, "publishedAt" DESC
      LIMIT ${limit}`,
  );
  return rows.map((r) => ({ id: r.id, rank: Number(r.rank) }));
}

/**
 * Convenience helper that builds a websearch_to_tsquery-friendly string from
 * a list of keyword terms — quotes multi-word phrases so they match as a unit.
 * Empty terms are dropped. Returns "" when nothing usable remains.
 */
export function buildTextQuery(terms: Array<string | null | undefined>): string {
  const cleaned = (terms ?? [])
    .map((t) => (t ?? "").trim())
    .filter((t) => t.length > 0)
    // Deduplicate case-insensitively while preserving the first occurrence's casing.
    .filter(
      (t, i, arr) => arr.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i,
    );
  if (cleaned.length === 0) return "";
  return cleaned
    .map((t) => (t.includes(" ") ? `"${t.replace(/"/g, "")}"` : t))
    .join(" OR ");
}
