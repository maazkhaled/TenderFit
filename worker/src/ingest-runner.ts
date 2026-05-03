import { prisma } from "@beta/db";
import {
  adapters,
  runAdapter,
  type IngestAdapter,
  type OnBatchFn,
  type OnBatchResult,
} from "@beta/ingest";
import type {
  IngestRunSummary,
  NormalizedTender,
  TenderSourceId,
} from "@beta/shared";

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 5;

function checkRequiredEnv(adapter: IngestAdapter): string[] {
  return adapter.requiredEnv.filter((name) => !process.env[name]);
}

async function computeSinceIso(source: TenderSourceId): Promise<string> {
  const latest = await prisma.tender.findFirst({
    where: { source },
    orderBy: { publishedAt: "desc" },
    select: { publishedAt: true },
  });
  if (latest?.publishedAt) return latest.publishedAt.toISOString();
  return new Date(Date.now() - FOURTEEN_DAYS_MS).toISOString();
}

function makeOnBatch(source: TenderSourceId): OnBatchFn {
  return async (tenders: NormalizedTender[]): Promise<OnBatchResult> => {
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const t of tenders) {
      try {
        const existing = await prisma.tender.findUnique({
          where: { source_externalId: { source, externalId: t.externalId } },
          select: { id: true },
        });

        if (existing) {
          await prisma.tender.update({
            where: { id: existing.id },
            data: {
              title: t.title,
              description: t.description,
              url: t.url,
              buyer: t.buyer,
              country: t.country,
              sector: t.sector,
              cpvCodes: t.cpvCodes,
              budgetMinUsd: t.budgetMinUsd,
              budgetMaxUsd: t.budgetMaxUsd,
              currency: t.currency,
              publishedAt: t.publishedAt,
              deadlineAt: t.deadlineAt,
              language: t.language,
              raw: t.raw as any,
            },
          });
          updated += 1;
        } else {
          await prisma.tender.create({
            data: {
              source,
              externalId: t.externalId,
              title: t.title,
              description: t.description,
              url: t.url,
              buyer: t.buyer,
              country: t.country,
              sector: t.sector,
              cpvCodes: t.cpvCodes,
              budgetMinUsd: t.budgetMinUsd,
              budgetMaxUsd: t.budgetMaxUsd,
              currency: t.currency,
              publishedAt: t.publishedAt,
              deadlineAt: t.deadlineAt,
              language: t.language,
              raw: t.raw as any,
              embeddingStatus: "pending",
            },
          });
          inserted += 1;
        }
      } catch (err) {
        skipped += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[ingest:${source}] skipped externalId=${t.externalId}: ${msg}`,
        );
      }
    }

    return { inserted, updated, skipped };
  };
}

function printSummaryTable(summaries: IngestRunSummary[]): void {
  const header = ["source", "fetched", "inserted", "updated", "skipped", "errors", "ms"];
  const widths = header.map((h) => h.length);
  const rows = summaries.map((s) => {
    const row = [
      s.source,
      String(s.fetched),
      String(s.inserted),
      String(s.updated),
      String(s.skipped),
      String(s.errors.length),
      String(s.finishedAt.getTime() - s.startedAt.getTime()),
    ];
    row.forEach((v, i) => {
      if (v.length > (widths[i] ?? 0)) widths[i] = v.length;
    });
    return row;
  });

  const fmtRow = (cells: string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i] ?? c.length)).join("  ");

  console.log("");
  console.log(fmtRow(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  rows.forEach((r) => console.log(fmtRow(r)));
  console.log("");
}

export async function runIngest(): Promise<IngestRunSummary[]> {
  const summaries: IngestRunSummary[] = [];
  const sources = Object.keys(adapters) as TenderSourceId[];

  for (const source of sources) {
    const adapter = adapters[source];
    if (adapter.disabledReason) {
      console.warn(`[ingest:${source}] skipping — disabled: ${adapter.disabledReason}`);
      continue;
    }
    const missing = checkRequiredEnv(adapter);
    if (missing.length > 0) {
      console.warn(
        `[ingest:${source}] skipping — missing env: ${missing.join(", ")}`,
      );
      continue;
    }

    const sinceIso = await computeSinceIso(source);
    console.log(`[ingest:${source}] starting since=${sinceIso}`);
    const summary = await runAdapter(adapter, {
      sinceIso,
      maxPages: MAX_PAGES,
      onBatch: makeOnBatch(source),
    });
    summaries.push(summary);
    console.log(
      `[ingest:${source}] done fetched=${summary.fetched} inserted=${summary.inserted} updated=${summary.updated} skipped=${summary.skipped} errors=${summary.errors.length}`,
    );
  }

  printSummaryTable(summaries);
  return summaries;
}

const isDirect = (() => {
  const arg = process.argv[1] ?? "";
  return arg.endsWith("ingest-runner.ts") || arg.endsWith("ingest-runner.js");
})();

if (isDirect) {
  runIngest()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error("[ingest] fatal:", err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
