-- 011_tier12_sources.sql
--
-- Adds the 10 Tier 1 + Tier 2 source IDs to the Postgres "TenderSource"
-- enum. The TypeScript constants and Prisma schema were updated in the
-- same commit (2026-06-25), but the live database needs this DDL to
-- accept inserts for the new sources — without it the worker crashes
-- on the first findFirst({ where: { source: "gem_india" } }) call in
-- computeSinceIso (ingest-runner.ts).
--
-- Idempotent: ADD VALUE IF NOT EXISTS is a no-op on re-run.

-- Tier 1: high-value IT/consulting markets
ALTER TYPE "TenderSource" ADD VALUE IF NOT EXISTS 'gem_india';
ALTER TYPE "TenderSource" ADD VALUE IF NOT EXISTS 'austender';
ALTER TYPE "TenderSource" ADD VALUE IF NOT EXISTS 'gca_uk';
ALTER TYPE "TenderSource" ADD VALUE IF NOT EXISTS 'gebiz_sg';
ALTER TYPE "TenderSource" ADD VALUE IF NOT EXISTS 'canada_buys';

-- Tier 2: multilateral development banks
ALTER TYPE "TenderSource" ADD VALUE IF NOT EXISTS 'afdb';
ALTER TYPE "TenderSource" ADD VALUE IF NOT EXISTS 'ifc';
ALTER TYPE "TenderSource" ADD VALUE IF NOT EXISTS 'ebrd';
ALTER TYPE "TenderSource" ADD VALUE IF NOT EXISTS 'jica';
ALTER TYPE "TenderSource" ADD VALUE IF NOT EXISTS 'iadb';
