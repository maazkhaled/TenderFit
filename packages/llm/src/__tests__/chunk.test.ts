import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText, meanPool } from "../util/chunk.ts";

test("chunkText returns the original as one chunk when it already fits", () => {
  const text = "short text under the cap";
  const chunks = chunkText(text, { targetChars: 1000, overlapChars: 100 });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]!.text, text);
  assert.equal(chunks[0]!.start, 0);
  assert.equal(chunks[0]!.end, text.length);
});

test("chunkText returns [] for empty/whitespace-only input", () => {
  assert.deepEqual(chunkText(""), []);
  assert.deepEqual(chunkText("   \n  "), []);
});

test("chunkText splits on paragraph boundaries first when possible", () => {
  const paras = Array.from({ length: 6 }, (_, i) =>
    "para-" + i + ": " + "x".repeat(100),
  );
  const text = paras.join("\n\n");
  const chunks = chunkText(text, { targetChars: 250, overlapChars: 0 });
  assert.ok(chunks.length >= 2, "should split into multiple chunks");
  // Each chunk should be roughly within the target (no piece much larger).
  for (const c of chunks) {
    assert.ok(c.text.length <= 300, `chunk too large: ${c.text.length}`);
  }
});

test("chunkText overlap carries trailing text from previous chunk", () => {
  // Two paragraphs of equal length that pack into two chunks with the
  // recursive separator logic. Predictable packing so the overlap is
  // observable rather than masked by the recursive splitter.
  const a = "alpha-section " + "x".repeat(380);
  const b = "beta-section " + "y".repeat(380);
  const text = a + "\n\n" + b;
  const chunks = chunkText(text, { targetChars: 500, overlapChars: 100 });
  assert.equal(chunks.length, 2, "should split into two chunks");
  // chunk[0] ends with material from the end of paragraph A.
  // chunk[1] should begin with the trailing 100 chars of paragraph A
  // before continuing into paragraph B.
  assert.ok(
    chunks[1]!.text.includes("xxxx"),
    "chunk 1 should carry trailing material from chunk 0",
  );
  // Stronger check: chunk[1].start is earlier than chunk[0].end by ~overlapChars.
  assert.ok(
    chunks[1]!.start < chunks[0]!.end,
    `expected chunk[1].start (${chunks[1]!.start}) < chunk[0].end (${chunks[0]!.end})`,
  );
  assert.ok(
    chunks[0]!.end - chunks[1]!.start >= 50,
    "overlap window should be at least 50 chars",
  );
});

test("chunkText handles input with no usable separators (long unbroken string)", () => {
  const text = "x".repeat(2500);
  const chunks = chunkText(text, { targetChars: 500, overlapChars: 0 });
  assert.ok(chunks.length >= 5, `expected ~5 chunks, got ${chunks.length}`);
  for (const c of chunks) assert.ok(c.text.length <= 500);
});

test("chunkText offsets are consistent with original text", () => {
  const text = Array.from({ length: 10 }, (_, i) => `Line ${i}\n`).join("") +
    "tail-section\n\n" + "y".repeat(600);
  const chunks = chunkText(text, { targetChars: 200, overlapChars: 0 });
  // For each non-overlapping chunk, text.slice(start, end) must match.
  for (const c of chunks) {
    assert.equal(text.slice(c.start, c.end), c.text);
  }
});

test("meanPool: length-weighted average is correct for trivial 2-vector case", () => {
  const v1 = [1, 0, 0];
  const v2 = [0, 1, 0];
  const out = meanPool([v1, v2], [3, 1]);
  // weighted mean: (3*1 + 1*0)/4, (3*0 + 1*1)/4, 0
  assert.equal(out.length, 3);
  assert.ok(Math.abs((out[0] as number) - 0.75) < 1e-9);
  assert.ok(Math.abs((out[1] as number) - 0.25) < 1e-9);
  assert.equal(out[2], 0);
});

test("meanPool: all-zero weights fall back to uniform", () => {
  const v1 = [2, 4, 6];
  const v2 = [4, 6, 8];
  const out = meanPool([v1, v2], [0, 0]);
  // uniform mean = [3, 5, 7]
  assert.deepEqual(out, [3, 5, 7]);
});

test("meanPool: dimension mismatch throws", () => {
  assert.throws(() => meanPool([[1, 2], [1, 2, 3]], [1, 1]));
});

test("meanPool: empty input throws", () => {
  assert.throws(() => meanPool([], []));
});

test("meanPool: weight mismatch throws", () => {
  assert.throws(() => meanPool([[1, 2]], [1, 1]));
});
