import type {
  CapabilityProfile,
  NormalizedTender,
  PastProject,
  TenderSourceId,
} from "@beta/shared";

export function tenderRowToNormalized(row: any): NormalizedTender {
  return {
    externalId: row.externalId,
    source: row.source as TenderSourceId,
    title: row.title,
    description: row.description ?? "",
    url: row.url,
    buyer: row.buyer ?? "",
    country: row.country ?? null,
    sector: row.sector ?? null,
    cpvCodes: Array.isArray(row.cpvCodes) ? row.cpvCodes : [],
    budgetMinUsd: row.budgetMinUsd ?? null,
    budgetMaxUsd: row.budgetMaxUsd ?? null,
    currency: row.currency ?? null,
    publishedAt:
      row.publishedAt instanceof Date
        ? row.publishedAt
        : new Date(row.publishedAt),
    deadlineAt: row.deadlineAt
      ? row.deadlineAt instanceof Date
        ? row.deadlineAt
        : new Date(row.deadlineAt)
      : null,
    language: row.language ?? "en",
    raw: row.raw,
  };
}

export function profileRowToCapability(
  row: any,
  companyName: string,
): CapabilityProfile {
  const pastProjects: PastProject[] = Array.isArray(row.pastProjects)
    ? (row.pastProjects as PastProject[])
    : [];
  return {
    companyName,
    oneLiner: row.oneLiner ?? "",
    industries: Array.isArray(row.industries) ? row.industries : [],
    techStack: Array.isArray(row.techStack) ? row.techStack : [],
    services: Array.isArray(row.services) ? row.services : [],
    certifications: Array.isArray(row.certifications) ? row.certifications : [],
    pastClients: Array.isArray(row.pastClients) ? row.pastClients : [],
    pastProjects,
    geographies: Array.isArray(row.geographies) ? row.geographies : [],
    teamSize: row.teamSize ?? 0,
    budgetRangeUsd: {
      min: row.budgetMinUsd ?? 0,
      max: row.budgetMaxUsd ?? 0,
    },
    languages: Array.isArray(row.languages) ? row.languages : ["en"],
    // Defaults to false for older profile rows persisted before migration 006.
    ignoreLocation: Boolean(row.ignoreLocation ?? false),
  };
}
