# Project Beta — MVP Scope (Shared Contract)

> **All agents read this file first. Do not deviate from the contracts below without flagging it back to the lead.**

## What we're building

A **multi-tenant SaaS** that ingests tender / RFP / project opportunities (domestic + international) from **official, license-friendly sources only**, matches them against a tenant company's capability profile using LLM-powered semantic matching + fit scoring, and delivers **scheduled digests** (not always-on alerts).

Target buyer: any IT services / software / consulting company that bids on opportunities. Multi-tenant from day one.

## The "innovative bit" (must be present in MVP)

The matcher is the product. Not keyword search. For every tender + company pair we produce:

1. **Fit score (0–100)** — vector similarity + LLM rerank
2. **Why it fits / doesn't fit** — 3 bullet rationale grounded in tender text + capability profile
3. **Capability gaps** — explicit list of tender requirements the company does NOT yet meet (certifications, tech, geography, scale)
4. **Win-probability heuristic** — based on past similar wins, sector, budget band, geography. Returns Low / Medium / High with reasoning.
5. **One-click Capability Statement draft** — generates a tailored capability statement / executive summary the company can use as bid input.

This is the moat. Aggregation alone is commodity.

## Non-goals (MVP)

- No scraping of any non-API source. Ever. If it doesn't have an API / RSS / paid licensed feed, it's out.
- No always-on push. Scheduled digests only (daily, weekly, configurable per tenant).
- No bid submission, no e-signature, no payment flows.
- No mobile native — responsive web is enough.

## Stack (locked)

- **Monorepo:** pnpm workspaces
- **Web app:** Next.js 14 (App Router) + TypeScript + TailwindCSS + shadcn/ui style components
- **Worker:** Standalone Node/TS process (`worker/`) using `node-cron` for scheduling
- **DB:** PostgreSQL with `pgvector` extension. ORM: Prisma.
- **LLM:** Anthropic Claude API (`@anthropic-ai/sdk`). Embeddings via Voyage AI (`voyage-3-large`) — Anthropic's recommended embedding partner.
- **Auth:** Stub for MVP — simple session cookie, single user per tenant. Real auth deferred.
- **Email:** Resend (or stub printer in dev).

Model defaults:
- Reasoning / fit scoring / capability statement → `claude-opus-4-7`
- Cheap extraction / normalization → `claude-haiku-4-5-20251001`
- Embeddings → `voyage-3-large` (1024 dim)

## Data sources (MVP set — all official, license-friendly)

| Source | Coverage | Access |
|---|---|---|
| SAM.gov (US Federal) | US gov contracts | Official JSON API + free API key |
| TED (EU) | EU public procurement | Official API (TED API v3) |
| UNGM | UN agencies | Official RSS / API |
| World Bank Procurement | Multilateral | Official API (`search.worldbank.org`) |
| Pakistan PPRA | Domestic (default) | Public RSS |

Each source is implemented as an **adapter** matching the `IngestAdapter` interface (defined in `packages/ingest`).

## Repository layout

```
project-beta/
├── SCOPE.md                    ← this file
├── package.json                ← pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example
├── prisma/
│   └── schema.prisma           ← shared DB contract (DO NOT FORK)
├── apps/
│   └── web/                    ← Next.js (Frontend agent + Backend agent both touch this)
│       ├── app/
│       │   ├── (marketing)/    ← landing
│       │   ├── (app)/          ← authed dashboard
│       │   └── api/            ← Next.js route handlers (Backend agent)
│       ├── components/
│       └── lib/
├── worker/                     ← Scheduler agent owns
│   ├── src/
│   │   ├── ingest-runner.ts
│   │   ├── match-runner.ts
│   │   └── digest-runner.ts
│   └── package.json
└── packages/
    ├── db/                     ← Prisma client re-export (Backend agent)
    ├── ingest/                 ← Source adapters (Ingestion agent)
    │   └── src/adapters/
    ├── llm/                    ← Claude wrappers + matching logic (LLM agent — the "innovative bit")
    └── shared/                 ← Zod schemas, shared types (Lead defines, all read)
```

## Shared types (canonical — defined in `packages/shared`)

```ts
// Tender — normalized opportunity record (what every adapter outputs)
export interface NormalizedTender {
  externalId: string;          // unique within source
  source: TenderSource;        // 'sam_gov' | 'ted_eu' | 'ungm' | 'world_bank' | 'ppra_pk'
  title: string;
  description: string;         // full text, may be long
  url: string;                 // canonical link to original
  buyer: string;               // issuing org
  country: string | null;      // ISO-3166 alpha-2
  sector: string | null;       // free text from source
  cpvCodes: string[];          // EU CPV or equivalent if available
  budgetMin: number | null;    // USD
  budgetMax: number | null;    // USD
  currency: string | null;     // original currency code
  publishedAt: Date;
  deadlineAt: Date | null;
  language: string;            // ISO 639-1
  raw: unknown;                // original payload for debugging
}

// CapabilityProfile — what a tenant company is good at
export interface CapabilityProfile {
  companyName: string;
  oneLiner: string;
  industries: string[];        // free text
  techStack: string[];
  services: string[];          // e.g. "custom software dev", "cloud migration"
  certifications: string[];    // ISO 27001, SOC2, CMMI L3, etc.
  pastClients: string[];       // optional
  pastProjects: { title: string; summary: string; sector?: string; valueUsd?: number }[];
  geographies: string[];       // ISO-3166 alpha-2 list, [] = global
  teamSize: number;
  budgetRangeUsd: { min: number; max: number };
  languages: string[];
}

// MatchResult — what the LLM matcher produces
export interface MatchResult {
  tenderId: string;
  tenantId: string;
  fitScore: number;            // 0-100
  rationale: string[];         // exactly 3 bullets
  gaps: { requirement: string; severity: 'blocker' | 'major' | 'minor' }[];
  winProbability: 'low' | 'medium' | 'high';
  winProbabilityReason: string;
  modelVersion: string;
}
```

## Agent ownership map (no overlap)

| Agent | Owns (writes to) | Reads |
|---|---|---|
| **Backend** | `prisma/schema.prisma`, `apps/web/app/api/**`, `apps/web/lib/db.ts`, `apps/web/lib/auth.ts`, `packages/db/**` | shared types |
| **Ingestion** | `packages/ingest/**` | shared types |
| **LLM / Matching** | `packages/llm/**` | shared types, Prisma client interface |
| **Frontend** | `apps/web/app/(marketing)/**`, `apps/web/app/(app)/**`, `apps/web/components/**`, `apps/web/lib/ui/**` | shared types, API contract |
| **Scheduler / Notifications** | `worker/**`, `packages/notifications/**` | all packages (composes them) |

Lead writes: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.env.example`, `packages/shared/**`, `README.md`.

## API contract (Backend ↔ Frontend)

All under `/api/v1`:

- `POST /api/v1/tenants/onboard` — create tenant + initial capability profile
- `GET  /api/v1/profile` — get current tenant's profile
- `PUT  /api/v1/profile` — update profile (triggers re-embedding)
- `GET  /api/v1/matches?from=&to=&minScore=` — list matches for current tenant
- `GET  /api/v1/matches/:id` — full match detail (rationale, gaps, win-prob, capability statement)
- `POST /api/v1/matches/:id/capability-statement` — generate / regenerate
- `POST /api/v1/matches/:id/feedback` — `{ interested: boolean, note?: string }` — used to improve future matches
- `GET  /api/v1/schedule` — get tenant's digest schedule
- `PUT  /api/v1/schedule` — update (cron-ish: frequency = daily|weekly, hourLocal, dayOfWeek?)

## Definition of done (MVP)

- A tenant can sign up, fill capability profile, and immediately see seeded matches.
- The worker, when run, ingests at least 2 sources and produces matches with fit scores + rationale + gaps + win-prob.
- A scheduled digest can be manually triggered (`pnpm worker:digest`) and prints a tenant-specific HTML email payload.
- One capability-statement generation works end-to-end.
- `pnpm typecheck` passes across the workspace.

## What this is NOT, today

This is a **prototype scaffold** that proves the architecture and the innovative matching loop. Not production. No load testing, no rate-limit handling beyond basic respect for source ToS, no payment, no real auth.
