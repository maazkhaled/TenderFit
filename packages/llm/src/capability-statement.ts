import {
  type CapabilityProfile,
  type MatchResult,
  type NormalizedTender,
  MODEL_REASONING,
} from "@beta/shared";
import { getAnthropicClient } from "./clients";
import { renderProfileForLLM, renderTenderForLLM } from "./util/render";

const MAX_TOKENS = 1500;

const SYSTEM_PROMPT = `You draft a tailored capability statement for a company bidding on a specific tender.

Hard rules:
- Use ONLY information present in the company profile. Do NOT invent certifications, clients, projects, technologies, or experience.
- If the profile is silent on something the tender asks for, do not paper over it. You may briefly acknowledge that an area is being scoped or addressed via partners ONLY if the profile actually says so.
- Tone: confident, concrete, business-appropriate. No marketing fluff, no superlatives ("world-class", "cutting-edge", "leading"), no emojis.
- Format: plain text with simple Markdown-style section headers (e.g. lines starting with "## "). No HTML.
- Length: ~300-500 words total.
- Sections in this exact order:
  1. ## Company Snapshot
  2. ## Why We're a Fit  (cite the rationale bullets provided; do not invent new reasons)
  3. ## How We'd Approach It
  4. ## Differentiators
  5. ## Contact
- "Contact" section is a placeholder line: "Contact: [point of contact to be provided]". Do not invent names, emails, or phone numbers.
- Output the statement directly. No preamble, no "Here is the statement:".`;

export async function generateCapabilityStatement(
  profile: CapabilityProfile,
  tender: NormalizedTender,
  matchResult: Omit<MatchResult, "tenderId" | "tenantId">,
): Promise<string> {
  const client = getAnthropicClient();

  const userContent = [
    renderProfileForLLM(profile),
    "",
    renderTenderForLLM(tender),
    "",
    `# Match assessment (already produced)`,
    `Fit score: ${matchResult.fitScore}/100`,
    `Win probability: ${matchResult.winProbability} — ${matchResult.winProbabilityReason}`,
    ``,
    `Rationale (cite these in "Why We're a Fit"):`,
    ...matchResult.rationale.map((r, i) => `  ${i + 1}. ${r}`),
    ``,
    `Known gaps (do NOT pretend these are filled; either omit or address honestly):`,
    matchResult.gaps.length === 0
      ? "  (none recorded)"
      : matchResult.gaps
          .map((g) => `  - [${g.severity}] ${g.requirement}`)
          .join("\n"),
    ``,
    `Now write the capability statement following the section structure in the system prompt.`,
  ].join("\n");

  const response = await client.messages.create({
    model: MODEL_REASONING,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const text = response.content
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { type: string; text?: string }) => b.text ?? "")
    .join("")
    .trim();

  if (!text) {
    throw new Error(
      "generateCapabilityStatement: model returned no text content",
    );
  }
  return text;
}
