# @beta/llm — agent notes

Pure TS library. No DB writes. The Scheduler composes these with Prisma.

## Public functions (exported from `src/index.ts`)

- `voyageEmbed(texts)` — raw fetch to Voyage `/v1/embeddings`, returns `number[][]` of `EMBEDDING_DIM`. No caching.
- `getAnthropicClient()` — singleton `Anthropic` client; reads `ANTHROPIC_API_KEY`.
- `embedCapabilityProfile(profile)` / `embedTender(tender)` — flatten input to a structured natural-language string and embed. Tender description truncated to ~6000 chars.
- `cosineSimilarity(a, b)` — standard cosine; throws on length mismatch.
- `estimateWinProbability(profile, tender, similarHistoricalWins?)` — deterministic heuristic combining geography overlap, budget-band fit, team-size capacity (team<5 + tender>$1M penalty), sector overlap, and prior wins. Returns `{ winProbability, reason }`.
- `scoreMatch(profile, tender, similarity, opts?)` — runs `estimateWinProbability`, then calls `claude-opus-4-7` with **forced tool-use** (`submit_match_assessment`). Validates output with zod, retries once on failure, throws after two. Returns `Omit<MatchResult, 'tenderId'|'tenantId'>`. `modelVersion` = `claude-opus-4-7+<sha256[0..8] of system prompt + tool def>`.
- `generateCapabilityStatement(profile, tender, matchResult)` — plain-text Markdown output, ~300-500 words, fixed section order. No tool-use.
- `renderProfileForLLM` / `renderTenderForLLM` — shared rendering used by both LLM functions.

## Prompt strategy

Match scoring uses a terse system prompt that explicitly forbids invented capabilities and requires gaps to be listed even when cosine similarity is high; the cosine value and the deterministic heuristic estimate are passed as context but the model is told it may override either. Structured output is enforced via `tool_choice: { type: "tool", name: "submit_match_assessment" }` with an `input_schema` mirrored by a zod parse on return. Capability-statement generation uses a separate plain-text prompt with a fixed five-section structure and a hard ban on inventing certifications, clients, or experience not in the profile.

## TODOs

- `TODO(lead):` confirm `claude-opus-4-7` accepts forced tool-use as written; if 4.7 changes structured-output ergonomics later, this is the one place to update.
- `TODO(lead):` Scheduler should pass `similarHistoricalWins` from prior `MatchFeedback` joined with `Tender` so win-prob heuristic improves over time.
