import { z } from "zod";
import { TENDER_SOURCES, MATCH_RATIONALE_BULLET_COUNT } from "./constants.ts";

export const TenderSourceSchema = z.enum(TENDER_SOURCES);
export const TenderSourceCategorySchema = z.enum([
  "government",
  "multilateral",
  "un_agency",
  "domestic",
  "it_digital",
  "planning_data",
  "international",
  "gcc",
]);

export const TenderSourceCatalogEntrySchema = z.object({
  id: TenderSourceSchema,
  label: z.string().min(1),
  category: TenderSourceCategorySchema,
  url: z.string().url(),
  checkboxLabel: z.string().min(1),
  description: z.string().min(1),
});

export const NormalizedTenderSchema = z.object({
  externalId: z.string().min(1),
  source: TenderSourceSchema,
  title: z.string().min(1),
  description: z.string(),
  url: z.string().url(),
  buyer: z.string(),
  country: z.string().length(2).nullable(),
  sector: z.string().nullable(),
  cpvCodes: z.array(z.string()).default([]),
  budgetMinUsd: z.number().int().nonnegative().nullable(),
  budgetMaxUsd: z.number().int().nonnegative().nullable(),
  currency: z.string().nullable(),
  publishedAt: z.coerce.date(),
  deadlineAt: z.coerce.date().nullable(),
  language: z.string().min(2).max(5).default("en"),
  raw: z.unknown(),
});

export const PastProjectSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  sector: z.string().optional(),
  valueUsd: z.number().nonnegative().optional(),
});

export const CapabilityProfileSchema = z.object({
  companyName: z.string().min(1),
  oneLiner: z.string().min(1).max(280),
  industries: z.array(z.string()).default([]),
  techStack: z.array(z.string()).default([]),
  services: z.array(z.string()).default([]),
  certifications: z.array(z.string()).default([]),
  pastClients: z.array(z.string()).default([]),
  pastProjects: z.array(PastProjectSchema).default([]),
  geographies: z.array(z.string().length(2)).default([]),
  teamSize: z.number().int().nonnegative(),
  budgetRangeUsd: z.object({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  }),
  languages: z.array(z.string()).default(["en"]),
});

export const GapSeveritySchema = z.enum(["blocker", "major", "minor"]);
export const WinProbabilitySchema = z.enum(["low", "medium", "high"]);
export const HumanResourcesEstimateSchema = z.object({
  minimumPeople: z.number().int().min(0).max(10_000),
  confidence: z.enum(["low", "medium", "high"]),
  basis: z.enum(["explicit", "inferred", "mixed"]),
  roles: z
    .array(
      z.object({
        role: z.string().min(1),
        count: z.number().int().min(1).max(10_000),
        seniority: z.string().min(1).nullable(),
        rationale: z.string().min(1),
      }),
    )
    .default([]),
  notes: z.string().min(1),
});

export const CapabilityGapSchema = z.object({
  requirement: z.string().min(1),
  severity: GapSeveritySchema,
});

export const MatchResultSchema = z.object({
  tenderId: z.string(),
  tenantId: z.string(),
  fitScore: z.number().int().min(0).max(100),
  rationale: z.array(z.string()).length(MATCH_RATIONALE_BULLET_COUNT),
  gaps: z.array(CapabilityGapSchema),
  winProbability: WinProbabilitySchema,
  winProbabilityReason: z.string().min(1),
  humanResourcesEstimate: HumanResourcesEstimateSchema,
  capabilityStatement: z.string().optional(),
  modelVersion: z.string(),
});

export const DigestScheduleInputSchema = z.object({
  frequency: z.enum(["daily", "weekly"]),
  hourLocal: z.number().int().min(0).max(23),
  dayOfWeek: z.number().int().min(0).max(6).nullable(),
  timezone: z.string().default("UTC"),
  enabled: z.boolean().default(true),
  minFitScore: z.number().int().min(0).max(100).default(60),
});

export const FeedbackInputSchema = z.object({
  interested: z.boolean(),
  note: z.string().optional(),
});

export type NormalizedTenderInput = z.infer<typeof NormalizedTenderSchema>;
export type CapabilityProfileInput = z.infer<typeof CapabilityProfileSchema>;
export type DigestScheduleInput = z.infer<typeof DigestScheduleInputSchema>;
export type FeedbackInput = z.infer<typeof FeedbackInputSchema>;
