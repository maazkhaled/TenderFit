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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'User_email_tenantId_key'
  ) THEN
    ALTER TABLE "User"
      ADD CONSTRAINT "User_email_tenantId_key" UNIQUE ("email", "tenantId");
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "User_email_idx" ON "User" ("email");
