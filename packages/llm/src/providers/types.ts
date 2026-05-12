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

export type ProviderName =
  | "ollama"
  | "lmstudio"
  | "openai"
  | "anthropic"
  | "voyage"
  | "gemini"
  | "nvidia";

export class ProviderError extends Error {
  constructor(
    public readonly provider: ProviderName,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
}
