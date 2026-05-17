/**
 * Provider diagnostics. Run via `pnpm llm:doctor`.
 *
 * Verifies:
 *   1. The selected chat provider is reachable and required models are loaded.
 *   2. The selected embedding provider works AND produces vectors of the
 *      expected EMBEDDING_DIM (catches the classic "I switched to
 *      nomic-embed-text but my pgvector column is still 1024" footgun).
 *   3. End-to-end: a tiny structured-output round-trip.
 */

// MUST be first — see packages/llm/src/util/load-env.ts. Without this the
// doctor reports the provider defaults instead of what .env actually says.
import "./util/load-env.js";

import { readChatConfig, readEmbeddingConfig } from "./providers/config";
import { getChatProvider, getEmbeddingProvider } from "./providers";
import type { JsonSchema } from "./providers/types";

const PROBE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["sentiment", "confidence"],
  additionalProperties: false,
};

interface ProbeOut {
  sentiment: "positive" | "neutral" | "negative";
  confidence: number;
}

async function main(): Promise<number> {
  const chatCfg = readChatConfig();
  const embedCfg = readEmbeddingConfig();

  console.log("=== Project Beta — LLM doctor ===");
  console.log(`Chat provider:      ${chatCfg.provider}`);
  console.log(`  reasoning model:  ${chatCfg.reasoningModel}`);
  console.log(`  fast model:       ${chatCfg.fastModel}`);
  console.log(`  base URL:         ${chatCfg.baseUrl}`);
  console.log(`Embedding provider: ${embedCfg.provider}`);
  console.log(`  model:            ${embedCfg.model}`);
  console.log(`  dim (expected):   ${embedCfg.dim}`);
  console.log(`  base URL:         ${embedCfg.baseUrl}`);
  console.log("");

  let failures = 0;

  // 1. chat ping
  const chat = getChatProvider();
  const chatPing = await chat.ping();
  console.log(`[chat:${chat.name}] ping: ${chatPing.ok ? "OK" : "FAIL"} — ${chatPing.detail}`);
  if (!chatPing.ok) failures++;

  // 2. embed ping
  const embed = getEmbeddingProvider();
  const embedPing = await embed.ping();
  console.log(`[embed:${embed.name}] ping: ${embedPing.ok ? "OK" : "FAIL"} — ${embedPing.detail}`);
  if (!embedPing.ok) failures++;

  // 3. embed live test — confirms dim
  if (embedPing.ok) {
    try {
      const [vec] = await embed.embed(["hello world"]);
      if (!vec) {
        console.log(`[embed:${embed.name}] live: FAIL — no vector returned`);
        failures++;
      } else if (vec.length !== embedCfg.dim) {
        console.log(
          `[embed:${embed.name}] live: FAIL — produced ${vec.length}-dim vector, expected ${embedCfg.dim}.\n` +
            `   Either set EMBEDDING_DIM=${vec.length} and re-run the pgvector migration with the matching dim,\n` +
            `   or pick an embedding model whose native dim is ${embedCfg.dim}.`,
        );
        failures++;
      } else {
        console.log(`[embed:${embed.name}] live: OK — produced ${vec.length}-dim vector`);
      }
    } catch (err) {
      console.log(`[embed:${embed.name}] live: FAIL — ${err instanceof Error ? err.message : String(err)}`);
      failures++;
    }
  }

  // 4. structured-output live test
  if (chatPing.ok) {
    try {
      const out = await chat.chatStructured<ProbeOut>({
        system: "You classify sentiment. Always return JSON.",
        user: "Classify the sentiment of: 'I love this product, it works great!'",
        schemaName: "sentiment_classify",
        schemaDescription: "Sentiment classification result.",
        schema: PROBE_SCHEMA,
        tier: "fast",
        maxTokens: 200,
        temperature: 0,
      });
      if (
        typeof out.sentiment !== "string" ||
        typeof out.confidence !== "number"
      ) {
        console.log(`[chat:${chat.name}] structured: FAIL — bad shape ${JSON.stringify(out)}`);
        failures++;
      } else {
        console.log(
          `[chat:${chat.name}] structured: OK — got sentiment=${out.sentiment} confidence=${out.confidence}`,
        );
      }
    } catch (err) {
      console.log(`[chat:${chat.name}] structured: FAIL — ${err instanceof Error ? err.message : String(err)}`);
      failures++;
    }
  }

  console.log("");
  if (failures === 0) {
    console.log("All checks passed. The LLM stack is ready.");
    return 0;
  }
  console.log(`${failures} check(s) failed. See messages above.`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("doctor: fatal", err);
    process.exit(1);
  });
