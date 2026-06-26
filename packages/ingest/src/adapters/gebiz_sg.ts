// source: https://www.gebiz.gov.sg/ptn/opportunity/BOListing.xhtml
//
// GeBIZ (Government Electronic Business, Singapore) — pure
// JSF/PrimeFaces SPA. The listing is rendered after a series of XHR
// calls; raw HTTP returns only spinner placeholders. Use Playwright
// to fetch the rendered DOM, then extract the opportunity cards.
//
// Defensive parsing: GeBIZ refreshes its template every year or so.
// We match on anchor URL substring (BODetail.xhtml?...) which is
// stable, then walk surrounding text for title / closing date.

import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { IngestAdapter } from "../types.ts";
import { decodeEntities, stripTags } from "../util/html-scrape.ts";
import { fetchRendered } from "../util/playwright-render.ts";

const LIST_URL = "https://www.gebiz.gov.sg/ptn/opportunity/BOListing.xhtml";

export const gebizSgAdapter: IngestAdapter = {
  source: "gebiz_sg",
  label: "GeBIZ Singapore",
  requiredEnv: [],
  async fetchPage({ sinceIso }) {
    const sinceMs = new Date(sinceIso).getTime();
    let html: string;
    try {
      // GeBIZ is JSF/PrimeFaces; the listing renders after a series of
      // XHR loads. We wait for any link to a notice/opportunity detail
      // page rather than a specific filename — JSF's URL scheme has
      // varied across upgrades (BODetail / OPNotice / opportunity).
      // domcontentloaded is enough because the search is wrapped in a
      // PrimeFaces partial-update; networkidle never fires.
      html = await fetchRendered(LIST_URL, {
        waitUntil: "domcontentloaded",
        waitForSelector:
          "a[href*='Detail.xhtml'], a[href*='Notice.xhtml'], a[href*='opportunity']",
        timeoutMs: 60_000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[gebiz_sg] render failed: ${msg}`);
      return { tenders: [], nextPageToken: null };
    }

    const items = parseGebiz(html);
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
          source: "gebiz_sg",
          title: item.title,
          description: [item.agency, item.type].filter(Boolean).join("\n\n"),
          url: item.detailUrl,
          buyer: item.agency || "Singapore Government",
          country: "SG",
          sector: item.type || null,
          cpvCodes: [],
          budgetMinUsd: null,
          budgetMaxUsd: null,
          currency: "SGD",
          publishedAt: item.publishedAt ?? new Date(),
          deadlineAt: item.closingAt,
          language: "en",
          raw: item,
        };
        tenders.push(NormalizedTenderSchema.parse(tender) as NormalizedTender);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[gebiz_sg] skipped item: ${msg}`);
      }
    }
    return { tenders, nextPageToken: null };
  },
};

interface GebizItem {
  id: string;
  detailUrl: string;
  title: string;
  agency: string;
  type: string;
  publishedAt: Date | null;
  closingAt: Date | null;
}

function parseGebiz(html: string): GebizItem[] {
  const out: GebizItem[] = [];
  // GeBIZ uses anchors like `BODetail.xhtml?...&itemId=NNNN` or similar
  // PrimeFaces faces links. Accept any detail-page URL pattern.
  // Loosened to match the broader set of opportunity-detail URL shapes
  // GeBIZ has shipped over the years: BODetail, OpportunityDetail,
  // NoticeDetail, generic ?opportunityId=... links.
  const anchorRe =
    /<a\b[^>]*href="([^"]*(?:BODetail|OpportunityDetail|NoticeDetail|Detail|opportunity)[^"]*(?:\.xhtml|opportunityId=)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const hrefRaw = m[1]!;
    const titleHtml = m[2]!;
    const title = decodeEntities(stripTags(titleHtml).trim());
    if (!title || title.length < 4) continue;

    const detailUrl = hrefRaw.startsWith("http")
      ? hrefRaw
      : `https://www.gebiz.gov.sg/${hrefRaw.replace(/^\/+/, "")}`;
    const idM = /(?:itemId|opportunityId|noticeId)=([\w-]+)/i.exec(detailUrl);
    const id = idM ? idM[1]! : detailUrl;
    if (seen.has(id)) continue;
    seen.add(id);

    // Walk a window of surrounding HTML for agency + closing date.
    const start = Math.max(0, m.index - 500);
    const end = Math.min(html.length, m.index + m[0]!.length + 1500);
    const window = html.slice(start, end);
    const agency =
      pickField(window, [/Agency[^<]*<[^>]*>\s*([^<]+)/i]) ?? "";
    const type =
      pickField(window, [
        /Type[^<]*<[^>]*>\s*([^<]+)/i,
        /Solicitation[^<]*<[^>]*>\s*([^<]+)/i,
      ]) ?? "";
    const publishedAt = parseSgDate(
      pickField(window, [/Published[^<]*<[^>]*>\s*([^<]+)/i]),
    );
    const closingAt = parseSgDate(
      pickField(window, [/Clos(?:ing|ed)\s+(?:Date|At)[^<]*<[^>]*>\s*([^<]+)/i]),
    );

    out.push({
      id,
      detailUrl,
      title,
      agency,
      type,
      publishedAt,
      closingAt,
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

/**
 * GeBIZ Singapore renders dates like "31-Dec-2026 16:00" or
 * "31 Dec 2026 4:00 PM". Parse defensively, fall back to null.
 */
function parseSgDate(raw: string | null): Date | null {
  if (!raw) return null;
  const m = /(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(am|pm|AM|PM)?)?/i.exec(raw);
  if (!m) return null;
  const day = Number.parseInt(m[1]!, 10);
  const monthName = m[2]!.toLowerCase();
  const year = Number.parseInt(m[3]!, 10);
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const month = months[monthName];
  if (month === undefined) return null;
  let hour = m[4] ? Number.parseInt(m[4], 10) : 0;
  const minute = m[5] ? Number.parseInt(m[5], 10) : 0;
  if (m[6]?.toLowerCase() === "pm" && hour < 12) hour += 12;
  if (m[6]?.toLowerCase() === "am" && hour === 12) hour = 0;
  // Singapore is UTC+8, no DST.
  const utcMs = Date.UTC(year, month, day, hour - 8, minute);
  return new Date(utcMs);
}
