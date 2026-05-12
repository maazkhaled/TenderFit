// source: https://www.ungm.org/Public/Notice
//
// UN Global Marketplace — covers all UN agency procurement (UNDP, UNICEF,
// WFP, IOM, UNHCR, etc.). The legacy ?rss=1 endpoint was removed; the
// /Public/Notice/Search POST returns rendered HTML rows.
//
// Scraping policy:
//   - User explicitly approved scraping for sources without an API.
//   - Polite: <=1 request/2s per host, 5 pages/run max (~75 notices).
//   - We hit the JSON-shaped POST that returns HTML — no per-detail fetches.

import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { IngestAdapter } from "../types.ts";
import { fetchHtml, decodeEntities, stripTags } from "../util/html-scrape.ts";

const SEARCH_URL = "https://www.ungm.org/Public/Notice/Search";
const PAGE_SIZE = 25;
const MIN_INTERVAL_MS = 2_000;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

// Custom POST through the polite-delay layer. Reuses fetchHtml's host-limit
// indirectly by piggybacking on a GET to the host first? No — simplest:
// implement local rate-limiting here too.
const lastRequestAt: { ts: number } = { ts: 0 };

async function fetchUngmHtml(pageIndex: number): Promise<string> {
  const wait = lastRequestAt.ts + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt.ts = Date.now();

  const body = JSON.stringify({
    PageIndex: pageIndex,
    PageSize: PAGE_SIZE,
    Title: "",
    Description: "",
    Reference: "",
    PublishedFrom: null,
    DeadlineFrom: null,
    DeadlineTo: null,
    Countries: [],
    Agencies: [],
    UNSPSCs: [],
    NoticeTypes: [],
    SortField: "DatePublished",
    Ascending: false,
    isPicker: false,
    NoticeDisplay: 2,
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": BROWSER_UA,
          Accept: "text/html,*/*",
          "X-Requested-With": "XMLHttpRequest",
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        throw new Error(`UNGM search ${res.status} ${res.statusText}`);
      }
      return await res.text();
    } catch (err) {
      if (attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
    }
  }
  throw new Error("unreachable");
}

interface RowFields {
  noticeId: string;
  title: string;
  deadline: string | null;
  published: string | null;
  agency: string | null;
  type: string | null;
  reference: string | null;
  country: string | null;
}

function extractRows(html: string): RowFields[] {
  const out: RowFields[] = [];

  // First split on row boundaries — each row block ends where the next row
  // starts (or end of document).
  const rowChunks = splitOnMarker(
    html,
    /<div role="row"[^>]*data-noticeid="(\d+)"[^>]*>/g,
  );

  for (const { markerCapture, body } of rowChunks) {
    if (!markerCapture) continue;
    const noticeId = markerCapture;

    // Within each row, split into cell chunks the same way.
    const cellChunks = splitOnMarker(body, /<div role="cell"[^>]*>/g);
    if (cellChunks.length < 8) continue;
    const cells = cellChunks.map((c) => c.body);

    const titleM = /<span class="ungm-title[^"]*">([\s\S]*?)<\/span>/i.exec(cells[1]!);
    const title = titleM ? decodeEntities(stripTags(titleM[1]!).trim()) : "";
    if (!title) continue;

    const deadline = firstSpanText(cells[2]!);
    const published = firstSpanText(cells[3]!);
    const agency = firstSpanText(cells[4]!);
    const typeM = /<label[^>]*>([\s\S]*?)<\/label>/i.exec(cells[5]!);
    const type = typeM ? decodeEntities(stripTags(typeM[1]!).trim()) : firstSpanText(cells[5]!);
    const reference = firstSpanText(cells[6]!);
    const country = firstSpanText(cells[7]!);

    out.push({ noticeId, title, deadline, published, agency, type, reference, country });
  }
  return out;
}

interface SplitChunk {
  markerCapture: string | null;
  body: string;
}

/**
 * Split a string on a global regex that has at most one capture group; for
 * each match, the chunk body is the text between the marker and the next
 * marker (or end of string). markerCapture is the match's capture group.
 * The first chunk before the first marker is dropped.
 */
function splitOnMarker(s: string, re: RegExp): SplitChunk[] {
  const out: SplitChunk[] = [];
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const positions: Array<{ start: number; end: number; cap: string | null }> = [];
  let m: RegExpExecArray | null;
  while ((m = g.exec(s)) !== null) {
    positions.push({
      start: m.index,
      end: m.index + m[0].length,
      cap: m[1] ?? null,
    });
  }
  for (let i = 0; i < positions.length; i++) {
    const cur = positions[i]!;
    const next = positions[i + 1];
    const body = s.slice(cur.end, next ? next.start : s.length);
    out.push({ markerCapture: cur.cap, body });
  }
  return out;
}

function firstSpanText(html: string): string | null {
  const m = /<span[^>]*>([\s\S]*?)<\/span>/i.exec(html);
  if (!m) return null;
  const t = decodeEntities(stripTags(m[1]!).trim());
  return t || null;
}

function matchAll(re: RegExp, s: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  while ((m = g.exec(s)) !== null) out.push(m);
  return out;
}

const COUNTRY_NAME_TO_ISO2: Record<string, string> = {
  bangladesh: "BD", pakistan: "PK", india: "IN", afghanistan: "AF",
  "sri lanka": "LK", nepal: "NP", bhutan: "BT", maldives: "MV",
  "saudi arabia": "SA", "united arab emirates": "AE",
  qatar: "QA", oman: "OM", kuwait: "KW", bahrain: "BH",
  jordan: "JO", lebanon: "LB", syria: "SY", iraq: "IQ", iran: "IR",
  yemen: "YE", egypt: "EG", libya: "LY", tunisia: "TN", morocco: "MA",
  sudan: "SD", "south sudan": "SS", somalia: "SO", ethiopia: "ET",
  kenya: "KE", uganda: "UG", tanzania: "TZ", rwanda: "RW", burundi: "BI",
  nigeria: "NG", ghana: "GH", "côte d'ivoire": "CI", "ivory coast": "CI",
  senegal: "SN", mali: "ML", "burkina faso": "BF", niger: "NE", chad: "TD",
  cameroon: "CM", "central african republic": "CF",
  "congo": "CG", "democratic republic of the congo": "CD", "drc": "CD",
  angola: "AO", zambia: "ZM", zimbabwe: "ZW", malawi: "MW",
  mozambique: "MZ", madagascar: "MG", "south africa": "ZA",
  brazil: "BR", argentina: "AR", chile: "CL", peru: "PE", colombia: "CO",
  venezuela: "VE", bolivia: "BO", ecuador: "EC", paraguay: "PY",
  uruguay: "UY", mexico: "MX", guatemala: "GT", honduras: "HN",
  haiti: "HT", "dominican republic": "DO", cuba: "CU",
  ukraine: "UA", russia: "RU", "russian federation": "RU",
  belarus: "BY", moldova: "MD", georgia: "GE", armenia: "AM",
  azerbaijan: "AZ", turkey: "TR", türkiye: "TR",
  kazakhstan: "KZ", uzbekistan: "UZ", tajikistan: "TJ",
  kyrgyzstan: "KG", turkmenistan: "TM", mongolia: "MN",
  myanmar: "MM", cambodia: "KH", "lao people's democratic republic": "LA",
  laos: "LA", vietnam: "VN", thailand: "TH", indonesia: "ID",
  malaysia: "MY", philippines: "PH",
  "papua new guinea": "PG", fiji: "FJ", "solomon islands": "SB",
};

function toIso2(name: string | null): string | null {
  if (!name) return null;
  return COUNTRY_NAME_TO_ISO2[name.trim().toLowerCase()] ?? null;
}

function parseUngmDate(s: string | null): Date | null {
  if (!s) return null;
  // "07-May-2026 11:00 (GMT 6.00)" or "03-May-2026"
  const m = /(\d{1,2})-(\w{3,9})-(\d{4})(?:\s+(\d{1,2}):(\d{2}))?(?:\s*\(GMT\s*([+-]?\d+(?:\.\d+)?)\))?/i.exec(s);
  if (!m) return null;
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const month = months[m[2]!.slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  const day = Number.parseInt(m[1]!, 10);
  const year = Number.parseInt(m[3]!, 10);
  let hour = m[4] ? Number.parseInt(m[4]!, 10) : 0;
  const minute = m[5] ? Number.parseInt(m[5]!, 10) : 0;
  const tz = m[6] ? Number.parseFloat(m[6]!) : 0;
  return new Date(Date.UTC(year, month, day, hour - tz, minute));
}

export const ungmAdapter: IngestAdapter = {
  source: "ungm",
  label: "UN Global Marketplace",
  requiredEnv: [],
  async fetchPage({ sinceIso, pageToken }) {
    const pageIndex = pageToken ? Number.parseInt(pageToken, 10) : 0;
    const html = await fetchUngmHtml(pageIndex);
    const rows = extractRows(html);
    const sinceMs = new Date(sinceIso).getTime();

    const tenders: NormalizedTender[] = [];
    for (const r of rows) {
      try {
        const publishedAt = parseUngmDate(r.published) ?? new Date();
        if (Number.isFinite(sinceMs) && publishedAt.getTime() < sinceMs) continue;

        const t: NormalizedTender = {
          externalId: r.noticeId,
          source: "ungm",
          title: r.title,
          description: [r.title, r.type, r.agency, r.country].filter(Boolean).join("\n"),
          url: `https://www.ungm.org/Public/Notice/${encodeURIComponent(r.noticeId)}`,
          buyer: r.agency ?? "UN Agency",
          country: toIso2(r.country),
          sector: r.type ?? null,
          cpvCodes: [],
          budgetMinUsd: null,
          budgetMaxUsd: null,
          currency: null,
          publishedAt,
          deadlineAt: parseUngmDate(r.deadline),
          language: "en",
          raw: r,
        };
        tenders.push(NormalizedTenderSchema.parse(t) as NormalizedTender);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[ungm] skipped notice ${r.noticeId}: ${msg}`);
      }
    }

    const FULL_PAGE = PAGE_SIZE;
    const nextPageToken =
      rows.length === FULL_PAGE ? String(pageIndex + 1) : null;

    return { tenders, nextPageToken };
  },
};

// fetchHtml is unused here directly but kept imported so the politeness
// helpers stay aligned across adapters; remove if linting complains.
void fetchHtml;
