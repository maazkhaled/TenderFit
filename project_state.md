# Project Beta (TenderFit) — Handoff State

## What it is
Multi-tenant SaaS that ingests public tenders/RFPs, matches them against a tenant's capability profile via local LLM + pgvector cosine similarity, and emails scheduled digests of the best fits. Default stack runs free on a laptop; cloud LLMs swap in via env-only.

## Architecture

```
project-beta/
├── prisma/schema.prisma          ← DB contract; embedding cols added via raw SQL
├── apps/web/                     ← Next.js 14 (App Router) — UI + /api/v1/*
├── worker/                       ← node-cron worker (ingest / match / digest)
└── packages/
    ├── shared/                   ← zod schemas, TenderSource enum, EMBEDDING_DIM
    ├── db/                       ← Prisma client + writeEmbedding/readEmbeddingMeta
    ├── ingest/                   ← Source adapters + politeness layer
    ├── llm/                      ← Provider abstraction (Ollama / LMStudio / OpenAI / Anthropic / Voyage)
    └── notifications/            ← Digest builder + sender
```

Pipeline: **ingest → match (embed + LLM score) → digest**. Each is one-shot (`pnpm worker:ingest|match|digest`) or runs continuously via `pnpm --filter worker dev` (6h / 1h / 15m).

## Files changed this engagement

### LLM provider abstraction (new)
- `packages/llm/src/providers/{types,config,ollama,openai-compat,anthropic,voyage,index}.ts`
- `packages/llm/src/util/embed-cache.ts` (in-mem LRU)
- `packages/llm/src/doctor.ts` (run via `pnpm llm:doctor`)
- `packages/llm/src/{embed,score,capability-statement,clients,index}.ts` refactored to use providers
- `packages/llm/src/__smoke__.ts` (manual end-to-end test harness)

### Ingest sources
- New: `packages/ingest/src/adapters/uk_find_a_tender.ts`, `uk_contracts_finder.ts`
- New: `packages/ingest/src/util/{ocds,html-scrape}.ts`
- Rewritten (HTML scrape, polite, low-qps): `adapters/ppra_pk.ts`, `adapters/ungm.ts`
- Disabled: `adapters/ted_eu.ts` (BT-code field rework needed)
- Updated registry: `packages/ingest/src/index.ts`, types: `IngestAdapter.disabledReason`
- FX fallback rates with INT4 clamp: `packages/ingest/src/util/usd.ts`

### DB
- New cols on `Tender` + `CapabilityProfile`: `embeddingHash`, `embeddingModel`
- 2 new enum values: `uk_find_a_tender`, `uk_contracts_finder`
- `packages/db/src/embedding.ts`: `writeEmbedding(meta?)`, `readEmbeddingMeta()`
- `packages/db/scripts/generate-pgvector-sql.mjs` + `001_pgvector.sql.template`

### Worker
- `worker/src/match-runner.ts`: hash-aware skip path, historical-wins enrichment, active-stamp logging

### Web
- `apps/web/app/(app)/dashboard/page.tsx`: replaced hard-coded `minScore=60` with env-driven `DASHBOARD_MIN_FIT_SCORE` (default 30)

### Docs
- `README.md` — full rewrite (sources, scraping policy, "Running the complete app", caveats)
- `HOW_TO_USE.md` — operations guide with command-by-command explanations + troubleshooting
- `.env.example` — provider toggles, scraping/dashboard knobs

## Current status

### Working
- 5 ingest sources live: World Bank (500), UK Find a Tender (500), UK Contracts Finder (500), PPRA Pakistan (250 via EPMS scrape), UNGM (15 via scrape) — **1,765 tenders in dev DB**
- Local LLM stack verified: qwen2.5:7b structured output, mxbai-embed-large 1024-dim, doctor green
- Match worker scored **90 MatchResults** (range 31–54, avg 36 — small local model is conservative)
- Persistent embedding cache populated (1765/1765 rows have hash + model stamp)
- Web app runs on :3000, onboard API works (POST /api/v1/tenants/onboard → 201)

### Known issues / disabled
- TED EU adapter is `disabledReason`-flagged; needs BT-code allowlist mapping
- SAM.gov is registered but auto-skips because no `SAM_GOV_API_KEY` set (free, user-registered)
- Static FX fallback rates only; no live ECB feed wired
- Stub auth (single user per tenant); not production-grade
- `prisma db push` warns about dropping the raw-SQL `embedding` columns — apply enum/column changes via raw `ALTER` instead

## Important env vars (in `.env`)

```
DATABASE_URL                postgresql://postgres:postgres@localhost:5432/project_beta
SESSION_SECRET              must be ≥ 32 chars (use `openssl rand -hex 24`)
LLM_PROVIDER                ollama|lmstudio|openai|anthropic   (default ollama)
LLM_REASONING_MODEL         qwen2.5:7b-instruct
LLM_FAST_MODEL              qwen2.5:3b-instruct
EMBEDDING_PROVIDER          ollama|lmstudio|openai|voyage      (default ollama)
EMBEDDING_MODEL             mxbai-embed-large
EMBEDDING_DIM               1024 (changing requires re-running pgvector SQL)
LLM_SCORE_BLEND_WEIGHT      default 0.3 for local, 0 for cloud
DASHBOARD_MIN_FIT_SCORE     30 — lowered for local LLMs; raise to 60 for cloud
EMBED_INPUT_CHAR_CAP        1000 — fits 512-token embedders like mxbai
SAM_GOV_API_KEY             (optional) free key from sam.gov
```

## Pending tasks (priority order)

1. **Rewrite TED EU adapter** with eForms BT-code field map (BT-21=title, BT-24=description, etc.) — half-day of mapping work, unlocks EU-wide coverage
2. **Wire live FX feed** (ECB or openexchangerates) replacing static `FALLBACK_USD_PER` table in `packages/ingest/src/util/usd.ts`
3. **Persist embed cache hash hardening** — currently in-mem LRU is duplicative of DB hash; consolidate
4. **Real auth** — currently `signInAsTenant` is a stub session cookie; needs proper auth before any external use
5. **Background `worker dev` as a service** — currently just a foreground shell

## Exact next steps to resume

```bash
# Verify all services up
brew services list | grep postgres
curl -s http://localhost:11434/api/tags >/dev/null && echo ollama-up
pnpm llm:doctor

# Three-shell startup
ollama serve                            # shell 1
pnpm dev:web                            # shell 2
pnpm --filter worker dev                # shell 3 (cron mode)

# Browser → http://localhost:3000/dashboard
# If empty: check DASHBOARD_MIN_FIT_SCORE in .env, restart pnpm dev:web after changes.
```

`pnpm typecheck` is clean across all 7 workspace packages. DB has live data; the app is operational and demoable end-to-end.

## Latest update — source recheck + HR estimate

- Rechecked disabled sources on 2026-05-05 and documented findings in `SOURCE_RECHECK_2026-05-05.md`.
- Enabled new adapters for `nitb_pk` and `planning_commission_pk` after finding stable public tender listing pages.
- Added AI-estimated minimum human resources to match scoring. New `MatchResult.humanResourcesEstimate` JSON field stores `minimumPeople`, role counts, confidence, basis, and notes.
- Added migration `packages/db/src/migrations/003_match_human_resources.sql`; apply it with `002_tender_sources.sql` before re-running ingest/match on an existing DB.
- Dashboard cards show minimum HR when available; match detail pages show the full role breakdown.
- Applied migrations locally after first enum failure, then verified `pnpm worker:ingest` completed with zero enabled-source errors.
- Disabled `pda_pk`, `sop_pk`, and `kuwait_capt` after live verification showed broken TLS, malformed redirect, and Cloudflare challenge respectively.
- Hardened `worker/src/match-runner.ts` with duplicate tender handling, unique-constraint skip behavior, per-score progress logs, and `MATCH_SCORE_TIMEOUT_MS` (default 60000).
- Repaired existing HR estimates so `minimumPeople` matches summed role counts; future LLM outputs are normalized before persistence.
