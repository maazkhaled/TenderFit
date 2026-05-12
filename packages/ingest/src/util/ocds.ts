/**
 * Open Contracting Data Standard (OCDS) helpers.
 *
 * Both UK Find a Tender and UK Contracts Finder publish identical OCDS
 * release packages. This file abstracts the shared shape so each UK adapter
 * is just a thin wrapper picking the right endpoint and source label.
 *
 * Spec: https://standard.open-contracting.org/latest/en/schema/release/
 */

import { NormalizedTenderSchema, type NormalizedTender } from "@beta/shared";
import type { TenderSourceId } from "@beta/shared";
import { toUsd } from "./usd.ts";

export interface OcdsRelease {
  ocid?: string;
  id?: string;
  date?: string;
  language?: string;
  buyer?: { id?: string; name?: string };
  tender?: {
    id?: string;
    title?: string;
    description?: string;
    value?: { amount?: number; currency?: string };
    minValue?: { amount?: number; currency?: string };
    tenderPeriod?: { startDate?: string; endDate?: string };
    classification?: { scheme?: string; id?: string; description?: string };
    additionalClassifications?: Array<{ scheme?: string; id?: string }>;
    items?: Array<{
      classification?: { scheme?: string; id?: string };
    }>;
    mainProcurementCategory?: string;
  };
  parties?: Array<{
    id?: string;
    name?: string;
    address?: { countryName?: string };
    roles?: string[];
  }>;
}

export interface OcdsReleasePackage {
  releases?: OcdsRelease[];
  links?: { next?: string | null };
}

export function ocdsReleasesToTenders(
  releases: OcdsRelease[],
  source: TenderSourceId,
  defaultUrl: (id: string) => string,
): NormalizedTender[] {
  const out: NormalizedTender[] = [];
  for (const r of releases) {
    try {
      const t = toNormalizedTender(r, source, defaultUrl);
      if (!t) continue;
      out.push(NormalizedTenderSchema.parse(t) as NormalizedTender);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[${source}] skipped release ${r?.id ?? "?"}: ${msg}`);
    }
  }
  return out;
}

function toNormalizedTender(
  r: OcdsRelease,
  source: TenderSourceId,
  defaultUrl: (id: string) => string,
): NormalizedTender | null {
  const externalId = r.id ?? r.ocid;
  if (!externalId) return null;
  const tender = r.tender;
  if (!tender) return null;

  const title = (tender.title ?? "").trim();
  if (!title) return null;
  const description = (tender.description ?? "").trim();

  const value = tender.value ?? null;
  const minVal = tender.minValue ?? null;
  const currency = value?.currency ?? minVal?.currency ?? null;
  const amountMax =
    typeof value?.amount === "number" ? value.amount : null;
  const amountMin =
    typeof minVal?.amount === "number" ? minVal.amount : amountMax;
  const usdMax = toUsd(amountMax, currency);
  const usdMin = toUsd(amountMin, currency);

  const publishedAt = r.date ? new Date(r.date) : new Date();
  const deadlineRaw = tender.tenderPeriod?.endDate ?? null;
  const deadlineAt = deadlineRaw ? new Date(deadlineRaw) : null;

  const cpvCodes = collectCpvCodes(r);
  const sector =
    cpvCodes[0] ??
    tender.classification?.description ??
    tender.mainProcurementCategory ??
    null;

  // Buyer country: prefer the buyer party's address; fall back to "GB" for
  // UK feeds (the OCDS publisher is always UK government for these endpoints).
  const buyerParty = (r.parties ?? []).find((p) =>
    p.roles?.includes("buyer"),
  );
  const country =
    iso2FromCountryName(buyerParty?.address?.countryName ?? null) ??
    (source === "uk_find_a_tender" || source === "uk_contracts_finder"
      ? "GB"
      : null);

  return {
    externalId: String(externalId),
    source,
    title,
    description,
    url: defaultUrl(String(externalId)),
    buyer: r.buyer?.name ?? buyerParty?.name ?? "UK Government",
    country,
    sector,
    cpvCodes,
    budgetMinUsd: usdMin,
    budgetMaxUsd: usdMax,
    currency,
    publishedAt,
    deadlineAt,
    language: r.language ?? "en",
    raw: r,
  };
}

function collectCpvCodes(r: OcdsRelease): string[] {
  const codes: string[] = [];
  const main = r.tender?.classification;
  if (main?.scheme === "CPV" && typeof main.id === "string") codes.push(main.id);
  for (const c of r.tender?.additionalClassifications ?? []) {
    if (c.scheme === "CPV" && typeof c.id === "string") codes.push(c.id);
  }
  for (const item of r.tender?.items ?? []) {
    const c = item.classification;
    if (c?.scheme === "CPV" && typeof c.id === "string") codes.push(c.id);
  }
  return Array.from(new Set(codes));
}

function iso2FromCountryName(name: string | null): string | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  // Tiny lookup — full mapping isn't worth the dep here.
  const map: Record<string, string> = {
    "united kingdom": "GB",
    "england": "GB",
    "scotland": "GB",
    "wales": "GB",
    "northern ireland": "GB",
    "united states": "US",
    "germany": "DE",
    "france": "FR",
    "ireland": "IE",
  };
  return map[n] ?? null;
}
