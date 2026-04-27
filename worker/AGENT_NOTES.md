# Worker — agent notes

## Scripts (run from repo root)

- `pnpm worker:ingest` — `worker/src/ingest-runner.ts`. Iterates `adapters` registry; per-source `sinceIso = max(publishedAt) || now-14d`; `runAdapter(maxPages=5)` with `onBatch` upserting `Tender` (unique `[source, externalId]`); new rows get `embeddingStatus='pending'`. Skips adapters missing required env vars.
- `pnpm worker:match` — `worker/src/match-runner.ts`. Three phases: embed pending Tenders → embed pending CapabilityProfiles → for each tenant with a ready embedding, fetch top-50 nearest tenders (cosine), filter out existing matches + expired deadlines, call `scoreMatch(profile, tender, similarity, { similarHistoricalWins })` (capped at 20 new matches/tenant), insert `MatchResult`.
- `pnpm worker:digest` — `worker/src/digest-runner.ts`. Either `--tenant=<slug>` for one, or scans all `enabled` schedules and processes those where `isDueNow(...)` returns true. Calls `buildDigestForTenant → renderDigestHtml → sendDigest`, then updates `lastSentAt`.
- `pnpm --filter worker dev` — `worker/src/cron.ts`. Continuous cron mode: ingest every 6h, match hourly, digest every 15m. Bootstrap runs all three once on startup. Uses a per-job mutex so a slow tick can't stack. Graceful SIGINT/SIGTERM shutdown.

## `packages/notifications`

- `buildDigestForTenant(tenantId, since)` — pulls matches above `DigestSchedule.minFitScore` (fallback `DEFAULT_MIN_FIT_SCORE`), capped at 25, ordered by fitScore desc.
- `renderDigestHtml(payload)` — inline-styled, mobile-friendly HTML. Per-match card with title, buyer, deadline, fit/win badges, 3 rationale bullets, "View match" CTA, footer linking `${APP_URL}/schedule`.
- `sendDigest(payload, html)` — Resend if `RESEND_API_KEY` + `DIGEST_TEST_RECIPIENT` set, else stub-prints HTML and returns `{ delivered: false, mode: 'stub' }`.

## Capability-statement route — wired by lead

`apps/web/app/api/v1/matches/[id]/capability-statement/route.ts` now calls `generateCapabilityStatement` synchronously (via `apps/web/lib/services/llm-mapping.ts` for DB→domain mapping), persists to `MatchResult.capabilityStatement`, returns 200 `{ capabilityStatement }`.

## TODOs (lead)

- `worker/src/match-runner.ts:fetchHistoricalWins` — historical wins shape passes minimal fields; enrich once `MatchFeedback` schema grows (e.g. capture sector/value at feedback time).
- `packages/notifications/src/send.ts` — currently uses `DIGEST_TEST_RECIPIENT`; needs per-User email resolution once auth is real.
- `packages/db/src/migrations/001_pgvector.sql` — must be applied manually after `prisma db push` (Prisma can't manage `vector` columns natively).

## Typecheck

Not run from this agent (rate-limited mid-task). Lead should run `pnpm install && pnpm typecheck` and surface any cross-package fallout. Most likely friction points: ingest test file's extensionless imports (flagged in `packages/ingest/AGENT_NOTES.md`), and `@beta/db` requiring `prisma generate` before its types resolve.
