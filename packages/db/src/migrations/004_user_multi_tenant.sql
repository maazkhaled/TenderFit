-- 004 — Allow one stub-auth email to own multiple tenants.
--
-- Was: User.email UNIQUE — implied one tenant per user.
-- Now: composite UNIQUE(email, tenantId) — one row per (email, tenant)
-- pair so a user can hold N tenants and switch between them via the
-- session's activeTenantId.
--
-- Apply once; safe to re-run because of IF EXISTS / IF NOT EXISTS guards.

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_email_key";
-- The constraint's backing index sometimes survives the DROP CONSTRAINT on
-- older Postgres installations where Prisma created it as a plain UNIQUE
-- INDEX rather than a CONSTRAINT.
DROP INDEX IF EXISTS "User_email_key";

-- Prisma db push may create this as either a UNIQUE CONSTRAINT or a plain
-- UNIQUE INDEX depending on the database state. A unique index enforces the
-- same invariant and keeps the migration cleanly re-runnable in both cases.
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_tenantId_key"
  ON "User" ("email", "tenantId");

CREATE INDEX IF NOT EXISTS "User_email_idx" ON "User" ("email");
