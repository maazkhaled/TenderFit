import type { TenderSourceId } from "./constants";

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
}

export type GapSeverity = "blocker" | "major" | "minor";

export interface CapabilityGap {
  requirement: string;
  severity: GapSeverity;
}

export type WinProbability = "low" | "medium" | "high";

export interface MatchResult {
  tenderId: string;
  tenantId: string;
  fitScore: number;
  rationale: string[];
  gaps: CapabilityGap[];
  winProbability: WinProbability;
  winProbabilityReason: string;
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
  }>;
}
