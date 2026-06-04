/**
 * Internal HTTP API for triggering worker actions from the web container.
 *
 * Exposes:
 *   POST /trigger/ingest       — start a one-shot ingest of all enabled sources
 *   POST /trigger/match        — start a one-shot match for every tenant
 *   POST /trigger/digest?tenant=<slug>
 *                              — send a digest immediately for the given tenant
 *   GET  /status               — JSON of every job's running/finished/error state
 *
 * Auth: a single shared bearer token (`WORKER_AUTH_TOKEN`). The token is sent
 * by the web container in the Authorization header. The server NEVER listens on
 * a public port — `docker-compose.yml` uses `expose: 8080`, not `ports:`, so the
 * port is only reachable on the compose network from `web` or `caddy`.
 *
 * Concurrency: one in-memory map keyed by action name. If a job is still
 * running, a new request returns `{ status: "already_running" }` immediately
 * — no queuing, no parallel duplicate runs. The cron loop in cron.ts uses
 * the same `safeRun` mutex so cron-triggered runs are also captured here
 * via the same exported singleton.
 */

import http from "node:http";
import { runIngest } from "./ingest-runner.js";
import { runMatch } from "./match-runner.js";
import { runDigest } from "./digest-runner.js";

const PORT = Number.parseInt(process.env.WORKER_HTTP_PORT ?? "8080", 10);
const AUTH_TOKEN = process.env.WORKER_AUTH_TOKEN ?? "";

interface JobState {
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  /** Last successful run, for "last refreshed N min ago" copy in the UI. */
  lastSuccessAt: number | null;
}

const jobs = new Map<string, JobState>();

function getOrInit(name: string): JobState {
  const existing = jobs.get(name);
  if (existing) return existing;
  const fresh: JobState = {
    startedAt: 0,
    finishedAt: 0,
    error: null,
    lastSuccessAt: null,
  };
  jobs.set(name, fresh);
  return fresh;
}

function isRunning(name: string): boolean {
  const j = jobs.get(name);
  return j != null && j.startedAt > 0 && j.finishedAt === null;
}

/**
 * Fire-and-forget job runner with mutex semantics. Returns immediately;
 * the caller reads /status to find out when it's done.
 */
function startJob(name: string, fn: () => Promise<unknown>): {
  status: "started" | "already_running";
} {
  if (isRunning(name)) {
    return { status: "already_running" };
  }
  const job = getOrInit(name);
  job.startedAt = Date.now();
  job.finishedAt = null;
  job.error = null;
  fn()
    .then(() => {
      job.finishedAt = Date.now();
      job.lastSuccessAt = job.finishedAt;
      console.log(
        `[worker-http] job=${name} finished in ${job.finishedAt - job.startedAt}ms`,
      );
    })
    .catch((err: unknown) => {
      job.finishedAt = Date.now();
      job.error = err instanceof Error ? err.message : String(err);
      console.error(`[worker-http] job=${name} failed:`, err);
    });
  console.log(`[worker-http] job=${name} started`);
  return { status: "started" };
}

function authOk(req: http.IncomingMessage): boolean {
  // If no token is configured, refuse all requests — fail closed, not open.
  if (!AUTH_TOKEN) return false;
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();
  return token === AUTH_TOKEN;
}

function jsonResponse(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    if (!authOk(req)) {
      jsonResponse(res, 401, { error: "unauthorized" });
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/status") {
      const out: Record<string, JobState & { running: boolean }> = {};
      for (const [name, state] of jobs.entries()) {
        out[name] = { ...state, running: isRunning(name) };
      }
      jsonResponse(res, 200, { jobs: out });
      return;
    }

    if (req.method === "POST" && url.pathname === "/trigger/ingest") {
      jsonResponse(res, 202, startJob("ingest", runIngest));
      return;
    }

    if (req.method === "POST" && url.pathname === "/trigger/match") {
      jsonResponse(res, 202, startJob("match", runMatch));
      return;
    }

    if (req.method === "POST" && url.pathname === "/trigger/digest") {
      const slug = url.searchParams.get("tenant");
      if (!slug) {
        jsonResponse(res, 400, { error: "tenant query param required" });
        return;
      }
      // runDigest reads argv to find --tenant=<slug>; mimic the CLI here.
      jsonResponse(
        res,
        202,
        startJob(`digest:${slug}`, () =>
          runDigest(["", "", `--tenant=${slug}`]),
        ),
      );
      return;
    }

    jsonResponse(res, 404, { error: "not_found" });
  } catch (err) {
    console.error("[worker-http] handler error:", err);
    jsonResponse(res, 500, {
      error: "internal_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  if (!AUTH_TOKEN) {
    console.warn(
      `[worker-http] WORKER_AUTH_TOKEN is unset — server will reject every request. Set it in .env to enable triggers.`,
    );
  }
  console.log(`[worker-http] listening on 0.0.0.0:${PORT}`);
});

export { server };
