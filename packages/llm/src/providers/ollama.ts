/**
 * Ollama provider — runs everything locally for free.
 *
 * Chat: POST /api/chat with `format` set to a JSON schema for structured
 * outputs. Ollama 0.5+ enforces the schema during decoding (constrained
 * sampling), which is much more reliable than the older "json mode" which
 * only set a soft prefix.
 *
 * Embed: POST /api/embed with `input` (array). Older /api/embeddings still
 * works but is single-string only — `/api/embed` is the current canonical
 * endpoint and accepts arrays.
 */

import type {
  ChatProvider,
  ChatStructuredRequest,
  ChatTextRequest,
  EmbeddingProvider,
} from "./types";
import { ProviderError } from "./types";
import { fetchWithTimeout, type ChatProviderConfig, type EmbeddingProviderConfig } from "./config";

interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaChatResponse {
  model: string;
  message?: { role: string; content: string };
  done: boolean;
  error?: string;
}

interface OllamaEmbedResponse {
  embeddings?: number[][];
  error?: string;
}

interface OllamaTagsResponse {
  models?: Array<{ name: string }>;
}

async function ollamaListModels(baseUrl: string, timeoutMs: number): Promise<string[]> {
  const res = await fetchWithTimeout(
    `${baseUrl}/api/tags`,
    { method: "GET" },
    timeoutMs,
  );
  if (!res.ok) {
    throw new ProviderError("ollama", `tags ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as OllamaTagsResponse;
  return (json.models ?? []).map((m) => m.name);
}

export class OllamaChatProvider implements ChatProvider {
  readonly name = "ollama" as const;
  constructor(private readonly cfg: ChatProviderConfig) {}

  async ping(): Promise<{ ok: boolean; detail: string }> {
    try {
      const models = await ollamaListModels(this.cfg.baseUrl, 5_000);
      const wanted = [this.cfg.reasoningModel, this.cfg.fastModel];
      const missing = wanted.filter((m) => !models.some((mm) => mm === m || mm.startsWith(`${m}:`) || m.startsWith(mm.split(":")[0]!)));
      if (missing.length > 0) {
        return {
          ok: false,
          detail: `reachable but missing models: ${missing.join(", ")}. Run: ollama pull ${missing.join(" && ollama pull ")}`,
        };
      }
      return { ok: true, detail: `${this.cfg.baseUrl} OK (${models.length} models)` };
    } catch (err) {
      return { ok: false, detail: errMsg(err) };
    }
  }

  async chatText(req: ChatTextRequest): Promise<string> {
    const model = req.tier === "fast" ? this.cfg.fastModel : this.cfg.reasoningModel;
    const body = {
      model,
      stream: false,
      options: {
        num_predict: req.maxTokens ?? 1500,
        temperature: req.temperature ?? 0.2,
      },
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ] satisfies OllamaChatMessage[],
    };
    const res = await fetchWithTimeout(
      `${this.cfg.baseUrl}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      this.cfg.timeoutMs,
    );
    const json = (await res.json().catch(() => ({}))) as OllamaChatResponse;
    if (!res.ok || json.error) {
      throw new ProviderError(
        "ollama",
        `chat ${res.status}: ${json.error ?? res.statusText}`,
      );
    }
    const content = json.message?.content ?? "";
    if (!content.trim()) {
      throw new ProviderError("ollama", "empty content from /api/chat");
    }
    return content;
  }

  async chatStructured<T = unknown>(req: ChatStructuredRequest<T>): Promise<T> {
    const model = req.tier === "fast" ? this.cfg.fastModel : this.cfg.reasoningModel;
    const body = {
      model,
      stream: false,
      // Schema-constrained decoding. Ollama enforces this during sampling.
      format: req.schema as unknown,
      options: {
        num_predict: req.maxTokens ?? 1500,
        temperature: req.temperature ?? 0,
      },
      messages: [
        { role: "system", content: req.system },
        // Repeat the schema name in the user turn so the model knows what to fill.
        {
          role: "user",
          content:
            `${req.user}\n\n` +
            `Respond ONLY with a JSON object matching the "${req.schemaName}" schema (${req.schemaDescription}). No prose, no markdown fences.`,
        },
      ] satisfies OllamaChatMessage[],
    };
    const res = await fetchWithTimeout(
      `${this.cfg.baseUrl}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      this.cfg.timeoutMs,
    );
    const json = (await res.json().catch(() => ({}))) as OllamaChatResponse;
    if (!res.ok || json.error) {
      throw new ProviderError(
        "ollama",
        `chatStructured ${res.status}: ${json.error ?? res.statusText}`,
      );
    }
    const raw = json.message?.content ?? "";
    if (!raw.trim()) {
      throw new ProviderError("ollama", "empty content from structured /api/chat");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ProviderError(
        "ollama",
        `model returned non-JSON despite format=schema: ${truncate(raw, 200)}`,
        err,
      );
    }
    if (req.validate) {
      try {
        return req.validate(parsed);
      } catch (err) {
        throw new ProviderError("ollama", `validate failed: ${errMsg(err)}`, err);
      }
    }
    return parsed as T;
  }
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = "ollama" as const;
  readonly dim: number;
  constructor(private readonly cfg: EmbeddingProviderConfig) {
    this.dim = cfg.dim;
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    try {
      const models = await ollamaListModels(this.cfg.baseUrl, 5_000);
      const has = models.some(
        (m) => m === this.cfg.model || m.startsWith(`${this.cfg.model}:`),
      );
      if (!has) {
        return {
          ok: false,
          detail: `reachable but embedding model "${this.cfg.model}" not pulled. Run: ollama pull ${this.cfg.model}`,
        };
      }
      return { ok: true, detail: `${this.cfg.baseUrl} OK (model ${this.cfg.model})` };
    } catch (err) {
      return { ok: false, detail: errMsg(err) };
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const body = { model: this.cfg.model, input: texts };
    const res = await fetchWithTimeout(
      `${this.cfg.baseUrl}/api/embed`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      this.cfg.timeoutMs,
    );
    const json = (await res.json().catch(() => ({}))) as OllamaEmbedResponse;
    if (!res.ok || json.error) {
      throw new ProviderError(
        "ollama",
        `embed ${res.status}: ${json.error ?? res.statusText}`,
      );
    }
    const vectors = json.embeddings;
    if (!Array.isArray(vectors) || vectors.length !== texts.length) {
      throw new ProviderError(
        "ollama",
        `embed: expected ${texts.length} vectors, got ${vectors?.length ?? 0}`,
      );
    }
    for (const v of vectors) {
      if (!Array.isArray(v) || v.length !== this.dim) {
        throw new ProviderError(
          "ollama",
          `embed: vector dim ${v?.length} != EMBEDDING_DIM ${this.dim}. ` +
            `Either change EMBEDDING_MODEL or run the regenerated pgvector migration with EMBEDDING_DIM=${v?.length}.`,
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
