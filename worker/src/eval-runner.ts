/**
 * Shadow-mode eval harness.
 *
 * Reads MatchResult + MatchFeedback for a tenant, computes confusion-matrix
 * metrics at configurable thresholds, and writes a Markdown report. This is
 * the closed-loop tool the "Friday review" ritual is built around: it
 * answers "how often does the matcher's call match what the bid team did?"
 *
 * Usage:
 *   pnpm --filter worker run eval -- --tenant=acme [--since=2026-01-01]
 *                                   [--out=./eval.md]
 *                                   [--thresholds=40,60,75]
 *
 * The script intentionally produces a file (default: outputs/eval-<slug>-<date>.md)
 * rather than printing only to stdout so reports can accumulate in a repo or
 * shared folder over time — that's the artefact the bid team and product
 * owner read each week.
 */

// MUST be first — see worker/src/util/load-env.ts.
import "./util/load-env.js";

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { prisma } from "@beta/db";
import { evaluate, type LabeledMatch } from "./eval/metrics.js";
import { renderMarkdownReport } from "./eval/report.js";

interface ParsedArgs {
  tenantSlug: string | null;
  since: Date | null;
  out: string | null;
  thresholds: number[] | null;
}

function parseArgs(argv: string[]): ParsedArgs {
  let tenantSlug: string | null = null;
  let since: Date | null = null;
  let out: string | null = null;
  let thresholds: number[] | null = null;
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--tenant=")) {
      tenantSlug = arg.slice("--tenant=".length);
    } else if (arg.startsWith("--since=")) {
      const v = arg.slice("--since=".length);
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        throw new Error(`--since must be a valid ISO date (got "${v}")`);
      }
      since = d;
    } else if (arg.startsWith("--out=")) {
      out = arg.slice("--out=".length);
    } else if (arg.startsWith("--thresholds=")) {
      const raw = arg.slice("--thresholds=".length);
      const parsed = raw
        .split(",")
        .map((s) => Number.parseFloat(s.trim()))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 100);
      if (parsed.length === 0) {
        throw new Error(
          `--thresholds expected comma-separated numbers in [0,100], got "${raw}"`,
        );
      }
      thresholds = parsed;
    }
  }
  return { tenantSlug, since, out, thresholds };
}

function defaultOutputPath(tenantSlug: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return resolve(process.cwd(), `outputs/eval-${tenantSlug}-${date}.md`);
}

async function loadLabeledMatches(
  tenantId: string,
  since: Date | null,
): Promise<{ samples: LabeledMatch[]; modelVersion: string | null }> {
  const where: Record<string, unknown> = { tenantId };
  if (since) where.createdAt = { gte: since };

  const matches = await prisma.matchResult.findMany({
    where,
    include: {
      feedback: true,
      tender: { select: { source: true } },
    },
  });

  const samples: LabeledMatch[] = [];
  let modelVersion: string | null = null;
  for (const m of matches) {
    if (!m.feedback) continue; // unlabeled — eval only looks at where the team gave a verdict
    samples.push({
      predicted: m.fitScore,
      label: m.feedback.interested,
      group: m.tender?.source ?? "(unknown)",
    });
    if (modelVersion == null) modelVersion = m.modelVersion;
  }
  return { samples, modelVersion };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (!args.tenantSlug) {
    console.error(
      "Usage: pnpm --filter worker run eval -- --tenant=<slug> [--since=ISO] [--out=path] [--thresholds=40,60,75]",
    );
    process.exit(2);
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: args.tenantSlug },
  });
  if (!tenant) {
    console.error(`[eval] tenant slug=${args.tenantSlug} not found`);
    process.exit(1);
  }

  const { samples, modelVersion } = await loadLabeledMatches(
    tenant.id,
    args.since,
  );
  console.log(
    `[eval] tenant=${tenant.slug} labeled=${samples.length} model=${modelVersion ?? "?"}`,
  );

  const summary = evaluate(samples, args.thresholds ?? undefined);
  const md = renderMarkdownReport(summary, {
    tenantSlug: tenant.slug,
    tenantName: tenant.companyName,
    since: args.since,
    until: new Date(),
    modelVersion,
    pipelineNotes: [
      "Retrieval: hybrid (dense + Postgres ts_rank_cd) fused via Reciprocal Rank Fusion",
      "Rerank: configured via RERANK_PROVIDER (voyage | none)",
      "Scorer: LLM with structured-output schema (see packages/llm/src/score.ts)",
    ],
  });

  const outPath = args.out
    ? resolve(process.cwd(), args.out)
    : defaultOutputPath(tenant.slug);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, md, "utf8");
  console.log(`[eval] report written to ${outPath}`);
}

const isDirect = (() => {
  const arg = process.argv[1] ?? "";
  return arg.endsWith("eval-runner.ts") || arg.endsWith("eval-runner.js");
})();

if (isDirect) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error("[eval] fatal:", err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
