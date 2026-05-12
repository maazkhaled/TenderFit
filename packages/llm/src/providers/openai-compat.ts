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
    const res = await fetchWithTimeout(
      `${this.cfg.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      },
      this.cfg.timeoutMs,
    );
    const json = (await res.json().catch(() => ({}))) as OAIChatResponse;
    if (!res.ok || json.error) {
      throw new ProviderError(
        this.name,
        `chat ${res.status}: ${json.error?.message ?? res.statusText}`,
      );
    }
    const content = json.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) {
      throw new ProviderError(this.name, "empty content from /chat/completions");
    }
    return content;
  }

  async chatStructured<T = unknown>(req: ChatStructuredRequest<T>): Promise<T> {
    const model = req.tier === "fast" ? this.cfg.fastModel : this.cfg.reasoningModel;
    const body = {
      model,
      messages: [
        { role: "system", content: req.system },
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
    const res = await fetchWithTimeout(
      `${this.cfg.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      },
      this.cfg.timeoutMs,
    );
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
    } catch (err) {
      throw new ProviderError(
        this.name,
        `non-JSON output despite response_format: ${truncate(raw, 200)}`,
        err,
      );
    }
    if (req.validate) {
      try {
        return req.validate(parsed);
      } catch (err) {
        throw new ProviderError(this.name, `validate failed: ${errMsg(err)}`, err);
      }
    }
    return parsed as T;
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
