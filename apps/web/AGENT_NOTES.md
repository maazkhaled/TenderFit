# Backend agent notes

Endpoints implemented under `app/api/v1/`:

- `POST /api/v1/tenants/onboard` — creates Tenant + CapabilityProfile, sets iron-session cookie, returns `{ tenantId, slug }`. CapabilityProfile is written with `embeddingStatus = pending`.
- `GET  /api/v1/profile` — returns `{ companyName, profile }` for the session tenant.
- `PUT  /api/v1/profile` — upserts CapabilityProfile, resets `embeddingStatus = pending`.
- `GET  /api/v1/matches?from=&to=&minScore=` — lists MatchResults for current tenant ordered by `fitScore desc`, joined with tender summary fields.
- `GET  /api/v1/matches/:id` — full match incl. tender + feedback.
- `POST /api/v1/matches/:id/capability-statement` — nulls existing statement, returns 202 placeholder.
- `POST /api/v1/matches/:id/feedback` — upserts MatchFeedback per `FeedbackInputSchema`.
- `GET  /api/v1/schedule` — current tenant's DigestSchedule.
- `PUT  /api/v1/schedule` — upsert DigestSchedule per `DigestScheduleInputSchema`.

Singleton `prisma` lives in `packages/db` and is re-exported via `apps/web/lib/db.ts`. Auth uses `iron-session`; `signInAsTenant(slug)` is the dev helper. Every handler that touches tenant data filters by `session.tenantId`. Validation flows through `@beta/shared` zod schemas via `parseJson`. Errors are funnelled through `apiHandler` (ZodError → 400, NotAuthError → 401, NotFoundError → 404, else 500).

TODOs left for the lead:

- `app/api/v1/matches/[id]/capability-statement/route.ts`: wire to LLM agent's `generateCapabilityStatement()` — currently 202 placeholder.
- `packages/db/src/migrations/001_pgvector.sql`: must be applied after `prisma db push` to add `vector(1024)` columns + HNSW indexes.
