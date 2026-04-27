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
    ├── llm/                       ← Claude + Voyage matching engine
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

Prerequisites: Node ≥ 20.10, pnpm 9, PostgreSQL 16 with the `vector` extension, an Anthropic API key, a Voyage AI key.

```bash
# 1. install
pnpm install

# 2. env
cp .env.example .env
# fill DATABASE_URL, ANTHROPIC_API_KEY, VOYAGE_API_KEY at minimum

# 3. db
pnpm db:generate
pnpm db:push
psql "$DATABASE_URL" -f packages/db/src/migrations/001_pgvector.sql

# 4. dev
pnpm dev:web            # Next.js on :3000
pnpm worker:ingest      # one-shot: pull new tenders
pnpm worker:match       # one-shot: embed + score
pnpm worker:digest      # one-shot: send digests for due tenants
pnpm --filter worker dev  # OR continuous cron mode
```

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
