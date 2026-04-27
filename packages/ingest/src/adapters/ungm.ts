// source: https://www.ungm.org/Public/Notice (UNGM public notices, RSS feed)
import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { IngestAdapter } from "../types";
import { httpJson as defaultHttpJson } from "../util/http";
import { parseRss } from "../util/rss";

const ENDPOINT = "https://www.ungm.org/Public/Notice?rss=1";

export const ungmAdapter: IngestAdapter = {
  source: "ungm",
  label: "UN Global Marketplace",
  requiredEnv: [],
  async fetchPage({ sinceIso, httpJson = defaultHttpJson }) {
    const xml = await httpJson<string>(ENDPOINT, { asText: true });
    const items = parseRss(xml);
    const sinceMs = new Date(sinceIso).getTime();

    const tenders: NormalizedTender[] = [];
    for (const item of items) {
      try {
        const publishedAt = item.pubDate ? new Date(item.pubDate) : new Date();
        if (Number.isFinite(sinceMs) && publishedAt.getTime() < sinceMs) continue;

        const externalId = item.guid ?? item.link;
        if (!externalId) continue;

        const tender = {
          externalId,
          source: "ungm" as const,
          title: item.title,
          description: stripHtml(item.description),
          url: item.link,
          buyer: "UN Agency",
          country: null,
          sector: null,
          cpvCodes: [],
          budgetMinUsd: null,
          budgetMaxUsd: null,
          currency: null,
          publishedAt,
          deadlineAt: null,
          language: "en",
          raw: item.raw,
        };
        tenders.push(NormalizedTenderSchema.parse(tender) as NormalizedTender);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[ungm] skipped item: ${msg}`);
      }
    }

    return { tenders, nextPageToken: null };
  },
};

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
