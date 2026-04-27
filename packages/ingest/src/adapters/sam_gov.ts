// source: https://open.gsa.gov/api/get-opportunities-public-api/
import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { IngestAdapter } from "../types";
import { httpJson as defaultHttpJson } from "../util/http";
import { toUsd } from "../util/usd";

const ENDPOINT = "https://api.sam.gov/opportunities/v2/search";
const PAGE_LIMIT = 100;

export const samGovAdapter: IngestAdapter = {
  source: "sam_gov",
  label: "SAM.gov (US Federal)",
  requiredEnv: ["SAM_GOV_API_KEY"],
  async fetchPage({ sinceIso, pageToken, httpJson = defaultHttpJson }) {
    const apiKey = process.env.SAM_GOV_API_KEY ?? "";
    const offset = pageToken ? Number.parseInt(pageToken, 10) : 0;

    const postedFrom = formatSamDate(sinceIso);
    const postedTo = formatSamDate(new Date().toISOString());

    const params = new URLSearchParams({
      api_key: apiKey,
      postedFrom,
      postedTo,
      limit: String(PAGE_LIMIT),
      offset: String(offset),
    });
    const url = `${ENDPOINT}?${params.toString()}`;

    const data = await httpJson<SamSearchResponse>(url);
    const opportunities = data?.opportunitiesData ?? [];

    const tenders: NormalizedTender[] = [];
    for (const op of opportunities) {
      try {
        const tender = mapSamOpportunity(op);
        tenders.push(NormalizedTenderSchema.parse(tender) as NormalizedTender);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[sam_gov] skipped opportunity ${op?.noticeId ?? "?"}: ${msg}`);
      }
    }

    const totalRecords = data?.totalRecords ?? 0;
    const consumed = offset + opportunities.length;
    const nextPageToken =
      opportunities.length === PAGE_LIMIT && consumed < totalRecords ? String(consumed) : null;

    return { tenders, nextPageToken };
  },
};

function formatSamDate(iso: string): string {
  // TODO(lead): SAM.gov expects MM/dd/yyyy in postedFrom/postedTo per public docs.
  const d = new Date(iso);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

interface SamSearchResponse {
  totalRecords?: number;
  opportunitiesData?: SamOpportunity[];
}

interface SamOpportunity {
  noticeId?: string;
  title?: string;
  description?: string;
  fullParentPathName?: string;
  postedDate?: string;
  responseDeadLine?: string | null;
  uiLink?: string;
  naicsCode?: string;
  classificationCode?: string;
  award?: { amount?: string | number };
  placeOfPerformance?: { country?: { code?: string } };
}

function mapSamOpportunity(op: SamOpportunity) {
  // TODO(lead): verify field names against live API response.
  const externalId = op.noticeId ?? "";
  const title = op.title ?? "";
  const description = op.description ?? "";
  const url = op.uiLink ?? `https://sam.gov/opp/${externalId}/view`;
  const buyer = op.fullParentPathName ?? "US Federal Government";
  const publishedAt = op.postedDate ? new Date(op.postedDate) : new Date();
  const deadlineAt = op.responseDeadLine ? new Date(op.responseDeadLine) : null;

  let budgetAmount: number | null = null;
  if (op.award?.amount !== undefined && op.award.amount !== null) {
    const n = typeof op.award.amount === "number" ? op.award.amount : Number.parseFloat(op.award.amount);
    if (Number.isFinite(n)) budgetAmount = n;
  }
  const budgetUsd = toUsd(budgetAmount, "USD");

  return {
    externalId,
    source: "sam_gov" as const,
    title,
    description,
    url,
    buyer,
    country: "US",
    sector: op.naicsCode ?? op.classificationCode ?? null,
    cpvCodes: [],
    budgetMinUsd: budgetUsd,
    budgetMaxUsd: budgetUsd,
    currency: "USD",
    publishedAt,
    deadlineAt,
    language: "en",
    raw: op,
  };
}
