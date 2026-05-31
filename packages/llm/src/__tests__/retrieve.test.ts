import { test } from "node:test";
import assert from "node:assert/strict";
import type { CapabilityProfile } from "@beta/shared";
import {
  buildProfileQuery,
  defaultProfileKeywords,
  hybridRetrieve,
  reciprocalRankFusion,
  type DenseHit,
  type HybridRetrievers,
  type TextHit,
} from "../retrieve.ts";

const baseProfile: CapabilityProfile = {
  companyName: "Acme",
  oneLiner: "Cloud dev shop",
  industries: ["fintech"],
  techStack: ["TypeScript", "AWS"],
  services: ["custom software dev"],
  certifications: ["ISO 27001"],
  pastClients: [],
  pastProjects: [],
  geographies: ["PK"],
  teamSize: 10,
  budgetRangeUsd: { min: 0, max: 0 },
  languages: ["en"],
  ignoreLocation: false,
};

test("reciprocalRankFusion: single list returns canonical order", () => {
  const fused = reciprocalRankFusion([["a", "b", "c"]], 60);
  assert.deepEqual(
    fused.map((f) => f.id),
    ["a", "b", "c"],
  );
});

test("reciprocalRankFusion: documents in both lists rank above singletons", () => {
  // 'a' appears in both lists, 'b' and 'c' appear in only one each.
  const fused = reciprocalRankFusion(
    [
      ["a", "b"],
      ["a", "c"],
    ],
    60,
  );
  assert.equal(fused[0]!.id, "a", "shared doc must come first");
  // The remaining two share the same singleton score; tiebreak is first-seen rank.
  const restIds = fused.slice(1).map((f) => f.id);
  assert.deepEqual(restIds.sort(), ["b", "c"]);
});

test("reciprocalRankFusion: scoring matches the formula 1/(k+rank)", () => {
  const k = 60;
  // 'x' is rank 1 in list 1 → 1/61. 'x' rank 3 in list 2 → 1/63. total ≈ 0.0322
  const fused = reciprocalRankFusion(
    [
      ["x", "y"],
      ["m", "n", "x"],
    ],
    k,
  );
  const x = fused.find((f) => f.id === "x")!;
  const expected = 1 / (k + 1) + 1 / (k + 3);
  assert.ok(Math.abs(x.fusedScore - expected) < 1e-12);
});

test("reciprocalRankFusion: k must be > 0", () => {
  assert.throws(() => reciprocalRankFusion([["a"]], 0));
  assert.throws(() => reciprocalRankFusion([["a"]], -1));
});

test("defaultProfileKeywords pulls from services/techStack/certs/industries", () => {
  const kws = defaultProfileKeywords(baseProfile);
  assert.deepEqual(kws.sort(), [
    "AWS",
    "ISO 27001",
    "TypeScript",
    "custom software dev",
    "fintech",
  ]);
});

test("buildProfileQuery quotes multi-word terms and joins with OR", () => {
  const q = buildProfileQuery(baseProfile);
  assert.ok(q.includes('"ISO 27001"'));
  assert.ok(q.includes('"custom software dev"'));
  assert.ok(q.includes("AWS"));
  assert.ok(q.includes(" OR "));
});

test("buildProfileQuery returns empty string when no keywords", () => {
  const empty = {
    ...baseProfile,
    services: [],
    techStack: [],
    certifications: [],
    industries: [],
  };
  assert.equal(buildProfileQuery(empty), "");
});

test("hybridRetrieve: composes fused candidates with provenance flags", async () => {
  const dense: DenseHit[] = [
    { id: "t1", distance: 0.1 },
    { id: "t2", distance: 0.2 },
    { id: "t3", distance: 0.3 },
  ];
  const text: TextHit[] = [
    { id: "t2", rank: 0.9 },
    { id: "t4", rank: 0.7 },
  ];
  const retrievers: HybridRetrievers = {
    dense: async () => dense,
    text: async () => text,
  };
  const out = await hybridRetrieve(baseProfile, retrievers, {
    perRetrieverLimit: 10,
    fusedLimit: 10,
  });
  const byId = new Map(out.map((c) => [c.id, c]));

  // Every dense-only candidate has denseSimilarity set, text-only has textRank.
  assert.ok(byId.get("t1")!.denseSimilarity !== null);
  assert.equal(byId.get("t1")!.textRank, null);
  assert.ok(byId.get("t4")!.textRank !== null);
  assert.equal(byId.get("t4")!.denseSimilarity, null);

  // Shared candidate carries both signals.
  assert.deepEqual(byId.get("t2")!.sources.sort(), ["dense", "text"]);
  assert.ok(byId.get("t2")!.denseSimilarity !== null);
  assert.ok(byId.get("t2")!.textRank !== null);
});

test("hybridRetrieve: shared candidate ranks above singletons (fusion sanity)", async () => {
  const retrievers: HybridRetrievers = {
    dense: async () => [{ id: "shared", distance: 0.5 }, { id: "donly", distance: 0.1 }],
    text: async () => [{ id: "shared", rank: 0.8 }, { id: "tonly", rank: 0.9 }],
  };
  const out = await hybridRetrieve(baseProfile, retrievers);
  assert.equal(out[0]!.id, "shared", "shared candidate should be first");
});

test("hybridRetrieve: denseOnly skips text retrieval entirely", async () => {
  let textCalled = false;
  const retrievers: HybridRetrievers = {
    dense: async () => [{ id: "x", distance: 0.1 }],
    text: async () => {
      textCalled = true;
      return [];
    },
  };
  const out = await hybridRetrieve(baseProfile, retrievers, { denseOnly: true });
  assert.equal(textCalled, false);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0]!.sources, ["dense"]);
});

test("hybridRetrieve: a failing retriever does not abort the other", async () => {
  const retrievers: HybridRetrievers = {
    dense: async () => {
      throw new Error("dense exploded");
    },
    text: async () => [{ id: "t1", rank: 0.5 }],
  };
  const out = await hybridRetrieve(baseProfile, retrievers);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, "t1");
});

test("hybridRetrieve: returns [] when both retrievers return []", async () => {
  const retrievers: HybridRetrievers = {
    dense: async () => [],
    text: async () => [],
  };
  const out = await hybridRetrieve(baseProfile, retrievers);
  assert.deepEqual(out, []);
});
