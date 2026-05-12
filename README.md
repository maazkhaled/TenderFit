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
    ├── ingest/                    ← Source adapters (28 sources — World Bank, UK Find a Tender, UK Contracts Finder, PPRA, UNGM, UNDP, NITB, PITB, Ignite, Planning Commission, Urban Unit, PDA, SAM.gov, …)
    ├── llm/                       ← Pluggable matching engine (Ollama / LM Studio / OpenAI / Anthropic / Voyage / Gemini / NVIDIA NIM)
    └── notifications/             ← Digest builder + renderer + sender
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
| Free cloud (Google Gemini) | `gemini` | `gemini` | free tier — ~10 RPM / 250 RPD |
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

#### Free cloud — Google Gemini

The Gemini API has a free tier (≈10 requests/min, 250 requests/day on `gemini-2.5-flash` as of mid-2026 — generous for ingest). Get a key at <https://aistudio.google.com/apikey>, then:

```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=AIza...
# defaults: gemini-2.5-flash for both tiers — override with LLM_REASONING_MODEL=gemini-2.5-pro
EMBEDDING_PROVIDER=gemini
# gemini-embedding-001 supports MRL truncation, so the `dimensions` field
# returns vectors that fit the existing 1024-dim pgvector column.
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

## Running the complete app

The app is three independent processes plus an LLM backend. They can all share one terminal session if you background them, but the cleanest layout is one shell per process so logs are readable.

### One-time prep (covers fresh laptop → working app)

```bash
# 1. Postgres + pgvector + Ollama
brew install postgresql@17 pgvector ollama
brew services start postgresql@17

# 2. Database
psql -U postgres -d postgres -c "CREATE DATABASE project_beta;"
psql -U postgres -d project_beta -c "CREATE EXTENSION IF NOT EXISTS vector;"

# 3. Project deps + env
pnpm install
cp .env.example .env
# Edit .env: set DATABASE_URL and SESSION_SECRET (>= 32 chars: `openssl rand -hex 24`)

# 4. Schema
pnpm db:generate
pnpm db:push
pnpm db:vector-sql
psql "$DATABASE_URL" -f packages/db/src/migrations/001_pgvector.sql

# 5. LLM models (run once; ~7 GB total disk)
ollama serve &        # start the daemon (or run in another shell)
ollama pull qwen2.5:7b-instruct
ollama pull qwen2.5:3b-instruct
ollama pull mxbai-embed-large

# 6. Verify the LLM stack
pnpm llm:doctor
# Expect: all 4 checks green (chat ping, embed ping, live 1024-dim embed, structured-output round-trip)
```

### Day-to-day startup (4 shells)

```bash
# Shell 1 — Ollama (always-on)
ollama serve

# Shell 2 — Next.js web app
pnpm dev:web
# → http://localhost:3000

# Shell 3 — Cron worker (continuous ingest + match + digest)
pnpm --filter worker dev
# → ingest every 6h, match hourly, digest every 15m

# Shell 4 — your terminal for running ad-hoc commands
```

That's it — the app is fully running. Visit `http://localhost:3000`, sign up a tenant, fill in the capability profile, and matches start flowing on the next worker tick.

### First-run shortcut (skip waiting for cron)

The cron worker takes up to 6 h to do its first ingest. To see results immediately on a fresh DB, force one full pass:

```bash
pnpm worker:ingest          # pulls fresh tenders from all 12 active sources (~30–90 s)

# match worker takes 100 tenders/phase; drain the queue:
for i in {1..18}; do pnpm worker:match; done
# Each pass is ~1 min on local Ollama. After ~18 passes the embedding queue
# is empty and the persistent hash cache means subsequent runs are seconds.
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
# Ctrl-C in each shell, or:
pkill -f "next dev"
pkill -f "tsx watch"
brew services stop postgresql@17
pkill -f "ollama serve"        # only if you're done for the session
```

### Health checks

```bash
pnpm llm:doctor                # LLM stack
pg_isready -h localhost -p 5432  # Postgres
curl -s http://localhost:11434/api/tags | jq        # Ollama models loaded
curl -s http://localhost:3000 -o /dev/null -w '%{http_code}\n'  # Web app
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

- ✅ 12 sources actively ingest live tenders; 14 more registered-but-disabled with documented reasons (Cloudflare, paywalls, geofences). Live PDA scrape uses a scoped TLS-relaxation for that one host (incomplete cert chain). PC.gov.pk scraper rewritten to walk tender table rows only (no footer false positives).
- ✅ Local LLM stack scores fit + gaps + win-prob + HR estimate as a single structured-output call; verified with qwen2.5:7b
- ✅ Capability statement generation works end-to-end against local models
- ✅ Persistent embedding cache + provider-aware score blending
- ✅ Seven LLM provider backends drop in via env-var swap: Ollama, LM Studio, OpenAI, Anthropic, Voyage, **Google Gemini** (free tier), **NVIDIA NIM** (free dev tier)

Not yet production: no real auth (single-user-per-tenant stub), no rate-limit handling beyond polite scraping, no payment, no live FX feed (static fallback rates), TED EU adapter awaiting BT-code rewrite. Outstanding items are grep-able as `TODO(lead):` markers across the tree.

## License

UNLICENSED — internal exploration. Confirm a license before any external distribution.
