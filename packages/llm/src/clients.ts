/**
 * Back-compat shims kept so any external caller of voyageEmbed /
 * getAnthropicClient still works. New code should import from
 * `./providers` and use `getChatProvider()` / `getEmbeddingProvider()`.
 */

import { getEmbeddingProvider } from "./providers";

/**
 * @deprecated use `getEmbeddingProvider().embed(...)` instead.
 * Kept for backward compatibility with callers that hardcoded Voyage.
 * The function now routes through whichever embedding provider is active.
 */
export async function voyageEmbed(texts: string[]): Promise<number[][]> {
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new Error("voyageEmbed: texts must be a non-empty array");
  }
  return getEmbeddingProvider().embed(texts);
}

/**
 * @deprecated use `getChatProvider()` instead.
 * Throws unless LLM_PROVIDER=anthropic — kept only for callers that need the
 * raw SDK shape. Prefer the abstraction.
 */
export async function getAnthropicClient(): Promise<unknown> {
  if (process.env.LLM_PROVIDER && process.env.LLM_PROVIDER !== "anthropic") {
    throw new Error(
      `getAnthropicClient called but LLM_PROVIDER=${process.env.LLM_PROVIDER}. Migrate to getChatProvider().`,
    );
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const mod = await import("@anthropic-ai/sdk");
  const SDK = (mod as { default: new (o: { apiKey: string }) => unknown }).default;
  return new SDK({ apiKey });
}
