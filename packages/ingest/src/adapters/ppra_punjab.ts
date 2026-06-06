// source: https://eproc.punjab.gov.pk/ActiveTenders.aspx
//
// Punjab Procurement Regulatory Authority public e-procurement portal.
// The page is ASP.NET WebForms — the initial GET returns the first page of
// tender rows already rendered (server-side), plus the __VIEWSTATE /
// __EVENTVALIDATION hidden inputs needed to POST back for subsequent
// pages. We parse the first page from the GET response; pagination uses
// postForm() with __EVENTTARGET pointing at the pager link control.
//
// Scraping policy:
//   - User explicitly approved scraping for sources lacking an API.
//   - Polite: <=1 request/2s, browser UA, max 5 pages/run (~250 tenders).
//   - Listing-page only — never fetch per-tender PDF documents (they're
//     not needed for matching and would multiply load 50x).
//   - Robots.txt on eproc.punjab.gov.pk does not disallow ActiveTenders.aspx.
//
// IMPORTANT — this adapter is best-effort: the exact ASP.NET control IDs
// and table column order vary between Punjab portal redesigns. The
// extractTenders() helper tries three common ASP.NET DataGrid / GridView
// layouts. If none match, the adapter logs a "structure not recognised"
// warning and returns an empty page — the rest of the ingest run continues
// gracefully (per runAdapter()'s error contract). Tune the selectors below
// after you observe the first real-world response.

import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { IngestAdapter } from "../types.ts";
import {
  decodeEntities,
  extractAspNetViewState,
  fetchHtml,
  postForm,
  stripTags,
} from "../util/html-scrape.ts";

const BASE = "https://eproc.punjab.gov.pk";
const LISTING = `${BASE}/ActiveTenders.aspx`;

interface TenderRow {
  externalId: string;
  title: string;
  buyer: string;
  publishedAt: Date | null;
  deadlineAt: Date | null;
  url: string;
}

/**
 * Date format on the Punjab portal is typically `dd/MM/yyyy` (e.g.
 * "03/06/2026") or `dd-MMM-yyyy` (e.g. "03-Jun-2026"). Try both.
 */
function parsePunjabDate(s: string): Date | null {
  if (!s) return null;
  const trimmed = stripTags(s);

  // dd/MM/yyyy
  let m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(trimmed);
  if (m) {
    const d = Number.parseInt(m[1]!, 10);
    const mo = Number.parseInt(m[2]!, 10) - 1;
    const y = Number.parseInt(m[3]!, 10);
    // PKT = UTC+5, so we subtract 5 to land on UTC
    return new Date(Date.UTC(y, mo, d, -5, 0));
  }

  const MONTHS: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  // dd-MMM-yyyy or dd MMM yyyy
  m = /(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{4})/.exec(trimmed);
  if (m) {
    const d = Number.parseInt(m[1]!, 10);
    const mo = MONTHS[m[2]!.slice(0, 3).toLowerCase()];
    if (mo === undefined) return null;
    const y = Number.parseInt(m[3]!, 10);
    return new Date(Date.UTC(y, mo, d, -5, 0));
  }

  return null;
}

/**
 * Pull `<tr>...</tr>` blocks out of the rendered HTML.
 * Filter to rows that look like data rows (have at least 5 <td> children).
 */
function rowsFromHtml(html: string): string[] {
  const rows: string[] = [];
  const tableMatch =
    // Most Punjab eproc grids carry id="..." with "GridView" or "dgr" in it.
    /<table[^>]*\bid="[^"]*(?:GridView|dgr|grdTenders|gvTenders|dgTenders)[^"]*"[^>]*>([\s\S]*?)<\/table>/i.exec(
      html,
    ) ?? /<table[^>]*class="[^"]*(?:tender|gridview|gv|dg)[^"]*"[^>]*>([\s\S]*?)<\/table>/i.exec(html);

  const body = tableMatch ? tableMatch[1]! : html;

  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(body)) !== null) {
    const inner = m[1] ?? "";
    // Count td cells; need at least 5 to be a real data row (skip header
    // rows which use <th> and skip empty layout rows).
    const tdCount = (inner.match(/<td/gi) ?? []).length;
    if (tdCount >= 5) rows.push(inner);
  }
  return rows;
}

function cellsFromRow(rowHtml: string): string[] {
  const out: string[] = [];
  const re = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowHtml)) !== null) out.push(m[1] ?? "");
  return out;
}

/**
 * The Punjab grid's columns have varied over redesigns. Most observed
 * layouts include these columns in *some* order:
 *   - tender reference / id
 *   - title / description
 *   - procuring agency (buyer)
 *   - advertised / publish date
 *   - closing / deadline date
 *   - "View" link
 *
 * We pick out fields by heuristic rather than fixed index:
 *   - title = the longest plain-text cell
 *   - buyer = first cell that contains "Department", "Authority", "Ministry"
 *             or a Punjab-flagged keyword
 *   - dates = any cell matching parsePunjabDate
 *   - id    = the cell that looks like "PR/..." or a numeric ref
 */
function extractTender(rowHtml: string): TenderRow | null {
  const cells = cellsFromRow(rowHtml);
  if (cells.length < 5) return null;

  const texts = cells.map((c) => stripTags(c));

  // Title — longest text cell over 12 chars
  let titleIdx = -1;
  let titleLen = 0;
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i]!;
    if (t.length > titleLen && t.length > 12) {
      titleLen = t.length;
      titleIdx = i;
    }
  }
  if (titleIdx === -1) return null;
  const title = texts[titleIdx]!;

  // Buyer — first cell mentioning an org-shape keyword
  const ORG_KW = /\b(department|authority|board|ministry|government|district|directorate|institute|university|hospital|company|corporation)\b/i;
  let buyer = "";
  for (const t of texts) {
    if (t === title) continue;
    if (ORG_KW.test(t)) {
      buyer = t;
      break;
    }
  }
  if (!buyer) {
    // Fallback: second-longest text
    const sorted = [...texts]
      .filter((t) => t !== title)
      .sort((a, b) => b.length - a.length);
    buyer = sorted[0] ?? "Government of Punjab";
  }

  // Dates — parse every cell, sort by date value (earliest = published, latest = deadline)
  const dates: Array<{ idx: number; date: Date }> = [];
  for (let i = 0; i < texts.length; i++) {
    const d = parsePunjabDate(texts[i] ?? "");
    if (d) dates.push({ idx: i, date: d });
  }
  let publishedAt: Date | null = null;
  let deadlineAt: Date | null = null;
  if (dates.length >= 2) {
    const sorted = dates.sort((a, b) => a.date.getTime() - b.date.getTime());
    publishedAt = sorted[0]!.date;
    deadlineAt = sorted[sorted.length - 1]!.date;
  } else if (dates.length === 1) {
    deadlineAt = dates[0]!.date;
  }

  // External ID — explicit tender ref (e.g. "PR/2026/12345") or fallback hash
  const REF = /\b((?:PR|TR|EOI|RFP)[\/\-\s]?[A-Za-z0-9\-\/]+)\b/i;
  let externalId = "";
  for (const t of texts) {
    const m = REF.exec(t);
    if (m) {
      externalId = m[1]!.replace(/\s+/g, "");
      break;
    }
  }
  if (!externalId) {
    // Deterministic fallback so the upsert stays idempotent across runs
    externalId = `ppra-punjab-${title.slice(0, 60).replace(/\s+/g, "-")}-${deadlineAt?.toISOString().slice(0, 10) ?? "nodeadline"}`;
  }

  // URL — try to extract a <a href=...> from the row; otherwise use the listing page.
  const hrefMatch = /<a[^>]+href="([^"]+)"/i.exec(rowHtml);
  let url = LISTING;
  if (hrefMatch) {
    const raw = decodeEntities(hrefMatch[1]!);
    url = raw.startsWith("http") ? raw : `${BASE}/${raw.replace(/^\.?\//, "")}`;
  }

  return {
    externalId,
    title,
    buyer,
    publishedAt,
    deadlineAt,
    url,
  };
}

function toNormalized(row: TenderRow): NormalizedTender | null {
  const tender = {
    externalId: row.externalId,
    source: "ppra_punjab" as const,
    title: row.title,
    description: row.title, // listing page doesn't give us the full description; LLM scorer will use title + buyer
    url: row.url,
    buyer: row.buyer,
    country: "PK" as const,
    sector: null,
    cpvCodes: [] as string[],
    budgetMinUsd: null,
    budgetMaxUsd: null,
    currency: "PKR" as const,
    publishedAt: row.publishedAt ?? new Date(),
    deadlineAt: row.deadlineAt,
    language: "en",
    raw: row as unknown,
  };
  try {
    return NormalizedTenderSchema.parse(tender) as NormalizedTender;
  } catch {
    return null;
  }
}

export const ppraPunjabAdapter: IngestAdapter = {
  source: "ppra_punjab",
  label: "Punjab PPRA",
  requiredEnv: [],
  async fetchPage({ pageToken }) {
    let html: string;

    if (!pageToken) {
      // Page 1 — straight GET. The server-rendered response includes the
      // first batch of rows AND the __VIEWSTATE hidden inputs we need for
      // any subsequent page POSTs.
      html = await fetchHtml(LISTING);
    } else {
      // Pages 2+ — POST back with the pager target.
      // We expect the caller to pass pageToken = JSON.stringify({ page, viewState... })
      // Bail to GET if the token can't be parsed (legacy single-page mode).
      try {
        const parsed = JSON.parse(pageToken) as {
          page: number;
          viewState: string;
          viewStateGenerator: string;
          eventValidation: string;
        };
        html = await postForm(LISTING, {
          __EVENTTARGET: `ctl00$ContentPlaceHolder1$GridView1`, // common Punjab grid name; refine on first run
          __EVENTARGUMENT: `Page$${parsed.page}`,
          __VIEWSTATE: parsed.viewState,
          __VIEWSTATEGENERATOR: parsed.viewStateGenerator,
          __EVENTVALIDATION: parsed.eventValidation,
        });
      } catch {
        html = await fetchHtml(LISTING);
      }
    }

    const rows = rowsFromHtml(html);
    if (rows.length === 0) {
      console.warn(
        "[ppra_punjab] no data rows found — ASP.NET grid structure may have changed. Inspect the HTML and adjust rowsFromHtml/extractTender in adapters/ppra_punjab.ts",
      );
      return { tenders: [], nextPageToken: null };
    }

    const tenders: NormalizedTender[] = [];
    for (const rowHtml of rows) {
      const row = extractTender(rowHtml);
      if (!row) continue;
      const norm = toNormalized(row);
      if (norm) tenders.push(norm);
    }

    // Pagination — extract fresh ViewState for the next POST.
    const FULL_PAGE = 25; // Punjab grid usually shows 25/page
    const currentPage = pageToken
      ? (JSON.parse(pageToken) as { page: number }).page
      : 1;
    let nextPageToken: string | null = null;
    if (tenders.length >= FULL_PAGE) {
      const { viewState, viewStateGenerator, eventValidation } =
        extractAspNetViewState(html);
      if (viewState) {
        nextPageToken = JSON.stringify({
          page: currentPage + 1,
          viewState,
          viewStateGenerator,
          eventValidation,
        });
      }
    }

    return { tenders, nextPageToken };
  },
};
