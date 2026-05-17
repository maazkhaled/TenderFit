import { test } from "node:test";
import assert from "node:assert/strict";
import {
  confusionAt,
  evaluate,
  metricsFromMatrix,
  type LabeledMatch,
} from "../metrics.ts";

const samples: LabeledMatch[] = [
  // Predicted high, label true → TP at threshold 60
  { predicted: 85, label: true, group: "sam_gov" },
  { predicted: 72, label: true, group: "sam_gov" },
  // Predicted high, label false → FP at threshold 60
  { predicted: 80, label: false, group: "ted_eu" },
  // Predicted low, label true → FN at threshold 60
  { predicted: 30, label: true, group: "ppra_pk" },
  // Predicted low, label false → TN at threshold 60
  { predicted: 20, label: false, group: "ppra_pk" },
  { predicted: 10, label: false, group: "ppra_pk" },
];

test("confusionAt: threshold 60 over canonical sample", () => {
  const m = confusionAt(samples, 60);
  assert.deepEqual(
    { tp: m.tp, fp: m.fp, fn: m.fn, tn: m.tn, total: m.total },
    { tp: 2, fp: 1, fn: 1, tn: 2, total: 6 },
  );
});

test("confusionAt: threshold at boundary is inclusive on >=", () => {
  // At threshold 72, the score=72 sample is a positive prediction.
  const at72 = confusionAt(samples, 72);
  const at73 = confusionAt(samples, 73);
  assert.equal(at72.tp + at72.fp, at73.tp + at73.fp + 1);
});

test("confusionAt: 0/100 thresholds collapse to all-positive/all-negative", () => {
  const all = confusionAt(samples, 0);
  assert.equal(all.tp + all.fp, samples.length);
  assert.equal(all.tn + all.fn, 0);

  const none = confusionAt(samples, 101);
  assert.equal(none.tn + none.fn, samples.length);
  assert.equal(none.tp + none.fp, 0);
});

test("metricsFromMatrix: precision/recall/F1 math", () => {
  const m = { tp: 2, fp: 1, fn: 1, tn: 2, total: 6 };
  const out = metricsFromMatrix(m, 60);
  // precision = 2/(2+1) = 0.6667
  assert.ok(Math.abs(out.precision - 2 / 3) < 1e-9);
  // recall = 2/(2+1) = 0.6667
  assert.ok(Math.abs(out.recall - 2 / 3) < 1e-9);
  // f1 = 2*P*R/(P+R) = 0.6667
  assert.ok(Math.abs(out.f1 - 2 / 3) < 1e-9);
  // agreement = (2+2)/6
  assert.ok(Math.abs(out.agreement - 4 / 6) < 1e-9);
});

test("metricsFromMatrix: zero-denominator precision/recall yields 0 (not NaN)", () => {
  const allTrueNeg = { tp: 0, fp: 0, fn: 0, tn: 5, total: 5 };
  const out = metricsFromMatrix(allTrueNeg, 60);
  assert.equal(out.precision, 0);
  assert.equal(out.recall, 0);
  assert.equal(out.f1, 0);
});

test("evaluate: produces threshold sweep and per-group breakdown", () => {
  const summary = evaluate(samples, [40, 60, 75]);
  assert.equal(summary.totalLabeled, 6);
  assert.equal(summary.positiveCount, 3);
  assert.equal(summary.thresholds.length, 3);
  // Groups: sam_gov (2), ted_eu (1), ppra_pk (3) — sorted by count desc.
  assert.equal(summary.byGroup[0]!.group, "ppra_pk");
  assert.equal(summary.byGroup[0]!.count, 3);
  assert.equal(summary.byGroup[1]!.group, "sam_gov");
  assert.equal(summary.byGroup[2]!.group, "ted_eu");
});

test("evaluate: empty input returns zeroed summary", () => {
  const out = evaluate([]);
  assert.equal(out.totalLabeled, 0);
  assert.equal(out.positiveCount, 0);
  assert.equal(out.positiveRate, 0);
  for (const t of out.thresholds) {
    assert.equal(t.matrix.total, 0);
    assert.equal(t.precision, 0);
    assert.equal(t.recall, 0);
  }
  assert.equal(out.byGroup.length, 0);
});

test("evaluate: ungrouped samples land under (ungrouped)", () => {
  const out = evaluate([
    { predicted: 80, label: true },
    { predicted: 20, label: false },
  ]);
  assert.equal(out.byGroup.length, 1);
  assert.equal(out.byGroup[0]!.group, "(ungrouped)");
});
