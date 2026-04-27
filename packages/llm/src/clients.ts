import Anthropic from "@anthropic-ai/sdk";
import { EMBEDDING_DIM, EMBEDDING_MODEL } from "@beta/shared";

let _anthropic: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (_anthropic) return _anthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  _anthropic = new Anthropic({ apiKey });
  return _anthropic;
}

interface VoyageEmbedResponse {
  object: string;
  data: Array<{ object: string; embedding: number[]; index: number }>;
  model: string;
  usage?: { total_tokens: number };
}

export async function voyageEmbed(texts: string[]): Promise<number[][]> {
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new Error("voyageEmbed: texts must be a non-empty array");
  }
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY is not set");
  }

  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      input_type: "document",
      output_dimension: EMBEDDING_DIM,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `voyageEmbed failed: ${res.status} ${res.statusText} ${body}`,
    );
  }

  const json = (await res.json()) as VoyageEmbedResponse;
  if (!json.data || json.data.length !== texts.length) {
    throw new Error(
      `voyageEmbed: response count mismatch (got ${json.data?.length}, expected ${texts.length})`,
    );
  }

  const sorted = [...json.data].sort((a, b) => a.index - b.index);
  const out: number[][] = sorted.map((d) => d.embedding);

  for (const v of out) {
    if (!Array.isArray(v) || v.length !== EMBEDDING_DIM) {
      throw new Error(
        `voyageEmbed: vector dim mismatch (got ${v?.length}, expected ${EMBEDDING_DIM})`,
      );
    }
  }
  return out;
}
