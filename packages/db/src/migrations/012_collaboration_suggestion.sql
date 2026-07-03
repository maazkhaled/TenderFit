-- 012_collaboration_suggestion.sql
--
-- Adds MatchResult.collaborationSuggestion — nullable JSON column
-- holding the LLM-generated JV/partner suggestion for tenders whose
-- solo fit is weak. Shape validated by CollaborationSuggestionSchema
-- in packages/shared/src/schemas.ts:
--   {
--     partnerProfile: string,
--     mustHaveCapabilities: string[],
--     geographyHint: string | null,
--     newWinProbabilityIfPartnered: "low" | "medium" | "high"
--   }
--
-- Idempotent: IF NOT EXISTS is a no-op on re-run.

ALTER TABLE "MatchResult"
  ADD COLUMN IF NOT EXISTS "collaborationSuggestion" JSONB;
