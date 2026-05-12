import {
  CapabilityProfileSchema,
  type CapabilityProfileInput,
} from "@beta/shared";
import { getChatProvider } from "./providers";
import type { JsonSchema } from "./providers/types";

/**
 * Parse a free-text document (company website copy, capability deck export,
 * About Us blurb, etc.) into a structured CapabilityProfile draft.
 *
 * Hard rules baked into the system prompt:
 *   - Do NOT invent facts. If the text is silent on a field, leave it empty.
 *   - Use 2-letter ISO country codes for geographies.
 *   - Use ISO 639-1 codes for languages (default ["en"] if unspecified).
 *   - Conservative team size and budget numbers when they're stated; 0 otherwise.
 *
 * The structured output is a JSON Schema mirror of CapabilityProfileSchema,
 * sent through the active chat provider's chatStructured() path. The result
 * is re-validated with the zod schema before being returned, so callers get
 * a guaranteed-valid CapabilityProfileInput.
 */

const PROFILE_JSON_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    companyName: { type: "string" },
    oneLiner: {
      type: "string",
      description:
        "One sentence (<=280 chars) describing what the company does. If the text has no clear pitch, summarise in your own words from the description, but stay grounded in the text.",
    },
    industries: {
      type: "array",
      items: { type: "string" },
      description: "Sectors the company serves (e.g. fintech, healthcare).",
    },
    services: {
      type: "array",
      items: { type: "string" },
      description: "What the company sells (e.g. 'custom software dev', 'cloud migration').",
    },
    techStack: {
      type: "array",
      items: { type: "string" },
      description: "Technologies/products mentioned (e.g. AWS, React, Postgres).",
    },
    certifications: {
      type: "array",
      items: { type: "string" },
      description:
        "Formal certifications (ISO 27001, SOC2, CMMI L3, …). Empty if none stated.",
    },
    pastClients: {
      type: "array",
      items: { type: "string" },
      description: "Named past clients explicitly mentioned. Empty if none.",
    },
    pastProjects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          sector: { type: "string" },
          valueUsd: { type: "number" },
        },
        required: ["title", "summary"],
        additionalProperties: false,
      },
      description: "Named projects with at least a title and one-line summary.",
    },
    geographies: {
      type: "array",
      items: { type: "string", minLength: 2, maxLength: 2 },
      description:
        "ISO 3166-1 alpha-2 country codes where the company can deliver. Use exactly two-letter codes (e.g. PK, GB, AE). Empty array = global / unspecified.",
    },
    teamSize: {
      type: "integer",
      minimum: 0,
      description: "Stated headcount; 0 when not stated.",
    },
    budgetRangeUsd: {
      type: "object",
      properties: {
        min: { type: "integer", minimum: 0 },
        max: { type: "integer", minimum: 0 },
      },
      required: ["min", "max"],
      additionalProperties: false,
      description:
        "Typical engagement size in USD. Use 0/0 when not stated. If only a single number is mentioned, set both min and max to it.",
    },
    languages: {
      type: "array",
      items: { type: "string", minLength: 2, maxLength: 5 },
      description: "ISO 639-1 codes. Default ['en'] if unspecified.",
    },
  },
  required: [
    "companyName",
    "oneLiner",
    "industries",
    "services",
    "techStack",
    "certifications",
    "pastClients",
    "pastProjects",
    "geographies",
    "teamSize",
    "budgetRangeUsd",
    "languages",
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You extract a structured company capability profile from a free-text document.

Hard rules:
- Use ONLY information present in the document. Do NOT invent certifications, clients, technologies, projects, team sizes, budgets, or geographies.
- If the document is silent on a field, output an empty array or 0/empty-string for it. Do NOT guess.
- Geographies must be 2-letter ISO 3166-1 alpha-2 codes (PK, GB, AE, US, …). If the document names a country in prose, map it to its code. Skip ambiguous mentions.
- Languages must be ISO 639-1 (en, fr, ur, …). Default ["en"] only when no languages are mentioned at all.
- oneLiner: <= 280 chars, one sentence, present-tense, no marketing fluff.
- companyName: copy verbatim if stated; otherwise generate a short Title-Case guess from the strongest signal in the text.
- pastProjects: each must have at least a title and a one-line summary; skip "we've worked with…" name-drops without project descriptions (use pastClients for those instead).
- budgetRangeUsd: stated numbers only. If only one number is stated, set min=max=that number. Otherwise 0/0.
- teamSize: an integer count of people only when explicitly stated (e.g. "team of 35", "18 engineers"). 0 otherwise.
- Output the structured JSON only — no commentary, no markdown fences.`;

export interface ParseProfileOptions {
  /** Hint a company name when the text is ambiguous (e.g. filename). */
  companyNameHint?: string;
}

/** ~12k chars ≈ 3k tokens — enough for most About / capability decks, fits any provider. */
const MAX_INPUT_CHARS = 12_000;

export async function parseProfileFromText(
  rawText: string,
  options: ParseProfileOptions = {},
): Promise<CapabilityProfileInput> {
  const text = (rawText ?? "").trim();
  if (!text) {
    throw new Error("parseProfileFromText: input text is empty");
  }
  const truncated = text.slice(0, MAX_INPUT_CHARS);
  const userParts: string[] = [];
  if (options.companyNameHint) {
    userParts.push(`Filename / hint: ${options.companyNameHint}`);
  }
  userParts.push("Document content:");
  userParts.push("---");
  userParts.push(truncated);
  if (text.length > MAX_INPUT_CHARS) {
    userParts.push(
      `\n[NOTE: input was truncated to the first ${MAX_INPUT_CHARS} characters of ${text.length} total.]`,
    );
  }
  userParts.push("---");
  userParts.push(
    "Now produce the capability_profile JSON. Remember: silence in the document = empty array / 0. Do not invent.",
  );

  const provider = getChatProvider();
  const draft = await provider.chatStructured<unknown>({
    system: SYSTEM_PROMPT,
    user: userParts.join("\n"),
    schemaName: "capability_profile",
    schemaDescription:
      "Company capability profile extracted from a free-text document.",
    schema: PROFILE_JSON_SCHEMA,
    tier: "reasoning",
    maxTokens: 1800,
    temperature: 0,
  });

  // The zod parse is the final guard: if the model misses a required field
  // (some local models drop optional-feeling fields), surface the validation
  // error so the API route can return a 400 with a useful message.
  return CapabilityProfileSchema.parse(draft);
}
