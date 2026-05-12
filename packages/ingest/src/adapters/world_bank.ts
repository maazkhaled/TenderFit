// source: https://search.worldbank.org/api/v2/procnotices (World Bank Procurement Notices)
import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { IngestAdapter } from "../types.ts";
import { httpJson as defaultHttpJson } from "../util/http.ts";
import { toUsd } from "../util/usd.ts";

const ENDPOINT = "https://search.worldbank.org/api/v2/procnotices";
const PAGE_LIMIT = 100;

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
    for (const d of docs) {
      try {
        const publishedAt = d.notice_date ? new Date(d.notice_date) : new Date();
        if (Number.isFinite(sinceMs) && publishedAt.getTime() < sinceMs) continue;
        const tender = mapWorldBankDoc(d, publishedAt);
        tenders.push(NormalizedTenderSchema.parse(tender) as NormalizedTender);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[world_bank] skipped doc ${d?.id ?? "?"}: ${msg}`);
      }
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
