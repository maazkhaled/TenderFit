# Project Beta — TenderFit

Multi-tenant SaaS that ingests tender / RFP / project opportunities (domestic and international) from public-facing official sources, matches them against a tenant company's capability profile using LLM-powered fit scoring + gap analysis, and delivers **scheduled digests** (not always-on alerts).

Target buyer: any IT services / software / consulting company that bids on opportunities.

The recommended setup runs via **Docker Compose** — no local tooling required beyond Docker Desktop. A free Google Gemini API key is the only credential needed out of the box. The same codebase switches to any LLM backend (Ollama, Anthropic, OpenAI, NVIDIA NIM, or Voyage) by changing env vars; no code changes required.

> See `SCOPE.md` for the full product brief and architectural contracts.

## What the matcher produces

For every (tender, company) pair the matcher produces:

1. **Fit score 0–100** — produced by a four-stage pipeline (see *How matching works* below): hybrid retrieval → cross-encoder rerank → LLM scoring → optional cosine-blend for small local models
2. **Why-it-fits rationale** — exactly 3 grounded bullets
3. **Capability gaps** — explicit blockers / major / minor requirements the company doesn't yet meet
4. **Win-probability heuristic** — Low / Medium / High with reasoning (deterministic, then LLM may agree or override)
5. **One-click capability statement draft** — tailored, no-hallucination bid input

Plus a **shadow-mode eval harness** (`pnpm eval --tenant=<slug>`) that computes confusion-matrix metrics from `MatchFeedback` labels — the closed-loop tool the "Friday review" ritual is built around.

Aggregation alone is commodity. The matcher + the eval loop are the moat.

## How matching works (pipeline)

```
tender + profile
        │
        ▼
┌────────────────────────────────────────────────────────────┐
│  Stage 1 — Hybrid retrieval (Reciprocal Rank Fusion, k=60) │
│    • Dense:  pgvector cosine over chunked + mean-pooled    │
│              tender embeddings (Voyage / Ollama / …)       │
│    • Lexical: Postgres ts_rank_cd over a weighted tsvector │
│              (title=A, buyer=B, sector/CPV=C, desc=D)      │
│    Output: top-N fused candidates per tenant               │
└────────────────────────────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────────────────────────────┐
│  Stage 2 — Cross-encoder rerank                            │
│    • Voyage rerank-2.5 (or NoopRerankProvider when         │
│      RERANK_PROVIDER=none)                                 │
│    Output: top-K precision-reranked candidates             │
└────────────────────────────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────────────────────────────┐
│  Stage 3 — LLM structured scoring                          │
│    • fit score, 3-bullet rationale, gap list,              │
│      win-probability, HR estimate                          │
│    • Schema-constrained JSON (Anthropic tool-use / OpenAI  │
│      response_format / Ollama format)                      │
└────────────────────────────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────────────────────────────┐
│  Stage 4 — Provider-aware blend (local-only)               │
│    • Local 7B models can swing fit scores; blend with the  │
│      cosine baseline at weight LLM_SCORE_BLEND_WEIGHT      │
│      (default 0.3 for ollama/lmstudio, 0 for cloud)        │
└────────────────────────────────────────────────────────────┘
```

This is the current industry-standard hybrid-retrieval architecture (see e.g. ZeroEntropy's reranker guide and the Genzeon hybrid-retrieval study). On published benchmarks, hybrid retrieval plus a cross-encoder reranker lifts Recall@5 by ≈17% over dense-only.

Long tender descriptions are **chunked** (recursive separator-aware splitter, 1500-char target with 200-char overlap), each chunk embedded with the tender header prepended, then **length-weighted mean-pooled** into a single vector — so the existing `vector(1024)` schema doesn't change but signal from later pages is preserved.

Key files:

| Concern | File |
|---|---|
| Chunking + pooling | `packages/llm/src/util/chunk.ts` |
| Long-text embedding | `packages/llm/src/embed.ts` |
| Hybrid retrieval + RRF fusion | `packages/llm/src/retrieve.ts` |
| BM25-style FTS query | `packages/db/src/retrieval.ts` |
| Voyage rerank + no-op fallback | `packages/llm/src/providers/voyage-rerank.ts` |
| LLM structured scoring | `packages/llm/src/score.ts` |
| Pipeline wiring | `worker/src/match-runner.ts` |
| Eval metrics + report | `worker/src/eval/metrics.ts`, `worker/src/eval/report.ts` |
| Eval CLI | `worker/src/eval-runner.ts` |

## Architecture

```
project-beta/
├── SCOPE.md
├── docker-compose.yml            ← recommended deployment: web + worker + postgres
├── Dockerfile                    ← multi-target build (web and worker images)
├── prisma/schema.prisma          ← shared DB contract (pgvector + Postgres)
├── apps/
│   └── web/                      ← Next.js 14 (App Router) — UI + API
├── worker/                       ← Node worker (ingest / match / digest / cron)
└── packages/
    ├── shared/                   ← Zod schemas, types, constants
    ├── db/                       ← Prisma client + pgvector helpers
    ├── ingest/                   ← Source adapters (28 sources — World Bank, UK Find a Tender, UK Contracts Finder, PPRA, UNGM, UNDP, NITB, PITB, Ignite, Planning Commission, Urban Unit, PDA, SAM.gov, …)
    ├── llm/                      ← Pluggable matching engine (Ollama / LM Studio / OpenAI / Anthropic / Voyage / Gemini / NVIDIA NIM)
    └── notifications/            ← Digest builder + renderer + sender
```

## Data sources

All sources are official public listings. Where available we use a JSON / OCDS / RSS API; otherwise we polite-scrape the public listing page (see *Scraping policy* below). 28 source slots are registered, 12 active by default, 1 optional-with-key, 1 awaiting rework, 14 disabled pending upstream changes.

The dashboard exposes per-tenant source filtering via checkboxes (`SourceFilter` component); operators can also narrow a worker run with `INGEST_SOURCES=source_a,source_b` for targeted backfills.

### Active by default — no API key required

| ID | Source | Coverage | Mechanism | Endpoint |
|---|---|---|---|---|
| `world_bank` | World Bank | Multilateral | JSON API | `search.worldbank.org` |
| `uk_find_a_tender` | UK Find a Tender | Above-threshold UK procurement | OCDS JSON | `find-tender.service.gov.uk/api/1.0` |
| `uk_contracts_finder` | UK Contracts Finder | Below-threshold + SME-friendly UK contracts | OCDS JSON | `contractsfinder.service.gov.uk/.../OCDS` |
| `ppra_pk` | Pakistan Federal PPRA (EPMS) | Federal PK procurement | HTML scrape (polite) | `epms.ppra.gov.pk/public/tenders/active-tenders` |
| `ungm` | UNGM | UN agency procurement (UNDP, UNICEF, WFP, IOM, UNHCR…) | HTML rows from JSON-shaped POST | `ungm.org/Public/Notice/Search` |
| `undp` | UNDP Procurement Notices | UNDP global procurement | RSS 1.0 / RDF feed | `procurement-notices.undp.org/rss_feeds/rss.xml` |
| `nitb_pk` | National IT Board (PK) | Federal IT/digital procurement | HTML scrape (polite) | `nitb.gov.pk/tender.html` |
| `pitb_pk` | Punjab IT Board | Punjab IT/digital procurement | HTML scrape (polite) | `pitb.gov.pk/tendernotices` |
| `planning_commission_pk` | Planning Commission (PK) | Federal planning ministry procurement | HTML scrape (polite) | `pc.gov.pk/web/tender` |
| `urban_unit_pk` | The Urban Unit (PK) | Punjab urban planning procurement | HTML scrape (polite) | `urbanunit.gov.pk/procurement` |
| `ignite_pk` | Ignite National Technology Fund | PK IT R&D RFPs | HTML scrape (polite) | `ignite.org.pk/rfps/` |
| `pda_pk` | Pakistan Digital Authority | Federal digital-services procurement | HTML scrape (polite, **insecureTls**) | `www.pda.gov.pk/procurement.php` |

> `pda_pk` is fetched via Node's built-in `https` module with `rejectUnauthorized:false` because pda.gov.pk's server omits its intermediate cert. The exemption is scoped to this single host — see `packages/ingest/src/util/html-scrape.ts:fetchHtmlInsecure`. Remove `insecureTls: true` from `adapters/pda_pk.ts` once they fix the chain.

### Optional — needs free API key registration

| ID | Source | Coverage | Auth |
|---|---|---|---|
| `sam_gov` | SAM.gov | US Federal | free `SAM_GOV_API_KEY` from sam.gov |

### Registered but disabled (upstream change required)

| ID | Reason | What it would take to enable |
|---|---|---|
| `ted_eu` | API v3 reworked the `fields` parameter to a strict BT-code allowlist | eForms BT-code field-map rewrite |
| `eprocure_pk` | Public listings are already covered by EPMS/PPRA; no separate stable feed | Wait for a dedicated public endpoint |
| `ppra_punjab` | Punjab portal links out to `eproc.punjab.gov.pk` which is IP-gated from outside PK | Test from a PK-hosted runner |
| `kppra` | KP procurement routes through `kp.eprocure.gov.pk/EPADS`; requires supplier registration | Wait for anonymous feed or run a KP-region runner |
| `ppra_sindh` | SPPRA has only legacy search pages, no clean unified feed | Hand-crafted scraper if needed (high effort, low yield) |
| `bppra_balochistan` | BPPRA portal returns 5xx and lacks a stable feed | Wait for portal stabilisation |
| `pseb_pk` | No official tender feed; search results scatter into third-party job boards | Wait for an official PSEB procurement page |
| `nadra_pk` | Site returns 403 to non-browser clients (likely Cloudflare/WAF) | Headless browser fetch or contact NADRA for an API |
| `sop_pk` | Official tender URL redirects to a malformed host | Fix upstream URL or scrape a working mirror |
| `ppwd_pk` | Domain unresolvable | Wait for site to come back online |
| `adb` | Procurement pages exist but no stable current-opportunity feed | ADB Open Data API workaround (large dataset, would need filtering) |
| `etimad_sa` | Saudi platform is behind JS/anti-bot; the dev API requires a paid subscription | Etimad Developer Portal subscription |
| `kuwait_capt` | Cloudflare 403 to non-interactive clients | Headless browser fetch + IP-rep workaround |
| `kuwait_egov_ctc` | eService entry point, not a machine-readable feed | Wait for an open data endpoint |
| `kuwait_cbk` | Requires supplier registration | Apply for supplier access |

Disabled sources still appear in the source catalog so operators can see them in the dashboard with their disabled reason; they're skipped by ingest.

### Scraping policy

When a source has no JSON / RSS / Atom alternative we fall back to HTML scraping the publicly-listed tenders page. Politeness rules are enforced in `packages/ingest/src/util/html-scrape.ts`:

- ≥ 2 s between requests to the same host (per-host token bucket)
- Browser User-Agent + `Accept-Language` (default ingest UA gets rejected by some gov servers)
- Exponential backoff on 429/5xx, max 3 attempts, no retry storms
- Listing pages only — no per-tender detail or PDF fetches
- Each scraping adapter has a comment explaining the policy and the conditions under which to flip the adapter's `disabledReason` (persistent 4xx, ToS change, IP block) rather than fight it

### Adding a source

Each adapter implements `IngestAdapter` from `packages/ingest/src/types.ts`. Add new adapters under `packages/ingest/src/adapters/` and register them in `packages/ingest/src/index.ts` plus the enum in `prisma/schema.prisma` and `packages/shared/src/constants.ts`. Set `disabledReason` to retire an adapter without deleting historical rows.

## Quick start (Docker — recommended)

Prerequisites: [Docker Desktop](https://docs.docker.com/get-docker/) (or Docker Engine + Compose v2). No other local tooling required.

```bash
# 1. Configure
cp .env.example .env
# Open .env and fill in:
#   GEMINI_API_KEY  — free key from https://aistudio.google.com/apikey
#   SESSION_SECRET  — any 32+ char random string (e.g. `openssl rand -hex 24`)
#   (all other defaults work out of the box)

# 2. Build images and start all three services
docker compose build
docker compose up -d
# → postgres on :5432  |  web on :3000  |  worker cron running in background

# 3. First-run only — apply DB schema (~10 s)
docker compose exec web pnpm db:push
docker compose exec web pnpm db:sql packages/db/src/migrations/001_pgvector.sql
docker compose exec web pnpm db:sql packages/db/src/migrations/002_tender_sources.sql
docker compose exec web pnpm db:sql packages/db/src/migrations/003_match_human_resources.sql
docker compose exec web pnpm db:sql packages/db/src/migrations/004_user_multi_tenant.sql
docker compose exec web pnpm db:fts-migrate

# 4. Visit http://localhost:3000, create a company profile, and let the worker run.
```

The worker cron ingests tenders every 6 h and scores matches hourly. To force an immediate first pass instead of waiting:

```bash
docker compose exec worker pnpm ingest          # pull tenders from all active sources (~30–90 s)
for i in {1..5}; do docker compose exec worker pnpm match; done
# Each pass embeds up to 100 tenders and scores up to 20 per tenant.
# Run several times to drain the embedding queue on a fresh database.
```

### 1. Install (local dev without Docker)

```bash
# macOS
brew install postgresql@17 pgvector
brew services start postgresql@17

pnpm install
cp .env.example .env
# Open .env and:
#   - set DATABASE_URL to your local Postgres
#   - set SESSION_SECRET to a 32+ char random string (e.g. `openssl rand -hex 24`)
#   - set GEMINI_API_KEY, or configure a local Ollama stack (see below)
```

### 2. Pick an LLM stack

The matcher and capability-statement generator both go through a provider abstraction. Pick a chat backend and an embedding backend independently. Defaults below run **fully on your laptop, free**.

| Use case | `LLM_PROVIDER` | `EMBEDDING_PROVIDER` | Cost |
|---|---|---|---|
| Docker / cloud default | `gemini` | `gemini` | free tier |
| Local dev (no internet) | `ollama` | `ollama` | free |
| Local dev via LM Studio UI | `lmstudio` | `lmstudio` | free |
| Free cloud (Google Gemini) | `gemini` | `gemini` | free tier — gemini-3.1-flash-lite: ~15 RPM / 500 RPD |
| Free cloud (NVIDIA NIM) | `nvidia` | `nvidia` | free dev tier on build.nvidia.com |
| Self-hosted prod (Ollama on a GPU VM) | `ollama` (remote URL) | `ollama` (remote URL) | infra only |
| Cloud prod (Anthropic + Voyage) | `anthropic` | `voyage` | pay per call |
| Cloud prod (OpenAI single-vendor) | `openai` | `openai` | pay per call |
| Mixed (cheap embed + paid reasoning) | `anthropic` | `ollama` (remote) | partial |

#### What each provider is used for

The matcher does three model-bound things; each maps to a specific call shape and provider tier. Pick a provider per task using this table — the matching code itself does not care, so a "best for X" decision is just env var configuration.

| Pipeline task | Code path | API shape | Reasoning model tier | Embedding model | Latency / call (local) | Latency / call (cloud) |
|---|---|---|---|---|---|---|
| **Tender + profile embedding** | `packages/llm/src/embed.ts` | `EmbeddingProvider.embed(texts)` | — | `EMBEDDING_PROVIDER` × `EMBEDDING_MODEL` | ~80–200 ms (mxbai) | ~150 ms (Voyage/Gemini/NIM) |
| **Fit score + gaps + win-prob + HR estimate** (structured JSON) | `packages/llm/src/score.ts` | `chatStructured` (schema-enforced) | `LLM_REASONING_MODEL` | — | ~3–8 s (qwen2.5:7b) | ~1–3 s (Claude/Gemini/NIM) |
| **Capability statement draft** (free-form text) | `packages/llm/src/capability-statement.ts` | `chatText` | `LLM_REASONING_MODEL` | — | ~10–25 s (qwen2.5:7b) | ~3–6 s (cloud) |
| **Doctor probe / sanity classification** | `packages/llm/src/doctor.ts` | `chatStructured` | `LLM_FAST_MODEL` | — | ~1 s | <1 s |

The fast tier (`LLM_FAST_MODEL`) is plumbed for future light-touch extractions (e.g. quick deadline/budget normalization) but currently only the doctor uses it. Reasoning tier owns the moat. Embeddings are independent — many production deployments will pair a cheap-and-fast embed provider with a stronger reasoning provider.

#### Picking a provider for each task

| Task | Best **free / local** | Best **free cloud** | Best **paid cloud** | Avoid |
|---|---|---|---|---|
| Embeddings | `ollama` + `mxbai-embed-large` (1024-dim, runs on CPU) | `nvidia` + `baai/bge-m3` (1024-dim native, no migration); fallback `gemini` + `gemini-embedding-001` (MRL-truncated to 1024) | `voyage` + `voyage-3-large` (strongest retrieval quality) or `openai` + `text-embedding-3-small` | `anthropic` — no embedding endpoint |
| Fit score + gaps + win-prob (structured JSON) | `ollama` + `qwen2.5:7b-instruct` (schema-constrained decoding is rock-solid here) | `gemini` + `gemini-2.5-flash` (free tier, strong JSON adherence, ~10 RPM/250 RPD) or `nvidia` + `meta/llama-3.3-70b-instruct` (free dev tier) | `anthropic` + `claude-opus-4-7` (forced tool-use is the gold standard for structured output) | `lmstudio` with older builds — set `OAI_STRICT_SCHEMA=false` if it rejects strict mode |
| Capability statement (free-form, long-form text) | `ollama` + `qwen2.5:7b-instruct` (decent prose, but verbose) | `gemini` + `gemini-2.5-flash` (excellent prose for free) or `nvidia` + `meta/llama-3.3-70b-instruct` | `anthropic` + `claude-opus-4-7` (best prose quality for client-facing output) or `openai` + `gpt-4o` | small <3B local models — generate hallucinated client names |
| Score-blending mode (env-controlled) | local → blends LLM score with cosine baseline at weight `LLM_SCORE_BLEND_WEIGHT` (default 0.3) | leave default 0.3 | set `LLM_SCORE_BLEND_WEIGHT=0` to trust the model fully | — |
| `DASHBOARD_MIN_FIT_SCORE` floor | 30 (small local models are conservative) | 40–50 | 60+ (frontier models calibrate higher) | — |

**Mix-and-match recipes** (all env-only, no code change):

```env
# Recipe 1 — fully free, fully cloud (recommended for laptops without a strong GPU)
LLM_PROVIDER=gemini
GEMINI_API_KEY=AIza...
EMBEDDING_PROVIDER=nvidia
NVIDIA_API_KEY=nvapi-...
# Why: Gemini has the cleanest free-tier structured-output + capability prose;
# NVIDIA's bge-m3 returns 1024-dim natively so no pgvector migration needed.

# Recipe 2 — local embeddings (fast, free), cloud reasoning (quality)
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=mxbai-embed-large
# Why: embeddings are batchy and embarrassingly parallel — local hardware
# handles them fine. Reasoning is sequential and benefits from a strong model.

# Recipe 3 — all-local development (no API keys at all)
LLM_PROVIDER=ollama
LLM_REASONING_MODEL=qwen2.5:7b-instruct
LLM_FAST_MODEL=qwen2.5:3b-instruct
EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=mxbai-embed-large

# Recipe 4 — free-cloud reasoning, free-cloud embeddings, single vendor
LLM_PROVIDER=gemini
GEMINI_API_KEY=AIza...
EMBEDDING_PROVIDER=gemini
EMBEDDING_MODEL=gemini-embedding-001
EMBEDDING_DIM=1024   # MRL-truncated; no migration needed
```

#### Local-first (Ollama)

Requires a machine with sufficient RAM to run local models (see *Hardware notes* below). The active set occupies ~6 GB resident.

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

#### Free cloud — Google Gemini (default configuration)

The Gemini API has a free tier. `gemini-3.1-flash-lite` (the current default) runs at ≈15 RPM / 500 RPD — sufficient for a single tenant's ingest cadence. Get a key at <https://aistudio.google.com/apikey>, then:

```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=AIza...
LLM_REASONING_MODEL=gemini-3.1-flash-lite
LLM_FAST_MODEL=gemini-3.1-flash-lite
EMBEDDING_PROVIDER=gemini
EMBEDDING_MODEL=gemini-embedding-001
EMBEDDING_DIM=1024
# gemini-embedding-001 supports MRL truncation — vectors fit the existing 1024-dim pgvector column.
```

#### Free cloud — NVIDIA NIM

NVIDIA hosts a free OpenAI-compatible gateway at `integrate.api.nvidia.com/v1` covering Llama 3.3 70B, Llama 3.1 8B, BGE-M3 embeddings, and more. Pick a model at <https://build.nvidia.com/explore/discover>, click "Get API Key", then:

```env
LLM_PROVIDER=nvidia
NVIDIA_API_KEY=nvapi-...
# defaults: meta/llama-3.3-70b-instruct (reasoning) + meta/llama-3.1-8b-instruct (fast)
EMBEDDING_PROVIDER=nvidia
# baai/bge-m3 returns 1024-dim natively — no pgvector migration needed.
```

#### Paid cloud production

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
psql -d project_beta -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Schema + Prisma model
pnpm db:generate
pnpm db:push

# Raw SQL migrations — apply in numeric order. pnpm db:sql wraps psql so it
# loads .env automatically and strips the ?schema=public param Prisma adds
# (which raw psql rejects).
pnpm db:vector-sql                                                       # regenerates 001 with current EMBEDDING_DIM
pnpm db:sql packages/db/src/migrations/001_pgvector.sql                  # vector columns + HNSW indexes
pnpm db:sql packages/db/src/migrations/002_tender_sources.sql            # TenderSource enum extensions
pnpm db:sql packages/db/src/migrations/003_match_human_resources.sql     # humanResourcesEstimate column
pnpm db:sql packages/db/src/migrations/004_user_multi_tenant.sql         # composite (email, tenantId) unique
pnpm db:fts-migrate                                                      # 005 — FTS (tsvector + GIN) for hybrid retrieval
```

Each raw migration is idempotent (`IF NOT EXISTS` / `IF EXISTS` guards). `db:fts-migrate` is just an alias for `pnpm db:sql packages/db/src/migrations/005_tender_fts.sql`.

If you change `EMBEDDING_DIM` later (e.g. switching to a 768-dim or 1536-dim embedding model), re-run `pnpm db:vector-sql` and re-apply `001`.

**Caveat: the `Tender` and `CapabilityProfile` tables hold the `embedding` columns (and the FTS `fts_doc` generated column) via raw SQL, not Prisma.** Subsequent `prisma db push` runs will warn about "data loss" wanting to drop them. Apply enum/column changes via raw `ALTER` statements — see the existing migrations in `packages/db/src/migrations/`.

### 4. Dev

```bash
pnpm dev:web                              # Next.js on :3000

# Docker (run inside the worker container)
docker compose exec worker pnpm ingest   # one-shot: pull new tenders from all enabled sources
docker compose exec worker pnpm match    # one-shot: embed + score (skips unchanged rows)
docker compose exec worker pnpm digest   # one-shot: send digests for due tenants

# Local (non-Docker)
pnpm ingest
pnpm match
pnpm digest
pnpm eval --tenant=<slug>                # shadow-mode eval report from MatchFeedback labels
pnpm --filter worker dev                 # OR continuous cron mode (ingest 6h, match 1h, digest 15m)
```

The match worker processes up to 100 tenders per phase. On a fresh ingest of 1,000+ tenders, run it several times (or leave the cron mode running) to drain the queue. Once the `embeddingHash` column is populated, subsequent runs are near-instant — only changed rows re-embed.

## Running the complete app

### Docker (recommended)

All three services (Postgres, web, worker) start with a single command. See *Quick start* above for the one-time DB setup. After that:

```bash
# Start everything
docker compose up -d
# → http://localhost:3000

# Stop everything
docker compose down

# View logs
docker compose logs -f web
docker compose logs -f worker

# Rebuild after code changes
docker compose up -d --build web       # web only (fast)
docker compose up -d --build           # all services
```

### Day-to-day — one-off worker commands

```bash
# Force an immediate ingest (rather than waiting for the 6-hour cron tick)
docker compose exec worker pnpm ingest

# Score new matches (each pass embeds ~100 tenders, scores up to 20 per tenant)
docker compose exec worker pnpm match

# Send digest emails manually
docker compose exec worker pnpm digest

# Run shadow-mode eval for a specific tenant
docker compose exec worker pnpm eval --tenant=<slug>
```

### Local dev without Docker (4 shells)

If you prefer to run processes directly (faster hot-reload for frontend work):

```bash
# Shell 1 — Ollama (only needed if LLM_PROVIDER=ollama)
ollama serve

# Shell 2 — Next.js web app
pnpm dev:web
# → http://localhost:3000

# Shell 3 — Cron worker (continuous ingest + match + digest)
pnpm --filter worker dev
# → ingest every 6h, match hourly, digest every 15m

# Shell 4 — ad-hoc commands
pnpm ingest    # one-shot ingest
pnpm match     # one-shot match cycle
```

Visit `http://localhost:3000`, create a company profile, and matches start flowing on the next worker tick.

### First-run shortcut (skip waiting for cron)

The cron worker takes up to 6 h to do its first ingest. To see results immediately on a fresh DB:

```bash
# Docker
docker compose exec worker pnpm ingest
for i in {1..5}; do docker compose exec worker pnpm match; done

# Local (non-Docker)
pnpm ingest
for i in {1..5}; do pnpm match; done
# After ~5 passes the embedding queue is draining; run more to embed all tenders.
# Once all embeddings are cached the persistent hash means subsequent runs are near-instant.
```

### Onboarding a tenant via API (optional, no UI needed)

```bash
curl -s -i -X POST http://localhost:3000/api/v1/tenants/onboard \
  -H 'Content-Type: application/json' \
  -c /tmp/cookies.txt \
  -d '{
    "companyName":"Acme Cloud Co",
    "oneLiner":"AWS-native custom software dev shop in Karachi, 18 engineers.",
    "industries":["fintech","logistics"],
    "techStack":["TypeScript","AWS","Postgres","React"],
    "services":["custom software dev","cloud migration","DevOps"],
    "certifications":["ISO 27001"],
    "pastClients":["Bank Alfalah"],
    "pastProjects":[{"title":"Mobile banking revamp","summary":"Re-architected a tier-1 mobile banking app on AWS.","sector":"fintech","valueUsd":750000}],
    "geographies":["PK","AE"],
    "teamSize":18,
    "budgetRangeUsd":{"min":100000,"max":1500000},
    "languages":["en","ur"]
  }'
# → 201 Created with { tenantId, slug }, sets the beta_session cookie

curl -b /tmp/cookies.txt http://localhost:3000/api/v1/matches
# → ranked match list once the worker has scored some
```

### Stopping everything

```bash
# Docker
docker compose down

# Local (non-Docker) — Ctrl-C in each shell, or:
pkill -f "next dev"
pkill -f "tsx watch"
pkill -f "ollama serve"        # only if running Ollama locally
```

### Health checks

```bash
# Docker
docker compose ps                                             # all services healthy?
docker compose exec web pnpm llm:doctor                      # LLM stack
docker compose exec postgres pg_isready -U postgres          # Postgres

# Local (non-Docker)
pnpm llm:doctor
pg_isready -h localhost -p 5432
curl -s http://localhost:11434/api/tags | jq                  # Ollama — if using local LLM
curl -s http://localhost:3000 -o /dev/null -w '%{http_code}\n'
```

### Production switch (no code change)

Set in `.env` for cloud LLMs and re-run the worker / web app:

```env
LLM_PROVIDER=anthropic
LLM_REASONING_MODEL=claude-opus-4-7
LLM_FAST_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=sk-ant-...

EMBEDDING_PROVIDER=voyage
EMBEDDING_MODEL=voyage-3-large
VOYAGE_API_KEY=pa-...
```

Or self-host Ollama on a GPU VM and only change `OLLAMA_BASE_URL`.

### Hardware notes (local LLM only)

These specs apply only when running with `LLM_PROVIDER=ollama` or `LLM_PROVIDER=lmstudio`. Cloud provider setups (Gemini, Anthropic, OpenAI, etc.) have no local hardware requirements beyond running Docker.

| Workload | Recommended local model | Resident RAM |
|---|---|---|
| Reasoning / scoring | `qwen2.5:7b-instruct` | ~5 GB |
| Fast extraction | `qwen2.5:3b-instruct` | ~2 GB |
| Embeddings | `mxbai-embed-large` | ~700 MB |
| Bigger reasoning (slower) | `qwen2.5:14b-instruct` Q4 | ~9 GB |

A machine with at least 16 GB of unified or system RAM is recommended for the 7B + embedding combination (~6 GB total resident). Schema-constrained decoding via Ollama's `format: <json schema>` is the key reason the matcher's structured outputs are reliable on local 7B models; cached embeddings (in-memory LRU + persistent `embeddingHash` column) keep repeated runs fast.

### Provider-aware score blending

Small local models can swing the LLM-assigned `fitScore` more than frontier models. When the active chat provider is `ollama` or `lmstudio`, `scoreMatch` blends the model's score with the cosine-derived baseline (default weight `0.3`, override with `LLM_SCORE_BLEND_WEIGHT`). Cloud providers run unblended.

### Persistent embedding cache

Each `Tender` and `CapabilityProfile` row stores a `(embeddingHash, embeddingModel)` pair so the match worker skips re-embedding when nothing has changed. Provider/model swaps invalidate automatically because the model name is part of the hash.

### Shadow-mode eval

The matcher runs alongside the bid team's existing workflow without changing it: every morning the worker scores tenders, the team independently marks matches they're interested in (writes `MatchFeedback` rows), and once a week the eval harness compares the two. Build the report with:

```bash
pnpm eval --tenant=<your-slug>                              # all-time
pnpm eval --tenant=<your-slug> --since=2026-04-01           # window
pnpm eval --tenant=<your-slug> --thresholds=40,60,75        # custom thresholds
pnpm eval --tenant=<your-slug> --out=./reviews/wk16.md      # custom output path
```

Output is a Markdown file in `outputs/eval-<slug>-<date>.md` containing:

- **Agreement rate** at each threshold — across labeled matches, on how many did the matcher (`fitScore ≥ threshold`) and the bid team (`interested = true`) reach the same conclusion?
- **Confusion matrix** (TP / FP / FN / TN), precision, recall, F1 per threshold
- **Per-source breakdown** so you can see whether the matcher is much better on SAM.gov than on PPRA (or vice versa)
- An inline "How to read this" guide for non-ML readers

The aim is to keep the matcher **honest and improving over months**: track agreement and per-source breakdown trends, look at false negatives first (those would have been silently dropped in production), then false positives.

### Reranking — Voyage rerank-2.5

Stage 2 of the pipeline uses a cross-encoder reranker. Default is `RERANK_PROVIDER=none` (a no-op pass-through). To activate Voyage's rerank-2.5:

```env
RERANK_PROVIDER=voyage
VOYAGE_API_KEY=pa-...
# Optional overrides:
# RERANK_MODEL=rerank-2.5            # also: rerank-2.5-lite (cheaper, faster)
# RERANK_TOP_K=20                    # how many top candidates to LLM-score
# RERANK_TIMEOUT_MS=30000
```

The Voyage free tier covers **200M tokens** on rerank-2.5, which is well beyond a single company's working set — practically free for internal use. Pricing: <https://docs.voyageai.com/docs/pricing>.

### Tuning the retrieval pipeline

All knobs are env-controlled with sensible defaults. None require code changes.

| Variable | Default | Effect |
|---|---|---|
| `MATCH_PER_RETRIEVER_LIMIT` | `60` | Top-N pulled from each retriever (dense and FTS) before fusion |
| `MATCH_RERANK_INPUT_LIMIT` | `40` | Fused candidates handed to the reranker |
| `MATCH_RERANK_DOC_CHARS` | `1500` | Per-doc text budget for the reranker (server-side truncation also applies) |
| `EMBED_INPUT_CHAR_CAP` | `6000` | Per-input cap before embed call (Voyage handles ~8K tokens; mxbai caps at 512) |
| `EMBED_LONG_TEXT_THRESHOLD` | same as cap | Tenders longer than this get chunked + mean-pooled |
| `EMBED_CHUNK_TARGET_CHARS` | `1500` | Target chars per chunk |
| `EMBED_CHUNK_OVERLAP_CHARS` | `200` | Overlap between adjacent chunks |
| `EMBED_CHUNK_MAX_BATCH` | `16` | Max chunks per provider request |

## Cron schedule (continuous mode)

| Job | Frequency |
|---|---|
| Ingest | every 6 hours |
| Match (embed + score) | hourly |
| Digest dispatch | every 15 minutes (each tick filters by `isDueNow`) |

Per-tenant digest cadence is configured via the `/schedule` UI and stored on `DigestSchedule` (frequency, hour-of-day, day-of-week, timezone, min fit score).

## Agent build

This repo was built by a coordinated agent build:

| Agent | Owns |
|---|---|
| Lead | `SCOPE.md`, workspace config, `packages/shared/`, integration glue, this README |
| Backend | `prisma/schema.prisma`, `packages/db/`, `apps/web/app/api/`, `apps/web/lib/auth|api|db|services/` |
| Ingestion | `packages/ingest/` |
| LLM engine | `packages/llm/` |
| Frontend | `apps/web/app/(marketing)/`, `apps/web/app/(app)/`, `apps/web/components/`, `apps/web/lib/ui/` |
| Scheduler | `worker/`, `packages/notifications/`, capability-statement route wiring |


## Status

This is an MVP that proves the architecture and the matching loop end-to-end:

- ✅ 12 sources actively ingest live tenders; 14 more registered-but-disabled with documented reasons (Cloudflare, paywalls, geofences). Live PDA scrape uses a scoped TLS-relaxation for that one host (incomplete cert chain). PC.gov.pk scraper rewritten to walk tender table rows only (no footer false positives).
- ✅ **Hybrid retrieval (dense + BM25-style FTS, RRF-fused)** + **cross-encoder rerank stage** (Voyage rerank-2.5, with no-op fallback) + LLM structured scoring — current industry-standard pipeline
- ✅ Long-tender **chunking + mean-pool aggregation** so multi-page descriptions retain signal without a schema change
- ✅ Local LLM stack scores fit + gaps + win-prob + HR estimate as a single structured-output call; verified with qwen2.5:7b
- ✅ Capability statement generation works end-to-end against local models
- ✅ Persistent embedding cache + provider-aware score blending
- ✅ **Shadow-mode eval harness** (`pnpm eval`) — confusion matrix + per-source breakdown from `MatchFeedback` labels, output as a Markdown report
- ✅ Seven LLM provider backends drop in via env-var swap: Ollama, LM Studio, OpenAI, Anthropic, Voyage, **Google Gemini** (free tier), **NVIDIA NIM** (free dev tier)

Not yet production: no real auth (single-user-per-tenant stub), no rate-limit handling beyond polite scraping, no payment, no live FX feed (static fallback rates), TED EU adapter awaiting BT-code rewrite. Outstanding items are grep-able as `TODO(lead):` markers across the tree.

## License

Proprietary — all rights reserved. Not licensed for external use or distribution.
