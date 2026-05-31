-- 007_digest_schedule_window.sql
--
-- Extends DigestSchedule to support:
--   1. A time WINDOW for delivery (hourLocal .. hourLocalEnd) instead of a
--      single hour. The cron tick may deliver any time in this window.
--   2. Custom-N-day cadence ("every 2 days", "every 5 days", ...) via the
--      new `every_n_days` enum value + `intervalDays` column.
--   3. Monthly cadence on a chosen day-of-month via the new `monthly`
--      enum value + `dayOfMonth` column.
--
-- Behaviour preserved for existing rows:
--   - hourLocal stays as the (now start of) the window
--   - hourLocalEnd defaults to hourLocal + 2 so legacy "fire at exactly N"
--     rows widen to a 3-hour window — same per-day debounce via lastSentAt
--     means at most one send per day; the window just makes the cron tick
--     more forgiving of brief outages.
--
-- Safe to re-run. Idempotent.

-- New enum values (Postgres requires ADD VALUE ... IF NOT EXISTS, one per
-- statement, each in its own committed step. The DO block below commits each
-- ADD VALUE separately so no rollback wedges a partially-applied migration.)
ALTER TYPE "DigestFrequency" ADD VALUE IF NOT EXISTS 'every_n_days';
ALTER TYPE "DigestFrequency" ADD VALUE IF NOT EXISTS 'monthly';

-- New columns. NOT NULL DEFAULT pattern means existing rows get the defaults
-- without manual backfill.
ALTER TABLE "DigestSchedule"
  ADD COLUMN IF NOT EXISTS "intervalDays" INTEGER NOT NULL DEFAULT 2;

-- hourLocalEnd default = 10, but for existing rows we widen to hourLocal + 2
-- (clamped to 23) so the previously-exact hour stays valid. The COALESCE
-- guard means re-running this migration doesn't keep bumping the value.
ALTER TABLE "DigestSchedule"
  ADD COLUMN IF NOT EXISTS "hourLocalEnd" INTEGER NOT NULL DEFAULT 10;

UPDATE "DigestSchedule"
  SET "hourLocalEnd" = LEAST(23, "hourLocal" + 2)
  WHERE "hourLocalEnd" = 10 AND "hourLocal" + 2 <> 10;

ALTER TABLE "DigestSchedule"
  ADD COLUMN IF NOT EXISTS "dayOfMonth" INTEGER;

-- Belt-and-braces sanity check: ensure the window is valid (start <= end).
-- Done as a CHECK so future API writes can't corrupt the state.
ALTER TABLE "DigestSchedule"
  DROP CONSTRAINT IF EXISTS digest_schedule_window_valid;
ALTER TABLE "DigestSchedule"
  ADD CONSTRAINT digest_schedule_window_valid
  CHECK ("hourLocal" >= 0 AND "hourLocal" <= 23
     AND "hourLocalEnd" >= 0 AND "hourLocalEnd" <= 23
     AND "hourLocalEnd" >= "hourLocal");
