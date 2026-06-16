// source: https://search.worldbank.org/api/v2/procnotices (World Bank Procurement Notices)
import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { IngestAdapter } from "../types.ts";
import { httpJson as defaultHttpJson } from "../util/http.ts";
import { toUsd } from "../util/usd.ts";

const ENDPOINT = "https://search.worldbank.org/api/v2/procnotices";
const PAGE_LIMIT = 100;

/**
 * Lower-cased keywords that mark a notice as a *closed* outcome event, not
 * an open bidding opportunity. The WB feed mixes these in with live tenders;
 * before this filter we were ingesting (and the matcher was scoring) past
 * contract awards as if they were biddable, which is exactly the noise the
 * customer flagged.
 *
 * Keep this list inclusive (substring match, lowercase) — adding new ones
 * is cheap and safer than under-filtering.
 */
const CLOSED_NOTICE_KEYWORDS = [
  "award",          // "Contract Award", "Award Notice", "Awarded Contract"
  "cancellation",   // "Cancellation Notice"
  "cancelled",
  "withdrawn",
  "contract signed",
  "completion",
];

/**
 * Lower-cased keywords that mark a notice as an *open* opportunity. We
 * accept anything matching this — covers IFB / RFP / EOI / GPN / SPN flows.
 * We deliberately fall through (accept) when notice_type is empty/missing
 * rather than drop, since some valid live tenders ship with sparse metadata.
 */
const OPEN_NOTICE_KEYWORDS = [
  "request for",        // Request for Bids/Proposals/EOI
  "invitation",         // Invitation for Bids
  "specific procurement",
  "general procurement",
  "expression of interest",
  "prequalification",
  "consulting services",
  "bid",                // catch-all for "Bid Notice" etc
];

function isOpenOpportunity(noticeType: string | undefined): boolean {
  const t = (noticeType ?? "").toLowerCase().trim();
  if (!t) return true; // sparse metadata — accept rather than drop
  for (const kw of CLOSED_NOTICE_KEYWORDS) {
    if (t.includes(kw)) return false;
  }
  for (const kw of OPEN_NOTICE_KEYWORDS) {
    if (t.includes(kw)) return true;
  }
  // Doesn't match either list — be conservative and drop unknown "notice"
  // strings rather than ingest noise. If something legit slips through,
  // add the keyword to OPEN_NOTICE_KEYWORDS.
  return false;
}

export const worldBankAdapter: IngestAdapter = {
  source: "world_bank",
  label: "World Bank Procurement Notices",
  requiredEnv: [],
  async fetchPage({ sinceIso, pageToken, httpJson = defaultHttpJson }) {
    const offset = pageToken ? Number.parseInt(pageToken, 10) : 0;

    const params = new URLSearchParams({
      format: "json",
      rows: String(PAGE_LIMIT),
      os: String(offset),
      fl: "id,project_name,notice_type,notice_text,notice_date,deadline_date,project_ctry_name,project_ctry_code,procurement_method,total_contract_amount,bid_description,url",
    });
    const url = `${ENDPOINT}?${params.toString()}`;

    const data = await httpJson<WorldBankResponse>(url);
    const docs = extractDocs(data);
    const sinceMs = new Date(sinceIso).getTime();

    const tenders: NormalizedTender[] = [];
    let skippedClosed = 0;
    let skippedStaleDeadline = 0;
    const now = Date.now();
    const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
    for (const d of docs) {
      try {
        const publishedAt = d.notice_date ? new Date(d.notice_date) : new Date();
        if (Number.isFinite(sinceMs) && publishedAt.getTime() < sinceMs) continue;

        // Filter awarded / cancelled / completed notices — they're not
        // biddable opportunities, just artefacts of the WB feed mixing
        // outcome notices with open tenders.
        if (!isOpenOpportunity(d.notice_type)) {
          skippedClosed += 1;
          continue;
        }

        // Belt-and-braces: drop notices whose deadline is already 14+ days
        // past. Sometimes WB publishes late notices about long-closed bids.
        if (d.deadline_date) {
          const dl = new Date(d.deadline_date).getTime();
          if (Number.isFinite(dl) && dl + FOURTEEN_DAYS_MS < now) {
            skippedStaleDeadline += 1;
            continue;
          }
        }

        const tender = mapWorldBankDoc(d, publishedAt);
        tenders.push(NormalizedTenderSchema.parse(tender) as NormalizedTender);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[world_bank] skipped doc ${d?.id ?? "?"}: ${msg}`);
      }
    }
    if (skippedClosed > 0 || skippedStaleDeadline > 0) {
      console.log(
        `[world_bank] filtered out closed=${skippedClosed} stale_deadline=${skippedStaleDeadline} (kept ${tenders.length})`,
      );
    }

    const total = data?.total ?? 0;
    const consumed = offset + docs.length;
    const nextPageToken = docs.length === PAGE_LIMIT && consumed < total ? String(consumed) : null;

    return { tenders, nextPageToken };
  },
};

interface WorldBankResponse {
  total?: number;
  procnotices?: Record<string, WorldBankDoc> | WorldBankDoc[];
}

interface WorldBankDoc {
  id?: string;
  project_name?: string;
  notice_type?: string;
  notice_text?: string;
  bid_description?: string;
  notice_date?: string;
  deadline_date?: string | null;
  project_ctry_name?: string;
  project_ctry_code?: string;
  procurement_method?: string;
  total_contract_amount?: string | number;
  url?: string;
}

function extractDocs(data: WorldBankResponse): WorldBankDoc[] {
  const p = data?.procnotices;
  if (!p) return [];
  if (Array.isArray(p)) return p;
  return Object.values(p);
}

function mapWorldBankDoc(d: WorldBankDoc, publishedAt: Date) {
  // TODO(lead): verify field names against live API response.
  const externalId = d.id ?? "";
  const title = d.project_name ?? d.bid_description ?? "World Bank Procurement Notice";
  const description = d.notice_text ?? d.bid_description ?? "";
  const url = d.url ?? `https://projects.worldbank.org/en/projects-operations/procurement-detail/${encodeURIComponent(externalId)}`;
  const buyer = d.project_name ?? "World Bank";
  const country = isoCountry(d.project_ctry_code);
  const deadlineAt = d.deadline_date ? new Date(d.deadline_date) : null;

  let amount: number | null = null;
  if (d.total_contract_amount !== undefined && d.total_contract_amount !== null) {
    const n = typeof d.total_contract_amount === "number" ? d.total_contract_amount : Number.parseFloat(d.total_contract_amount);
    if (Number.isFinite(n)) amount = n;
  }
  const usd = toUsd(amount, "USD");

  return {
    externalId,
    source: "world_bank" as const,
    title,
    description,
    url,
    buyer,
    country,
    sector: d.procurement_method ?? d.notice_type ?? null,
    cpvCodes: [],
    budgetMinUsd: usd,
    budgetMaxUsd: usd,
    currency: "USD",
    publishedAt,
    deadlineAt,
    language: "en",
    raw: d,
  };
}

function isoCountry(code: string | undefined): string | null {
  if (!code) return null;
  const c = code.toUpperCase().slice(0, 2);
  return c.length === 2 ? c : null;
}
