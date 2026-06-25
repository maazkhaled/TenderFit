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
| Email sender | Resend with verified subdomain `mail.detex.site` (SPF + DKIM + DMARC). From-address: `TenderFit <info@mail.detex.site>` |
| Health check | UptimeRobot pings `/login` every 5 min |

The email sender was moved off the apex domain `detex.site` after Microsoft 365 recipients (Outlook) repeatedly bounced messages and Resend auto-unverified the domain. The subdomain `mail.detex.site` is reputationally isolated, has its own SPF/DKIM/DMARC, and survives Microsoft's greylisting.

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

The cron continues to run in the background. Frequencies are tuned for the Gemini free tier (250 RPD) and digest-driven usage:

| Job | Cadence | Why |
|---|---|---|
| Ingest | 2× per day (02:00 + 14:00 UTC) | Most upstream sources update once or twice a day; two cycles keep digests fresh without thrashing portals |
| Match | 4× per day (03:00, 09:00, 15:00, 21:00 UTC) | Each match call hits Gemini; 4× × ~20 pending = ~80 LLM calls/day, well under 250 RPD |
| Digest | every 15 min | Cheap DB-only check; the `isDueNow` gate ensures emails only actually fire on each tenant's chosen cadence (daily / weekdays / weekly / monthly / every-N-days) |

If you want sub-daily freshness, the dashboard's **Run now → Fetch latest tenders** button kicks off an ad-hoc ingest immediately.

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

10 active by default, 1 needs a free API key, the rest (incl. 10 newly-catalogued Tier 1 / Tier 2 candidates) disabled with documented reasons. The dashboard exposes per-tenant source filtering via checkboxes — disabled sources still appear but render with a "Temporarily not available" badge so users know the source is wired but currently silent.

### Active by default

| ID | Source | Coverage | Mechanism |
|---|---|---|---|
| `world_bank` | World Bank | Multilateral | JSON API (award filter scans both `notice_type` and description text) |
| `uk_find_a_tender` | UK Find a Tender | Above-threshold UK | OCDS JSON |
| `uk_contracts_finder` | UK Contracts Finder | Below-threshold + SME UK | OCDS JSON |
| `ppra_pk` | Pakistan Federal PPRA (EPMS) | Federal PK | HTML scrape (works because EPMS itself isn't geo-blocked) |
| `ungm` | UNGM | UN agency procurement | HTML scrape |
| `undp` | UNDP Procurement | UN agency procurement | RSS / RDF |
| `pitb_pk` | Punjab IT Board | Punjab IT/digital | HTML scrape |
| `urban_unit_pk` | The Urban Unit (PK) | Punjab urban planning | HTML scrape |
| `ignite_pk` | Ignite National Technology Fund (PK) | PK IT R&D RFPs | HTML scrape |
| `pda_pk` | Pakistan Digital Authority | Federal digital | HTML scrape (scoped TLS-relaxed) |

### Optional (free API key)

- `sam_gov` — SAM.gov US Federal — register at https://sam.gov for `SAM_GOV_API_KEY`

### Temporarily unavailable (geo-blocked from non-PK IPs)

These four adapters are fully implemented but their upstream hosts firewall non-Pakistani IP ranges, so the Malaysian production VPS can't reach them. To re-enable, configure `PK_PROXY_URL` in `.env` (a Pakistan-resident HTTP proxy) and swap the line in `packages/ingest/src/index.ts` back from `disabledAdapter(…)` to the real adapter — the imports and the `void` references at the bottom of that file keep the swap to one line.

| ID | Source | What's needed |
|---|---|---|
| `ppra_punjab` | Punjab PPRA | PK-resident proxy via `PK_PROXY_URL` |
| `nitb_pk` | National IT Board | PK-resident proxy via `PK_PROXY_URL` |
| `planning_commission_pk` | Planning Commission | PK-resident proxy via `PK_PROXY_URL` |
| `sop_pk` | Survey of Pakistan | PK-resident proxy via `PK_PROXY_URL` |

### Disabled (upstream constraint)

The remaining sources (TED EU pending API v3 rework, several provincial PK PPRAs without stable feeds, NADRA, ADB, and most Kuwait/Saudi platforms) are registered as `disabledAdapter(...)` entries in `packages/ingest/src/index.ts` with a documented reason inline. They still appear in the dashboard's source picker (with the same "Temporarily not available" badge) so operators can see what's coming; ingest skips them.

### Catalog-only (Tier 1 + Tier 2 candidates, adapters pending)

Added 2026-06-25 to the catalog so they show up in the UI and tenants can pre-opt-in. Adapters are stubbed as `disabledAdapter` until each upstream's feed shape is verified against live responses (same shipping discipline applied to the disabled set above — no speculative scrapers).

| ID | Source | Type | Why catalog-only for now |
|---|---|---|---|
| `gem_india` | GeM India | Government | JS-rendered listing, needs verified public API |
| `austender` | Australian federal AusTender | Government | HTML list is fetchable, detail-URL pattern needs verification |
| `gca_uk` | UK GCA (ex-Crown Commercial) | Government | Agreement list visible but pagination is JS-driven |
| `gebiz_sg` | GeBIZ Singapore | Government | Pure JSF/PrimeFaces — no static HTML payload |
| `canada_buys` | CanadaBuys (federal Canada) | Government | Drupal frontend; needs verified open-data CSV URL |
| `afdb` | African Development Bank | Multilateral | Empty payload on direct fetch — needs feed verification |
| `ifc` | International Finance Corporation | Multilateral | Needs verified procurement-notices feed shape |
| `ebrd` | European Bank for Reconstruction & Development | Multilateral | Needs verified procurement-notices feed shape |
| `jica` | Japan International Cooperation Agency | Multilateral | Needs verified procurement-notices feed shape |
| `iadb` | Inter-American Development Bank | Multilateral | Empty payload on direct fetch — needs feed verification |

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

- ✅ 10 sources actively ingest; 1 with free API key; 4 geo-blocked but adapter-complete (need PK proxy); ~13 disabled with documented reasons
- ✅ Hybrid retrieval (dense + BM25-style FTS, RRF-fused) + Voyage cross-encoder rerank + LLM structured scoring
- ✅ Long-tender chunking + mean-pool aggregation
- ✅ Persistent embedding cache, provider-aware score blending
- ✅ Shadow-mode eval harness (`pnpm eval`)
- ✅ Eight LLM provider backends drop in via env-var swap
- ✅ International collaboration mode (`ignoreLocation` toggle on profile)
- ✅ Frontend "Run now" buttons for ingest/match/digest (no CLI needed)
- ✅ Multi-recipient digest emails (per-tenant recipient list, ≤20)
- ✅ Resend throttle + 429 retry (no more silent third-recipient drops)
- ✅ Per-tenant min-fit-score control (live slider on dashboard, applies to digest too)
- ✅ Customisable digest schedule with time window + 5 cadences (daily / weekdays / every N days / weekly / monthly)
- ✅ World Bank award filter scans description text (not just `notice_type`)
- ✅ "Temporarily not available" UI badge on disabled sources
- ✅ Production deployment on Hostinger KVM 2 with Caddy + Let's Encrypt TLS
- ✅ Verified email subdomain `mail.detex.site` with SPF + DKIM + DMARC
- ⏳ Real auth (Google OAuth + email verification) — planned
- ⏳ Multi-tenant sales / billing — planned

## License

Proprietary — all rights reserved. Not licensed for external use or distribution.
