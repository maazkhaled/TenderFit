/**
 * Markdown report rendering for the eval harness. Pure formatting — accepts
 * an EvalSummary and produces a human-readable .md string.
 */

import type { EvalSummary, ThresholdMetrics } from "./metrics.js";

export interface ReportContext {
  tenantSlug: string;
  tenantName: string;
  since: Date | null;
  until: Date;
  modelVersion: string | null;
  pipelineNotes: string[];
}

function pct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(3);
}

function row(t: ThresholdMetrics): string {
  return (
    `| ≥ ${t.threshold} | ${t.matrix.total} | ${t.matrix.tp} | ${t.matrix.fp} | ${t.matrix.fn} | ${t.matrix.tn} ` +
    `| ${pct(t.agreement)} | ${fmt(t.precision)} | ${fmt(t.recall)} | ${fmt(t.f1)} |`
  );
}

export function renderMarkdownReport(
  summary: EvalSummary,
  ctx: ReportContext,
): string {
  const lines: string[] = [];
  lines.push(`# Shadow-mode eval — ${ctx.tenantName}`);
  lines.push("");
  lines.push(
    `Tenant: \`${ctx.tenantSlug}\` · Window: ${ctx.since ? ctx.since.toISOString() : "(all time)"} → ${ctx.until.toISOString()}`,
  );
  if (ctx.modelVersion) lines.push(`Model version: \`${ctx.modelVersion}\``);
  if (ctx.pipelineNotes.length > 0) {
    lines.push("");
    lines.push("Pipeline:");
    for (const n of ctx.pipelineNotes) lines.push(`- ${n}`);
  }
  lines.push("");
  lines.push(`## Sample`);
  lines.push(
    `${summary.totalLabeled} labeled matches · ${summary.positiveCount} positives (${pct(summary.positiveRate)})`,
  );
  if (summary.totalLabeled < 30) {
    lines.push("");
    lines.push(
      `> Sample is small — metrics below have wide confidence intervals. Aim for at least 50 labeled matches before trusting the precision/recall numbers.`,
    );
  }
  lines.push("");
  lines.push(`## Overall metrics by threshold`);
  lines.push("");
  lines.push("| Threshold | N | TP | FP | FN | TN | Agreement | Precision | Recall | F1 |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const t of summary.thresholds) lines.push(row(t));
  lines.push("");
  lines.push(`## Per-source breakdown`);
  if (summary.byGroup.length === 0) {
    lines.push("");
    lines.push("(no labeled matches)");
  } else {
    for (const g of summary.byGroup) {
      lines.push("");
      lines.push(
        `### \`${g.group}\` — ${g.count} matches, ${pct(g.positiveRate)} positive`,
      );
      lines.push("");
      lines.push("| Threshold | N | TP | FP | FN | TN | Agreement | Precision | Recall | F1 |");
      lines.push("|---|---|---|---|---|---|---|---|---|---|");
      for (const t of g.thresholds) lines.push(row(t));
    }
  }
  lines.push("");
  lines.push(`## How to read this`);
  lines.push("");
  lines.push(
    "- **Agreement** is the headline: across all labeled tenders, on how many did the matcher (predicted ≥ threshold) and the bid team (interested=true) agree?",
  );
  lines.push(
    "- **False positives (FP)** are tenders the matcher flagged that the team passed on. Inspect a sample: did the team have context the matcher missed? If so, surface that as a profile field or a new gap-check.",
  );
  lines.push(
    "- **False negatives (FN)** are tenders the team pursued that the matcher scored below threshold — the worst category, since in production these would be silently dropped.",
  );
  lines.push(
    "- The right threshold is the one that maximises **F1** at acceptable recall for your team. Don't pick the highest agreement number — it can hide a recall collapse.",
  );
  return lines.join("\n") + "\n";
}
