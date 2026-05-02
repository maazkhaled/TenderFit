# Project Beta

Multi-tenant SaaS that ingests tender / RFP / project opportunities (domestic and international) from **official, license-friendly sources only**, matches them against a tenant company's capability profile using LLM-powered fit scoring + gap analysis, and delivers **scheduled digests** (not always-on alerts).

Target buyer: any IT services / software / consulting company that bids on opportunities.

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
    ├── ingest/                    ← Source adapters (SAM.gov, TED EU, UNGM, World Bank, PPRA)
    ├── llm/                       ← Pluggable matching engine (Ollama / LM Studio / OpenAI / Claude + Voyage)
    └── notifications/             ← Digest builder + renderer + sender
```

## Data sources (MVP — all official, license-friendly)

| Source | Coverage | Auth |
|---|---|---|
| SAM.gov | US Federal | `SAM_GOV_API_KEY` |
| TED EU | EU procurement | `TED_EU_API_KEY` (or anon for some endpoints) |
| UNGM | UN agencies | RSS, no key |
| World Bank | Multilateral | none |
| Pakistan PPRA | Domestic | RSS, no key |

**No HTML scraping anywhere.** New sources are added as adapters under `packages/ingest/src/adapters/`.

## Quick start

Prerequisites: Node ≥ 20.10, pnpm 9, PostgreSQL 16 with the `vector` extension. **No paid API keys required** for the default local-first config.

### 1. Install

```bash
pnpm install
cp .env.example .env
# fill DATABASE_URL — leave LLM_* defaults alone for local-first dev
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
pnpm db:generate
pnpm db:push
pnpm db:vector-sql                            # generates SQL with current EMBEDDING_DIM
psql "$DATABASE_URL" -f packages/db/src/migrations/001_pgvector.sql
```

If you change `EMBEDDING_DIM` later (e.g. switching to a 768-dim or 1536-dim embedding model), re-run `pnpm db:vector-sql` and re-apply the SQL.

### 4. Dev

```bash
pnpm dev:web            # Next.js on :3000
pnpm worker:ingest      # one-shot: pull new tenders
pnpm worker:match       # one-shot: embed + score
pnpm worker:digest      # one-shot: send digests for due tenants
pnpm --filter worker dev  # OR continuous cron mode
```

### Hardware notes (M4 Pro, 24 GB)

| Workload | Recommended local model | Resident |
|---|---|---|
| Reasoning / scoring | `qwen2.5:7b-instruct` | ~5 GB |
| Fast extraction | `qwen2.5:3b-instruct` | ~2 GB |
| Embeddings | `mxbai-embed-large` | ~700 MB |
| Bigger reasoning (slower) | `qwen2.5:14b-instruct` Q4 | ~9 GB |

Schema-constrained decoding via Ollama's `format: <json schema>` is the key reason the matcher's structured outputs are reliable on local 7B models. Each fit-score call is ~2–6s on the M4 Pro; cached embeddings (in-memory LRU) keep repeated runs fast.

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

This is an MVP **scaffold** that proves the architecture and the matching loop. Not production. Outstanding lead-owned items are tracked in the per-agent notes files and grep-able as `TODO(lead):` markers across the tree.

## License

UNLICENSED — internal exploration. Confirm a license before any external distribution.
# TenderFit
