// source: https://ecepp.ebrd.com/delta/noticeSearchResults.html
//
// EBRD's eClient Portal (ECEPP) is the canonical home for the bank's
// project procurement notices since the bank moved everything off the
// www.ebrd.com listing in 2024. The public search page returns a
// server-rendered HTML table with one row per notice — title (linked to
// the detail page), notice type, procurement exercise title, published
// date, closing date, and current state. The trailing column also
// carries country, sector, buyer, and project ID in a comma-joined list.
//
// Scraping policy:
//   - Public listing page (no login wall, no robots-disallow on this path).
//   - Single GET per run, paged via &searchPage=N if needed.
//   - 2s/host throttle inherited from fetchHtml.
//   - Filter: only "Open" notices with a future closing date are accepted —
//     skip "Information Only", "Closed", and "Contract Award Notice" rows
//     to avoid the same award-noise problem we solved for World Bank.

import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { IngestAdapter } from "../types.ts";
import { fetchHtml, decodeEntities, stripTags } from "../util/html-scrape.ts";

const LIST_URL = "https://ecepp.ebrd.com/delta/noticeSearchResults.html";
const MAX_PAGES = 3; // ~150 notices/run, generous given 12h cron cadence

// Notice types we treat as live bid opportunities. ECEPP also publishes
// "Contract Award Notice", "Shortlist Notice", "General Procurement
// Notice" (early heads-up, no documents yet) — none of those are biddable
// in the same way and would pollute the matcher. Lowercased substring
// match.
const ACCEPT_NOTICE_TYPES = [
  "invitation for tenders",
  "invitation for prequalification",
  "invitation for expressions of interest",
  "request for proposals",
];

const REJECT_NOTICE_TYPES = [
  "contract award",
  "award notice",
  "shortlist",
];

// Map ECEPP's country prefix ("Armenia: ...", "Türkiye: ...") to ISO-2.
// Only the countries that actually appear in EBRD's regions — keeps the
// lookup tight. Unrecognised countries return null and the matcher's
// geography heuristic falls back gracefully.
const ECEPP_COUNTRY_ISO2: Record<string, string> = {
  albania: "AL",
  armenia: "AM",
  azerbaijan: "AZ",
  belarus: "BY",
  benin: "BJ",
  "bosnia and herzegovina": "BA",
  bulgaria: "BG",
  croatia: "HR",
  cyprus: "CY",
  czechia: "CZ",
  "côte d'ivoire": "CI",
  "cote d'ivoire": "CI",
  egypt: "EG",
  estonia: "EE",
  georgia: "GE",
  greece: "GR",
  hungary: "HU",
  iraq: "IQ",
  jordan: "JO",
  kazakhstan: "KZ",
  kenya: "KE",
  kosovo: "XK",
  "kyrgyz republic": "KG",
  latvia: "LV",
  lebanon: "LB",
  lithuania: "LT",
  moldova: "MD",
  mongolia: "MN",
  montenegro: "ME",
  morocco: "MA",
  nigeria: "NG",
  "north macedonia": "MK",
  poland: "PL",
  regional: null as unknown as string, // ignored at runtime
  romania: "RO",
  russia: "RU",
  serbia: "RS",
  "slovak republic": "SK",
  slovenia: "SI",
  tajikistan: "TJ",
  tunisia: "TN",
  turkmenistan: "TM",
  türkiye: "TR",
  turkey: "TR",
  ukraine: "UA",
  uzbekistan: "UZ",
  "west bank and gaza": "PS",
};

export const ebrdAdapter: IngestAdapter = {
  source: "ebrd",
  label: "European Bank for Reconstruction and Development",
  requiredEnv: [],
  async fetchPage({ sinceIso }) {
    const sinceMs = new Date(sinceIso).getTime();
    const tenders: NormalizedTender[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url =
        page === 1
          ? `${LIST_URL}?locale=en`
          : `${LIST_URL}?locale=en&searchPage=${page}`;
      let html: string;
      try {
        html = await fetchHtml(url, {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[ebrd] fetch failed for page ${page}: ${msg}`);
        break;
      }

      const rows = parseRows(html);
      if (rows.length === 0) {
        // No rows on this page — almost certainly past the last page.
        if (page === 1) console.warn(`[ebrd] empty first page, abandoning run`);
        break;
      }

      let acceptedThisPage = 0;
      for (const row of rows) {
        try {
          const tender = rowToTender(row);
          if (!tender) continue;
          if (Number.isFinite(sinceMs) && tender.publishedAt.getTime() < sinceMs) {
            // The list is published-desc — once we're past the cutoff we
            // can stop paging entirely.
            return { tenders, nextPageToken: null };
          }
          tenders.push(NormalizedTenderSchema.parse(tender) as NormalizedTender);
          acceptedThisPage++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[ebrd] skipped row: ${msg}`);
        }
      }

      // If a page produced zero acceptable rows (e.g. all award notices),
      // keep paging — but cap at MAX_PAGES so a fully-stale snapshot
      // doesn't pull forever.
      if (acceptedThisPage === 0 && rows.length < 5) break;
    }

    return { tenders, nextPageToken: null };
  },
};

interface EceppRow {
  noticeId: string;
  detailUrl: string;
  title: string;
  noticeType: string;
  exerciseTitle: string;
  publishedAt: Date;
  deadlineAt: Date | null;
  state: string;
  /** Comma-separated metadata blob: project, project id, country, scope, buyer, sector. */
  metadata: string;
}

function parseRows(html: string): EceppRow[] {
  const rows: EceppRow[] = [];

  // ECEPP's results table renders each notice as a <tr> with an anchor to
  // viewNotice.html?displayNoticeId=NNNN. Anchor presence is the most
  // stable shape across page-template tweaks — the table layout changes
  // more often than the URL pattern. So: find each anchor + the
  // surrounding <tr>...</tr>, then split that <tr> on </td> to get cells.

  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRe.exec(html)) !== null) {
    const trBody = trMatch[1]!;
    const anchorM =
      /<a\b[^>]*href="([^"]*viewNotice\.html\?displayNoticeId=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(
        trBody,
      );
    if (!anchorM) continue;

    const detailUrlRaw = anchorM[1]!;
    const noticeId = anchorM[2]!;
    const titleHtml = anchorM[3]!;
    const title = decodeEntities(stripTags(titleHtml).trim());
    if (!title) continue;
    const detailUrl = detailUrlRaw.startsWith("http")
      ? detailUrlRaw
      : `https://ecepp.ebrd.com/delta/${detailUrlRaw.replace(/^\/+/, "")}`;

    const cells = splitCells(trBody);
    if (cells.length < 6) continue;

    // Column order in the rendered table:
    //   0: Title (with anchor)
    //   1: Notice Type
    //   2: Procurement Exercise Title
    //   3: Published
    //   4: Closing Date
    //   5: Current State
    //   6+: metadata blob (project name, project id, country, scope, buyer, sector)
    const noticeType = cleanCell(cells[1] ?? "");
    const exerciseTitle = cleanCell(cells[2] ?? "");
    const published = cleanCell(cells[3] ?? "");
    const deadline = cleanCell(cells[4] ?? "");
    const state = cleanCell(cells[5] ?? "");
    const metadata = cells
      .slice(6)
      .map((c) => cleanCell(c))
      .filter(Boolean)
      .join(", ");

    const publishedAt = parseEceppDate(published);
    if (!publishedAt) continue;
    const deadlineAt = parseEceppDate(deadline);

    rows.push({
      noticeId,
      detailUrl,
      title,
      noticeType,
      exerciseTitle,
      publishedAt,
      deadlineAt,
      state,
      metadata,
    });
  }
  return rows;
}

function splitCells(trBody: string): string[] {
  // Crude but reliable: split on </td>, drop any leading <tr> chunk before
  // the first <td>. Works because we already pre-sliced to the row body.
  const parts = trBody.split(/<\/td>/i);
  const cells: string[] = [];
  for (const part of parts) {
    const m = /<td\b[^>]*>([\s\S]*)/i.exec(part);
    if (m) cells.push(m[1] ?? "");
  }
  return cells;
}

function cleanCell(html: string): string {
  return decodeEntities(stripTags(html).replace(/\s+/g, " ").trim());
}

function rowToTender(row: EceppRow): NormalizedTender | null {
  const stateLower = row.state.toLowerCase();
  const typeLower = row.noticeType.toLowerCase();

  // Skip non-biddable rows. State "Open" is what we want; "Closed",
  // "Information Only" are everything else.
  if (!stateLower.includes("open")) return null;

  // Reject award/shortlist explicitly.
  for (const kw of REJECT_NOTICE_TYPES) {
    if (typeLower.includes(kw)) return null;
  }
  // Only accept the known live-tender notice types.
  const isBiddable = ACCEPT_NOTICE_TYPES.some((kw) => typeLower.includes(kw));
  if (!isBiddable) return null;

  // Title format: "<Country>: <Subject>". Split once on the first colon.
  const colonIdx = row.title.indexOf(":");
  const countryName = colonIdx > 0 ? row.title.slice(0, colonIdx).trim() : "";
  const subject = colonIdx > 0 ? row.title.slice(colonIdx + 1).trim() : row.title;
  const country = ECEPP_COUNTRY_ISO2[countryName.toLowerCase()] ?? null;

  // The metadata column repeats the country and project info; pull the
  // buyer (typically last-but-two element) heuristically. If the blob is
  // empty just fall back to "EBRD".
  const metaParts = row.metadata
    .split(/,(?![^()]*\))/) // split on commas not inside parens
    .map((s) => s.trim())
    .filter(Boolean);
  // Buyer is usually the longest non-country, non-sector string between
  // the project ID and the sector. Pick the longest entry that isn't
  // already the country name as a defensible heuristic.
  let buyer = "EBRD";
  if (metaParts.length >= 4) {
    const candidates = metaParts.filter(
      (p) =>
        p.length > 3 &&
        p.toLowerCase() !== countryName.toLowerCase() &&
        !/^[A-Z][a-z]*$/.test(p), // skip single-word capitalised (sector names)
    );
    if (candidates.length > 0) {
      buyer = candidates.sort((a, b) => b.length - a.length)[0] ?? "EBRD";
    }
  }

  const description = [
    row.exerciseTitle && row.exerciseTitle !== "N/A" ? row.exerciseTitle : null,
    row.noticeType,
    row.metadata,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    externalId: row.noticeId,
    source: "ebrd",
    title: row.title,
    description: description || subject,
    url: row.detailUrl,
    buyer,
    country,
    sector: row.noticeType || null,
    cpvCodes: [],
    budgetMinUsd: null,
    budgetMaxUsd: null,
    currency: null,
    publishedAt: row.publishedAt,
    deadlineAt: row.deadlineAt,
    language: "en",
    raw: row,
  };
}

/**
 * Parse ECEPP's date format: "24/06/2026 00:14  UK Time" or "24/06/2026".
 * Returns null on "N/A" or anything unparseable.
 */
function parseEceppDate(raw: string): Date | null {
  const s = (raw || "").trim();
  if (!s || s === "N/A") return null;
  // Strip trailing " UK Time" / "GMT" / etc. so we can parse the leading
  // dd/MM/yyyy[ HH:mm].
  const cleaned = s.replace(/\s+(UK Time|GMT|UTC).*$/i, "").trim();
  const m =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(cleaned);
  if (!m) return null;
  const [, d, mo, y, hh, mm] = m;
  const iso = `${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}T${(hh ?? "00").padStart(2, "0")}:${mm ?? "00"}:00Z`;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
