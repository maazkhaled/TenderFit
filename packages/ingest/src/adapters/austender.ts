// source: https://www.tenders.gov.au/atm
//
// AusTender (Australian Government) Approach to Market notices. The
// /atm list page IS server-rendered — when a regular HTTP client hits
// it, the response body includes the full list of current ATMs with
// detail-page anchors. No JS rendering required.
//
// Anchor pattern observed from /atm responses:
//     <a ... href="atm/show/<UUID>">Title text</a>
// Each result row also embeds agency, ATM ID, close-date, and category
// in adjacent table cells.
//
// Defensive parsing: if the page structure shifts, we log + return
// zero tenders rather than crash the worker. Tomorrow's run will
// either pick up new HTML or we get a log signal to update the regex.

import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { IngestAdapter } from "../types.ts";
import { fetchHtml, decodeEntities, stripTags } from "../util/html-scrape.ts";

const LIST_URL = "https://www.tenders.gov.au/atm";

export const austenderAdapter: IngestAdapter = {
  source: "austender",
  label: "AusTender (Australia federal)",
  requiredEnv: [],
  async fetchPage({ sinceIso }) {
    const sinceMs = new Date(sinceIso).getTime();
    let html: string;
    try {
      html = await fetchHtml(LIST_URL, {
        headers: { Accept: "text/html,application/xhtml+xml" },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[austender] fetch failed: ${msg}`);
      return { tenders: [], nextPageToken: null };
    }

    const items = parseAtmList(html);
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
          externalId: item.atmId,
          source: "austender",
          title: item.title,
          description: [item.agency, item.category, item.uno]
            .filter(Boolean)
            .join("\n\n"),
          url: item.detailUrl,
          buyer: item.agency || "Australian Government",
          country: "AU",
          sector: item.category || null,
          cpvCodes: [],
          budgetMinUsd: null,
          budgetMaxUsd: null,
          currency: null,
          publishedAt: item.publishedAt ?? new Date(),
          deadlineAt: item.closeDate,
          language: "en",
          raw: item,
        };
        tenders.push(NormalizedTenderSchema.parse(tender) as NormalizedTender);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[austender] skipped item: ${msg}`);
      }
    }
    return { tenders, nextPageToken: null };
  },
};

interface ParsedAtm {
  atmId: string;
  detailUrl: string;
  title: string;
  agency: string;
  category: string;
  uno: string;
  publishedAt: Date | null;
  closeDate: Date | null;
}

function parseAtmList(html: string): ParsedAtm[] {
  const out: ParsedAtm[] = [];
  // Match anchors to ATM detail pages. AusTender uses paths like
  // /atm/show/<UUID> (case-insensitive); accept any URL containing that
  // segment to ride out small URL-style changes.
  const anchorRe =
    /<a\b[^>]*href="([^"]*\/atm\/show\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const hrefRaw = m[1]!;
    const titleHtml = m[2]!;
    const title = decodeEntities(stripTags(titleHtml).trim());
    if (!title) continue;

    const detailUrl = hrefRaw.startsWith("http")
      ? hrefRaw
      : `https://www.tenders.gov.au/${hrefRaw.replace(/^\/+/, "")}`;
    const idM = /\/atm\/show\/([^/?#]+)/i.exec(detailUrl);
    const atmId = idM ? idM[1]! : detailUrl;
    if (seen.has(atmId)) continue;
    seen.add(atmId);

    // Walk forward a few hundred chars from the anchor end to scrape
    // the surrounding metadata cells (agency, UNO, dates, category).
    const tailStart = m.index + m[0]!.length;
    const tail = html.slice(tailStart, tailStart + 4_000);
    const agency = pickField(tail, [/Agency[^<]*<[^>]*>\s*([^<]+)/i]);
    const uno = pickField(tail, [/UNSPSC[^<]*<[^>]*>\s*([^<]+)/i, /UNO[^<]*<[^>]*>\s*([^<]+)/i]);
    const category = pickField(tail, [/Category[^<]*<[^>]*>\s*([^<]+)/i]);
    const closeDateRaw = pickField(tail, [
      /Close (?:Date|Time)[^<]*<[^>]*>\s*([^<]+)/i,
      /Closing Date[^<]*<[^>]*>\s*([^<]+)/i,
    ]);
    const publishedRaw = pickField(tail, [
      /Publish(?:ed)? Date[^<]*<[^>]*>\s*([^<]+)/i,
    ]);

    out.push({
      atmId,
      detailUrl,
      title,
      agency: agency ?? "",
      category: category ?? "",
      uno: uno ?? "",
      publishedAt: parseAusDate(publishedRaw),
      closeDate: parseAusDate(closeDateRaw),
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
 * AusTender dates render as "20-Aug-2026 2:00 pm (ACT Local Time)" or
 * "20-Aug-2026". Parse the leading day-month-year, ignore the rest.
 */
function parseAusDate(raw: string | null): Date | null {
  if (!raw) return null;
  const m = /(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(am|pm)?)?/i.exec(raw);
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
  // ACT is UTC+10 (no DST in Brisbane; Canberra has DST but the rough
  // hour-of-day in AEST is close enough for filtering by deadline).
  const utcMs = Date.UTC(year, month, day, hour - 10, minute);
  return new Date(utcMs);
}
