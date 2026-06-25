// source: https://canadabuys.canada.ca/en/tender-opportunities
//
// CanadaBuys (Federal Canadian procurement, the successor to Buy and
// Sell) publishes its full active-tender list as a daily-refreshed CSV
// at the open data path below. Drupal frontend requires JS but the
// CSV is plain HTTP — no auth, no JS. We always pull the active feed
// (closed tenders end up in a separate archive CSV).
//
// CSV columns observed (header row): reference-number-numero-reference,
// solicitation-number-numero-sollicitation, title-en, title-fr,
// publication-date-date-publication, date-closing-date-fermeture,
// gsin-nibs, gsin-description-en, region-of-opportunity-region-livraison,
// procurement-entity-entite-approvisionnement, notice-type-type-avis,
// procurement-method-methode-approvisionnement,
// notice-url-en, notice-url-fr.
//
// If the column header names drift, we fall back to defensive matching
// on substring tokens ("title", "closing", "notice-url-en") so a small
// rename doesn't blank the adapter.

import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { IngestAdapter } from "../types.ts";
import { httpJson as defaultHttpJson } from "../util/http.ts";

const CSV_URL =
  "https://canadabuys.canada.ca/sites/default/files/opendata/opendata-tender-notice/tpsgc-pwgsc_ao-t_aviso_de_oportunidad-tender_notice.csv";
const FALLBACK_CSV_URLS = [
  // CanadaBuys has migrated CSV paths twice. Try alternatives if the
  // canonical one 404s — saves an outage when they reshuffle file names.
  "https://canadabuys.canada.ca/opendata/opendata-tender-notice.csv",
  "https://canadabuys.canada.ca/sites/default/files/csv/tpsgc-pwgsc_ao-t_tender-notice.csv",
];

export const canadaBuysAdapter: IngestAdapter = {
  source: "canada_buys",
  label: "CanadaBuys (Federal Canada)",
  requiredEnv: [],
  async fetchPage({ sinceIso, httpJson = defaultHttpJson }) {
    const sinceMs = new Date(sinceIso).getTime();
    let csv = "";
    const urls = [CSV_URL, ...FALLBACK_CSV_URLS];
    for (const url of urls) {
      try {
        csv = await httpJson<string>(url, { asText: true });
        if (csv && csv.length > 100) break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[canada_buys] CSV fetch failed at ${url}: ${msg}`);
      }
    }
    if (!csv || csv.length < 100) {
      console.warn(`[canada_buys] all CSV URLs returned empty/short payloads`);
      return { tenders: [], nextPageToken: null };
    }

    const rows = parseCsv(csv);
    if (rows.length === 0) return { tenders: [], nextPageToken: null };

    const header = rows[0]!;
    const idx = (matchers: string[]): number => {
      for (let i = 0; i < header.length; i++) {
        const h = (header[i] ?? "").toLowerCase();
        for (const m of matchers) {
          if (h.includes(m)) return i;
        }
      }
      return -1;
    };

    const cTitle = idx(["title-en", "title_en", "english title"]);
    const cId = idx(["reference-number-numero-reference", "reference_number"]);
    const cClosing = idx(["closing", "date-fermeture", "date_fermeture"]);
    const cPublished = idx(["publication-date", "publication_date"]);
    const cBuyer = idx(["procurement-entity", "procurement_entity", "entite"]);
    const cRegion = idx(["region-of-opportunity", "region_of"]);
    const cNoticeType = idx(["notice-type", "notice_type"]);
    const cUrl = idx(["notice-url-en", "notice_url_en", "url-en"]);
    const cGsinDesc = idx(["gsin-description-en", "gsin_description_en"]);

    const tenders: NormalizedTender[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      try {
        const title = (cTitle >= 0 ? row[cTitle] : "")?.trim();
        if (!title) continue;
        const externalId = (cId >= 0 ? row[cId] : `cb-${i}`) || `cb-${i}`;
        const publishedRaw = cPublished >= 0 ? row[cPublished] : null;
        const closingRaw = cClosing >= 0 ? row[cClosing] : null;
        const publishedAt = parseIsoOrDate(publishedRaw);
        if (
          Number.isFinite(sinceMs) &&
          publishedAt &&
          publishedAt.getTime() < sinceMs
        ) {
          continue;
        }
        const url =
          (cUrl >= 0 ? row[cUrl] : "")?.trim() ||
          `https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/${encodeURIComponent(externalId)}`;

        const tender: NormalizedTender = {
          externalId: String(externalId),
          source: "canada_buys",
          title,
          description: [
            cBuyer >= 0 ? row[cBuyer] : null,
            cNoticeType >= 0 ? row[cNoticeType] : null,
            cGsinDesc >= 0 ? row[cGsinDesc] : null,
            cRegion >= 0 ? row[cRegion] : null,
          ]
            .filter((s) => s && String(s).trim())
            .join("\n\n"),
          url,
          buyer:
            (cBuyer >= 0 ? row[cBuyer] : "")?.trim() || "Government of Canada",
          country: "CA",
          sector: (cGsinDesc >= 0 ? row[cGsinDesc] : null) || null,
          cpvCodes: [],
          budgetMinUsd: null,
          budgetMaxUsd: null,
          currency: "CAD",
          publishedAt: publishedAt ?? new Date(),
          deadlineAt: parseIsoOrDate(closingRaw),
          language: "en",
          raw: row,
        };
        tenders.push(NormalizedTenderSchema.parse(tender) as NormalizedTender);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[canada_buys] skipped row ${i}: ${msg}`);
      }
    }
    return { tenders, nextPageToken: null };
  },
};

/**
 * Tiny CSV parser — RFC 4180-ish. Handles quoted fields, doubled
 * quotes for escapes, CRLF or LF line endings. Doesn't allocate per
 * char so it stays cheap on multi-megabyte feeds.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n" || ch === "\r") {
        if (field.length > 0 || row.length > 0) {
          row.push(field);
          rows.push(row);
          row = [];
          field = "";
        }
        // Skip \n after \r so CRLF doesn't insert an empty row.
        if (ch === "\r" && text[i + 1] === "\n") i++;
      } else {
        field += ch;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseIsoOrDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
