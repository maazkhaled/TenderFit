// source: https://www.find-tender.service.gov.uk/apidocumentation
// Free, no API key. Returns OCDS-format release packages. UK higher-value
// procurement (above thresholds — pre-Brexit equivalent of TED EU notices).
import type { IngestAdapter } from "../types";
import { httpJson as defaultHttpJson } from "../util/http";
import { ocdsReleasesToTenders, type OcdsReleasePackage } from "../util/ocds";

const ENDPOINT = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages";
const PAGE_LIMIT = 100;
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ProjectBeta-Ingest";

export const ukFindATenderAdapter: IngestAdapter = {
  source: "uk_find_a_tender",
  label: "UK Find a Tender (above-threshold)",
  requiredEnv: [],
  async fetchPage({ sinceIso, pageToken, httpJson = defaultHttpJson }) {
    // updatedFrom must be `YYYY-MM-DDThh:mm:ss` — strip the trailing Z + ms.
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
      "uk_find_a_tender",
      (id) => `https://www.find-tender.service.gov.uk/Notice/${encodeURIComponent(id)}`,
    );

    const next = data?.links?.next ?? null;
    // The "next" link is returned even when the current page is short — only
    // chase it when we actually saw a full page of results.
    const nextPageToken = next && releases.length === PAGE_LIMIT ? next : null;

    return { tenders, nextPageToken };
  },
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().replace(/\.\d+Z$/, "");
  return d.toISOString().replace(/\.\d+Z$/, "");
}
