import type { TenderSourceId } from "./constants.ts";

export type TenderSourceCategory =
  | "government"
  | "multilateral"
  | "un_agency"
  | "domestic"
  | "it_digital"
  | "planning_data"
  | "international"
  | "gcc";

export interface TenderSourceCatalogEntry {
  id: TenderSourceId;
  label: string;
  category: TenderSourceCategory;
  url: string;
  checkboxLabel: string;
  description: string;
}

export interface NormalizedTender {
  externalId: string;
  source: TenderSourceId;
  title: string;
  description: string;
  url: string;
  buyer: string;
  country: string | null;
  sector: string | null;
  cpvCodes: string[];
  budgetMinUsd: number | null;
  budgetMaxUsd: number | null;
  currency: string | null;
  publishedAt: Date;
  deadlineAt: Date | null;
  language: string;
  raw: unknown;
}

export interface PastProject {
  title: string;
  summary: string;
  sector?: string;
  valueUsd?: number;
}

export interface CapabilityProfile {
  companyName: string;
  oneLiner: string;
  industries: string[];
  techStack: string[];
  services: string[];
  certifications: string[];
  pastClients: string[];
  pastProjects: PastProject[];
  geographies: string[];
  teamSize: number;
  budgetRangeUsd: { min: number; max: number };
  languages: string[];
  /**
   * When true, scoring and retrieval ignore country/geography entirely.
   *
   * For companies (like r2v) that actively want international collaborations
   * and JVs, the default geo-match boost works against them — local-country
   * tenders are scored higher and international ones get downgraded. Flipping
   * this on:
   *   - strips Geographies from the profile embedding text (forces re-embed)
   *   - strips the Geographies/Country fields from the LLM scoring prompt
   *   - skips the geo-match boost/penalty in the win-probability heuristic
   *   - leaves the underlying data (profile.geographies, tender.country)
   *     untouched on disk so the flag is reversible without data loss
   */
  ignoreLocation: boolean;
}

export type GapSeverity = "blocker" | "major" | "minor";

export interface CapabilityGap {
  requirement: string;
  severity: GapSeverity;
}

export type WinProbability = "low" | "medium" | "high";

export type HumanResourcesEstimateConfidence = "low" | "medium" | "high";
export type HumanResourcesEstimateBasis = "explicit" | "inferred" | "mixed";

export interface HumanResourceRoleEstimate {
  role: string;
  count: number;
  seniority: string | null;
  rationale: string;
}

export interface HumanResourcesEstimate {
  minimumPeople: number;
  confidence: HumanResourcesEstimateConfidence;
  basis: HumanResourcesEstimateBasis;
  roles: HumanResourceRoleEstimate[];
  notes: string;
}

export interface MatchResult {
  tenderId: string;
  tenantId: string;
  fitScore: number;
  rationale: string[];
  gaps: CapabilityGap[];
  winProbability: WinProbability;
  winProbabilityReason: string;
  humanResourcesEstimate: HumanResourcesEstimate;
  capabilityStatement?: string;
  modelVersion: string;
}

export interface IngestRunSummary {
  source: TenderSourceId;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
  startedAt: Date;
  finishedAt: Date;
}

export interface DigestPayload {
  tenantId: string;
  companyName: string;
  generatedAt: Date;
  matches: Array<{
    matchId: string;
    tenderTitle: string;
    tenderUrl: string;
    buyer: string;
    deadlineAt: Date | null;
    fitScore: number;
    rationale: string[];
    winProbability: WinProbability;
    humanResourcesEstimate: HumanResourcesEstimate;
  }>;
}
