# TenderFit AI Architecture Deep Dive

This document is written for interview preparation: what the project does, how the AI pipeline is built, what is genuinely strong about it, and how to explain it without overstating model-training work.

## One-Sentence Description

TenderFit is a multi-tenant tender/RFP matching system for IT and consulting companies. It ingests public procurement opportunities, embeds and retrieves relevant tenders against a company capability profile, uses an LLM to produce structured fit analysis, and closes the loop with human feedback and threshold-based evaluation.

## Important Positioning For AI R&D Roles

This project is best described as an end-to-end production AI system built around retrieval, ranking, structured LLM inference, evaluation, and product integration.

It is not, by itself, evidence that you trained or fine-tuned a neural model from scratch. Do not present it as a PyTorch/TensorFlow fine-tuning project unless you add a separate training artifact. The strongest honest framing is:

- "I built a production-style AI pipeline, not just a chatbot."
- "The system combines data ingestion, preprocessing, vector embeddings, hybrid retrieval, reranking, schema-constrained LLM scoring, caching, evaluation, and deployment."
- "The current implementation uses off-the-shelf embedding, rerank, and LLM models, but the architecture is set up to collect labeled feedback that could later train a supervised classifier or fine-tune a reranker."

For the job description you shared, this project maps strongly to RAG, embeddings, vector DBs, NLP systems, AI pipeline engineering, model evaluation, and production integration. It maps weakly to hands-on model training/fine-tuning unless you have another project or add that work.

## System Architecture

The repo is a TypeScript monorepo:

- `apps/web`: Next.js UI and API routes.
- `worker`: cron-style background worker for ingest, match, digest, and eval.
- `packages/ingest`: tender source adapters and normalization.
- `packages/llm`: AI pipeline: embeddings, retrieval, reranking, scoring, profile parsing, capability statements.
- `packages/db`: Prisma client plus raw SQL helpers for pgvector and full-text search.
- `packages/shared`: shared Zod schemas, types, constants.
- `packages/notifications`: digest builder, renderer, sender.

Deployment is production-shaped Docker Compose:

- Postgres with pgvector stores tenants, profiles, tenders, embeddings, match results, feedback, and schedules.
- Web service runs the dashboard and API.
- Worker service runs ingest every 6 hours, matching hourly, and digests every 15 minutes.
- Caddy reverse-proxies the web service for HTTPS.

## End-To-End AI Data Flow

The core flow is:

1. Ingest public tenders from official sources.
2. Normalize each source into one shared `NormalizedTender` shape.
3. Store or update tenders in Postgres.
4. Embed pending tenders and capability profiles.
5. Retrieve candidate tenders with hybrid dense + lexical search.
6. Optionally rerank candidates with a cross-encoder reranker.
7. Score the top candidates with a schema-constrained LLM.
8. Persist fit score, rationale, gaps, win probability, HR estimate, and model version.
9. Surface results in the dashboard and scheduled digests.
10. Capture human feedback and run shadow-mode evaluation.

## AI Pipeline Stages

### 1. Profile Creation And Extraction

Users can manually enter a capability profile or paste/upload text. `parseProfileFromText` turns free text into a structured `CapabilityProfileInput` using schema-constrained LLM output.

Key files:

- `packages/llm/src/parse-profile.ts`
- `apps/web/app/api/v1/profile/parse-document/route.ts`
- `apps/web/lib/services/profile.ts`

Important details:

- The parser uses a JSON schema and then validates with Zod.
- The prompt explicitly forbids inventing certifications, clients, team size, budgets, or geographies.
- The API returns a draft only; it does not auto-save. The user reviews and saves.
- Saving a profile sets `embeddingStatus = pending`, so the next worker match run re-embeds it.

### 2. Tender Ingestion And Normalization

Each tender source implements a common `IngestAdapter` interface:

- `source`
- `label`
- `requiredEnv`
- `fetchPage`
- optional `disabledReason`

The runner handles paging, environment checks, errors, and database upserts. Tenders are deduped by `(source, externalId)`.

Key files:

- `packages/ingest/src/types.ts`
- `packages/ingest/src/run.ts`
- `worker/src/ingest-runner.ts`
- `packages/ingest/src/index.ts`

AI relevance:

- This is the data pipeline layer. It handles real-world source messiness before anything reaches the model.
- Normalization gives the downstream model stable fields: title, description, buyer, country, sector, CPV codes, budget, dates, language, and raw payload.
- HTML-only sources are scraped politely with per-host rate limiting and backoff.

### 3. Embedding Strategy

Tenders and profiles are flattened into model-readable text and embedded into 1024-dimensional vectors by the active embedding provider.

Default local setup:

- `EMBEDDING_PROVIDER=ollama`
- `EMBEDDING_MODEL=mxbai-embed-large`
- `EMBEDDING_DIM=1024`

Cloud alternatives include OpenAI, Voyage, Gemini, and NVIDIA NIM, selected with environment variables.

Key files:

- `packages/llm/src/embed.ts`
- `packages/llm/src/util/chunk.ts`
- `packages/db/src/embedding.ts`
- `packages/db/src/migrations/001_pgvector.sql`

Important implementation details:

- Short tenders are embedded directly.
- Long tender descriptions are split with a recursive separator-aware chunker.
- Each chunk gets the tender header prepended so title, buyer, sector, country, and CPV context are retained.
- Chunk vectors are length-weighted mean-pooled into one vector so the schema stays `vector(1024)`.
- Embeddings are cached in memory and also invalidated persistently with `embeddingHash` and `embeddingModel`.
- Provider/model switches automatically invalidate old embeddings because the model stamp is part of the hash.

### 4. Hybrid Retrieval

The matcher does not send every tender to the LLM. It first builds a candidate shortlist.

Dense retrieval:

- Postgres pgvector cosine distance between the profile embedding and tender embeddings.
- HNSW indexes are created on tender and profile embedding columns.

Lexical retrieval:

- Postgres full-text search over a weighted generated `fts_doc`.
- Title has weight A, buyer B, sector/CPV C, description D.
- Query terms come from the profile fields most likely to match tender language: services, tech stack, certifications, and industries.

Fusion:

- Dense and lexical rankings are combined with Reciprocal Rank Fusion.
- Default RRF `k=60`.
- The system preserves candidate provenance: dense, text, or both.

Key files:

- `packages/llm/src/retrieve.ts`
- `packages/db/src/retrieval.ts`
- `packages/db/src/migrations/005_tender_fts.sql`

Why this matters:

- Dense embeddings catch semantic matches.
- Full-text search catches exact tokens like CPV codes, certification names, buyer terms, and technical keywords.
- RRF avoids fragile score normalization between vector distances and text ranks.

### 5. Cross-Encoder Rerank

After hybrid retrieval, candidates can be reranked with Voyage rerank.

Key files:

- `packages/llm/src/providers/voyage-rerank.ts`
- `packages/llm/src/providers/config.ts`
- `worker/src/match-runner.ts`

Behavior:

- `RERANK_PROVIDER=voyage` enables reranking if `VOYAGE_API_KEY` is present.
- Otherwise the system uses `NoopRerankProvider`.
- The reranker receives the rendered profile as query and compact tender documents as candidates.
- The worker reranks up to 40 candidates by default and then scores a smaller top set.

### 6. Structured LLM Scoring

The LLM produces a structured match assessment:

- `fitScore`: integer 0-100
- exactly 3 rationale bullets
- gap list with severity: blocker, major, minor
- win probability: low, medium, high
- win-probability reason
- human resources estimate with roles, counts, confidence, basis, and notes

Key files:

- `packages/llm/src/score.ts`
- `packages/llm/src/winprob.ts`
- `packages/llm/src/util/render.ts`
- `worker/src/match-runner.ts`

Important details:

- The scorer uses provider-level structured output, then Zod validation.
- Temperature is 0 for deterministic scoring.
- The system prompt is strict: no invented capabilities, list gaps even when similarity is high, and blockers should suppress high scores.
- A deterministic win-probability heuristic is computed first and passed to the LLM as context. The LLM can agree or override, but must justify the final call.
- For local providers such as Ollama or LM Studio, the final score can be blended with the cosine baseline. This reduces score volatility from small local models.
- `modelVersion` stores provider, model, and prompt/schema hash for traceability.

### 7. Capability Statement Generation

On a match detail page, the user can generate a bid-oriented capability statement.

Key files:

- `packages/llm/src/capability-statement.ts`
- `apps/web/app/api/v1/matches/[id]/capability-statement/route.ts`
- `apps/web/app/(app)/matches/[id]/MatchActions.tsx`

Behavior:

- The statement is generated on demand.
- It uses the already-produced match analysis as grounding.
- The prompt forbids inventing clients, certifications, contacts, or capabilities.
- The output is cached back onto `MatchResult.capabilityStatement`.

### 8. Feedback And Shadow-Mode Evaluation

Users can mark a match as interesting or not. This writes `MatchFeedback`.

The eval harness reads `MatchResult + MatchFeedback` and computes classification-style metrics at score thresholds.

Metrics:

- TP, FP, FN, TN
- agreement
- precision
- recall
- F1
- per-source breakdown

Key files:

- `apps/web/app/api/v1/matches/[id]/feedback/route.ts`
- `worker/src/eval/metrics.ts`
- `worker/src/eval/report.ts`
- `worker/src/eval-runner.ts`

Why this matters:

- This turns subjective match quality into a measurable feedback loop.
- False positives show what the model overvalued.
- False negatives show opportunities the model would have hidden.
- The threshold can be tuned based on precision/recall tradeoff, not gut feel.

## Runtime Controls And Scaling Knobs

Important environment variables:

- `LLM_PROVIDER`: ollama, lmstudio, openai, anthropic, gemini, nvidia
- `LLM_REASONING_MODEL`: model used for scoring and generation
- `LLM_FAST_MODEL`: fast model tier, currently used by doctor checks
- `EMBEDDING_PROVIDER`: ollama, lmstudio, openai, voyage, gemini, nvidia
- `EMBEDDING_MODEL`: active embedding model
- `EMBEDDING_DIM`: vector dimension; must match pgvector schema
- `RERANK_PROVIDER`: voyage or none
- `MATCH_MAX_NEW_MATCHES_PER_TENANT`: scoring cap per tenant per run
- `MATCH_PER_RETRIEVER_LIMIT`: dense/text candidate limit before fusion
- `MATCH_RERANK_INPUT_LIMIT`: candidate count entering rerank
- `MATCH_SCORE_TIMEOUT_MS`: timeout around each scoring call
- `LLM_SCORE_BLEND_WEIGHT`: score blending weight for local models
- `DASHBOARD_MIN_FIT_SCORE`: product threshold for visible matches

Operationally, the worker keeps costs bounded:

- Embeds up to 100 pending tenders per run.
- Embeds up to 100 pending profiles per run.
- Retrieves 60 dense plus 60 lexical candidates by default.
- Reranks up to 40 candidates.
- Scores up to 20 new matches per tenant per run.

## What To Demo

Demo path:

1. Open the app dashboard.
2. Show a company profile and explain that it is converted into both structured DB fields and an embedding.
3. Show the source filters or explain the ingest adapters.
4. Run or describe `worker:ingest`: external data becomes normalized tenders.
5. Run or describe `worker:match`: pending rows are embedded, retrieved, reranked, scored, and persisted.
6. Open a match detail page.
7. Walk through fit score, rationale, gaps, win probability, HR estimate, and tender metadata.
8. Click generate capability statement.
9. Mark the match as interesting or not.
10. Show the eval harness concept: feedback becomes TP/FP/FN/TN metrics by threshold.

Commands to know:

```bash
pnpm worker:ingest
pnpm worker:match
pnpm worker:digest
pnpm --filter worker run eval -- --tenant=<slug>
pnpm llm:doctor
```

If `pnpm` has environment issues, the direct Node test commands still work for focused verification:

```bash
node --test --experimental-strip-types packages/llm/src/__tests__/chunk.test.ts
node --test --experimental-strip-types packages/llm/src/__tests__/retrieve.test.ts
node --test --experimental-strip-types packages/llm/src/__tests__/voyage-rerank.test.ts
node --test --experimental-strip-types worker/src/eval/__tests__/metrics.test.ts
node --test --experimental-strip-types packages/ingest/src/__tests__/normalize.test.ts
```

## Interview Talking Points

### Strong Technical Points

- Built a multi-stage NLP/RAG pipeline rather than a single prompt call.
- Separated data ingestion, embedding, retrieval, reranking, LLM scoring, and delivery.
- Used pgvector with HNSW indexing for vector retrieval.
- Added Postgres full-text search because dense retrieval misses exact procurement tokens.
- Used Reciprocal Rank Fusion to combine dense and lexical retrieval without score-scale tuning.
- Added optional cross-encoder reranking for better precision.
- Forced structured LLM output with JSON schema and Zod validation.
- Added prompt/schema hashing to `modelVersion` for auditability.
- Added hash-based embedding invalidation so model or content changes recompute vectors.
- Built a closed-loop eval harness using user feedback and classification metrics.
- Designed the provider layer so Ollama, OpenAI, Anthropic, Gemini, NVIDIA, Voyage, and LM Studio can be swapped through environment config.

### How To Describe The AI Architecture

"The core AI architecture is a retrieval-ranking-scoring pipeline. I normalize public tender data into a common schema, embed both tenders and company profiles, retrieve candidates using hybrid dense vector search and Postgres full-text search, fuse the rankings with RRF, optionally rerank candidates with a cross-encoder, and then use a schema-constrained LLM scorer to generate a calibrated fit score, rationale, gaps, win probability, and staffing estimate. The outputs are stored with model and prompt version metadata, surfaced in the product, and evaluated against human feedback with precision/recall/F1 threshold reports."

### How To Be Honest About Fine-Tuning

Use this phrasing:

"This project does not currently fine-tune a model. It is a production AI pipeline using off-the-shelf embedding, rerank, and LLM models. The feedback schema and eval harness are intentionally designed so the next step could be supervised training: collect labeled match pairs, train or fine-tune a binary classifier/reranker, calibrate thresholds, and compare it against the current LLM scoring pipeline."

Do not say:

- "I trained the LLM."
- "I fine-tuned Qwen/Claude/GPT for this."
- "The model learns automatically from feedback."

The feedback is currently used for evaluation and historical-win context, not gradient-based training.

## Screening Question Preparation

### 1. End-To-End AI/ML Project

A good answer:

"I built TenderFit, an end-to-end AI system for matching public-sector tenders to IT company capability profiles. The system ingests tenders from official sources, normalizes them, embeds tenders and profiles, performs hybrid retrieval with pgvector and Postgres full-text search, optionally reranks candidates with a cross-encoder, and uses a schema-constrained LLM to produce fit score, rationale, gaps, win probability, and HR estimate. It is deployed as a Docker Compose stack with Postgres, a Next.js web app, and a scheduled worker. For evaluation, users label matches as interesting/not interesting, and a shadow-mode eval harness computes precision, recall, F1, and confusion matrices at different score thresholds."

Be ready for the follow-up:

"Did you train the model?"

Answer:

"Not in this project. The models are off-the-shelf, but the system is built like a production ML pipeline with retrieval, reranking, structured inference, caching, observability through model versions, and feedback-based evaluation. I would use the collected feedback to train a supervised classifier or fine-tune a reranker as the next iteration."

### 2. Fine-Tuning And Optimization

If this project is your only AI project, answer honestly:

"TenderFit does not currently include fine-tuning. The closest model-optimization work is retrieval optimization: chunking long documents, length-weighted mean pooling, hybrid dense plus lexical retrieval, RRF fusion, optional cross-encoder reranking, score blending for small local models, embedding caching, and threshold calibration from feedback."

Then explain how you would add fine-tuning:

1. Export labeled `(profile, tender, label)` pairs from `MatchResult` and `MatchFeedback`.
2. Split by time or tender source to avoid leakage.
3. Handle class imbalance with stratified sampling, class weights, focal loss, or balanced batches.
4. Train a cross-encoder classifier or fine-tune a sentence-transformer/reranker.
5. Evaluate with precision, recall, F1, PR-AUC, calibration curves, and source-level breakdowns.
6. Deploy it as the rerank or scoring stage behind the existing provider interface.
7. Run shadow-mode comparison before replacing the LLM scorer.

### 3. Imbalanced Text Classification

A strong generic answer:

"I would first inspect label distribution, duplicates, leakage, text length, source/domain skew, and whether minority labels differ by source. I would create stratified train/validation/test splits, preferably time-based if the data is temporal. For baselines, I would start with TF-IDF plus logistic regression or linear SVM, then compare transformer embeddings plus a classifier, and finally a fine-tuned transformer if there is enough labeled data. For imbalance, I would use class weights, focal loss, balanced batch sampling, and possibly threshold tuning rather than relying on default 0.5. I would evaluate with precision, recall, F1, PR-AUC, confusion matrix, and per-class/per-source breakdowns. In production I would monitor drift, false negatives, false positives, and recalibrate thresholds as the label distribution changes."

Tie it back to TenderFit:

"TenderFit already has the feedback table and eval harness needed for this. The next step would be turning match feedback into a training dataset."

## Current Limitations To Acknowledge

- No gradient-based training or fine-tuning is implemented yet.
- Feedback improves evaluation and context, not model weights.
- The current eval harness depends on enough human-labeled matches; small samples have wide uncertainty.
- One-vector-per-tender mean pooling is pragmatic but loses per-chunk retrieval precision. A future `TenderChunk` table with per-chunk vectors would improve dense retrieval.
- Local 7B models can be conservative or noisy; the system mitigates this with score blending and lower dashboard thresholds.
- Auth is not production-grade yet; docs note stub auth.
- Some tender sources are disabled because their upstream sites lack stable public feeds or block non-interactive clients.

## Best Short Pitch

"TenderFit is an applied AI system for procurement intelligence. The interesting part is not a chatbot; it is the full pipeline: official-source ingestion, schema normalization, embedding, pgvector retrieval, Postgres full-text retrieval, RRF fusion, optional cross-encoder reranking, structured LLM scoring with hard validation, human-feedback evaluation, and scheduled delivery. It is designed so the current off-the-shelf model stack can later be replaced or augmented with a fine-tuned classifier/reranker using the feedback data the product already collects."

