# TenderFit

Multi-tenant SaaS that ingests tender / RFP / project opportunities from official public sources, matches them against your company's capability profile using LLM-powered fit scoring + gap analysis, and delivers scheduled email digests. Live deployment: **https://tenderfit.detex.site**.

For end users: read **[`USER_GUIDE.md`](./USER_GUIDE.md)** — step-by-step walkthrough of every button, when to use what, and how to manage the digest.

For contributors / operators: keep reading.

## What the matcher produces

For every (tender, company) pair:

1. **Fit score 0–100** — produced by a four-stage pipeline (hybrid retrieval → cross-encoder rerank → LLM scoring → optional cosine blend)
2. **Match analysis** — 3 grounded bullets explaining the score (positive or negative)
3. **Capability gaps** — explicit blockers / major / minor requirements the company doesn't yet meet
4. **Win-probability heuristic** — Low / Medium / High with reasoning
5. **One-click capability statement draft** — tailored bid input, no hallucinations
6. **Minimum HR estimate** — team-size + role breakdown inferred from tender scope
7. **International collaboration mode** — opt-in per-tenant flag that excludes country/geography from scoring, useful for cross-border JVs and partnerships

Plus a shadow-mode eval harness (`pnpm eval --tenant=<slug>`) that produces confusion-matrix metrics from `MatchFeedback` labels.

## Stack

- **Web:** Next.js 14 (App Router) + TypeScript + Tailwind + iron-session
- **Worker:** Node + TSX + `node-cron` for ingest/match/digest, plus an internal HTTP API on `:8080` for UI-triggered jobs
- **DB:** PostgreSQL 16 + pgvector
- **Reverse proxy:** Caddy with automatic Let's Encrypt TLS
- **LLM (default):** Google Gemini 2.5/3.x Flash (chat) + Voyage `voyage-3-large` (embeddings) + Voyage `rerank-2.5` (reranker)
- **Email:** Resend
- **Container orchestration:** Docker Compose (four services: `postgres`, `web`, `worker`, `caddy`)

The LLM stack is fully swappable via env vars — see [LLM provider table](#llm-provider-options) below.

## Live deployment

| Concern | Value |
|---|---|
| Public URL | `https://tenderfit.detex.site` |
| Host | Hostinger KVM 2 VPS (Malaysia datacenter) |
| Domain DNS | Hostinger DNS for `detex.site`, A record for `tenderfit` |
| TLS | Caddy auto-issued Let's Encrypt cert (renews automatically) |
| Email sender | Resend sandbox `onboarding@resend.dev` (move to verified domain later) |
| Health check | UptimeRobot pings `/login` every 5 min |

## Quick start (local dev)

```bash
# 1. Configure
cp .env.example .env
# Open .env and fill in (at minimum):
#   GEMINI_API_KEY      - https://aistudio.google.com/apikey
#   VOYAGE_API_KEY      - https://dash.voyageai.com (free 200M tokens)
#   RESEND_API_KEY      - https://resend.com/api-keys (optional in dev)
#   SESSION_SECRET      - openssl rand -hex 32
#   DEMO_PASSWORD       - openssl rand -base64 18
#   WORKER_AUTH_TOKEN   - openssl rand -hex 32

# 2. Bring up the stack
docker compose build
docker compose up -d

# 3. First-run only - schema + migrations
docker compose exec web pnpm db:push
for sql in packages/db/src/migrations/00*.sql; do
  docker compose exec -T postgres psql -U postgres -d project_beta < "$sql"
done
docker compose exec -w /app web pnpm db:generate
docker compose exec -w /app worker pnpm db:generate
docker compose restart web worker

# 4. Open
open http://localhost:3000
# Sign in with any email + DEMO_PASSWORD, fill the profile, save.
```

## Production deploy

Same `docker compose` stack on any VPS with Docker. For the live deployment we use Hostinger KVM 2 (Malaysia) with these steps:

1. Provision a VPS (any provider — Hostinger, Hetzner, Oracle Cloud all work; 4 GB RAM minimum for the Next.js build step).
2. SSH in, install Docker: `curl -fsSL https://get.docker.com | sh`
3. Open ports 80 + 443: `ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable`
4. `git clone` the repo to `/root/tenderfit`
5. `scp` your hardened `.env.production` to the VPS as `.env` (don't commit secrets to git)
6. Add a DNS A record pointing your subdomain at the VPS IP
7. The `docker-compose.yml` already has Caddy enabled with `DOMAIN: "tenderfit.detex.site"` — edit those two values for your domain + email
8. `docker compose build && docker compose up -d`
9. Apply migrations (see Quick start step 3)
10. Add UptimeRobot health check pinging `/login` every 5 min

## Day-to-day operations

The dashboard has three buttons under **Run now** that trigger the same actions as these CLI commands:

| UI button | CLI equivalent | When to use |
|---|---|---|
| Fetch latest tenders | `docker compose exec -w /app worker pnpm worker:ingest` | Pull fresh tenders from every active source |
| Find new matches | `docker compose exec -w /app worker pnpm worker:match` | Embed pending tenders + score new matches |
| Send digest now | `docker compose exec -w /app worker pnpm worker:digest -- --tenant=<slug>` | Send an immediate digest, bypassing the cron schedule |

The cron continues to run in the background (ingest every 6h, match every hour, digest every 15 min — filtered by each tenant's `DigestSchedule`).

```bash
# View live logs
docker compose logs -f worker
docker compose logs -f caddy

# Service health
docker compose ps
docker compose exec -w /app worker pnpm llm:doctor

# Shutdown / restart
docker compose down               # stops + removes containers, keeps volume
docker compose up -d              # back up
docker compose down -v            # NUKE database too (destructive)
```

## Data sources

15 active by default, 1 needs free API key, 12 disabled pending upstream changes. The dashboard exposes per-tenant source filtering via checkboxes.

### Active by default

| ID | Source | Coverage | Mechanism |
|---|---|---|---|
| `world_bank` | World Bank | Multilateral | JSON API |
| `uk_find_a_tender` | UK Find a Tender | Above-threshold UK | OCDS JSON |
| `uk_contracts_finder` | UK Contracts Finder | Below-threshold + SME UK | OCDS JSON |
| `ppra_pk` | Pakistan Federal PPRA (EPMS) | Federal PK | HTML scrape |
| `ungm` | UNGM | UN agency procurement | HTML scrape |
| `undp` | UNDP Procurement | UN agency procurement | RSS / RDF |
| `nitb_pk` | National IT Board (PK) | Federal IT/digital | HTML scrape |
| `pitb_pk` | Punjab IT Board | Punjab IT/digital | HTML scrape |
| `planning_commission_pk` | Planning Commission (PK) | Federal planning | HTML scrape |
| `urban_unit_pk` | The Urban Unit (PK) | Punjab urban planning | HTML scrape |
| `ignite_pk` | Ignite National Technology Fund (PK) | PK IT R&D RFPs | HTML scrape |
| `pda_pk` | Pakistan Digital Authority | Federal digital | HTML scrape (scoped TLS-relaxed) |
| `sop_pk` | Survey of Pakistan | Federal survey/GIS | HTML scrape |

### Optional (free API key)

- `sam_gov` — SAM.gov US Federal — register at https://sam.gov for `SAM_GOV_API_KEY`

### Disabled

The remaining sources (TED EU, several provincial PK PPRAs, NADRA, several Kuwait & Saudi platforms) are registered as `disabledAdapter(...)` entries in `packages/ingest/src/index.ts` with a documented reason. They still appear in the dashboard's source picker so operators can see what's coming; ingest skips them. See the disabled reasons inline for what each one needs to come online.

## LLM provider options

Default config uses **Google Gemini** for chat + **Voyage** for embeddings + rerank. To swap, only env vars change — no code:

| Provider | Free tier? | Used for |
|---|---|---|
| `gemini` | Yes (~15 RPM, no daily cap on embeddings) | Chat + embeddings |
| `voyage` | Yes (200M tokens lifetime per account) | Embeddings + rerank only |
| `ollama` | Yes (runs locally) | Chat + embeddings; needs GPU/RAM |
| `lmstudio` | Yes (runs locally with GUI) | Chat + embeddings |
| `openai` | No | Chat + embeddings |
| `anthropic` | No | Chat only (no embedding API) |
| `nvidia` | Yes (free dev tier on build.nvidia.com) | Chat + embeddings |

See `packages/llm/src/providers/config.ts` for the full env-var mapping.

## Repository layout

```
tenderfit/
├── README.md                       this file
├── USER_GUIDE.md                   step-by-step manual for end users
├── docker-compose.yml              production-shaped compose (Caddy enabled)
├── Dockerfile                      multi-target build (web + worker)
├── Caddyfile                       reverse-proxy + TLS config
├── prisma/schema.prisma            DB contract (pgvector + Postgres)
├── apps/web/                       Next.js 14 (App Router) — UI + API
├── worker/                         Node worker (ingest / match / digest / cron + HTTP API)
└── packages/
    ├── shared/                     Zod schemas, types, constants
    ├── db/                         Prisma client + raw SQL migrations
    ├── ingest/                     Source adapters
    ├── llm/                        Pluggable matching engine
    └── notifications/              Digest builder + renderer + sender
```

## Authentication

Current: shared-password gate (set `DEMO_PASSWORD` in `.env`). One email per tenant binding via the `User` table. Iron-session cookie.

Planned next-up: Auth.js with **Sign in with Google** + email magic links — see the `Plan: Google OAuth + email verification` task in the project board.

## Status

- ✅ 13 sources actively ingest; 1 with free API key; 12 disabled with documented reasons
- ✅ Hybrid retrieval (dense + BM25-style FTS, RRF-fused) + Voyage cross-encoder rerank + LLM structured scoring
- ✅ Long-tender chunking + mean-pool aggregation
- ✅ Persistent embedding cache, provider-aware score blending
- ✅ Shadow-mode eval harness (`pnpm eval`)
- ✅ Eight LLM provider backends drop in via env-var swap
- ✅ International collaboration mode (`ignoreLocation` toggle on profile)
- ✅ Frontend "Run now" buttons for ingest/match/digest (no CLI needed)
- ✅ Multi-recipient digest emails (per-tenant recipient list)
- ✅ Per-tenant min-fit-score control (live slider on dashboard, applies to digest too)
- ✅ Customisable digest schedule with time window + 4 cadences (daily / every N days / weekly / monthly)
- ✅ Production deployment on Hostinger KVM 2 with Caddy + Let's Encrypt TLS
- ⏳ Real auth (Google OAuth + email verification) — planned
- ⏳ Multi-tenant sales / billing — planned

## License

Proprietary — all rights reserved. Not licensed for external use or distribution.
