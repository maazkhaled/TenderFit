# How to use TenderFit

A plain-English guide to what this app does, what each command does, and when to run it.

---

## What is this app?

TenderFit is an opportunity-scout for IT/consulting companies. You tell it what your company does (a "capability profile"), and it finds public-sector tenders / RFPs from around the world that match what you can bid on. For each match it tells you:

- A **fit score** (0–100)
- Three **why-it-fits** bullets
- The **gaps** in your capabilities versus what the tender requires (blocker / major / minor)
- A **win-probability** estimate (low / medium / high) with reasoning
- A **draft capability statement** you can use when responding

The matching is done by a local LLM running on your laptop. No paid APIs needed.

---

## How the data flows

```
                   ┌────────────────────────────────────────────────┐
                   │                                                │
   World Bank API ─┤                                                │
   UK FaT API     ─┤                                                │
   UK CF API      ─┤  INGEST  ───►  Postgres "Tender" table         │
   PPRA scrape    ─┤                (1500+ tenders)                 │
   UNGM scrape    ─┤                                                │
                   └────────────────────────────────────────────────┘
                                          │
                                          ▼
   Your capability    ┌──────────────────────────────────────┐
   profile (in   ───► │  MATCH  →  Embed → Cosine similarity │
   Postgres)          │           → LLM scores top 50         │
                      │           → Writes "MatchResult" rows │
                      └──────────────────────────────────────┘
                                          │
                                          ▼
                      ┌──────────────────────────────────────┐
                      │  DIGEST → Pick high-fit matches      │
                      │           → Render HTML email        │
                      │           → Send to tenant on their  │
                      │             schedule (daily/weekly)  │
                      └──────────────────────────────────────┘
```

There are three pipeline stages — **ingest → match → digest** — and they run in that order. Each stage is a separate worker command so you can run them independently while developing or testing.

---

## What does each command actually do?

### `pnpm dev:web`

Starts the Next.js web app on http://localhost:3000.

The web app is the user-facing part: sign up a tenant, fill the capability profile, browse matches, click "generate capability statement" on a match, configure the digest schedule.

**Run this whenever you want to use the app in a browser.** Leave it running.

---

### `pnpm worker:ingest`

**What it does:** Goes out to all 5 enabled tender sources and pulls fresh tender postings. Inserts new ones into the `Tender` table; updates existing ones if their content changed.

**Concretely:** hits 5 HTTP endpoints (World Bank, UK Find a Tender, UK Contracts Finder, PPRA Pakistan, UNGM), normalizes each result into a common shape, dedups by source+externalId, writes 1000–2000 rows in ~30 seconds.

**Run this when:**
- You're starting fresh and want some tenders in the DB
- It's been a while since the last fresh run and you want the latest postings
- You added a new source adapter and want to test it

**You usually don't run this manually** in steady state — the cron mode (`pnpm --filter worker dev`) does it every 6 hours automatically.

---

### `pnpm worker:match`

**What it does:** Two phases.
1. **Embed:** For each Tender or CapabilityProfile that doesn't have an embedding yet (or whose content has changed), run it through the local embedding model (`mxbai-embed-large`) to produce a 1024-dim vector. Store the vector in Postgres + a content hash so it isn't re-computed next time.
2. **Score:** For each tenant, find the top 50 nearest tenders by cosine similarity, pass each through the LLM (`qwen2.5:7b-instruct`) which returns the structured fit-score / rationale / gaps / win-prob, and write a `MatchResult` row.

**Concretely:** processes up to 100 tenders per run (the cap is intentional so any single run is bounded). Re-running with no changes is essentially a no-op (cache hits everywhere).

**Run this when:**
- You just ran `worker:ingest` and want matches scored immediately
- You updated your capability profile and want re-scoring to happen now
- You changed the LLM model and want all rows re-scored
- You're debugging why a tender isn't matching well

**Cron mode runs this hourly automatically.**

---

### `pnpm worker:digest`

**What it does:** For each tenant whose digest schedule says "send now" (based on frequency, hour-of-day, day-of-week, timezone), it picks the highest-fit matches since the last send, renders an HTML email with the rationale and top opportunities, and sends it. In dev with no `RESEND_API_KEY` set, it prints the rendered email to the console instead of sending.

**Concretely:** the "scheduled digests" feature — instead of spamming users with a notification every time a new tender appears, TenderFit batches matches into a daily or weekly summary the user actually reads.

**Run this when:**
- You want to test what the digest email looks like
- A user says they didn't get their digest and you're checking why
- You're debugging the email template

**Cron mode runs this every 15 minutes** (each tick filters to only tenants whose `isDueNow` is true).

---

### `pnpm --filter worker dev`

**What it does:** runs all three above (ingest / match / digest) on a continuous schedule:

- Ingest: every 6 hours
- Match: every hour
- Digest: every 15 minutes

This is the single command that keeps the system fed in steady state. It's the production-equivalent of the worker process.

**Run this when:**
- You want the app to behave like a real product (data refreshes itself, matches keep flowing, digests go out on schedule)
- You're done manually testing individual stages and want the realistic experience

**Don't run this AND the one-shot worker commands at the same time** — they'll fight over the same rows.

---

### `pnpm llm:doctor`

**What it does:** Verifies the local LLM stack is healthy. Pings Ollama, checks that the configured chat + embedding models are pulled, runs a live 1024-dim embed on a probe string, runs a structured-output round-trip ("classify the sentiment of this string"), and prints OK or a copy-paste-ready remediation command for each failure.

**Run this when:**
- Anything LLM-related is broken
- You changed `LLM_PROVIDER` or `EMBEDDING_PROVIDER` env vars
- After a fresh laptop setup, before you trust the rest

This never writes to the DB — safe to run anytime.

---

### `pnpm db:generate` / `pnpm db:push` / `pnpm db:vector-sql`

DB schema commands. **You only run these once during setup**, or when the schema changes:

- `pnpm db:generate` — regenerates the typed Prisma client. Run after editing `prisma/schema.prisma`.
- `pnpm db:push` — applies schema changes to the actual Postgres database.
- `pnpm db:vector-sql` — regenerates the pgvector migration with the right `EMBEDDING_DIM`. Run after changing `EMBEDDING_DIM` env var.

You then `psql ... -f packages/db/src/migrations/001_pgvector.sql` to apply the vector migration.

**In daily use you never touch these.**

---

## When do I run what?

### Scenario A — "I just want to use the app"

```bash
# Shell 1 (always on)
ollama serve

# Shell 2
pnpm dev:web

# Shell 3
pnpm --filter worker dev
```

Then open http://localhost:3000. That's it. Everything refreshes automatically.

If the DB is empty (fresh laptop), do this once first to skip the 6-hour wait for the first ingest:

```bash
pnpm worker:ingest
for i in {1..18}; do pnpm worker:match; done
```

### Scenario B — "I'm developing / debugging a single piece"

Don't run the cron worker. Run the one-shot you care about:

| What you're working on | What to run |
|---|---|
| Adding/fixing an ingest adapter | `pnpm worker:ingest`, inspect DB |
| Tuning the matcher prompt | `pnpm worker:match`, inspect `MatchResult` rows |
| Tweaking the digest email | `pnpm worker:digest` |
| Frontend changes only | `pnpm dev:web` (the worker isn't needed unless you need data on the page) |

### Scenario C — "I onboarded a new tenant, why are there no matches?"

The order matters:

1. Tenant signs up, profile is saved → `embeddingStatus = pending` on their `CapabilityProfile`
2. Run `pnpm worker:match` → embeds the new profile, then scores against existing tenders
3. Refresh the page

If you signed up but `worker:match` hasn't run since, the profile has no embedding yet so no matches can be computed.

### Scenario D — "I want to verify the LLM is set up right"

```bash
pnpm llm:doctor
```

Run this anytime. It's safe and read-only.

### Scenario E — "I changed the LLM model and want everything re-scored"

```bash
pnpm worker:match
# The provider:model stamp on every cached row changed, so the worker will
# re-embed and re-score everything automatically.
```

### Scenario F — "I want to send a real digest right now to test it"

1. Make sure your tenant has a `DigestSchedule` configured (via the `/schedule` page in the UI)
2. Make sure the schedule's "next due" time is in the past
3. `pnpm worker:digest`

In dev (no `RESEND_API_KEY`) it prints the email to the console.

---

## Daily quick reference

| I want to... | Command |
|---|---|
| Use the app in a browser | `pnpm dev:web` |
| Keep data fresh automatically | `pnpm --filter worker dev` |
| Fetch new tenders right now | `pnpm worker:ingest` |
| Re-score matches right now | `pnpm worker:match` |
| Test the digest email | `pnpm worker:digest` |
| Check the LLM is working | `pnpm llm:doctor` |
| Reset and re-pull everything | `pnpm worker:ingest && for i in {1..20}; do pnpm worker:match; done` |

---

## Troubleshooting

### "Dashboard shows 'No matches yet' but the worker says it created some"

The dashboard hides matches below `DASHBOARD_MIN_FIT_SCORE` (default `30` in `.env`). Local LLMs like qwen2.5:7b score conservatively — most of their fits land in the 30–55 range, not 60+. If your dashboard is empty:

1. Check the actual scores in the DB:
   ```bash
   psql "$DATABASE_URL" -c 'SELECT MIN("fitScore"), MAX("fitScore"), COUNT(*) FROM "MatchResult";'
   ```
2. Lower the threshold further in `.env` if needed: `DASHBOARD_MIN_FIT_SCORE="0"` shows everything.
3. Restart the Next.js dev server (Ctrl-C then `pnpm dev:web`) — env vars are read at startup.

When you switch to a cloud model (Claude / GPT) raise this back to `60` so only meaningful fits surface.

### "Worker says embedded=100 every run, never finishes"

The match worker takes 100 rows per phase by design (bounded run time). After ingest brings in ~1500 tenders, it takes ~15 passes to drain. Either run a one-shot loop:
```bash
for i in {1..18}; do pnpm worker:match; done
```
or just run the cron worker (`pnpm --filter worker dev`) and let it drain in the background.

### "Tenant signed up but no matches appear after running worker:match"

The capability profile needs to be embedded first. Run `pnpm worker:match` once after onboarding — phase 2 embeds new profiles, phase 3 scores them. If the profile is still `embeddingStatus = pending`, no matches can be computed.

---

## Mental model in one paragraph

`worker:ingest` brings tenders in from the outside world. `worker:match` figures out which of those tenders are good for each tenant (this is where the LLM does its job). `worker:digest` emails the best matches to each tenant on their chosen cadence. `dev:web` is the user-facing UI for browsing matches and managing your profile. `--filter worker dev` runs ingest + match + digest forever on a schedule, which is what you want for the realistic experience. The one-shot commands exist for development and debugging — pick the stage you care about and skip the cron.
