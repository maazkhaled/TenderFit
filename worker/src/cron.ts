import cron from "node-cron";
import { prisma } from "@beta/db";
import { runIngest } from "./ingest-runner.js";
import { runMatch } from "./match-runner.js";
import { runDigest } from "./digest-runner.js";

let running = {
  ingest: false,
  match: false,
  digest: false,
};

async function safeRun(
  name: keyof typeof running,
  fn: () => Promise<unknown>,
): Promise<void> {
  if (running[name]) {
    console.log(`[cron] ${name} already running, skipping tick`);
    return;
  }
  running[name] = true;
  const startedAt = Date.now();
  try {
    await fn();
    console.log(`[cron] ${name} ok in ${Date.now() - startedAt}ms`);
  } catch (err) {
    console.error(`[cron] ${name} failed:`, err);
  } finally {
    running[name] = false;
  }
}

async function bootstrap(): Promise<void> {
  console.log("[cron] startup: running ingest → match → digest once");
  await safeRun("ingest", runIngest);
  await safeRun("match", runMatch);
  await safeRun("digest", () => runDigest([]));
}

function schedule(): void {
  cron.schedule("0 */6 * * *", () => {
    void safeRun("ingest", runIngest);
  });
  cron.schedule("5 * * * *", () => {
    void safeRun("match", runMatch);
  });
  cron.schedule("*/15 * * * *", () => {
    void safeRun("digest", () => runDigest([]));
  });
  console.log("[cron] scheduled: ingest=6h, match=1h, digest=15m");
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[cron] received ${signal}, shutting down`);
  try {
    await prisma.$disconnect();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

bootstrap()
  .then(() => schedule())
  .catch(async (err) => {
    console.error("[cron] bootstrap fatal:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
