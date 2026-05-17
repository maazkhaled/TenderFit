// Back-compat shims (deprecated).
export { getAnthropicClient, voyageEmbed } from "./clients";

// New provider abstraction — preferred entry points.
export {
  getChatProvider,
  getEmbeddingProvider,
  getRerankProvider,
  resetProviders,
  ProviderError,
} from "./providers";
export type {
  ChatProvider,
  EmbeddingProvider,
  RerankProvider,
  RerankHit,
  JsonSchema,
} from "./providers";
export {
  readChatConfig,
  readEmbeddingConfig,
  readRerankConfig,
} from "./providers/config";

// High-level functions used by the worker and the API.
export {
  embedCapabilityProfile,
  embedTender,
  embeddingHashForProfile,
  embeddingHashForTender,
  activeEmbeddingModelStamp,
} from "./embed";
export { scoreMatch, type ScoreMatchOptions } from "./score";
export {
  estimateWinProbability,
  type WinProbabilityEstimate,
  type SimilarHistoricalWin,
} from "./winprob";
export { generateCapabilityStatement } from "./capability-statement";
export { parseProfileFromText } from "./parse-profile";
export type { ParseProfileOptions } from "./parse-profile";
export { cosineSimilarity } from "./util/cosine";
export { renderProfileForLLM, renderTenderForLLM } from "./util/render";
export { embeddingCache } from "./util/embed-cache";
export { chunkText, meanPool } from "./util/chunk";
export type { ChunkOptions, TextChunk } from "./util/chunk";

// Hybrid retrieval — dense + BM25/FTS fused via Reciprocal Rank Fusion.
export {
  hybridRetrieve,
  reciprocalRankFusion,
  buildProfileQuery,
  defaultProfileKeywords,
} from "./retrieve";
export type {
  DenseHit,
  TextHit,
  HybridCandidate,
  HybridRetrieveOptions,
  HybridRetrievers,
} from "./retrieve";
