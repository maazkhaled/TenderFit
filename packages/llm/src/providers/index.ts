/**
 * Provider factory.
 *
 * Lazy-construct singletons keyed by env config so the rest of the app never
 * has to know which backend is wired up. Reset hooks are provided for tests.
 */

import { readChatConfig, readEmbeddingConfig } from "./config";
import { OllamaChatProvider, OllamaEmbeddingProvider } from "./ollama";
import {
  OpenAICompatChatProvider,
  OpenAICompatEmbeddingProvider,
} from "./openai-compat";
import { AnthropicChatProvider } from "./anthropic";
import { VoyageEmbeddingProvider } from "./voyage";
import type { ChatProvider, EmbeddingProvider } from "./types";

let _chat: ChatProvider | null = null;
let _embed: EmbeddingProvider | null = null;

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
  }
  return _embed;
}

export function resetProviders(): void {
  _chat = null;
  _embed = null;
}

export type { ChatProvider, EmbeddingProvider, JsonSchema } from "./types";
export { ProviderError } from "./types";
