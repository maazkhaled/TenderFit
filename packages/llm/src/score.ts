import { createHash } from "node:crypto";
import { z } from "zod";
import {
  type CapabilityProfile,
  type MatchResult,
  type NormalizedTender,
  MATCH_RATIONALE_BULLET_COUNT,
  MODEL_REASONING,
} from "@beta/shared";
import { getAnthropicClient } from "./clients";
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
- Respond ONLY by calling the submit_match_assessment tool. Do not produce any free-form text.`;

const TOOL_DEFINITION = {
  name: "submit_match_assessment",
  description:
    "Submit the structured match assessment. Must be called exactly once.",
  input_schema: {
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
            severity: {
              type: "string",
              enum: ["blocker", "major", "minor"],
            },
          },
          required: ["requirement", "severity"],
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
  },
} as const;

const PROMPT_TEMPLATE_VERSION = "v1";
const PROMPT_HASH = createHash("sha256")
  .update(
    [
      PROMPT_TEMPLATE_VERSION,
      SYSTEM_PROMPT,
      JSON.stringify(TOOL_DEFINITION),
    ].join("|"),
  )
  .digest("hex")
  .slice(0, 8);

const MODEL_VERSION = `${MODEL_REASONING}+${PROMPT_HASH}`;

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
  const client = getAnthropicClient();

  let lastError: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content: userContent },
    ];
    if (attempt > 0 && lastError) {
      messages.push({
        role: "user",
        content: `Your previous response was invalid because: ${lastError}\n\nReturn the assessment again by calling submit_match_assessment with valid arguments.`,
      });
    }

    const response = await client.messages.create({
      model: MODEL_REASONING,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [TOOL_DEFINITION],
      tool_choice: { type: "tool", name: TOOL_DEFINITION.name },
      messages,
    });

    const toolUse = response.content.find(
      (b: { type: string }) => b.type === "tool_use",
    ) as { type: "tool_use"; name: string; input: unknown } | undefined;

    if (!toolUse) {
      lastError = "no tool_use block was returned";
      continue;
    }
    if (toolUse.name !== TOOL_DEFINITION.name) {
      lastError = `unexpected tool name: ${toolUse.name}`;
      continue;
    }

    const parsed = ToolInputSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      lastError = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      continue;
    }

    return toMatchResult(parsed.data);
  }

  throw new Error(
    `scoreMatch: model failed to return valid tool input after 2 attempts (last error: ${lastError ?? "unknown"})`,
  );
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
    `Now call submit_match_assessment with your honest assessment.`,
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
    modelVersion: MODEL_VERSION,
  };
}

export const __test__ = {
  ToolInputSchema,
  PROMPT_HASH,
  MODEL_VERSION,
};
