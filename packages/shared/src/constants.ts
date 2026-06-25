/**
 * Embedding dim. Default 1024 to match the legacy voyage-3-large pgvector
 * column. Override with EMBEDDING_DIM (e.g. 768 for nomic-embed-text or
 * bge-m3, 1536 for OpenAI text-embedding-3-small). Changing this requires
 * regenerating the pgvector migration via `pnpm db:migrate-vector`.
 */
function readEmbeddingDim(): number {
  const v = typeof process !== "undefined" ? process.env?.EMBEDDING_DIM : undefined;
  if (!v) return 1024;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 1024;
}

export const EMBEDDING_DIM = readEmbeddingDim();

/**
 * The embedding *model name* below is informational only. The active model
 * is whatever EMBEDDING_MODEL resolves to inside the active provider
 * (see packages/llm/src/providers/config.ts).
 */
export const EMBEDDING_MODEL = "voyage-3-large";

/**
 * Legacy model identifiers, kept so existing modelVersion strings on stored
 * MatchResult rows remain meaningful. New code reads the active model from
 * `readChatConfig()` in packages/llm.
 */
export const MODEL_REASONING = "claude-opus-4-7";
export const MODEL_FAST = "claude-haiku-4-5-20251001";

export const MATCH_RATIONALE_BULLET_COUNT = 3;
export const DEFAULT_MIN_FIT_SCORE = 60;

export const TENDER_SOURCES = [
  "sam_gov",
  "ted_eu",
  "ungm",
  "world_bank",
  "ppra_pk",
  "eprocure_pk",
  "ppra_punjab",
  "kppra",
  "ppra_sindh",
  "bppra_balochistan",
  "pda_pk",
  "nitb_pk",
  "pseb_pk",
  "nadra_pk",
  "planning_commission_pk",
  "urban_unit_pk",
  "sop_pk",
  "ppwd_pk",
  "pitb_pk",
  "ignite_pk",
  "adb",
  "undp",
  "etimad_sa",
  "kuwait_capt",
  "kuwait_egov_ctc",
  "kuwait_cbk",
  "uk_find_a_tender",
  "uk_contracts_finder",
  // Tier 1 — high-value adds for IT/consulting (added 2026-06-25). Catalog
  // + UI wired; adapters stubbed via disabledAdapter pending verified feed
  // shape. See packages/ingest/src/index.ts for per-source rationale.
  "gem_india",
  "austender",
  "gca_uk",
  "gebiz_sg",
  "canada_buys",
  // Tier 2 — multilateral development banks, complement existing World Bank
  "afdb",
  "ifc",
  "ebrd",
  "jica",
  "iadb",
] as const;
export type TenderSourceId = (typeof TENDER_SOURCES)[number];
