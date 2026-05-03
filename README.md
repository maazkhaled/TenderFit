# Project Beta — TenderFit

Multi-tenant SaaS that ingests tender / RFP / project opportunities (domestic and international) from public-facing official sources, matches them against a tenant company's capability profile using LLM-powered fit scoring + gap analysis, and delivers **scheduled digests** (not always-on alerts).

Target buyer: any IT services / software / consulting company that bids on opportunities.

The default stack runs **fully on a laptop, free of API charges**: local LLM via Ollama, local embeddings, local Postgres + pgvector. Same code switches to managed cloud (Anthropic / OpenAI / Voyage) by changing env vars — no code changes.

> See `SCOPE.md` for the full product brief, architectural contracts, and the "innovative bit" specification.

## The innovative bit

For every (tender, company) pair the matcher produces:

1. **Fit score 0–100** — vector similarity reranked by an LLM
2. **Why-it-fits rationale** — exactly 3 grounded bullets
3. **Capability gaps** — explicit blockers / major / minor requirements the company doesn't yet meet
4. **Win-probability heuristic** — Low / Medium / High with reasoning (deterministic, then LLM may agree or override)
5. **One-click capability statement draft** — tailored, no-hallucination bid input

Aggregation alone is commodity. The matcher is the moat.

## Architecture

```
project-beta/
├── SCOPE.md
├── prisma/schema.prisma          ← shared DB contract (pgvector + Postgres)
├── apps/
│   └── web/                       ← Next.js 14 (App Router) — UI + API
├── worker/                        ← Node worker (ingest / match / digest / cron)
└── packages/
    ├── shared/                    ← Zod schemas, types, constants
    ├── db/                        ← Prisma client + pgvector helpers
    ├── ingest/                    ← Source adapters (World Bank, UK Find a Tender, UK Contracts Finder, PPRA, UNGM, SAM.gov, TED EU)
    ├── llm/                       ← Pluggable matching engine (Ollama / LM Studio / OpenAI / Claude + Voyage)
    └── notifications/             ← Digest builder + renderer + sender
```

## Data sources

All sources are official public listings. Most use a JSON / OCDS / RSS API; two (PPRA and UNGM) publish only HTML and are scraped politely (see *Scraping policy* below).

**Active by default — no API key required:**

| Source | Coverage | Mechanism | Notes |
|---|---|---|---|
| World Bank | Multilateral | JSON API | `search.worldbank.org` |
| UK Find a Tender | Above-threshold UK procurement | OCDS JSON | `find-tender.service.gov.uk/api/1.0` |
| UK Contracts Finder | Below-threshold + SME-friendly UK contracts | OCDS JSON | `contractsfinder.service.gov.uk/.../OCDS` |
| Pakistan PPRA (EPMS) | Federal + provincial PK procurement | HTML scrape (polite) | `epms.ppra.gov.pk/public/tenders/active-tenders` |
| UNGM | UN agency procurement (UNDP, UNICEF, WFP, IOM, UNHCR…) | HTML rows from JSON-shaped POST | `ungm.org/Public/Notice/Search` |

**Optional — needs free API key registration:**

| Source | Coverage | Auth |
|---|---|---|
| SAM.gov | US Federal | free `SAM_GOV_API_KEY` from sam.gov |

**Disabled (upstream change required):**

| Source | Reason |
|---|---|
| TED EU | API v3 reworked the `fields` parameter to a strict BT-code allowlist; needs eForms field-map rewrite |

### Scraping policy

When a source has no JSON / RSS / Atom alternative we fall back to HTML scraping the publicly-listed tenders page. Politeness rules are enforced in `packages/ingest/src/util/html-scrape.ts`:

- ≥ 2 s between requests to the same host (per-host token bucket)
- Browser User-Agent + `Accept-Language` (default ingest UA gets rejected by some gov servers)
- Exponential backoff on 429/5xx, max 3 attempts, no retry storms
- Listing pages only — no per-tender detail or PDF fetches
- Each scraping adapter has a comment explaining the policy and the conditions under which to flip the adapter's `disabledReason` (persistent 4xx, ToS change, IP block) rather than fight it

### Adding a source

Each adapter implements `IngestAdapter` from `packages/ingest/src/types.ts`. Add new adapters under `packages/ingest/src/adapters/` and register them in `packages/ingest/src/index.ts` plus the enum in `prisma/schema.prisma` and `packages/shared/src/constants.ts`. Set `disabledReason` to retire an adapter without deleting historical rows.

## Quick start

Prerequisites: Node ≥ 20.10, pnpm 9, PostgreSQL 16+, [pgvector](https://github.com/pgvector/pgvector), [Ollama](https://ollama.com). **No paid API keys required** for the default local-first config.

```bash
# macOS
brew install postgresql@17 pgvector ollama
brew services start postgresql@17
ollama serve &        # run in another shell or as a service
```

### 1. Install

```bash
pnpm install
cp .env.example .env
# Open .env and:
#   - set DATABASE_URL to your local Postgres
#   - set SESSION_SECRET to a 32+ char random string (e.g. `openssl rand -hex 24`)
#   - leave LLM_* defaults alone for local-first dev
```

### 2. Pick an LLM stack

The matcher and capability-statement generator both go through a provider abstraction. Pick a chat backend and an embedding backend independently. Defaults below run **fully on your laptop, free**.

| Use case | `LLM_PROVIDER` | `EMBEDDING_PROVIDER` | Cost |
|---|---|---|---|
| Local dev (default) | `ollama` | `ollama` | free |
| Local dev via LM Studio UI | `lmstudio` | `lmstudio` | free |
| Self-hosted prod (Ollama on a GPU VM) | `ollama` (remote URL) | `ollama` (remote URL) | infra only |
| Cloud prod (Anthropic + Voyage) | `anthropic` | `voyage` | pay per call |
| Cloud prod (OpenAI single-vendor) | `openai` | `openai` | pay per call |
| Mixed (cheap embed + paid reasoning) | `anthropic` | `ollama` (remote) | partial |

#### Local-first (Ollama) — recommended for dev

Tested on M4 Pro / 24 GB RAM. The active set occupies ~6 GB resident.

```bash
brew install ollama
ollama serve &                                # leave running
ollama pull qwen2.5:7b-instruct               # ~4.5 GB — reasoning tier
ollama pull qwen2.5:3b-instruct               # ~2.0 GB — fast tier
ollama pull mxbai-embed-large                 # ~660 MB — 1024-dim embeddings
```

Then verify the stack:

```bash
pnpm llm:doctor
```

The doctor pings the configured providers, confirms required models are pulled, embeds a probe string and checks the dim, and runs a structured-output round-trip. Any failure is printed with the exact remediation command.

#### LM Studio (alternative, GUI)

Set `LLM_PROVIDER=lmstudio`, `EMBEDDING_PROVIDER=lmstudio`, load equivalent models in LM Studio's UI, start its local server on `:1234`. Same `pnpm llm:doctor` confirms it.

#### Cloud production

Flip env vars at deploy time — no code changes:

```env
LLM_PROVIDER=anthropic
LLM_REASONING_MODEL=claude-opus-4-7
LLM_FAST_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=sk-ant-...

EMBEDDING_PROVIDER=voyage
EMBEDDING_MODEL=voyage-3-large
VOYAGE_API_KEY=pa-...
```

#### Self-hosted production

Run Ollama on a GPU VM (RunPod, Lambda Labs, Vast.ai, Scaleway H100, your own box). Point `OLLAMA_BASE_URL` at it. Same code path. Embedding models are CPU-fast and don't need a GPU; reasoning models on a 7B class fit on ~12 GB VRAM with room to spare.

### 3. DB

```bash
# Create the database (one-time)
psql "$DATABASE_URL_ROOT" -c "CREATE DATABASE project_beta;"
psql "$DATABASE_URL"      -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Schema + pgvector columns
pnpm db:generate
pnpm db:push
pnpm db:vector-sql                            # generates SQL with current EMBEDDING_DIM
psql "$DATABASE_URL" -f packages/db/src/migrations/001_pgvector.sql
```

If you change `EMBEDDING_DIM` later (e.g. switching to a 768-dim or 1536-dim embedding model), re-run `pnpm db:vector-sql` and re-apply the SQL.

**Caveat: the `Tender` and `CapabilityProfile` tables hold the `embedding` columns via raw SQL, not Prisma.** Subsequent `prisma db push` runs will warn about "data loss" wanting to drop them. Apply enum/column changes via raw `ALTER` statements — see the existing TenderSource enum extension in `packages/db/src/migrations/`.

### 4. Dev

```bash
pnpm dev:web              # Next.js on :3000
pnpm worker:ingest        # one-shot: pull new tenders from all enabled sources
pnpm worker:match         # one-shot: embed + score (skips rows whose content hash is unchanged)
pnpm worker:digest        # one-shot: send digests for due tenants
pnpm --filter worker dev  # OR continuous cron mode (ingest 6h, match 1h, digest 15m)
```

The match worker takes 100 tenders per phase. On a fresh ingest of 1500+ tenders, run it ~15 times (or just leave the cron mode running) to drain the queue. Once the `embeddingHash` column is populated, subsequent runs are near-instant — only changed rows re-embed.

### Hardware notes (M4 Pro, 24 GB)

| Workload | Recommended local model | Resident |
|---|---|---|
| Reasoning / scoring | `qwen2.5:7b-instruct` | ~5 GB |
| Fast extraction | `qwen2.5:3b-instruct` | ~2 GB |
| Embeddings | `mxbai-embed-large` | ~700 MB |
| Bigger reasoning (slower) | `qwen2.5:14b-instruct` Q4 | ~9 GB |

Schema-constrained decoding via Ollama's `format: <json schema>` is the key reason the matcher's structured outputs are reliable on local 7B models. Each fit-score call is ~2–6s on the M4 Pro; cached embeddings (in-memory LRU + persistent `embeddingHash` column) keep repeated runs fast.

### Provider-aware score blending

Small local models can swing the LLM-assigned `fitScore` more than frontier models. When the active chat provider is `ollama` or `lmstudio`, `scoreMatch` blends the model's score with the cosine-derived baseline (default weight `0.3`, override with `LLM_SCORE_BLEND_WEIGHT`). Cloud providers run unblended.

### Persistent embedding cache

Each `Tender` and `CapabilityProfile` row stores a `(embeddingHash, embeddingModel)` pair so the match worker skips re-embedding when nothing has changed. Provider/model swaps invalidate automatically because the model name is part of the hash.

## Cron schedule (continuous mode)

| Job | Frequency |
|---|---|
| Ingest | every 6 hours |
| Match (embed + score) | hourly |
| Digest dispatch | every 15 minutes (each tick filters by `isDueNow`) |

Per-tenant digest cadence is configured via the `/schedule` UI and stored on `DigestSchedule` (frequency, hour-of-day, day-of-week, timezone, min fit score).

## Monetisation paths (informal)

The codebase is built so the same product can be sold as:

- **Tiered SaaS** — free / starter (alerts) / pro (matching + bid tools) / enterprise (multi-user, integrations).
- **Vertical packages** — separate matcher tunings for IT services, cybersecurity firms, AI/ML consultancies.
- **White-label** — IT industry associations, chambers of commerce, export promotion bodies resell to members.
- **Bid intelligence add-on** — capability-statement generation, gap-analysis history, market-intel exports.

## Agent build

This repo was built by a coordinated agent build:

| Agent | Owns |
|---|---|
| Lead | `SCOPE.md`, workspace config, `packages/shared/`, integration glue, this README |
| Backend | `prisma/schema.prisma`, `packages/db/`, `apps/web/app/api/`, `apps/web/lib/auth|api|db|services/` |
| Ingestion | `packages/ingest/` |
| LLM (the innovative bit) | `packages/llm/` |
| Frontend | `apps/web/app/(marketing)/`, `apps/web/app/(app)/`, `apps/web/components/`, `apps/web/lib/ui/` |
| Scheduler | `worker/`, `packages/notifications/`, capability-statement route wiring |

Each agent left a `*AGENT_NOTES.md` / `FRONTEND_NOTES.md` in its package summarising deliverables and TODOs for the lead.

## Status

This is an MVP that proves the architecture and the matching loop end-to-end:

- ✅ 5 sources actively ingest live tenders (1,765 tenders in the dev DB at last verified run)
- ✅ Local LLM stack scores fit + gaps + win-prob, structured-output verified with qwen2.5:7b
- ✅ Capability statement generation works end-to-end against local models
- ✅ Persistent embedding cache + provider-aware scoring
- ✅ Cloud providers (Anthropic / OpenAI / Voyage) drop in via env-var swap

Not yet production: no real auth (single-user-per-tenant stub), no rate-limit handling beyond polite scraping, no payment, no live FX feed (static fallback rates), TED EU adapter awaiting BT-code rewrite. Outstanding items are grep-able as `TODO(lead):` markers across the tree.

## License

UNLICENSED — internal exploration. Confirm a license before any external distribution.
