// source: https://www.contractsfinder.service.gov.uk/apidocumentation
// Free, no API key. Returns OCDS-format release packages. UK below-threshold
// procurement and SME-friendly contracts. Same OCDS schema as Find a Tender.
import type { IngestAdapter } from "../types";
import { httpJson as defaultHttpJson } from "../util/http";
import { ocdsReleasesToTenders, type OcdsReleasePackage } from "../util/ocds";

const ENDPOINT =
  "https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search";
const PAGE_LIMIT = 100;
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ProjectBeta-Ingest";

export const ukContractsFinderAdapter: IngestAdapter = {
  source: "uk_contracts_finder",
  label: "UK Contracts Finder (below-threshold)",
  requiredEnv: [],
  async fetchPage({ sinceIso, pageToken, httpJson = defaultHttpJson }) {
    const updatedFrom = formatTimestamp(sinceIso);

    const url = pageToken
      ? pageToken
      : `${ENDPOINT}?updatedFrom=${encodeURIComponent(updatedFrom)}&limit=${PAGE_LIMIT}`;

    const data = await httpJson<OcdsReleasePackage>(url, {
      headers: { "User-Agent": BROWSER_UA },
    });

    const releases = data?.releases ?? [];
    const tenders = ocdsReleasesToTenders(
      releases,
      "uk_contracts_finder",
      (id) =>
        `https://www.contractsfinder.service.gov.uk/Notice/${encodeURIComponent(id)}`,
    );

    const next = data?.links?.next ?? null;
    const nextPageToken = next && releases.length === PAGE_LIMIT ? next : null;

    return { tenders, nextPageToken };
  },
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().replace(/\.\d+Z$/, "");
  return d.toISOString().replace(/\.\d+Z$/, "");
}
