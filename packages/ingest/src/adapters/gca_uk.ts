// source: https://www.gca.gov.uk/agreements
//
// GCA = Government Commercial Agency (UK), the rebranded Crown
// Commercial Service as of April 2026. The agreements listing is
// effectively a UK framework agreement catalogue: each entry is a
// long-running multi-year procurement vehicle (Cyber Security 3, AI
// framework, Cloud Compute 2, etc.) rather than a single tender.
// Still highly valuable for IT/consulting because each framework
// describes the kind of suppliers being onboarded.
//
// The list page is JS-rendered (pagination is JS-driven), so we use
// Playwright. Anchor pattern is /agreements/<RM-NUMBER>; each card
// surfaces start/end dates, regulation, agreement ID, and a short
// description.

import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { IngestAdapter } from "../types.ts";
import { decodeEntities, stripTags } from "../util/html-scrape.ts";
import { fetchRendered } from "../util/playwright-render.ts";

const LIST_URL = "https://www.gca.gov.uk/agreements";

export const gcaUkAdapter: IngestAdapter = {
  source: "gca_uk",
  label: "UK Government Commercial Agency (frameworks)",
  requiredEnv: [],
  async fetchPage({ sinceIso }) {
    const sinceMs = new Date(sinceIso).getTime();
    let html: string;
    try {
      html = await fetchRendered(LIST_URL, {
        waitUntil: "networkidle",
        waitForSelector: "a[href*='/agreements/RM']",
        timeoutMs: 30_000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[gca_uk] render failed: ${msg}`);
      return { tenders: [], nextPageToken: null };
    }

    const items = parseGca(html);
    const tenders: NormalizedTender[] = [];
    for (const item of items) {
      try {
        if (
          Number.isFinite(sinceMs) &&
          item.startAt &&
          item.startAt.getTime() < sinceMs
        ) {
          // For frameworks we filter on start-date (when the agreement
          // went live) since "published" doesn't really apply.
          continue;
        }
        const tender: NormalizedTender = {
          externalId: item.rmNumber,
          source: "gca_uk",
          title: item.title,
          description: [item.description, item.regulation]
            .filter(Boolean)
            .join("\n\n"),
          url: item.detailUrl,
          buyer: "UK Government (GCA)",
          country: "GB",
          sector: item.regulation || null,
          cpvCodes: [],
          budgetMinUsd: null,
          budgetMaxUsd: null,
          currency: "GBP",
          publishedAt: item.startAt ?? new Date(),
          deadlineAt: item.endAt,
          language: "en",
          raw: item,
        };
        tenders.push(NormalizedTenderSchema.parse(tender) as NormalizedTender);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[gca_uk] skipped item: ${msg}`);
      }
    }
    return { tenders, nextPageToken: null };
  },
};

interface GcaItem {
  rmNumber: string;
  detailUrl: string;
  title: string;
  description: string;
  regulation: string;
  startAt: Date | null;
  endAt: Date | null;
}

function parseGca(html: string): GcaItem[] {
  const out: GcaItem[] = [];
  const anchorRe =
    /<a\b[^>]*href="([^"]*\/agreements\/(RM[\w.-]+))"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const hrefRaw = m[1]!;
    const rmNumber = m[2]!;
    const titleHtml = m[3]!;
    const title = decodeEntities(stripTags(titleHtml).trim());
    if (!title || title.length < 3) continue;
    if (seen.has(rmNumber)) continue;
    seen.add(rmNumber);

    const detailUrl = hrefRaw.startsWith("http")
      ? hrefRaw
      : `https://www.gca.gov.uk${hrefRaw.startsWith("/") ? "" : "/"}${hrefRaw}`;

    // Walk surrounding context for start/end dates, regulation,
    // description. GCA cards are pretty consistent — "Start Date:",
    // "End Date:", "Regulation:" labels appear in order.
    const start = m.index + m[0]!.length;
    const window = html.slice(start, start + 3000);
    const startAt = parseUkDate(
      pickField(window, [/Start Date[^<]*<[^>]*>\s*([^<]+)/i]),
    );
    const endAt = parseUkDate(
      pickField(window, [/End Date[^<]*<[^>]*>\s*([^<]+)/i]),
    );
    const regulation =
      pickField(window, [/Regulation[^<]*<[^>]*>\s*([^<]+)/i]) ?? "";
    // Description is usually a stretch of plain text in a <p> tag
    // before the next agreement card. Take up to 600 chars.
    const descM = /<p[^>]*>([\s\S]{20,600}?)<\/p>/i.exec(window);
    const description = descM
      ? decodeEntities(stripTags(descM[1]!).trim()).slice(0, 600)
      : "";

    out.push({
      rmNumber,
      detailUrl,
      title,
      description,
      regulation,
      startAt,
      endAt,
    });
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

/** GCA dates: "DD/MM/YYYY". */
function parseUkDate(raw: string | null): Date | null {
  if (!raw) return null;
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw);
  if (!m) return null;
  const d = new Date(
    Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}
