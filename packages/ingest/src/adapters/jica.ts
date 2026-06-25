// source: https://www.jica.go.jp/english/announce/info/index.html
//
// Japan International Cooperation Agency procurement notices. The
// listing is mostly server-rendered HTML but uses some JS for filters.
// We render with Playwright defensively to handle both cases.
//
// JICA notice anchors are typically /english/announce/info/2026/<slug>.

import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { IngestAdapter } from "../types.ts";
import { decodeEntities, stripTags } from "../util/html-scrape.ts";
import { fetchRendered } from "../util/playwright-render.ts";

const LIST_URL = "https://www.jica.go.jp/english/announce/info/index.html";

export const jicaAdapter: IngestAdapter = {
  source: "jica",
  label: "Japan International Cooperation Agency",
  requiredEnv: [],
  async fetchPage({ sinceIso }) {
    const sinceMs = new Date(sinceIso).getTime();
    let html: string;
    try {
      html = await fetchRendered(LIST_URL, {
        waitUntil: "domcontentloaded",
        timeoutMs: 30_000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[jica] render failed: ${msg}`);
      return { tenders: [], nextPageToken: null };
    }

    const items = parseJica(html);
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
          source: "jica",
          title: item.title,
          description: item.category || item.title,
          url: item.detailUrl,
          buyer: "JICA",
          country: "JP",
          sector: item.category || null,
          cpvCodes: [],
          budgetMinUsd: null,
          budgetMaxUsd: null,
          currency: null,
          publishedAt: item.publishedAt ?? new Date(),
          deadlineAt: null,
          language: "en",
          raw: item,
        };
        tenders.push(NormalizedTenderSchema.parse(tender) as NormalizedTender);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[jica] skipped item: ${msg}`);
      }
    }
    return { tenders, nextPageToken: null };
  },
};

interface JicaItem {
  id: string;
  detailUrl: string;
  title: string;
  category: string;
  publishedAt: Date | null;
}

function parseJica(html: string): JicaItem[] {
  const out: JicaItem[] = [];
  const anchorRe =
    /<a\b[^>]*href="([^"]*\/english\/announce\/info\/[^"]+\.html?)"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const hrefRaw = m[1]!;
    const titleHtml = m[2]!;
    const title = decodeEntities(stripTags(titleHtml).trim());
    if (!title || title.length < 8) continue;
    if (/^(Notices?|Announcements?|Procurement|Read more|Top)$/i.test(title)) continue;
    if (seen.has(hrefRaw)) continue;
    seen.add(hrefRaw);

    const detailUrl = hrefRaw.startsWith("http")
      ? hrefRaw
      : `https://www.jica.go.jp${hrefRaw.startsWith("/") ? "" : "/"}${hrefRaw}`;

    // JICA cards often have a leading <span> with a date (YYYY/MM/DD).
    const start = Math.max(0, m.index - 500);
    const window = html.slice(start, m.index);
    const dateM = /(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/.exec(window);
    const publishedAt = dateM
      ? new Date(
          Date.UTC(
            Number(dateM[1]),
            Number(dateM[2]) - 1,
            Number(dateM[3]),
          ),
        )
      : null;
    const categoryM = /\[([^\]]{2,40})\]/.exec(window);
    const category = categoryM ? categoryM[1]!.trim() : "";

    out.push({ id: detailUrl, detailUrl, title, category, publishedAt });
  }
  return out;
}
