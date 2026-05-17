/**
 * Pure metric computation for the shadow-mode eval harness.
 *
 * Inputs are (predictedScore, humanLabel) pairs — `predictedScore` is the
 * matcher's fit score in [0,100], `humanLabel` is what the bid team said about
 * the match (interested vs not). No DB, no I/O — this module is unit-tested
 * directly against synthetic samples.
 *
 * The metric names follow standard binary-classification convention:
 *   - TP: predicted >= threshold AND label = true
 *   - FP: predicted >= threshold AND label = false
 *   - FN: predicted <  threshold AND label = true
 *   - TN: predicted <  threshold AND label = false
 * Agreement = (TP+TN)/total. Precision = TP/(TP+FP). Recall = TP/(TP+FN).
 * F1 = harmonic mean of precision/recall.
 *
 * Why thresholded rather than continuous: the bid team's action is binary
 * ("bid / no bid"), so precision/recall at a threshold is the metric that
 * maps directly to the production decision rule (the digest's minFitScore).
 */

export interface LabeledMatch {
  /** Matcher's predicted fit score, 0..100. */
  predicted: number;
  /** True iff the bid team marked the match as interesting (interested=true). */
  label: boolean;
  /** Optional grouping key (e.g. tender source) — enables per-source breakdowns. */
  group?: string;
}

export interface ConfusionMatrix {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  /** Total = tp + fp + fn + tn — exposed for convenience. */
  total: number;
}

export interface ThresholdMetrics {
  threshold: number;
  matrix: ConfusionMatrix;
  agreement: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface GroupMetrics {
  group: string;
  count: number;
  positiveRate: number;
  thresholds: ThresholdMetrics[];
}

export interface EvalSummary {
  totalLabeled: number;
  positiveCount: number;
  /** Fraction of samples with label=true. */
  positiveRate: number;
  thresholds: ThresholdMetrics[];
  byGroup: GroupMetrics[];
}

const DEFAULT_THRESHOLDS: readonly number[] = [40, 60, 75];

export function confusionAt(
  samples: ReadonlyArray<LabeledMatch>,
  threshold: number,
): ConfusionMatrix {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const s of samples) {
    const positive = s.predicted >= threshold;
    if (positive && s.label) tp++;
    else if (positive && !s.label) fp++;
    else if (!positive && s.label) fn++;
    else tn++;
  }
  return { tp, fp, fn, tn, total: tp + fp + fn + tn };
}

export function metricsFromMatrix(
  matrix: ConfusionMatrix,
  threshold: number,
): ThresholdMetrics {
  const denomP = matrix.tp + matrix.fp;
  const denomR = matrix.tp + matrix.fn;
  const precision = denomP === 0 ? 0 : matrix.tp / denomP;
  const recall = denomR === 0 ? 0 : matrix.tp / denomR;
  const agreement = matrix.total === 0 ? 0 : (matrix.tp + matrix.tn) / matrix.total;
  const f1 =
    precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { threshold, matrix, agreement, precision, recall, f1 };
}

export function evaluate(
  samples: ReadonlyArray<LabeledMatch>,
  thresholds: ReadonlyArray<number> = DEFAULT_THRESHOLDS,
): EvalSummary {
  const totalLabeled = samples.length;
  const positiveCount = samples.reduce((n, s) => (s.label ? n + 1 : n), 0);
  const positiveRate = totalLabeled === 0 ? 0 : positiveCount / totalLabeled;

  const thresholdMetrics = thresholds.map((t) =>
    metricsFromMatrix(confusionAt(samples, t), t),
  );

  const groups = new Map<string, LabeledMatch[]>();
  for (const s of samples) {
    const key = s.group ?? "(ungrouped)";
    const arr = groups.get(key) ?? [];
    arr.push(s);
    groups.set(key, arr);
  }
  const byGroup: GroupMetrics[] = [];
  for (const [group, arr] of groups) {
    const pos = arr.reduce((n, s) => (s.label ? n + 1 : n), 0);
    byGroup.push({
      group,
      count: arr.length,
      positiveRate: arr.length === 0 ? 0 : pos / arr.length,
      thresholds: thresholds.map((t) =>
        metricsFromMatrix(confusionAt(arr, t), t),
      ),
    });
  }
  // Stable: largest group first, alphabetical tiebreak.
  byGroup.sort((a, b) =>
    b.count !== a.count ? b.count - a.count : a.group.localeCompare(b.group),
  );

  return {
    totalLabeled,
    positiveCount,
    positiveRate,
    thresholds: thresholdMetrics,
    byGroup,
  };
}

export const __test__ = {
  DEFAULT_THRESHOLDS,
};
