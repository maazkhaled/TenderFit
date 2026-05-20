/**
 * OpenAI-compatible provider — used by both OpenAI proper AND LM Studio
 * (which exposes the same protocol on http://localhost:1234/v1).
 *
 * Structured outputs use response_format = { type: "json_schema", json_schema: {...} }.
 * LM Studio's structured-output support is on par with OpenAI's; older
 * versions fall back gracefully because we still parse the content as JSON.
 *
 * For LM Studio, the API key is required by the OpenAI client convention but
 * unused — we send "lm-studio" as a placeholder.
 */

import type {
  ChatProvider,
  ChatStructuredRequest,
  ChatTextRequest,
  EmbeddingProvider,
  ProviderName,
} from "./types";
import { ProviderError } from "./types";
import { fetchWithTimeout, type ChatProviderConfig, type EmbeddingProviderConfig } from "./config";

interface OAIChatChoice {
  index: number;
  message: { role: "assistant"; content: string | null };
  finish_reason: string;
}
interface OAIChatResponse {
  choices?: OAIChatChoice[];
  error?: { message: string; type?: string };
}
interface OAIEmbedResponse {
  data?: Array<{ index: number; embedding: number[] }>;
  error?: { message: string };
}
interface OAIModelsResponse {
  data?: Array<{ id: string }>;
  error?: { message: string };
}

/**
 * Retry a fetch-based call on 429 (rate-limit) responses.
 * Respects the Retry-After header when present; otherwise uses exponential
 * backoff starting at 15 s (Gemini free tier resets within ~6–15 s per window).
 * Max 4 attempts (1 initial + 3 retries) = up to ~105 s total wait.
 */
async function withRateLimitRetry<T>(
  providerName: ProviderName,
  fn: () => Promise<{ status: number; retryAfter: string | null; result: T }>,
): Promise<T> {
  const MAX_ATTEMPTS = 4;
  const BASE_DELAY_MS = 15_000;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { status, retryAfter, result } = await fn();
    if (status !== 429) return result;
    if (attempt === MAX_ATTEMPTS) {
      throw new ProviderError(providerName, "Rate limit exceeded after retries. Wait a moment and try again.");
    }
    const delayMs = retryAfter
      ? Math.max(Number(retryAfter) * 1000, 1000)
      : BASE_DELAY_MS * attempt;
    console.warn(`[${providerName}] 429 rate limit — waiting ${Math.round(delayMs / 1000)}s before retry ${attempt}/${MAX_ATTEMPTS - 1}`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  // unreachable
  throw new ProviderError(providerName, "Rate limit retry loop exited unexpectedly");
}

export class OpenAICompatChatProvider implements ChatProvider {
  readonly name: ProviderName;
  constructor(
    private readonly cfg: ChatProviderConfig,
    name: ProviderName,
  ) {
    this.name = name;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.cfg.apiKey) h["Authorization"] = `Bearer ${this.cfg.apiKey}`;
    return h;
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await fetchWithTimeout(
        `${this.cfg.baseUrl}/models`,
        { method: "GET", headers: this.headers() },
        5_000,
      );
      if (!res.ok) {
        return { ok: false, detail: `${res.status} ${res.statusText}` };
      }
      const json = (await res.json()) as OAIModelsResponse;
      const ids = (json.data ?? []).map((m) => m.id);
      if (ids.length === 0) {
        return { ok: false, detail: "reachable but /models returned empty" };
      }
      return { ok: true, detail: `${this.cfg.baseUrl} OK (${ids.length} models)` };
    } catch (err) {
      return { ok: false, detail: errMsg(err) };
    }
  }

  async chatText(req: ChatTextRequest): Promise<string> {
    const model = req.tier === "fast" ? this.cfg.fastModel : this.cfg.reasoningModel;
    const body = {
      model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      max_tokens: req.maxTokens ?? 1500,
      temperature: req.temperature ?? 0.2,
    };
    return withRateLimitRetry(this.name, async () => {
      const res = await fetchWithTimeout(
        `${this.cfg.baseUrl}/chat/completions`,
        { method: "POST", headers: this.headers(), body: JSON.stringify(body) },
        this.cfg.timeoutMs,
      );
      if (res.status === 429) {
        return { status: 429, retryAfter: res.headers.get("retry-after"), result: "" as string };
      }
      const json = (await res.json().catch(() => ({}))) as OAIChatResponse;
      if (!res.ok || json.error) {
        throw new ProviderError(this.name, `chat ${res.status}: ${json.error?.message ?? res.statusText}`);
      }
      const content = json.choices?.[0]?.message?.content ?? "";
      if (!content.trim()) throw new ProviderError(this.name, "empty content from /chat/completions");
      return { status: res.status, retryAfter: null, result: content };
    });
  }

  async chatStructured<T = unknown>(req: ChatStructuredRequest<T>): Promise<T> {
    const model = req.tier === "fast" ? this.cfg.fastModel : this.cfg.reasoningModel;

    // Gemini's OpenAI-compatible surface sometimes ignores json_schema and
    // wraps the JSON in conversational prose (e.g. "Here is the JSON: {...}").
    // Reinforcing the system prompt with an explicit instruction prevents this
    // in the vast majority of cases; the extractor below handles any remainder.
    const isGemini = this.name === "gemini";
    const systemContent = isGemini
      ? `${req.system}\n\nIMPORTANT: Your response MUST be a single raw JSON object with no markdown, no prose, no code fences — just the JSON.`
      : req.system;

    const body = {
      model,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: req.user },
      ],
      max_tokens: req.maxTokens ?? 1500,
      temperature: req.temperature ?? 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: req.schemaName,
          description: req.schemaDescription,
          // OpenAI's strict mode is the most reliable but rejects some schema
          // shapes. LM Studio accepts strict:true on recent versions; if it
          // ever rejects, set strict:false in env.
          strict: process.env.OAI_STRICT_SCHEMA === "false" ? false : true,
          schema: req.schema,
        },
      },
    };
    return withRateLimitRetry(this.name, async () => {
      const res = await fetchWithTimeout(
        `${this.cfg.baseUrl}/chat/completions`,
        { method: "POST", headers: this.headers(), body: JSON.stringify(body) },
        this.cfg.timeoutMs,
      );
      if (res.status === 429) {
        return { status: 429, retryAfter: res.headers.get("retry-after"), result: null as unknown as T };
      }
      const json = (await res.json().catch(() => ({}))) as OAIChatResponse;
      if (!res.ok || json.error) {
        throw new ProviderError(
          this.name,
          `chatStructured ${res.status}: ${json.error?.message ?? res.statusText}`,
        );
      }
      const raw = json.choices?.[0]?.message?.content ?? "";
      if (!raw.trim()) {
        throw new ProviderError(this.name, "empty content from structured /chat/completions");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Fallback: some providers (notably Gemini) add preamble text before the
        // JSON. Find the first { or [ and extract the balanced JSON block.
        const extracted = extractJsonBlock(raw);
        if (extracted !== null) {
          try {
            parsed = JSON.parse(extracted);
          } catch (err2) {
            throw new ProviderError(
              this.name,
              `non-JSON output despite response_format: ${truncate(raw, 200)}`,
              err2,
            );
          }
        } else {
          throw new ProviderError(
            this.name,
            `non-JSON output despite response_format: ${truncate(raw, 200)}`,
          );
        }
      }
      let result: T;
      if (req.validate) {
        try {
          result = req.validate(parsed);
        } catch (err) {
          throw new ProviderError(this.name, `validate failed: ${errMsg(err)}`, err);
        }
      } else {
        result = parsed as T;
      }
      return { status: res.status, retryAfter: null, result };
    });
  }
}

export class OpenAICompatEmbeddingProvider implements EmbeddingProvider {
  readonly name: ProviderName;
  readonly dim: number;
  constructor(
    private readonly cfg: EmbeddingProviderConfig,
    name: ProviderName,
  ) {
    this.name = name;
    this.dim = cfg.dim;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.cfg.apiKey) h["Authorization"] = `Bearer ${this.cfg.apiKey}`;
    return h;
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await fetchWithTimeout(
        `${this.cfg.baseUrl}/models`,
        { method: "GET", headers: this.headers() },
        5_000,
      );
      if (!res.ok) return { ok: false, detail: `${res.status} ${res.statusText}` };
      const json = (await res.json()) as OAIModelsResponse;
      const has = (json.data ?? []).some(
        (m) => m.id === this.cfg.model || m.id === `models/${this.cfg.model}`,
      );
      // NVIDIA/Gemini /models endpoints don't always list every embedding
      // model id under the same string they accept in requests; if the
      // server is reachable and returned a non-empty list, treat that as OK
      // and let the live embed call surface model errors instead.
      if (!has) {
        if (this.name === "gemini" || this.name === "nvidia") {
          return {
            ok: true,
            detail: `${this.cfg.baseUrl} reachable; model "${this.cfg.model}" not in /models list (NVIDIA/Gemini routinely omit embedding models from /models — will be validated live).`,
          };
        }
        return {
          ok: false,
          detail: `reachable but embedding model "${this.cfg.model}" not in /models. Load it in your provider first.`,
        };
      }
      return { ok: true, detail: `${this.cfg.baseUrl} OK (model ${this.cfg.model})` };
    } catch (err) {
      return { ok: false, detail: errMsg(err) };
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    // Some OpenAI-compat servers accept a `dimensions` field to truncate the
    // returned vector via Matryoshka representation learning. OpenAI's
    // text-embedding-3-* and Gemini's gemini-embedding-001 both support it,
    // which is how the user can keep using their existing pgvector column
    // dimension without re-running the migration.
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      input: texts,
    };
    if (this.name === "openai" || this.name === "gemini") {
      body.dimensions = this.cfg.dim;
    }
    const res = await fetchWithTimeout(
      `${this.cfg.baseUrl}/embeddings`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      },
      this.cfg.timeoutMs,
    );
    const json = (await res.json().catch(() => ({}))) as OAIEmbedResponse;
    if (!res.ok || json.error) {
      throw new ProviderError(
        this.name,
        `embed ${res.status}: ${json.error?.message ?? res.statusText}`,
      );
    }
    const data = json.data ?? [];
    if (data.length !== texts.length) {
      throw new ProviderError(
        this.name,
        `embed: expected ${texts.length} vectors, got ${data.length}`,
      );
    }
    const sorted = [...data].sort((a, b) => a.index - b.index);
    const vectors = sorted.map((d) => d.embedding);
    for (const v of vectors) {
      if (!Array.isArray(v) || v.length !== this.dim) {
        throw new ProviderError(
          this.name,
          `embed: vector dim ${v?.length} != EMBEDDING_DIM ${this.dim}`,
        );
      }
    }
    return vectors;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

/**
 * Extract the first balanced JSON object or array from a string that may
 * contain leading/trailing prose (common with Gemini's OAI-compat endpoint).
 * Returns null if no balanced block is found.
 */
function extractJsonBlock(s: string): string | null {
  const start = Math.min(
    s.indexOf("{") === -1 ? Infinity : s.indexOf("{"),
    s.indexOf("[") === -1 ? Infinity : s.indexOf("["),
  );
  if (!isFinite(start)) return null;
  const open = s[start] === "{" ? "{" : "[";
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
