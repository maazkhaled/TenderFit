-- 010_cleanup_awarded_wb.sql
--
-- One-time cleanup: remove World Bank tenders that were ingested before
-- the description-text award filter landed (commit "fix: WB award filter
-- also scans description"). These rows describe contracts that have
-- already been awarded — they're not biddable opportunities and were
-- showing up in dashboards / digests as if they were.
--
-- The query is narrow:
--   - source = 'world_bank' only — never touch PK gov, UN, UK sources
--   - description matches at least one explicit award phrase
--   - MatchResult rows referencing the deleted tenders are removed first
--     (FK constraint requires it; ON DELETE CASCADE would do this too,
--     but the explicit DELETE is auditable in the log output)
--
-- Safe to re-run. Idempotent — the second pass finds nothing.

BEGIN;

WITH awarded_ids AS (
  SELECT id FROM "Tender"
  WHERE source = 'world_bank'
    AND (
      LOWER(COALESCE(description, '')) LIKE '%date notification of award%'
      OR LOWER(COALESCE(description, '')) LIKE '%notification of award issued%'
      OR LOWER(COALESCE(description, '')) LIKE '%awarded bidder%'
      OR LOWER(COALESCE(description, '')) LIKE '%letter of acceptance%'
      OR LOWER(COALESCE(description, '')) LIKE '%contract award notice%'
      OR LOWER(COALESCE(description, '')) LIKE '%notice of contract award%'
      OR LOWER(COALESCE(description, '')) LIKE '%winning bidder%'
    )
)
DELETE FROM "MatchResult" WHERE "tenderId" IN (SELECT id FROM awarded_ids);

DELETE FROM "Tender"
  WHERE source = 'world_bank'
    AND (
      LOWER(COALESCE(description, '')) LIKE '%date notification of award%'
      OR LOWER(COALESCE(description, '')) LIKE '%notification of award issued%'
      OR LOWER(COALESCE(description, '')) LIKE '%awarded bidder%'
      OR LOWER(COALESCE(description, '')) LIKE '%letter of acceptance%'
      OR LOWER(COALESCE(description, '')) LIKE '%contract award notice%'
      OR LOWER(COALESCE(description, '')) LIKE '%notice of contract award%'
      OR LOWER(COALESCE(description, '')) LIKE '%winning bidder%'
    );

COMMIT;
