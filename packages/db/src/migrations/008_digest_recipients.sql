-- 008_digest_recipients.sql
--
-- Adds per-tenant recipient list for digest emails.
--
-- Previously the worker sent every digest to a single DIGEST_TEST_RECIPIENT
-- env var (single-tenant pilot pattern). With this migration each tenant
-- can configure their own recipients via the /schedule UI, and the sender
-- in packages/notifications/src/send.ts loops over the array.
--
-- Empty array means "fall back to env var" (back-compat with existing rows).
-- Adding addresses takes precedence — the env var is ignored once the
-- array is non-empty.
--
-- Safe to run multiple times.

ALTER TABLE "DigestSchedule"
  ADD COLUMN IF NOT EXISTS "recipients" TEXT[] NOT NULL DEFAULT '{}';
