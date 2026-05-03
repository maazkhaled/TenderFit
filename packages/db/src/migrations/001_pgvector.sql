-- Project Beta — pgvector setup. Run after `prisma db push` / `prisma migrate`.
-- 1024 is replaced at generation time by scripts/generate-pgvector-sql.ts.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "Tender"
  ADD COLUMN IF NOT EXISTS embedding vector(1024);

ALTER TABLE "CapabilityProfile"
  ADD COLUMN IF NOT EXISTS embedding vector(1024);

CREATE INDEX IF NOT EXISTS tender_embedding_hnsw_idx
  ON "Tender"
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS capability_profile_embedding_hnsw_idx
  ON "CapabilityProfile"
  USING hnsw (embedding vector_cosine_ops);
