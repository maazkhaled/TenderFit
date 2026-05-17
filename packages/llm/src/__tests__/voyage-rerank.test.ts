import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  NoopRerankProvider,
  VoyageRerankProvider,
} from "../providers/voyage-rerank.ts";
import type { RerankProviderConfig } from "../providers/config.ts";

const baseCfg: RerankProviderConfig = {
  provider: "voyage",
  model: "rerank-2.5",
  baseUrl: "https://api.voyageai.com/v1",
  apiKey: "test-key",
  timeoutMs: 5_000,
  topK: 10,
};

const originalFetch = globalThis.fetch;

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function installMockFetch(
  handler: (call: FetchCall) => Response | Promise<Response>,
): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler({ url, init });
  }) as typeof fetch;
  return { calls };
}

beforeEach(() => {
  // fresh fetch each test
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("VoyageRerankProvider.ping: ok with api key", async () => {
  const p = new VoyageRerankProvider(baseCfg);
  const ping = await p.ping();
  assert.equal(ping.ok, true);
  assert.ok(ping.detail.includes("rerank-2.5"));
});

test("VoyageRerankProvider.ping: not ok without api key", async () => {
  const p = new VoyageRerankProvider({ ...baseCfg, apiKey: null });
  const ping = await p.ping();
  assert.equal(ping.ok, false);
});

test("VoyageRerankProvider.rerank: empty documents returns []", async () => {
  const p = new VoyageRerankProvider(baseCfg);
  const out = await p.rerank("query", []);
  assert.deepEqual(out, []);
});

test("VoyageRerankProvider.rerank: posts JSON body and sorts by score desc", async () => {
  const { calls } = installMockFetch(() => {
    return new Response(
      JSON.stringify({
        data: [
          { index: 0, relevance_score: 0.2 },
          { index: 1, relevance_score: 0.9 },
          { index: 2, relevance_score: 0.7 },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  const p = new VoyageRerankProvider(baseCfg);
  const out = await p.rerank("q", ["a", "b", "c"], { topK: 3 });
  assert.deepEqual(
    out.map((h) => h.index),
    [1, 2, 0],
    "highest score first",
  );

  // Inspect the outbound request
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.ok(call.url.endsWith("/rerank"), `wrong url: ${call.url}`);
  assert.equal(call.init?.method, "POST");
  const headers = call.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers["Authorization"], "Bearer test-key");
  const body = JSON.parse(String(call.init?.body));
  assert.equal(body.model, "rerank-2.5");
  assert.equal(body.query, "q");
  assert.deepEqual(body.documents, ["a", "b", "c"]);
  assert.equal(body.top_k, 3);
  assert.equal(body.truncation, true);
});

test("VoyageRerankProvider.rerank: missing api key throws ProviderError", async () => {
  const p = new VoyageRerankProvider({ ...baseCfg, apiKey: null });
  await assert.rejects(() => p.rerank("q", ["a"]), /VOYAGE_API_KEY/);
});

test("VoyageRerankProvider.rerank: non-2xx response throws with status detail", async () => {
  installMockFetch(
    () =>
      new Response(JSON.stringify({ error: "invalid_request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
  );
  const p = new VoyageRerankProvider(baseCfg);
  await assert.rejects(() => p.rerank("q", ["a"]), /400|invalid_request/);
});

test("NoopRerankProvider.rerank: returns documents in original order with zero scores", async () => {
  const p = new NoopRerankProvider();
  const out = await p.rerank("q", ["a", "b", "c"]);
  assert.deepEqual(
    out.map((h) => h.index),
    [0, 1, 2],
  );
  assert.ok(out.every((h) => h.relevanceScore === 0));
});

test("NoopRerankProvider.rerank: honours topK", async () => {
  const p = new NoopRerankProvider();
  const out = await p.rerank("q", ["a", "b", "c", "d"], { topK: 2 });
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((h) => h.index),
    [0, 1],
  );
});
