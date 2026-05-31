-- 006_ignore_location.sql
--
-- Adds the per-tenant "disregard location" toggle.
--
-- When TRUE, the matcher/embedder/win-prob heuristic skip every
-- geography/country signal so cross-border collaboration-seeking
-- tenants (e.g. r2v) aren't penalised for international tenders.
--
-- Default FALSE so existing tenants keep current behaviour.
--
-- Safe to run multiple times. Re-flipping the flag invalidates the
-- profile embedding hash on next match-runner tick (the flattened-for-
-- embedding text changes), so no manual re-embed is required.

ALTER TABLE "CapabilityProfile"
  ADD COLUMN IF NOT EXISTS "ignoreLocation" BOOLEAN NOT NULL DEFAULT FALSE;
