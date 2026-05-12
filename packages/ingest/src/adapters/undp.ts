import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { IngestAdapter } from "../types.ts";
import { decodeEntities, stripTags } from "../util/html-scrape.ts";
import { httpJson as defaultHttpJson } from "../util/http.ts";
import { parseRss, type RssItem } from "../util/rss.ts";

const RSS_URL = "https://procurement-notices.undp.org/rss_feeds/rss.xml";
const RSS_LIMIT = 100;

export const undpAdapter: IngestAdapter = {
  source: "undp",
  label: "UNDP Procurement Notices",
  requiredEnv: [],
  async fetchPage({ sinceIso, httpJson = defaultHttpJson }) {
    const xml = await httpJson<string>(RSS_URL, {
      asText: true,
      headers: { Accept: "application/rss+xml, application/rdf+xml, application/xml, text/xml" },
    });
    const sinceMs = new Date(sinceIso).getTime();
    const tenders: NormalizedTender[] = [];

    for (const item of parseUndpRss(xml).slice(0, RSS_LIMIT)) {
      try {
        if (!item.title || !item.link) continue;
        const publishedAt = item.pubDate ? new Date(item.pubDate) : new Date();
        if (Number.isFinite(sinceMs) && publishedAt.getTime() < sinceMs) continue;
        const externalId = item.guid ?? item.link;
        const tender: NormalizedTender = {
          externalId,
          source: "undp",
          title: item.title,
          description: stripTags(item.description) || item.title,
          url: item.link,
          buyer: "UNDP",
          country: null,
          sector: "UNDP Procurement Notice",
          cpvCodes: [],
          budgetMinUsd: null,
          budgetMaxUsd: null,
          currency: null,
          publishedAt,
          deadlineAt: null,
          language: "en",
          raw: { sourceFeed: RSS_URL, item: item.raw },
        };
        tenders.push(NormalizedTenderSchema.parse(tender) as NormalizedTender);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[undp] skipped RSS item: ${msg}`);
      }
    }

    return { tenders, nextPageToken: null };
  },
};

function parseUndpRss(xml: string): RssItem[] {
  const parsed = parseRss(xml);
  if (parsed.length > 0) return parsed;

  // UNDP documents these feeds as RSS 1.0/RDF, while the shared parser covers
  // RSS 2.0/Atom. Keep RDF handling scoped to this adapter.
  const out: RssItem[] = [];
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const raw = m[0]!;
    const title = tagText(raw, "title");
    const link = tagText(raw, "link");
    if (!title || !link) continue;
    out.push({
      title,
      link,
      description: tagText(raw, "description") ?? "",
      pubDate: tagText(raw, "dc:date") ?? tagText(raw, "pubDate"),
      guid: attrText(raw, "rdf:about") ?? link,
      raw,
    });
  }
  return out;
}

function tagText(xml: string, tag: string): string | null {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i").exec(xml);
  if (!m) return null;
  return decodeEntities(stripTags(m[1]!).trim()) || null;
}

function attrText(xml: string, attr: string): string | null {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`${escaped}=["']([^"']+)["']`, "i").exec(xml);
  return m ? decodeEntities(m[1]!.trim()) : null;
}
