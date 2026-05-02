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

const MAX_TOKENS = 1500;

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
  fitScore: z.number().int().min(0).max(100),
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
- fitScore is an integer 0-100. The cosine similarity (0..1) is one input. You may override it up or down if the rationale and gaps demand a different score. A tender with blockers should rarely score above 40 even if similarity is high.
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
    fitScore: {
      type: "integer",
      description:
        "Overall fit score 0-100. Integer. Be honest — blockers should pull this well below the cosine hint.",
      minimum: 0,
      maximum: 100,
    },
  },
  required: [
    "rationale",
    "gaps",
    "winProbability",
    "winProbabilityReason",
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

  return toMatchResult(data);
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
    renderTenderForLLM(tender),
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
    modelVersion: modelVersion(),
  };
}

export const __test__ = {
  ToolInputSchema,
  PROMPT_HASH,
  SCHEMA,
};
