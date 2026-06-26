// source: https://canadabuys.canada.ca/en/tender-opportunities
//
// CanadaBuys (Federal Canadian procurement). The Drupal frontend
// serves a 403 to direct HTTP clients regardless of User-Agent — they
// require a real browser session. Switched from the open-data CSV
// (also 403 to non-browser clients) to Playwright-rendered listing
// scrape after the first deploy proved the CSV approach unreachable.
//
// We parse the listing page after Drupal hydrates the tender cards.
// Each card is an anchor to /en/tender-opportunities/tender-notice/<ID>.

import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { IngestAdapter } from "../types.ts";
import { decodeEntities, stripTags } from "../util/html-scrape.ts";
import { fetchRendered } from "../util/playwright-render.ts";

const LIST_URL = "https://canadabuys.canada.ca/en/tender-opportunities";

export const canadaBuysAdapter: IngestAdapter = {
  source: "canada_buys",
  label: "CanadaBuys (Federal Canada)",
  requiredEnv: [],
  async fetchPage({ sinceIso }) {
    const sinceMs = new Date(sinceIso).getTime();
    let html: string;
    try {
      html = await fetchRendered(LIST_URL, {
        waitUntil: "domcontentloaded",
        waitForSelector: "a[href*='/tender-notice/']",
        timeoutMs: 45_000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[canada_buys] render failed: ${msg}`);
      return { tenders: [], nextPageToken: null };
    }

    const items = parseCanadaBuys(html);
    const tenders: NormalizedTender[] = [];
    for (const item of items) {
      try {
        if (
          Number.isFinite(sinceMs) &&
          item.publishedAt &&
          item.publishedAt.getTime() < sinceMs
        ) {
          continue;
        }
        const tender: NormalizedTender = {
          externalId: item.id,
          source: "canada_buys",
          title: item.title,
          description: [item.buyer, item.noticeType].filter(Boolean).join("\n\n"),
          url: item.detailUrl,
          buyer: item.buyer || "Government of Canada",
          country: "CA",
          sector: item.noticeType || null,
          cpvCodes: [],
          budgetMinUsd: null,
          budgetMaxUsd: null,
          currency: "CAD",
          publishedAt: item.publishedAt ?? new Date(),
          deadlineAt: item.closingAt,
          language: "en",
          raw: item,
        };
        tenders.push(NormalizedTenderSchema.parse(tender) as NormalizedTender);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[canada_buys] skipped item: ${msg}`);
      }
    }
    return { tenders, nextPageToken: null };
  },
};

interface CbItem {
  id: string;
  detailUrl: string;
  title: string;
  buyer: string;
  noticeType: string;
  publishedAt: Date | null;
  closingAt: Date | null;
}

function parseCanadaBuys(html: string): CbItem[] {
  const out: CbItem[] = [];
  const anchorRe =
    /<a\b[^>]*href="([^"]*\/tender-notice\/([^"\/?#]+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const hrefRaw = m[1]!;
    const id = m[2]!;
    const titleHtml = m[3]!;
    const title = decodeEntities(stripTags(titleHtml).trim());
    if (!title || title.length < 5) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    const detailUrl = hrefRaw.startsWith("http")
      ? hrefRaw
      : `https://canadabuys.canada.ca${hrefRaw.startsWith("/") ? "" : "/"}${hrefRaw}`;

    const start = m.index + m[0]!.length;
    const window = html.slice(start, start + 2000);
    const buyer =
      pickField(window, [
        /(?:Buyer|Procurement entity|Entity)[^<]*<[^>]*>\s*([^<]+)/i,
      ]) ?? "";
    const noticeType =
      pickField(window, [/Notice Type[^<]*<[^>]*>\s*([^<]+)/i]) ?? "";
    const publishedAt = parseCbDate(
      pickField(window, [
        /(?:Publication|Published) Date[^<]*<[^>]*>\s*([^<]+)/i,
      ]),
    );
    const closingAt = parseCbDate(
      pickField(window, [/Closing(?: Date)?[^<]*<[^>]*>\s*([^<]+)/i]),
    );

    out.push({ id, detailUrl, title, buyer, noticeType, publishedAt, closingAt });
  }
  return out;
}

function pickField(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && m[1]) {
      const cleaned = decodeEntities(stripTags(m[1]).trim());
      if (cleaned) return cleaned;
    }
  }
  return null;
}

function parseCbDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

