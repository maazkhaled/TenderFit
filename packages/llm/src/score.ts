import { createHash } from "node:crypto";
import { z } from "zod";
import {
  type CapabilityProfile,
  type MatchResult,
  type NormalizedTender,
  MATCH_RATIONALE_BULLET_COUNT,
} from "@beta/shared";
import { getChatProvider } from "./providers";
import type { JsonSchema } from "./providers/types";
import { readChatConfig } from "./providers/config";
import { renderProfileForLLM, renderTenderForLLM } from "./util/render";
import {
  estimateWinProbability,
  type SimilarHistoricalWin,
} from "./winprob";

const MAX_TOKENS = 3000;

// Below this score the LLM is asked to generate a collaboration
// suggestion — the description of an ideal JV partner that would
// materially raise win probability. Above it, going solo is the
// expected path and the field stays empty. Override via env.
const COLLAB_SUGGESTION_MAX_SCORE = Number.parseInt(
  process.env.COLLAB_SUGGESTION_MAX_SCORE ?? "70",
  10,
);

const CollaborationSuggestionSchema = z.object({
  partnerProfile: z.string().min(20).max(600),
  mustHaveCapabilities: z.array(z.string().min(1)).min(1).max(6),
  geographyHint: z.string().nullable(),
  newWinProbabilityIfPartnered: z.enum(["low", "medium", "high"]),
});

const ToolInputSchema = z.object({
  rationale: z.array(z.string().min(1)).length(MATCH_RATIONALE_BULLET_COUNT),
  gaps: z
    .array(
      z.object({
        requirement: z.string().min(1),
        severity: z.enum(["blocker", "major", "minor"]),
      }),
    )
    .default([]),
  winProbability: z.enum(["low", "medium", "high"]),
  winProbabilityReason: z.string().min(1),
  humanResourcesEstimate: z.object({
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
  }),
  fitScore: z.number().int().min(0).max(100),
  // Optional in the schema — the LLM only returns this when it judges
  // the score sits below the "go solo" threshold. Post-processing
  // enforces the same rule: if fitScore >= COLLAB_SUGGESTION_MAX_SCORE
  // we drop whatever was returned so we never store a suggestion for
  // a high-fit tender.
  collaborationSuggestion: CollaborationSuggestionSchema.optional(),
});

type ToolInput = z.infer<typeof ToolInputSchema>;

const SYSTEM_PROMPT = `You are evaluating fit between an IT/consulting company and a public-sector tender.

Be honest and concrete. Your judgement protects the user from wasted bid effort.

Hard rules:
- Do NOT invent capabilities, certifications, clients, or experience the company does not list.
- LIST capability gaps even when the cosine similarity is high. A high embedding score is NOT a license to skip gaps.
- Be specific in gaps: name the exact tender requirement that is missing or weak.
- Severity meanings: "blocker" = cannot bid without it (mandatory cert/clearance/local presence), "major" = significant disadvantage vs typical winner, "minor" = nice-to-have.
- Rationale is exactly 3 bullets. Each bullet is one specific, grounded reason — no fluff, no marketing tone.
- Estimate the minimum human resources needed to deliver the tender. Prefer explicit staffing/personnel requirements from the tender. If staffing is not explicit, infer the smallest credible delivery team from scope, SLAs, locations, implementation/support obligations, and domain complexity. Do not inflate for comfort.
- humanResourcesEstimate.minimumPeople must equal the sum of role counts unless minimumPeople is 0 because the tender has no meaningful service/delivery component.
- Set humanResourcesEstimate.basis to "explicit" only when the tender states staffing counts/roles; "mixed" when some are explicit and others inferred; "inferred" when staffing is estimated from scope.
- fitScore is an integer 0-100. The cosine similarity (0..1) is one input. You may override it up or down if the rationale and gaps demand a different score. A tender with blockers should rarely score above 40 even if similarity is high.

Collaboration suggestion rule (only when fitScore < 70):
- If you assign a fitScore below 70, ALSO populate collaborationSuggestion — describe the ideal JV/partner company that would plug the identified capability gaps and materially improve the win probability.
- partnerProfile: 2-4 sentences describing the ideal partner's industry, size, and posture. Concrete, not aspirational. Example: "A regional systems integrator with an active ISO/IEC 27001-certified data centre in the GCC, delivering managed cybersecurity services to public-sector clients. Should have 100-300 staff and demonstrable references with the tender-issuing ministry's peer agencies."
- mustHaveCapabilities: 1-6 specific capabilities the partner MUST bring (certifications, existing client relationships, local presence, tech stack, staffing profile). Each entry is a short noun phrase — no full sentences.
- geographyHint: two-letter ISO country code (e.g. "SA") or a short region label (e.g. "GCC", "East Africa") when the tender clearly requires local presence; null otherwise.
- newWinProbabilityIfPartnered: your estimate of the win probability assuming the ideal partner is on board. Should almost always be at least one tier above the standalone winProbability.
- If fitScore >= 70, DO NOT populate collaborationSuggestion — leave it out entirely. A high-fit tender should be bid solo.
- Never suggest a specific named company; describe the partner archetype only.

- Return ONLY the structured object. No prose outside the structured fields.`;

const SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    rationale: {
      type: "array",
      description: `Exactly ${MATCH_RATIONALE_BULLET_COUNT} short bullets explaining the fit (or lack of fit). Each bullet grounded in tender + profile.`,
      items: { type: "string", minLength: 1 },
      minItems: MATCH_RATIONALE_BULLET_COUNT,
      maxItems: MATCH_RATIONALE_BULLET_COUNT,
    },
    gaps: {
      type: "array",
      description:
        "Capability gaps. Concrete tender requirements the company does not yet meet.",
      items: {
        type: "object",
        properties: {
          requirement: {
            type: "string",
            description:
              "Specific requirement from the tender that is missing or weak.",
            minLength: 1,
          },
          severity: { type: "string", enum: ["blocker", "major", "minor"] },
        },
        required: ["requirement", "severity"],
        additionalProperties: false,
      },
    },
    winProbability: {
      type: "string",
      enum: ["low", "medium", "high"],
      description:
        "Final win-probability call. The deterministic heuristic estimate is provided as context; you may agree or override.",
    },
    winProbabilityReason: {
      type: "string",
      description:
        "One short sentence justifying the winProbability value, citing the strongest factor.",
      minLength: 1,
    },
    humanResourcesEstimate: {
      type: "object",
      description:
        "Minimum human resources needed to deliver this tender, based on explicit requirements where available or conservative inference from scope.",
      properties: {
        minimumPeople: {
          type: "integer",
          minimum: 0,
          maximum: 10000,
          description:
            "Minimum number of distinct people needed. Must equal the sum of role counts unless 0 for no meaningful service/delivery effort.",
        },
        confidence: {
          type: "string",
          enum: ["low", "medium", "high"],
          description:
            "Confidence in the estimate. High only when staffing is explicit or scope is narrow.",
        },
        basis: {
          type: "string",
          enum: ["explicit", "inferred", "mixed"],
          description:
            "Whether the estimate came from explicit tender staffing, inference from scope, or both.",
        },
        roles: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: { type: "string", minLength: 1 },
              count: { type: "integer", minimum: 1, maximum: 10000 },
              seniority: { type: ["string", "null"] },
              rationale: {
                type: "string",
                minLength: 1,
                description:
                  "Short reason this role/count is needed, tied to tender text or delivery scope.",
              },
            },
            required: ["role", "count", "seniority", "rationale"],
            additionalProperties: false,
          },
        },
        notes: {
          type: "string",
          minLength: 1,
          description:
            "One short caveat, assumption, or explicit tender quote summary for the estimate.",
        },
      },
      required: ["minimumPeople", "confidence", "basis", "roles", "notes"],
      additionalProperties: false,
    },
    fitScore: {
      type: "integer",
      description:
        "Overall fit score 0-100. Integer. Be honest — blockers should pull this well below the cosine hint.",
      minimum: 0,
      maximum: 100,
    },
    collaborationSuggestion: {
      type: "object",
      description:
        "Only populate when fitScore < 70. Describes the ideal JV/collaboration partner that would materially raise win probability. Leave out entirely for high-fit tenders.",
      properties: {
        partnerProfile: {
          type: "string",
          minLength: 20,
          maxLength: 600,
          description:
            "2-4 sentence description of the ideal partner (industry, size, posture, relevant references). Concrete, not aspirational. No specific company names.",
        },
        mustHaveCapabilities: {
          type: "array",
          minItems: 1,
          maxItems: 6,
          items: { type: "string", minLength: 1 },
          description:
            "1-6 concrete capabilities the partner MUST bring — certifications, client references, local presence, tech stack, staffing profile. Short noun phrases.",
        },
        geographyHint: {
          type: ["string", "null"],
          description:
            "Two-letter ISO country code or short region label when the tender clearly requires local presence; null otherwise.",
        },
        newWinProbabilityIfPartnered: {
          type: "string",
          enum: ["low", "medium", "high"],
          description:
            "Win probability estimate assuming the ideal partner is on board. Should almost always be at least one tier above standalone winProbability.",
        },
      },
      required: [
        "partnerProfile",
        "mustHaveCapabilities",
        "geographyHint",
        "newWinProbabilityIfPartnered",
      ],
      additionalProperties: false,
    },
  },
  required: [
    "rationale",
    "gaps",
    "winProbability",
    "winProbabilityReason",
    "humanResourcesEstimate",
    "fitScore",
  ],
  additionalProperties: false,
};

const PROMPT_TEMPLATE_VERSION = "v2";
const PROMPT_HASH = createHash("sha256")
  .update([PROMPT_TEMPLATE_VERSION, SYSTEM_PROMPT, JSON.stringify(SCHEMA)].join("|"))
  .digest("hex")
  .slice(0, 8);

function modelVersion(): string {
  const cfg = readChatConfig();
  return `${cfg.provider}:${cfg.reasoningModel}+${PROMPT_HASH}`;
}

export interface ScoreMatchOptions {
  similarHistoricalWins?: SimilarHistoricalWin[];
}

/**
 * Blend the model's fitScore with a cosine-derived baseline.
 *
 * Why: small local models (qwen2.5:7b, llama3:8b) sometimes overshoot or
 * undershoot dramatically. Cloud frontier models don't need this. The blend
 * weight defaults to 0.3 for local providers (ollama/lmstudio) and 0 for
 * cloud. Override with LLM_SCORE_BLEND_WEIGHT (0..1).
 *
 * blended = round(weight * cosineScore + (1 - weight) * modelScore)
 */
function defaultBlendWeight(provider: string): number {
  const env = process.env.LLM_SCORE_BLEND_WEIGHT;
  if (env != null && env !== "") {
    const w = Number.parseFloat(env);
    if (Number.isFinite(w) && w >= 0 && w <= 1) return w;
  }
  return provider === "ollama" || provider === "lmstudio" ? 0.3 : 0;
}

export async function scoreMatch(
  profile: CapabilityProfile,
  tender: NormalizedTender,
  similarity: number,
  options: ScoreMatchOptions = {},
): Promise<Omit<MatchResult, "tenderId" | "tenantId">> {
  const clamped = Math.max(0, Math.min(1, similarity));
  const heuristic = estimateWinProbability(
    profile,
    tender,
    options.similarHistoricalWins ?? [],
  );

  const userContent = buildUserContent(profile, tender, clamped, heuristic);
  const provider = getChatProvider();

  const data = await provider.chatStructured<ToolInput>({
    system: SYSTEM_PROMPT,
    user: userContent,
    schemaName: "submit_match_assessment",
    schemaDescription:
      "Submit the structured match assessment. Must be returned exactly once.",
    schema: SCHEMA,
    tier: "reasoning",
    maxTokens: MAX_TOKENS,
    temperature: 0,
    validate: (raw) => {
      const parsed = ToolInputSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; "),
        );
      }
      return parsed.data;
    },
  });

  const weight = defaultBlendWeight(provider.name);
  const blendedFitScore =
    weight === 0
      ? data.fitScore
      : Math.round(weight * Math.round(clamped * 100) + (1 - weight) * data.fitScore);

  return toMatchResult({ ...data, fitScore: blendedFitScore });
}

function buildUserContent(
  profile: CapabilityProfile,
  tender: NormalizedTender,
  similarity: number,
  heuristic: { winProbability: string; reason: string },
): string {
  return [
    renderProfileForLLM(profile),
    "",
    renderTenderForLLM(tender, { ignoreLocation: profile.ignoreLocation }),
    "",
    `# Cosine similarity hint`,
    `${similarity.toFixed(4)} (range 0..1). The cosine similarity is one input — feel free to override it if the rationale demands a different score.`,
    "",
    `# Heuristic win-probability (deterministic, non-LLM)`,
    `${heuristic.winProbability.toUpperCase()} — ${heuristic.reason}`,
    `You may agree, raise, or lower this in your final winProbability. Be explicit in winProbabilityReason.`,
    "",
    `Now submit your honest assessment as a single JSON object matching the schema.`,
  ].join("\n");
}

function toMatchResult(
  data: ToolInput,
): Omit<MatchResult, "tenderId" | "tenantId"> {
  return {
    fitScore: data.fitScore,
    rationale: data.rationale,
    gaps: data.gaps,
    winProbability: data.winProbability,
    winProbabilityReason: data.winProbabilityReason,
    humanResourcesEstimate: normalizeHumanResourcesEstimate(
      data.humanResourcesEstimate,
    ),
    // Enforce the "only for low fit" rule server-side too — an LLM
    // that ignores the prompt and returns a suggestion for a high-fit
    // tender should still not have it persisted.
    collaborationSuggestion:
      data.fitScore < COLLAB_SUGGESTION_MAX_SCORE
        ? data.collaborationSuggestion
        : undefined,
    modelVersion: modelVersion(),
  };
}

function normalizeHumanResourcesEstimate(
  estimate: ToolInput["humanResourcesEstimate"],
): ToolInput["humanResourcesEstimate"] {
  const roleTotal = estimate.roles.reduce((sum, role) => sum + role.count, 0);
  if (roleTotal === estimate.minimumPeople) return estimate;
  return {
    ...estimate,
    minimumPeople: roleTotal,
    notes:
      roleTotal === 0
        ? estimate.notes
        : `${estimate.notes} Minimum team size normalized to the sum of role counts.`,
  };
}

export const __test__ = {
  ToolInputSchema,
  PROMPT_HASH,
  SCHEMA,
  normalizeHumanResourcesEstimate,
};
