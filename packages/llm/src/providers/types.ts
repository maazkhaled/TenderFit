/**
 * Provider abstractions for chat (LLM completions) and embeddings.
 *
 * The matcher and capability-statement code should never reference a vendor
 * directly. They go through these interfaces, and a factory in `./index.ts`
 * picks the concrete implementation based on env vars.
 *
 * Why three methods on ChatProvider:
 *   - `chatText`         — free-form text out (capability statement).
 *   - `chatStructured`   — strict JSON output validated against a JSON schema
 *                          (fit-score / gaps / win-probability assessment).
 *
 * Each backend has a different "structured output" mechanism:
 *   - Anthropic                → forced tool-use with input_schema
 *   - OpenAI / LM Studio       → response_format: { type: "json_schema", ... }
 *   - Ollama (≥ 0.5)           → top-level `format: <json schema>`
 * The provider implementations hide that difference.
 */

export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [k: string]: unknown;
}

export interface ChatTextRequest {
  system: string;
  user: string;
  /** Reasoning vs fast — providers map to their own model env vars. */
  tier?: "reasoning" | "fast";
  maxTokens?: number;
  temperature?: number;
}

export interface ChatStructuredRequest<T = unknown> extends ChatTextRequest {
  /** A short, snake_case name used by some providers (anthropic tool name, openai schema name). */
  schemaName: string;
  /** Human-readable description shown to the model. */
  schemaDescription: string;
  /** JSON schema the response MUST match. */
  schema: JsonSchema;
  /** Optional zod-style refinement run after schema validation. */
  validate?: (raw: unknown) => T;
}

export interface ChatProvider {
  readonly name: ProviderName;
  /** Quick liveness probe — used by the doctor CLI. Should be cheap (no model call). */
  ping(): Promise<{ ok: boolean; detail: string }>;
  chatText(req: ChatTextRequest): Promise<string>;
  chatStructured<T = unknown>(req: ChatStructuredRequest<T>): Promise<T>;
}

export interface EmbeddingProvider {
  readonly name: ProviderName;
  readonly dim: number;
  ping(): Promise<{ ok: boolean; detail: string }>;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Cross-encoder reranker. Takes a query (e.g. flattened capability profile)
 * and a list of candidate documents (tender excerpts) and returns each
 * document's index plus a relevance score, sorted best-first.
 *
 * The implementation is allowed to truncate documents to fit its context.
 * Callers should pass at most a few hundred candidates per call.
 */
export interface RerankProvider {
  readonly name: ProviderName | "noop";
  /** Pre-flight check — used by the doctor CLI. Should not call the model. */
  ping(): Promise<{ ok: boolean; detail: string }>;
  rerank(
    query: string,
    documents: string[],
    opts?: { topK?: number },
  ): Promise<RerankHit[]>;
}

export interface RerankHit {
  /** 0-based index into the original `documents` array. */
  index: number;
  /** Relevance score from the model. Bounded behaviour is provider-specific. */
  relevanceScore: number;
}

export type ProviderName =
  | "ollama"
  | "lmstudio"
  | "openai"
  | "anthropic"
  | "voyage"
  | "gemini"
  | "nvidia";

export class ProviderError extends Error {
  // Explicit fields rather than constructor parameter properties — the latter
  // are not yet supported by Node's --experimental-strip-types loader that
  // powers our test runner. Behaviour is unchanged.
  public readonly provider: ProviderName;
  public readonly cause?: unknown;
  constructor(provider: ProviderName, message: string, cause?: unknown) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
    this.provider = provider;
    this.cause = cause;
  }
}
