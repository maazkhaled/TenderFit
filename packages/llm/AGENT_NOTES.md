# @beta/llm — agent notes

Pure TS library. No DB writes. The Scheduler composes these with Prisma.

## Provider abstraction (new)

The matcher and capability-statement generator never touch a vendor SDK
directly. They go through `getChatProvider()` / `getEmbeddingProvider()` from
`./providers`, which dispatch on `LLM_PROVIDER` and `EMBEDDING_PROVIDER` env
vars. Supported backends:

| Backend | Chat | Embed | Notes |
|---|---|---|---|
| `ollama`     | ✓ | ✓ | Local. Schema-constrained decoding via `format: <json schema>`. |
| `lmstudio`   | ✓ | ✓ | Local. OpenAI-compatible. `response_format: json_schema`. |
| `openai`     | ✓ | ✓ | Cloud. Same OpenAI-compat client as LM Studio. |
| `anthropic`  | ✓ | — | Cloud. Forced tool-use for structured output. SDK lazy-loaded. |
| `voyage`     | — | ✓ | Cloud embeddings. |

Switching providers is a pure env change — no rebuild, no code change. The
modelVersion stamp on every MatchResult includes provider+model so historical
rows are traceable across migrations.

## Structured output across backends

| Backend | Mechanism |
|---|---|
| Ollama   | `format: <jsonSchema>` constrains decoding during sampling. |
| OpenAI / LM Studio | `response_format: { type: "json_schema", strict: true }`. |
| Anthropic | Single tool with `input_schema = jsonSchema`, `tool_choice: { type: "tool" }`. |

`ChatProvider.chatStructured` accepts a JSON schema once and the right
mechanism is picked per backend. A zod refinement runs after the model's
output and a single retry attempt is allowed (Anthropic implements the
retry; Ollama's constrained decoding makes retries unnecessary).

## Public functions (exported from `src/index.ts`)

- `getChatProvider() / getEmbeddingProvider()` — preferred entry points.
- `voyageEmbed(texts)` / `getAnthropicClient()` — deprecated shims, route
  through the abstraction. Kept for back-compat.
- `embedCapabilityProfile(profile)` / `embedTender(tender)` — flatten →
  cache lookup → `provider.embed(...)`. Tender description truncated to
  ~6000 chars.
- `cosineSimilarity(a, b)` — standard cosine; throws on length mismatch.
- `estimateWinProbability(profile, tender, similarHistoricalWins?)` —
  unchanged deterministic heuristic.
- `scoreMatch(profile, tender, similarity, opts?)` — runs heuristic, then
  `provider.chatStructured(...)`. Validates with zod. `modelVersion` =
  `<provider>:<model>+<sha256[0..8] of system prompt + schema>`.
- `generateCapabilityStatement(profile, tender, matchResult)` — plain-text
  Markdown, ~300-500 words, fixed five-section structure.
- `embeddingCache` — process-local LRU keyed by sha256(model:text). Cuts
  re-embed cost on repeated cron ticks; benefits cloud embedders too.
- `renderProfileForLLM` / `renderTenderForLLM` — shared rendering used by
  both LLM functions.

## Diagnostics

`pnpm llm:doctor` (alias for `tsx src/doctor.ts`) verifies:
1. The configured chat provider is reachable and required models are loaded.
2. The configured embedding provider is reachable and the model is loaded.
3. A live embed of a probe string returns a vector of `EMBEDDING_DIM`.
4. A structured-output round trip works (sentiment classify probe).

Each failure prints the exact remediation command (`ollama pull <model>`,
"set OPENAI_API_KEY", etc).

## Embedding dim

`EMBEDDING_DIM` (default 1024) is read at runtime from env in
`@beta/shared/constants` and re-exported by `@beta/db/embedding`. The
pgvector migration is templated — run `pnpm db:vector-sql` to regenerate
`packages/db/src/migrations/001_pgvector.sql` for the active dim, then
re-apply via psql. Mismatches between the model's native dim and
EMBEDDING_DIM are caught early by the doctor with a copy/paste fix.

## TODOs

- `TODO(lead):` Scheduler should pass `similarHistoricalWins` from prior
  `MatchFeedback` joined with `Tender` so win-prob heuristic improves
  over time.
- `TODO(lead):` Persist a content hash on Tender / CapabilityProfile so
  the embed cache can survive process restarts (currently in-memory only).
