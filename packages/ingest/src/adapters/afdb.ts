// source: https://www.afdb.org/en/projects-and-operations/procurement/notices
//
// African Development Bank procurement notices. The landing page is
// JS-rendered (returns empty payload to plain HTTP). Render with
// Playwright, then extract notice anchors. AfDB notice URLs include
// /procurement/notices/ in the path.

import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { IngestAdapter } from "../types.ts";
import { decodeEntities, stripTags } from "../util/html-scrape.ts";
import { fetchRendered } from "../util/playwright-render.ts";

const LIST_URL = "https://www.afdb.org/en/projects-and-operations/procurement/notices";

export const afdbAdapter: IngestAdapter = {
  source: "afdb",
  label: "African Development Bank",
  requiredEnv: [],
  async fetchPage({ sinceIso }) {
    const sinceMs = new Date(sinceIso).getTime();
    let html: string;
    try {
      // AfDB sits behind a Cloudflare bot challenge. Playwright's real
      // Chromium session passes it most of the time, but we need to
      // wait for the challenge JS to resolve before extracting links.
      // domcontentloaded fires too early (during the CF interstitial);
      // load + an extra selector wait is the reliable combo.
      html = await fetchRendered(LIST_URL, {
        waitUntil: "load",
        waitForSelector: "a[href*='/procurement']",
        timeoutMs: 60_000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[afdb] render failed: ${msg}`);
      return { tenders: [], nextPageToken: null };
    }

    const items = parseAfdb(html);
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
          source: "afdb",
          title: item.title,
          description: [item.country, item.sector, item.type].filter(Boolean).join("\n\n"),
          url: item.detailUrl,
          buyer: "AfDB",
          country: null, // AfDB country names vary; let the matcher reason from title text
          sector: item.sector || null,
          cpvCodes: [],
          budgetMinUsd: null,
          budgetMaxUsd: null,
          currency: null,
          publishedAt: item.publishedAt ?? new Date(),
          deadlineAt: item.deadlineAt,
          language: "en",
          raw: item,
        };
        tenders.push(NormalizedTenderSchema.parse(tender) as NormalizedTender);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[afdb] skipped item: ${msg}`);
      }
    }
    return { tenders, nextPageToken: null };
  },
};

interface AfdbItem {
  id: string;
  detailUrl: string;
  title: string;
  country: string;
  sector: string;
  type: string;
  publishedAt: Date | null;
  deadlineAt: Date | null;
}

function parseAfdb(html: string): AfdbItem[] {
  const out: AfdbItem[] = [];
  // Match anchors deep enough to be notice detail pages, not nav links.
  // AfDB notice paths contain "procurement" and one of the notice
  // verticals: "specific-procurement-notices", "general-procurement-notices",
  // "expressions-of-interest".
  const anchorRe =
    /<a\b[^>]*href="([^"]*\/procurement\/[^"]*\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const hrefRaw = m[1]!;
    const titleHtml = m[2]!;
    const title = decodeEntities(stripTags(titleHtml).trim());
    if (!title || title.length < 8) continue;
    // Drop nav links that share the path but are short navigation labels.
    if (/^(Procurement|Notices|Operations|Projects)$/i.test(title)) continue;
    if (seen.has(hrefRaw)) continue;
    seen.add(hrefRaw);

    const detailUrl = hrefRaw.startsWith("http")
      ? hrefRaw
      : `https://www.afdb.org${hrefRaw.startsWith("/") ? "" : "/"}${hrefRaw}`;
    const id = detailUrl;

    const start = m.index + m[0]!.length;
    const window = html.slice(start, start + 2000);
    const country = pickField(window, [/Country[^<]*<[^>]*>\s*([^<]+)/i]) ?? "";
    const sector = pickField(window, [/Sector[^<]*<[^>]*>\s*([^<]+)/i]) ?? "";
    const type = pickField(window, [/Type[^<]*<[^>]*>\s*([^<]+)/i, /Notice Type[^<]*<[^>]*>\s*([^<]+)/i]) ?? "";
    const publishedAt = parseAfdbDate(
      pickField(window, [/Publi(?:cation|shed)[^<]*<[^>]*>\s*([^<]+)/i, /Date[^<]*<[^>]*>\s*([^<]+)/i]),
    );
    const deadlineAt = parseAfdbDate(
      pickField(window, [/Deadline[^<]*<[^>]*>\s*([^<]+)/i, /Closing[^<]*<[^>]*>\s*([^<]+)/i]),
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

/** AfDB dates render as "12-Aug-2026" or "12 August 2026" or ISO. */
function parseAfdbDate(raw: string | null): Date | null {
  if (!raw) return null;
  // Try ISO first.
  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) return iso;
  const m = /(\d{1,2})[-\s]([A-Za-z]+)[-\s](\d{4})/.exec(raw);
  if (!m) return null;
  const day = Number.parseInt(m[1]!, 10);
  const monthName = m[2]!.toLowerCase().slice(0, 3);
  const year = Number.parseInt(m[3]!, 10);
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const month = months[monthName];
  if (month === undefined) return null;
  return new Date(Date.UTC(year, month, day));
}
