/**
 * Centralised env-var reading for provider config.
 *
 * Kept dumb on purpose: every read goes through these helpers so the
 * "what env var controls what" question has exactly one answer.
 */

import type { ProviderName } from "./types";

export interface ChatProviderConfig {
  provider: ProviderName;
  reasoningModel: string;
  fastModel: string;
  baseUrl: string;
  apiKey: string | null;
  timeoutMs: number;
}

export interface EmbeddingProviderConfig {
  provider: ProviderName;
  model: string;
  dim: number;
  baseUrl: string;
  apiKey: string | null;
  timeoutMs: number;
}

const DEFAULT_OLLAMA = "http://localhost:11434";
const DEFAULT_LMSTUDIO = "http://localhost:1234/v1";
const DEFAULT_OPENAI = "https://api.openai.com/v1";
// Gemini exposes an OpenAI-compatible surface at /v1beta/openai which accepts
// /chat/completions and /embeddings exactly like OpenAI proper. We hit that
// instead of native :generateContent so structured-output and streaming behave
// the same as every other OAI-compat backend.
const DEFAULT_GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai";
// NVIDIA's hosted NIM gateway is fully OpenAI-compatible at /v1.
const DEFAULT_NVIDIA = "https://integrate.api.nvidia.com/v1";

function envStr(name: string, fallback?: string): string | null {
  const v = process.env[name];
  if (v == null || v === "") return fallback ?? null;
  return v;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function asProviderName(v: string | null, fallback: ProviderName): ProviderName {
  if (!v) return fallback;
  if (
    v === "ollama" ||
    v === "lmstudio" ||
    v === "openai" ||
    v === "anthropic" ||
    v === "voyage" ||
    v === "gemini" ||
    v === "nvidia"
  ) {
    return v;
  }
  throw new Error(
    `Unknown provider "${v}". Valid: ollama|lmstudio|openai|anthropic|voyage|gemini|nvidia`,
  );
}

export function readChatConfig(): ChatProviderConfig {
  const provider = asProviderName(envStr("LLM_PROVIDER"), "ollama");
  const timeoutMs = envInt("LLM_TIMEOUT_MS", 120_000);

  switch (provider) {
    case "ollama": {
      return {
        provider,
        reasoningModel: envStr("LLM_REASONING_MODEL", "qwen2.5:7b-instruct")!,
        fastModel: envStr("LLM_FAST_MODEL", "qwen2.5:3b-instruct")!,
        baseUrl: envStr("OLLAMA_BASE_URL", DEFAULT_OLLAMA)!,
        apiKey: null,
        timeoutMs,
      };
    }
    case "lmstudio": {
      return {
        provider,
        reasoningModel: envStr("LLM_REASONING_MODEL", "local-model")!,
        fastModel: envStr("LLM_FAST_MODEL", "local-model")!,
        baseUrl: envStr("LMSTUDIO_BASE_URL", DEFAULT_LMSTUDIO)!,
        apiKey: envStr("LMSTUDIO_API_KEY", "lm-studio"),
        timeoutMs,
      };
    }
    case "openai": {
      return {
        provider,
        reasoningModel: envStr("LLM_REASONING_MODEL", "gpt-4o-mini")!,
        fastModel: envStr("LLM_FAST_MODEL", "gpt-4o-mini")!,
        baseUrl: envStr("OPENAI_BASE_URL", DEFAULT_OPENAI)!,
        apiKey: envStr("OPENAI_API_KEY"),
        timeoutMs,
      };
    }
    case "anthropic": {
      return {
        provider,
        reasoningModel: envStr("LLM_REASONING_MODEL", "claude-opus-4-7")!,
        fastModel: envStr("LLM_FAST_MODEL", "claude-haiku-4-5-20251001")!,
        baseUrl: envStr("ANTHROPIC_BASE_URL", "https://api.anthropic.com")!,
        apiKey: envStr("ANTHROPIC_API_KEY"),
        timeoutMs,
      };
    }
    case "voyage": {
      throw new Error(
        "voyage cannot be used as a chat provider; set LLM_PROVIDER to ollama|lmstudio|openai|anthropic|gemini|nvidia",
      );
    }
    case "gemini": {
      // Free-tier defaults: gemini-2.5-flash is the only free chat model and
      // is plenty capable for tender scoring. Pro can be enabled by setting
      // LLM_REASONING_MODEL=gemini-2.5-pro (paid tier required).
      return {
        provider,
        reasoningModel: envStr("LLM_REASONING_MODEL", "gemini-2.5-flash")!,
        fastModel: envStr("LLM_FAST_MODEL", "gemini-2.5-flash")!,
        baseUrl: envStr("GEMINI_BASE_URL", DEFAULT_GEMINI)!,
        apiKey: envStr("GEMINI_API_KEY"),
        timeoutMs,
      };
    }
    case "nvidia": {
      // build.nvidia.com NIMs are free for low-volume dev usage. The default
      // pair below is documented as "always free for development" — swap to
      // e.g. nvidia/llama-3.3-nemotron-super-49b-v1 if you need stronger reasoning.
      return {
        provider,
        reasoningModel: envStr("LLM_REASONING_MODEL", "meta/llama-3.3-70b-instruct")!,
        fastModel: envStr("LLM_FAST_MODEL", "meta/llama-3.1-8b-instruct")!,
        baseUrl: envStr("NVIDIA_BASE_URL", DEFAULT_NVIDIA)!,
        apiKey: envStr("NVIDIA_API_KEY"),
        timeoutMs,
      };
    }
  }
}

export function readEmbeddingConfig(): EmbeddingProviderConfig {
  const provider = asProviderName(envStr("EMBEDDING_PROVIDER"), "ollama");
  const dim = envInt("EMBEDDING_DIM", 1024);
  const timeoutMs = envInt("EMBEDDING_TIMEOUT_MS", 60_000);

  switch (provider) {
    case "ollama":
      return {
        provider,
        model: envStr("EMBEDDING_MODEL", "mxbai-embed-large")!,
        dim,
        baseUrl: envStr("OLLAMA_BASE_URL", DEFAULT_OLLAMA)!,
        apiKey: null,
        timeoutMs,
      };
    case "lmstudio":
      return {
        provider,
        model: envStr("EMBEDDING_MODEL", "text-embedding-mxbai-embed-large-v1")!,
        dim,
        baseUrl: envStr("LMSTUDIO_BASE_URL", DEFAULT_LMSTUDIO)!,
        apiKey: envStr("LMSTUDIO_API_KEY", "lm-studio"),
        timeoutMs,
      };
    case "openai":
      return {
        provider,
        model: envStr("EMBEDDING_MODEL", "text-embedding-3-small")!,
        dim,
        baseUrl: envStr("OPENAI_BASE_URL", DEFAULT_OPENAI)!,
        apiKey: envStr("OPENAI_API_KEY"),
        timeoutMs,
      };
    case "voyage":
      return {
        provider,
        model: envStr("EMBEDDING_MODEL", "voyage-3-large")!,
        dim,
        baseUrl: envStr("VOYAGE_BASE_URL", "https://api.voyageai.com/v1")!,
        apiKey: envStr("VOYAGE_API_KEY"),
        timeoutMs,
      };
    case "anthropic":
      throw new Error(
        "anthropic does not provide embeddings; set EMBEDDING_PROVIDER to ollama|lmstudio|openai|voyage|gemini|nvidia",
      );
    case "gemini":
      // gemini-embedding-001 returns 3072-dim by default but supports MRL
      // truncation: passing `dimensions` in the request (we already do for
      // OpenAI) lets you fit any pgvector column up to 3072. If you change
      // EMBEDDING_DIM you must also rerun the pgvector migration.
      return {
        provider,
        model: envStr("EMBEDDING_MODEL", "gemini-embedding-001")!,
        dim,
        baseUrl: envStr("GEMINI_BASE_URL", DEFAULT_GEMINI)!,
        apiKey: envStr("GEMINI_API_KEY"),
        timeoutMs,
      };
    case "nvidia":
      // baai/bge-m3 returns 1024-dim natively → matches the default pgvector
      // column without a migration. nvidia/nv-embedqa-e5-v5 also works (1024).
      return {
        provider,
        model: envStr("EMBEDDING_MODEL", "baai/bge-m3")!,
        dim,
        baseUrl: envStr("NVIDIA_BASE_URL", DEFAULT_NVIDIA)!,
        apiKey: envStr("NVIDIA_API_KEY"),
        timeoutMs,
      };
  }
}

export function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(t);
  });
}
