// source: https://epms.ppra.gov.pk/public/tenders/active-tenders
//
// Pakistan Public Procurement Regulatory Authority — e-Publish & Monitoring
// System. The portal publishes all federal/provincial tender notices and is
// the public face of PPRA. The previous RSS endpoint was retired (2026); the
// new EPMS does not expose JSON or RSS, so we scrape the public listing.
//
// Scraping policy:
//   - User explicitly approved scraping for sources lacking an API.
//   - Polite: <=1 request/2s, browser UA, max 5 pages/run (250 tenders).
//   - Listing-page only — never fetch /tender-details or /invoice (which
//     would multiply load by 50x and isn't needed for matching).
//   - Robots.txt is empty (no Disallow rules) on epms.ppra.gov.pk.

import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { IngestAdapter } from "../types.ts";
import { fetchHtml, decodeEntities, stripTags } from "../util/html-scrape.ts";

const BASE = "https://epms.ppra.gov.pk";
const LISTING = `${BASE}/public/tenders/active-tenders`;

// Per-row extractor — pulls fields from the captured group of one row.
// The capture STARTS after the row-index <td>, so:
//   cells[0] = tender no
//   cells[1] = tender details (title + long description + category badge)
//   cells[2] = organization
//   cells[3] = status badge
//   cells[4] = advertised date
//   cells[5] = closing date (date + time)
//   cells[6] = action buttons (ignored)
function parseRow(rowHtml: string): NormalizedTender | null {
  const cells = matchCells(rowHtml);
  if (cells.length < 6) return null;

  const tenderNoMatch = /<strong[^>]*>([^<]+)<\/strong>/i.exec(cells[0]!);
  const tenderNo = tenderNoMatch ? decodeEntities(tenderNoMatch[1]!.trim()) : null;
  if (!tenderNo) return null;

  const titleMatch = /<strong[^>]*>([^<]+)<\/strong>/i.exec(cells[1]!);
  const title = titleMatch ? decodeEntities(titleMatch[1]!.trim().replace(/^['"]/, "")) : "";
  if (!title) return null;

  const smalls = matchAll(/<small[^>]*>([^<]*?)<\/small>/gi, cells[1]!).map((m) =>
    decodeEntities(m[1]!.trim()),
  );
  const descCandidate =
    smalls
      .filter((s) => s && s.length > 10 && !/^\s*$/.test(s))
      .sort((a, b) => b.length - a.length)[0] ?? "";
  const description = descCandidate || title;

  const badgeMatches = matchAll(
    /<small[^>]*class="[^"]*badge[^"]*"[^>]*>([^<]+)<\/small>/gi,
    cells[1]!,
  );
  const category =
    badgeMatches.length > 0 ? decodeEntities(badgeMatches[0]![1]!.trim()) : null;

  const orgText = stripTags(cells[2]!);

  const advertisedRaw = stripTags(cells[4]!);
  const publishedAt = parsePpraDate(advertisedRaw) ?? new Date();

  const closeStrong = /<strong[^>]*>([^<]+)<\/strong>/i.exec(cells[5]!);
  const closeTime = /<small[^>]*>([^<]+)<\/small>/i.exec(cells[5]!);
  const closingRaw = closeStrong
    ? `${decodeEntities(closeStrong[1]!.trim())}${closeTime ? " " + decodeEntities(closeTime[1]!.trim()) : ""}`
    : "";
  const deadlineAt = parsePpraDate(closingRaw);

  return {
    externalId: tenderNo,
    source: "ppra_pk",
    title,
    description: [title, description, category, orgText]
      .filter((s): s is string => Boolean(s))
      .join("\n"),
    url: `${BASE}/public/tenders/tender-details/${encodeURIComponent(tenderNo)}`,
    buyer: orgText || "Government of Pakistan",
    country: "PK",
    sector: category,
    cpvCodes: [],
    budgetMinUsd: null,
    budgetMaxUsd: null,
    currency: "PKR",
    publishedAt,
    deadlineAt,
    language: "en",
    raw: { tenderNo, title, descCandidate, category, orgText, advertisedRaw, closingRaw },
  };
}

function matchCells(rowHtml: string): string[] {
  // First <td> is the row index ("1"); we keep it so caller indices are stable.
  const out: string[] = [];
  const re = /<td[^>]*>([\s\S]*?)<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowHtml)) !== null) {
    out.push(m[1]!);
  }
  return out;
}

function matchAll(re: RegExp, s: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  // Ensure global flag
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  while ((m = g.exec(s)) !== null) out.push(m);
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parsePpraDate(s: string): Date | null {
  if (!s) return null;
  // "May 03, 2026" or "May 21, 2026 02:00 PM"
  const m = /(\w{3,9})\s+(\d{1,2}),\s*(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i.exec(s);
  if (!m) return null;
  const month = MONTHS[m[1]!.slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  const day = Number.parseInt(m[2]!, 10);
  const year = Number.parseInt(m[3]!, 10);
  let hour = m[4] ? Number.parseInt(m[4]!, 10) : 0;
  const minute = m[5] ? Number.parseInt(m[5]!, 10) : 0;
  const ampm = m[6]?.toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  // PKT = UTC+5
  return new Date(Date.UTC(year, month, day, hour - 5, minute));
}

export const ppraPkAdapter: IngestAdapter = {
  source: "ppra_pk",
  label: "Pakistan PPRA (EPMS)",
  requiredEnv: [],
  async fetchPage({ pageToken }) {
    const page = pageToken ? Number.parseInt(pageToken, 10) : 1;
    const url = `${LISTING}?page=${page}`;

    const html = await fetchHtml(url);

    // Extract just the tender table body, then per-row blocks.
    const tbodyMatch = /<tbody[^>]*>([\s\S]*?)<\/tbody>/i.exec(html);
    const tbody = tbodyMatch ? tbodyMatch[1]! : html;
    const rowRe = /<tr>\s*<td class="text-center align-middle">\s*\d+\s*<\/td>([\s\S]*?)<\/tr>/g;

    const tenders: NormalizedTender[] = [];
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(tbody)) !== null) {
      try {
        const t = parseRow(rowMatch[1]!);
        if (!t) continue;
        tenders.push(NormalizedTenderSchema.parse(t) as NormalizedTender);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[ppra_pk] skipped row: ${msg}`);
      }
    }

    // Pagination: if the page returned a full set, try the next.
    const FULL_PAGE = 50;
    const nextPageToken = tenders.length === FULL_PAGE ? String(page + 1) : null;

    return { tenders, nextPageToken };
  },
};
