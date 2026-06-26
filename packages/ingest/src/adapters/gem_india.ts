// source: https://bidplus.gem.gov.in/all-bids
//
// Government e-Marketplace India (GeM) — federal + state IT/services
// tenders, huge volume. The all-bids page is a React SPA; we render it
// with Playwright, then parse the resulting "bid card" anchors.
//
// GeM bid URLs look like /bidlists/<BID_ID> or
// /showbidDocument/<DOC_ID>. We pick anchors whose href contains either
// segment. Each card on the rendered page exposes title, ministry,
// bid number, value, end-date in adjacent spans.
//
// Note on legality / ToS: GeM publishes the all-bids listing as a
// public read-only page (no auth required, no robots-disallow). We
// stay within the public surface — no bid submission, no scraping
// behind login.

import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { IngestAdapter } from "../types.ts";
import { decodeEntities, stripTags } from "../util/html-scrape.ts";
import { fetchRendered } from "../util/playwright-render.ts";

const LIST_URL = "https://bidplus.gem.gov.in/all-bids";

export const gemIndiaAdapter: IngestAdapter = {
  source: "gem_india",
  label: "GeM India (Government e-Marketplace)",
  requiredEnv: [],
  async fetchPage({ sinceIso }) {
    const sinceMs = new Date(sinceIso).getTime();
    let html: string;
    try {
      // GeM's analytics pings never go idle so waitUntil=networkidle
      // always times out at 60s. domcontentloaded + selector wait is
      // sufficient — the bid cards are server-injected into the
      // initial HTML payload, not deferred behind XHR.
      html = await fetchRendered(LIST_URL, {
        waitUntil: "domcontentloaded",
        waitForSelector:
          "a[href*='bidlists'], a[href*='showbidDocument'], a[href*='showradardirectorate']",
        timeoutMs: 45_000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[gem_india] render failed: ${msg}`);
      return { tenders: [], nextPageToken: null };
    }

    const items = parseGem(html);
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
          source: "gem_india",
          title: item.title,
          description: [item.ministry, item.department, item.value].filter(Boolean).join("\n\n"),
          url: item.detailUrl,
          buyer: item.ministry || item.department || "Government of India",
          country: "IN",
          sector: item.department || null,
          cpvCodes: [],
          budgetMinUsd: null,
          budgetMaxUsd: null,
          currency: "INR",
          publishedAt: item.publishedAt ?? new Date(),
          deadlineAt: item.endAt,
          language: "en",
          raw: item,
        };
        tenders.push(NormalizedTenderSchema.parse(tender) as NormalizedTender);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[gem_india] skipped item: ${msg}`);
      }
    }
    return { tenders, nextPageToken: null };
  },
};

interface GemItem {
  id: string;
  detailUrl: string;
  title: string;
  ministry: string;
  department: string;
  value: string;
  publishedAt: Date | null;
  endAt: Date | null;
}

function parseGem(html: string): GemItem[] {
  const out: GemItem[] = [];
  const anchorRe =
    /<a\b[^>]*href="([^"]*(?:bidlists|showbidDocument|showradardirectorate)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const hrefRaw = m[1]!;
    const titleHtml = m[2]!;
    const title = decodeEntities(stripTags(titleHtml).trim());
    if (!title || title.length < 4) continue;

    const detailUrl = hrefRaw.startsWith("http")
      ? hrefRaw
      : `https://bidplus.gem.gov.in/${hrefRaw.replace(/^\/+/, "")}`;
    const idM = /(?:bidlists|showbidDocument|showradardirectorate)\/([\w-]+)/i.exec(detailUrl);
    const id = idM ? idM[1]! : detailUrl;
    if (seen.has(id)) continue;
    seen.add(id);

    const start = Math.max(0, m.index - 600);
    const end = Math.min(html.length, m.index + m[0]!.length + 2000);
    const window = html.slice(start, end);
    const ministry =
      pickField(window, [/Ministry[^<]*<[^>]*>\s*([^<]+)/i]) ?? "";
    const department =
      pickField(window, [/Department[^<]*<[^>]*>\s*([^<]+)/i]) ?? "";
    const value =
      pickField(window, [
        /Value[^<]*<[^>]*>\s*([^<]+)/i,
        /Estimated Value[^<]*<[^>]*>\s*([^<]+)/i,
      ]) ?? "";
    const publishedAt = parseGemDate(
      pickField(window, [
        /Start Date[^<]*<[^>]*>\s*([^<]+)/i,
        /Bid Start[^<]*<[^>]*>\s*([^<]+)/i,
      ]),
    );
    const endAt = parseGemDate(
      pickField(window, [
        /End Date[^<]*<[^>]*>\s*([^<]+)/i,
        /Bid End[^<]*<[^>]*>\s*([^<]+)/i,
      ]),
    );

    out.push({
      id,
      detailUrl,
      title,
      ministry,
      department,
      value,
      publishedAt,
      endAt,
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
 * GeM dates: "31-12-2026 16:00:00" or "31/12/2026". IST = UTC+5:30.
 */
function parseGemDate(raw: string | null): Date | null {
  if (!raw) return null;
  const m = /(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(raw);
  if (!m) return null;
  const day = Number.parseInt(m[1]!, 10);
  const month = Number.parseInt(m[2]!, 10) - 1;
  const year = Number.parseInt(m[3]!, 10);
  const hour = m[4] ? Number.parseInt(m[4], 10) : 0;
  const minute = m[5] ? Number.parseInt(m[5], 10) : 0;
  // IST = UTC+5:30
  const utcMs = Date.UTC(year, month, day, hour - 5, minute - 30);
  return new Date(utcMs);
}
