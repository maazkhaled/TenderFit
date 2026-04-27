import type { IngestRunSummary } from "@beta/shared";
import type { IngestAdapter, RunAdapterOpts } from "./types";

const DEFAULT_MAX_PAGES = 5;

export async function runAdapter(
  adapter: IngestAdapter,
  opts: RunAdapterOpts,
): Promise<IngestRunSummary> {
  const startedAt = new Date();
  const summary: IngestRunSummary = {
    source: adapter.source,
    fetched: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    startedAt,
    finishedAt: startedAt,
  };

  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  let pageToken: string | undefined;

  for (const envVar of adapter.requiredEnv) {
    if (!process.env[envVar]) {
      summary.errors.push(`missing required env: ${envVar}`);
      summary.finishedAt = new Date();
      return summary;
    }
  }

  for (let page = 0; page < maxPages; page++) {
    try {
      const result = await adapter.fetchPage({
        sinceIso: opts.sinceIso,
        pageToken,
        httpJson: opts.httpJson,
      });
      summary.fetched += result.tenders.length;

      if (result.tenders.length > 0) {
        try {
          const batch = await opts.onBatch(result.tenders);
          summary.inserted += batch.inserted;
          summary.updated += batch.updated;
          summary.skipped += batch.skipped;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          summary.errors.push(`onBatch page ${page}: ${msg}`);
          console.error(`[ingest:${adapter.source}] onBatch error on page ${page}: ${msg}`);
        }
      }

      if (!result.nextPageToken) break;
      pageToken = result.nextPageToken;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push(`fetchPage ${page}: ${msg}`);
      console.error(`[ingest:${adapter.source}] fetchPage error on page ${page}: ${msg}`);
      break;
    }
  }

  summary.finishedAt = new Date();
  return summary;
}
