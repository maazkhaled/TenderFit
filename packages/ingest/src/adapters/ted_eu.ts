// source: https://ted.europa.eu/en/release-notes/api-v3 (TED Search API v3)
import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { IngestAdapter } from "../types";
import { httpJson as defaultHttpJson } from "../util/http";
import { toUsd } from "../util/usd";

const ENDPOINT = "https://api.ted.europa.eu/v3/notices/search";
const PAGE_LIMIT = 100;

export const tedEuAdapter: IngestAdapter = {
  source: "ted_eu",
  label: "TED (EU Public Procurement)",
  requiredEnv: [],
  async fetchPage({ sinceIso, pageToken, httpJson = defaultHttpJson }) {
    const page = pageToken ? Number.parseInt(pageToken, 10) : 1;
    const sinceDate = toTedDate(sinceIso);

    const body = {
      query: `publication-date>=${sinceDate}`,
      fields: [
        "publication-number",
        "title",
        "description",
        "publication-date",
        "deadline-receipt-tender-date-lot",
        "buyer-name",
        "buyer-country",
        "classification-cpv",
        "estimated-value-lot",
        "notice-type",
        "links",
      ],
      page,
      limit: PAGE_LIMIT,
    };

    const data = await httpJson<TedSearchResponse>(ENDPOINT, {
      method: "POST",
      body,
    });

    const notices = data?.notices ?? [];
    const tenders: NormalizedTender[] = [];
    for (const n of notices) {
      try {
        const t = mapTedNotice(n);
        tenders.push(NormalizedTenderSchema.parse(t) as NormalizedTender);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[ted_eu] skipped notice ${n?.["publication-number"] ?? "?"}: ${msg}`);
      }
    }

    const total = data?.total ?? 0;
    const consumed = page * PAGE_LIMIT;
    const nextPageToken = notices.length === PAGE_LIMIT && consumed < total ? String(page + 1) : null;

    return { tenders, nextPageToken };
  },
};

function toTedDate(iso: string): string {
  // TODO(lead): verify TED date format (likely yyyymmdd or yyyy-mm-dd in v3).
  const d = new Date(iso);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

interface TedSearchResponse {
  total?: number;
  notices?: TedNotice[];
}

interface TedNotice {
  "publication-number"?: string;
  title?: string | { eng?: string; en?: string } | Record<string, string>;
  description?: string | { eng?: string; en?: string } | Record<string, string>;
  "publication-date"?: string;
  "deadline-receipt-tender-date-lot"?: string | string[] | null;
  "buyer-name"?: string | string[];
  "buyer-country"?: string | string[];
  "classification-cpv"?: string | string[];
  "estimated-value-lot"?: { amount?: number; currency?: string } | Array<{ amount?: number; currency?: string }>;
  links?: { html?: { eng?: string; en?: string } | Record<string, string> };
}

function mapTedNotice(n: TedNotice) {
  // TODO(lead): verify field names against live API response — TED v3 uses dotted multilingual keys.
  const externalId = n["publication-number"] ?? "";
  const title = pickLocalized(n.title) ?? "";
  const description = pickLocalized(n.description) ?? "";
  const buyer = pickFirstString(n["buyer-name"]) ?? "EU Buyer";
  const country = pickCountry(n["buyer-country"]);
  const cpvCodes = toStringArray(n["classification-cpv"]);
  const publishedAt = n["publication-date"] ? new Date(n["publication-date"]) : new Date();
  const deadlineRaw = pickFirstString(n["deadline-receipt-tender-date-lot"]);
  const deadlineAt = deadlineRaw ? new Date(deadlineRaw) : null;

  const valueObj = Array.isArray(n["estimated-value-lot"]) ? n["estimated-value-lot"][0] : n["estimated-value-lot"];
  const currency = valueObj?.currency ?? null;
  const amount = typeof valueObj?.amount === "number" ? valueObj.amount : null;
  const usd = toUsd(amount, currency);

  const url = pickLocalized(n.links?.html) ?? `https://ted.europa.eu/en/notice/-/detail/${encodeURIComponent(externalId)}`;

  return {
    externalId,
    source: "ted_eu" as const,
    title,
    description,
    url,
    buyer,
    country,
    sector: cpvCodes[0] ?? null,
    cpvCodes,
    budgetMinUsd: usd,
    budgetMaxUsd: usd,
    currency,
    publishedAt,
    deadlineAt,
    language: "en",
    raw: n,
  };
}

function pickLocalized(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as Record<string, string>;
    return o.eng ?? o.en ?? Object.values(o)[0] ?? null;
  }
  return null;
}

function pickFirstString(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
  return null;
}

function pickCountry(v: unknown): string | null {
  const s = pickFirstString(v);
  if (!s) return null;
  const code = s.toUpperCase().slice(0, 2);
  return code.length === 2 ? code : null;
}

function toStringArray(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}
