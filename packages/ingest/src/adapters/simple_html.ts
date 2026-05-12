import { createHash } from "node:crypto";
import { NormalizedTenderSchema, type NormalizedTender, type TenderSourceId } from "@beta/shared";
import type { IngestAdapter } from "../types.ts";
import { decodeEntities, fetchHtml, stripTags } from "../util/html-scrape.ts";

interface SimpleTender {
  externalId?: string;
  title: string;
  description?: string;
  url?: string;
  buyer?: string;
  country: string;
  sector?: string | null;
  publishedAt?: Date | null;
  deadlineAt?: Date | null;
  currency?: string | null;
  raw?: unknown;
}

interface SimpleHtmlAdapterOpts {
  source: TenderSourceId;
  label: string;
  listingUrl: string;
  buyer: string;
  country: string;
  extractor: (html: string, listingUrl: string) => SimpleTender[];
  minIntervalMs?: number;
  /**
   * Opt-in TLS-chain relaxation for the listing host. Only for known public
   * portals (e.g. pda.gov.pk) whose servers omit intermediate certs.
   */
  insecureTls?: boolean;
}

export function simpleHtmlAdapter(opts: SimpleHtmlAdapterOpts): IngestAdapter {
  return {
    source: opts.source,
    label: opts.label,
    requiredEnv: [],
    async fetchPage({ sinceIso }) {
      const html = await fetchHtml(opts.listingUrl, {
        minIntervalMs: opts.minIntervalMs,
        insecureTls: opts.insecureTls,
      });
      const sinceMs = new Date(sinceIso).getTime();
      const tenders: NormalizedTender[] = [];

      for (const item of opts.extractor(html, opts.listingUrl)) {
        try {
          const publishedAt = item.publishedAt ?? new Date();
          if (Number.isFinite(sinceMs) && publishedAt.getTime() < sinceMs) continue;
          const url = absolutize(item.url ?? opts.listingUrl, opts.listingUrl);
          const externalId = item.externalId ?? stableId(opts.source, item.title, url);
          const tender: NormalizedTender = {
            externalId,
            source: opts.source,
            title: clean(item.title),
            description: clean(item.description ?? item.title),
            url,
            buyer: clean(item.buyer ?? opts.buyer),
            country: item.country,
            sector: item.sector ?? null,
            cpvCodes: [],
            budgetMinUsd: null,
            budgetMaxUsd: null,
            currency: item.currency ?? null,
            publishedAt,
            deadlineAt: item.deadlineAt ?? null,
            language: "en",
            raw: item.raw ?? item,
          };
          tenders.push(NormalizedTenderSchema.parse(tender) as NormalizedTender);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[${opts.source}] skipped item: ${msg}`);
        }
      }

      return { tenders, nextPageToken: null };
    },
  };
}

export function extractTableRows(html: string): string[][] {
  const rows: string[][] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells = matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi, rowMatch[1]!)
      .map((m) => m[1] ?? "");
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

export function firstLink(html: string, baseUrl: string): string | null {
  const m = /<a[^>]+href=["']([^"']+)["'][^>]*>/i.exec(html);
  return m?.[1] ? absolutize(decodeEntities(m[1]), baseUrl) : null;
}

export function cellText(html: string): string {
  return clean(stripTags(html));
}

export function parseLooseDate(s: string): Date | null {
  if (!s) return null;
  const normalized = clean(s)
    .replace(/(\d+)(st|nd|rd|th)\b/gi, "$1")
    .replace(/\s+@/g, " ")
    .replace(/\s+/g, " ");
  const direct = new Date(normalized);
  if (!Number.isNaN(direct.getTime())) return direct;

  const m = /(\w{3,9})\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?/i.exec(normalized);
  if (!m) return null;
  const month = MONTHS[m[1]!.slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  let hour = m[4] ? Number.parseInt(m[4], 10) : 0;
  const minute = m[5] ? Number.parseInt(m[5], 10) : 0;
  const ampm = m[6]?.toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return new Date(Date.UTC(Number.parseInt(m[3]!, 10), month, Number.parseInt(m[2]!, 10), hour, minute));
}

export function clean(s: string): string {
  return decodeEntities(s ?? "").replace(/\s+/g, " ").trim();
}

export function stableId(source: TenderSourceId, title: string, url: string): string {
  return createHash("sha256").update(`${source}:${title}:${url}`).digest("hex").slice(0, 24);
}

function absolutize(url: string, baseUrl: string): string {
  return new URL(url, baseUrl).toString();
}

function matchAll(re: RegExp, s: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = g.exec(s)) !== null) out.push(m);
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
