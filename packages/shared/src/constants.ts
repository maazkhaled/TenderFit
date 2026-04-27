export const EMBEDDING_DIM = 1024;
export const EMBEDDING_MODEL = "voyage-3-large";

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
] as const;
export type TenderSourceId = (typeof TENDER_SOURCES)[number];
