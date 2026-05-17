-- 005 — Add Postgres full-text search to Tender for hybrid (dense + BM25-ish)
-- retrieval. Dense retrieval alone misses very specific tokens that matter for
-- tenders: CPV codes, certification names ("ISO 27001", "CMMI Level 3"),
-- country names, currency thresholds, framework codes. FTS catches them.
--
-- Implementation note — IMMUTABLE wrapper function:
-- Generated columns in Postgres require an IMMUTABLE expression. While
-- `to_tsvector('simple'::regconfig, text)` is itself IMMUTABLE, the inline
-- composition `setweight(to_tsvector(...), 'A') || setweight(...) || ...`
-- mixed with `coalesce` and `array_to_string` isn't always provably immutable
-- to the planner (varies by PG version and config). The standard, version-
-- proof workaround is to wrap the whole expression in a SQL function declared
-- IMMUTABLE — the planner takes our word for it and the generated column
-- works. Behaviour is identical; only the proof obligation changes.
--
-- Apply once; safe to re-run (the DROPs at the top clean any partial state
-- from a prior failed attempt).

-- ---- Idempotent cleanup of partial state from a previous failed run -------
DROP INDEX IF EXISTS tender_fts_doc_gin_idx;
ALTER TABLE "Tender" DROP COLUMN IF EXISTS fts_doc;

-- ---- IMMUTABLE wrapper around the per-row tsvector construction -----------
CREATE OR REPLACE FUNCTION tender_fts_doc(
  title       text,
  buyer       text,
  sector      text,
  cpv         text[],
  description text
) RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    setweight(to_tsvector('simple'::regconfig, coalesce(title, '')),                                  'A') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(buyer, '')),                                  'B') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(sector, '')),                                 'C') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(array_to_string(cpv, ' '), '')),              'C') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(description, '')),                            'D')
$$;

-- ---- Generated column + GIN index -----------------------------------------
ALTER TABLE "Tender"
  ADD COLUMN fts_doc tsvector
  GENERATED ALWAYS AS (
    tender_fts_doc("title", "buyer", "sector", "cpvCodes", "description")
  ) STORED;

CREATE INDEX IF NOT EXISTS tender_fts_doc_gin_idx
  ON "Tender"
  USING gin (fts_doc);

-- Also useful for the eval harness time-windowed queries.
CREATE INDEX IF NOT EXISTS tender_published_at_desc_idx
  ON "Tender" ("publishedAt" DESC);
