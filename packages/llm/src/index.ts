// Back-compat shims (deprecated).
export { getAnthropicClient, voyageEmbed } from "./clients";

// New provider abstraction — preferred entry points.
export {
  getChatProvider,
  getEmbeddingProvider,
  resetProviders,
  ProviderError,
} from "./providers";
export type {
  ChatProvider,
  EmbeddingProvider,
  JsonSchema,
} from "./providers";
export {
  readChatConfig,
  readEmbeddingConfig,
} from "./providers/config";

// High-level functions used by the worker and the API.
export { embedCapabilityProfile, embedTender } from "./embed";
export { scoreMatch, type ScoreMatchOptions } from "./score";
export {
  estimateWinProbability,
  type WinProbabilityEstimate,
  type SimilarHistoricalWin,
} from "./winprob";
export { generateCapabilityStatement } from "./capability-statement";
export { cosineSimilarity } from "./util/cosine";
export { renderProfileForLLM, renderTenderForLLM } from "./util/render";
export { embeddingCache } from "./util/embed-cache";
