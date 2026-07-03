// source: https://www.iadb.org/en/projects-search
//
// Inter-American Development Bank (Latin America focus). The projects
// search page is server-rendered — a clean HTML table with one row per
// project: project number, operation number, country, sector, title,
// total cost, status, approval date. No JS needed. Switched from
// /procurement-notices (404) to /projects-search after probe.

import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { IngestAdapter } from "../types.ts";
import { decodeEntities, stripTags } from "../util/html-scrape.ts";
import { fetchRendered, diagnoseEmptyParse } from "../util/playwright-render.ts";

const LIST_URL = "https://www.iadb.org/en/projects-search";

export const iadbAdapter: IngestAdapter = {
  source: "iadb",
  label: "Inter-American Development Bank",
  requiredEnv: [],
  async fetchPage({ sinceIso }) {
    const sinceMs = new Date(sinceIso).getTime();
    let html: string;
    try {
      // IADB rejects direct HTTP from the production VPS region with
      // 403. Route through Playwright + a homepage warmup so we look
      // like a real Chrome session.
      html = await fetchRendered(LIST_URL, {
        waitUntil: "domcontentloaded",
        waitForSelector: "tr td, a[href*='/project']",
        timeoutMs: 45_000,
        warmupUrl: "https://www.iadb.org/en",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[iadb] fetch failed: ${msg}`);
      return { tenders: [], nextPageToken: null };
    }

    const items = parseIadb(html);
    if (items.length === 0) diagnoseEmptyParse("iadb", html);
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
          source: "iadb",
          title: item.title,
          description: [item.country, item.sector, item.type].filter(Boolean).join("\n\n"),
          url: item.detailUrl,
          buyer: "IADB",
          country: null,
          sector: item.sector || null,
          cpvCodes: [],
          budgetMinUsd: null,
          budgetMaxUsd: null,
          currency: "USD",
          publishedAt: item.publishedAt ?? new Date(),
          deadlineAt: item.deadlineAt,
          language: "en",
          raw: item,
        };
        tenders.push(NormalizedTenderSchema.parse(tender) as NormalizedTender);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[iadb] skipped item: ${msg}`);
      }
    }
    return { tenders, nextPageToken: null };
  },
};

interface IadbItem {
  id: string;
  detailUrl: string;
  title: string;
  country: string;
  sector: string;
  type: string;
  publishedAt: Date | null;
  deadlineAt: Date | null;
}

function parseIadb(html: string): IadbItem[] {
  const out: IadbItem[] = [];
  // IADB renders each project as a <tr> with cells in fixed order:
  // [Project Number, Operation Number, Country, Sector, Title,
  //  Total Cost, Status, Approval Date]. Project numbers follow the
  // pattern <2-letter-country>-<L|T><4-5 digits>, e.g. ME-L1348.
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((trMatch = trRe.exec(html)) !== null) {
    const trBody = trMatch[1]!;
    const cells = splitCells(trBody);
    if (cells.length < 5) continue;

    const projectNumber = cleanCell(cells[0] ?? "");
    if (!/^[A-Z]{2}-[A-Z]\d{3,5}$/.test(projectNumber)) continue; // header / non-data rows
    if (seen.has(projectNumber)) continue;
    seen.add(projectNumber);

    const country = cleanCell(cells[2] ?? "");
    const sector = cleanCell(cells[3] ?? "");
    const titleCell = cells[4] ?? "";
    const title = cleanCell(titleCell);
    if (!title) continue;

    // Title cell often contains an <a> with the project detail URL.
    const linkM = /<a\b[^>]*href="([^"]+)"/i.exec(titleCell);
    const hrefRaw = linkM?.[1] ?? `/en/project-description-title%2C1303.html?id=${encodeURIComponent(projectNumber)}`;
    const detailUrl = hrefRaw.startsWith("http")
      ? hrefRaw
      : `https://www.iadb.org${hrefRaw.startsWith("/") ? "" : "/"}${hrefRaw}`;

    const status = cleanCell(cells[6] ?? "");
    const dateRaw = cleanCell(cells[7] ?? "");
    const publishedAt = parseIadbDate(dateRaw);

    out.push({
      id: projectNumber,
      detailUrl,
      title,
      country,
      sector,
      type: status,
      publishedAt,
      deadlineAt: null, // Project search doesn't expose biddable deadlines
    });
  }
  return out;
}

function splitCells(trBody: string): string[] {
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

function parseIadbDate(raw: string): Date | null {
  if (!raw) return null;
  // Format: "Dec. 16 2025" or "Dec 16 2025"
  const m = /([A-Za-z]{3})\.?\s+(\d{1,2})\s+(\d{4})/.exec(raw);
  if (!m) return parseIsoOrShort(raw);
  const monthName = m[1]!.toLowerCase().slice(0, 3);
  const day = Number.parseInt(m[2]!, 10);
  const year = Number.parseInt(m[3]!, 10);
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const month = months[monthName];
  if (month === undefined) return null;
  return new Date(Date.UTC(year, month, day));
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

function parseIsoOrShort(raw: string | null): Date | null {
  if (!raw) return null;
  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) return iso;
  const m = /(\d{1,2})[-/\s]([A-Za-z]{3,}|\d{1,2})[-/\s](\d{4})/.exec(raw);
  if (!m) return null;
  const day = Number.parseInt(m[1]!, 10);
  const yr = Number.parseInt(m[3]!, 10);
  const monthRaw = m[2]!;
  const monthNum = /^\d+$/.test(monthRaw)
    ? Number.parseInt(monthRaw, 10) - 1
    : monthFromName(monthRaw);
  if (monthNum < 0 || monthNum > 11) return null;
  return new Date(Date.UTC(yr, monthNum, day));
}

function monthFromName(name: string): number {
  const k = name.toLowerCase().slice(0, 3);
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  return months[k] ?? -1;
}
