// MUST be first — see worker/src/util/load-env.ts. The downstream entry
// modules also import it, but loading here means the cron-shell-only env vars
// (DEBUG_ENV etc) take effect before anything else runs.
import "./util/load-env.js";

import cron from "node-cron";
import { prisma } from "@beta/db";
import { runIngest } from "./ingest-runner.js";
import { runMatch } from "./match-runner.js";
import { runDigest } from "./digest-runner.js";
// Side-effect import: starts the internal HTTP server that lets the web
// container trigger ingest/match/digest from UI buttons. See server.ts for
// the API surface and auth model.
import "./server.js";

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
  // Frequencies sized for digest-driven usage (most tenants read once per
  // day via email). Previous schedule (ingest=6h, match=1h) generated
  // ~480 Gemini LLM calls per day — well over the 250 RPD free-tier cap.
  // Current schedule cuts that ~6x while keeping data fresh within a few
  // hours of any digest fire. Users who want sub-daily freshness can hit
  // the "Run now" buttons in the dashboard ActionsPanel.

  // Ingest at 02:00 and 14:00 UTC daily — two cycles per day, well-spaced
  // so no single upstream source gets hit twice in <12h.
  cron.schedule("0 2,14 * * *", () => {
    void safeRun("ingest", runIngest);
  });

  // Match at 03:00, 09:00, 15:00, 21:00 UTC — four cycles per day, each
  // ~1h after a corresponding ingest finishes (with margin for slow
  // sources). LLM cost is now ~20 matches × 4 runs = 80 calls/day,
  // comfortably under Gemini free-tier 250 RPD.
  cron.schedule("0 3,9,15,21 * * *", () => {
    void safeRun("match", runMatch);
  });

  // Digest stays at 15 min — cheap DB-only check; the isDueNow gate
  // prevents emails from actually firing more than each tenant's chosen
  // cadence (daily / weekdays / weekly / monthly / every-N-days).
  cron.schedule("*/15 * * * *", () => {
    void safeRun("digest", () => runDigest([]));
  });

  console.log(
    "[cron] scheduled: ingest=12h (02,14 UTC), match=6h (03,09,15,21 UTC), digest=15m",
  );
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
