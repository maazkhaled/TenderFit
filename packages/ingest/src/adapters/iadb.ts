// source: https://www.iadb.org/en/projects/procurement-notices
//
// Inter-American Development Bank (Latin America focus). Procurement
// notices page is JS-rendered. Anchors to detail pages look like
// /en/project/<PROJECT_ID>/notice/<NOTICE_ID> or
// /en/projects/<PROJECT_ID>.

import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { IngestAdapter } from "../types.ts";
import { decodeEntities, stripTags } from "../util/html-scrape.ts";
import { fetchRendered } from "../util/playwright-render.ts";

const LIST_URL = "https://www.iadb.org/en/projects/procurement-notices";

export const iadbAdapter: IngestAdapter = {
  source: "iadb",
  label: "Inter-American Development Bank",
  requiredEnv: [],
  async fetchPage({ sinceIso }) {
    const sinceMs = new Date(sinceIso).getTime();
    let html: string;
    try {
      html = await fetchRendered(LIST_URL, {
        waitUntil: "networkidle",
        waitForSelector: "a[href*='/project/'], a[href*='/projects/']",
        timeoutMs: 45_000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[iadb] render failed: ${msg}`);
      return { tenders: [], nextPageToken: null };
    }

    const items = parseIadb(html);
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
          source: "iadb",
          title: item.title,
          description: [item.country, item.sector, item.type].filter(Boolean).join("\n\n"),
          url: item.detailUrl,
          buyer: "IADB",
          country: null,
          sector: item.sector || null,
          cpvCodes: [],
          budgetMinUsd: null,
          budgetMaxUsd: null,
          currency: "USD",
          publishedAt: item.publishedAt ?? new Date(),
          deadlineAt: item.deadlineAt,
          language: "en",
          raw: item,
        };
        tenders.push(NormalizedTenderSchema.parse(tender) as NormalizedTender);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[iadb] skipped item: ${msg}`);
      }
    }
    return { tenders, nextPageToken: null };
  },
};

interface IadbItem {
  id: string;
  detailUrl: string;
  title: string;
  country: string;
  sector: string;
  type: string;
  publishedAt: Date | null;
  deadlineAt: Date | null;
}

function parseIadb(html: string): IadbItem[] {
  const out: IadbItem[] = [];
  // Match project / project-notice anchors but skip the generic nav links.
  const anchorRe =
    /<a\b[^>]*href="([^"]*\/(?:project|projects)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const hrefRaw = m[1]!;
    const titleHtml = m[2]!;
    const title = decodeEntities(stripTags(titleHtml).trim());
    if (!title || title.length < 8) continue;
    if (/^(Projects?|Procurement|See more|Read more)$/i.test(title)) continue;

    const detailUrl = hrefRaw.startsWith("http")
      ? hrefRaw
      : `https://www.iadb.org${hrefRaw.startsWith("/") ? "" : "/"}${hrefRaw}`;
    const idM = /\/project[s]?\/([A-Z0-9-]+)/i.exec(detailUrl);
    const id = idM ? idM[1]! : detailUrl;
    if (seen.has(id)) continue;
    seen.add(id);

    const start = m.index + m[0]!.length;
    const window = html.slice(start, start + 2000);
    const country = pickField(window, [/Country[^<]*<[^>]*>\s*([^<]+)/i]) ?? "";
    const sector = pickField(window, [/Sector[^<]*<[^>]*>\s*([^<]+)/i]) ?? "";
    const type = pickField(window, [/(?:Notice|Project)\s+Type[^<]*<[^>]*>\s*([^<]+)/i]) ?? "";
    const publishedAt = parseIsoOrShort(
      pickField(window, [
        /(?:Posted|Published|Date)[^<]*<[^>]*>\s*([^<]+)/i,
      ]),
    );
    const deadlineAt = parseIsoOrShort(
      pickField(window, [/(?:Deadline|Closing)[^<]*<[^>]*>\s*([^<]+)/i]),
    );

    out.push({ id, detailUrl, title, country, sector, type, publishedAt, deadlineAt });
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

function parseIsoOrShort(raw: string | null): Date | null {
  if (!raw) return null;
  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) return iso;
  const m = /(\d{1,2})[-/\s]([A-Za-z]{3,}|\d{1,2})[-/\s](\d{4})/.exec(raw);
  if (!m) return null;
  const day = Number.parseInt(m[1]!, 10);
  const yr = Number.parseInt(m[3]!, 10);
  const monthRaw = m[2]!;
  const monthNum = /^\d+$/.test(monthRaw)
    ? Number.parseInt(monthRaw, 10) - 1
    : monthFromName(monthRaw);
  if (monthNum < 0 || monthNum > 11) return null;
  return new Date(Date.UTC(yr, monthNum, day));
}

function monthFromName(name: string): number {
  const k = name.toLowerCase().slice(0, 3);
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  return months[k] ?? -1;
}
