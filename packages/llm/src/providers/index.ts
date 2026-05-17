/**
 * Provider factory.
 *
 * Lazy-construct singletons keyed by env config so the rest of the app never
 * has to know which backend is wired up. Reset hooks are provided for tests.
 */

import { readChatConfig, readEmbeddingConfig, readRerankConfig } from "./config";
import { OllamaChatProvider, OllamaEmbeddingProvider } from "./ollama";
import {
  OpenAICompatChatProvider,
  OpenAICompatEmbeddingProvider,
} from "./openai-compat";
import { AnthropicChatProvider } from "./anthropic";
import { VoyageEmbeddingProvider } from "./voyage";
import { NoopRerankProvider, VoyageRerankProvider } from "./voyage-rerank";
import type { ChatProvider, EmbeddingProvider, RerankProvider } from "./types";

let _chat: ChatProvider | null = null;
let _embed: EmbeddingProvider | null = null;
let _rerank: RerankProvider | null = null;

export function getChatProvider(): ChatProvider {
  if (_chat) return _chat;
  const cfg = readChatConfig();
  switch (cfg.provider) {
    case "ollama":
      _chat = new OllamaChatProvider(cfg);
      break;
    case "lmstudio":
      _chat = new OpenAICompatChatProvider(cfg, "lmstudio");
      break;
    case "openai":
      _chat = new OpenAICompatChatProvider(cfg, "openai");
      break;
    case "anthropic":
      _chat = new AnthropicChatProvider(cfg);
      break;
    case "voyage":
      throw new Error("voyage cannot be used as a chat provider");
    case "gemini":
      _chat = new OpenAICompatChatProvider(cfg, "gemini");
      break;
    case "nvidia":
      _chat = new OpenAICompatChatProvider(cfg, "nvidia");
      break;
  }
  return _chat;
}

export function getEmbeddingProvider(): EmbeddingProvider {
  if (_embed) return _embed;
  const cfg = readEmbeddingConfig();
  switch (cfg.provider) {
    case "ollama":
      _embed = new OllamaEmbeddingProvider(cfg);
      break;
    case "lmstudio":
      _embed = new OpenAICompatEmbeddingProvider(cfg, "lmstudio");
      break;
    case "openai":
      _embed = new OpenAICompatEmbeddingProvider(cfg, "openai");
      break;
    case "voyage":
      _embed = new VoyageEmbeddingProvider(cfg);
      break;
    case "anthropic":
      throw new Error("anthropic does not provide embeddings");
    case "gemini":
      _embed = new OpenAICompatEmbeddingProvider(cfg, "gemini");
      break;
    case "nvidia":
      _embed = new OpenAICompatEmbeddingProvider(cfg, "nvidia");
      break;
  }
  return _embed;
}

/**
 * Cross-encoder reranker. Returns a no-op (pass-through) provider when
 * RERANK_PROVIDER is unset/none or its API key is missing — keeps the calling
 * pipeline unchanged when reranking is intentionally disabled or misconfigured.
 */
export function getRerankProvider(): RerankProvider {
  if (_rerank) return _rerank;
  const cfg = readRerankConfig();
  if (cfg.provider === "voyage" && cfg.apiKey) {
    _rerank = new VoyageRerankProvider(cfg);
  } else {
    _rerank = new NoopRerankProvider();
  }
  return _rerank;
}

export function resetProviders(): void {
  _chat = null;
  _embed = null;
  _rerank = null;
}

export type {
  ChatProvider,
  EmbeddingProvider,
  RerankProvider,
  RerankHit,
  JsonSchema,
} from "./types";
export { ProviderError } from "./types";
