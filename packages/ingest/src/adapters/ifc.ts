// source: https://disclosures.ifc.org/projects-list
//
// International Finance Corporation (private-sector arm of the World
// Bank Group). Procurement opportunities live on the IFC Disclosures
// Portal. Projects-list is React-rendered — use Playwright.
//
// IFC project anchors are /project-detail/<projectId>. Each card has
// project name, country, sector, status, and dates.

import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { IngestAdapter } from "../types.ts";
import { decodeEntities, stripTags } from "../util/html-scrape.ts";
import { fetchRendered, diagnoseEmptyParse } from "../util/playwright-render.ts";

// /project-disclosures is the primary IFC portal listing. The /search
// route requires filter interaction to populate results. project-
// disclosures renders card links directly.
const LIST_URL = "https://disclosures.ifc.org/project-disclosures";

export const ifcAdapter: IngestAdapter = {
  source: "ifc",
  label: "International Finance Corporation",
  requiredEnv: [],
  async fetchPage({ sinceIso }) {
    const sinceMs = new Date(sinceIso).getTime();
    let html: string;
    try {
      html = await fetchRendered(LIST_URL, {
        // Don't wait for networkidle — IFC's disclosure portal has
        // long-poll analytics that never resolve. domcontentloaded +
        // selector wait is plenty.
        waitUntil: "domcontentloaded",
        // IFC project detail anchors include either /project-detail/<id>
        // or just an external project number. Accept both patterns.
        waitForSelector: "a[href*='project-detail'], a[href*='Project_Number']",
        timeoutMs: 45_000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ifc] render failed: ${msg}`);
      return { tenders: [], nextPageToken: null };
    }

    const items = parseIfc(html);
    if (items.length === 0) diagnoseEmptyParse("ifc", html);
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
          source: "ifc",
          title: item.title,
          description: [item.country, item.sector, item.status].filter(Boolean).join("\n\n"),
          url: item.detailUrl,
          buyer: "IFC",
          country: null,
          sector: item.sector || null,
          cpvCodes: [],
          budgetMinUsd: null,
          budgetMaxUsd: null,
          currency: "USD",
          publishedAt: item.publishedAt ?? new Date(),
          deadlineAt: null, // IFC projects don't have biddable deadlines
          language: "en",
          raw: item,
        };
        tenders.push(NormalizedTenderSchema.parse(tender) as NormalizedTender);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[ifc] skipped item: ${msg}`);
      }
    }
    return { tenders, nextPageToken: null };
  },
};

interface IfcItem {
  id: string;
  detailUrl: string;
  title: string;
  country: string;
  sector: string;
  status: string;
  publishedAt: Date | null;
}

function parseIfc(html: string): IfcItem[] {
  const out: IfcItem[] = [];
  const anchorRe =
    /<a\b[^>]*href="([^"]*\/project-detail\/(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const hrefRaw = m[1]!;
    const projectId = m[2]!;
    const titleHtml = m[3]!;
    const title = decodeEntities(stripTags(titleHtml).trim());
    if (!title || title.length < 4) continue;
    if (seen.has(projectId)) continue;
    seen.add(projectId);

    const detailUrl = hrefRaw.startsWith("http")
      ? hrefRaw
      : `https://disclosures.ifc.org${hrefRaw.startsWith("/") ? "" : "/"}${hrefRaw}`;

    const start = m.index + m[0]!.length;
    const window = html.slice(start, start + 2000);
    const country = pickField(window, [/Country[^<]*<[^>]*>\s*([^<]+)/i]) ?? "";
    const sector = pickField(window, [/Sector[^<]*<[^>]*>\s*([^<]+)/i, /Industry[^<]*<[^>]*>\s*([^<]+)/i]) ?? "";
    const status = pickField(window, [/Status[^<]*<[^>]*>\s*([^<]+)/i]) ?? "";
    const publishedAt = parseIsoDate(
      pickField(window, [
        /Disclosure Date[^<]*<[^>]*>\s*([^<]+)/i,
        /Board Approval[^<]*<[^>]*>\s*([^<]+)/i,
        /Date[^<]*<[^>]*>\s*([^<]+)/i,
      ]),
    );

    out.push({ id: projectId, detailUrl, title, country, sector, status, publishedAt });
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

function parseIsoDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
