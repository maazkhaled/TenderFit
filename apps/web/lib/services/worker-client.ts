/**
 * Thin client for the worker container's internal HTTP API (see
 * worker/src/server.ts). Used by /api/v1/actions/* routes to forward
 * authenticated UI button clicks into the worker process.
 *
 * The worker hostname is `worker` on the docker-compose network; in dev
 * outside Docker you can point WORKER_HTTP_URL at http://localhost:8080.
 */

const WORKER_URL = (
  process.env.WORKER_HTTP_URL ?? "http://worker:8080"
).replace(/\/$/, "");
const AUTH_TOKEN = process.env.WORKER_AUTH_TOKEN ?? "";

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${AUTH_TOKEN}`,
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export interface TriggerResult {
  status: "started" | "already_running";
}

export async function triggerIngest(): Promise<TriggerResult> {
  const res = await fetchWithTimeout(
    `${WORKER_URL}/trigger/ingest`,
    { method: "POST", headers: headers() },
    10_000,
  );
  if (!res.ok) throw new Error(`worker /trigger/ingest ${res.status}`);
  return (await res.json()) as TriggerResult;
}

export async function triggerMatch(): Promise<TriggerResult> {
  const res = await fetchWithTimeout(
    `${WORKER_URL}/trigger/match`,
    { method: "POST", headers: headers() },
    10_000,
  );
  if (!res.ok) throw new Error(`worker /trigger/match ${res.status}`);
  return (await res.json()) as TriggerResult;
}

export async function triggerDigest(tenantSlug: string): Promise<TriggerResult> {
  const u = new URL(`${WORKER_URL}/trigger/digest`);
  u.searchParams.set("tenant", tenantSlug);
  const res = await fetchWithTimeout(
    u.toString(),
    { method: "POST", headers: headers() },
    10_000,
  );
  if (!res.ok) throw new Error(`worker /trigger/digest ${res.status}`);
  return (await res.json()) as TriggerResult;
}

export interface JobStatus {
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  lastSuccessAt: number | null;
  running: boolean;
}

export interface StatusResponse {
  jobs: Record<string, JobStatus>;
}

export async function getStatus(): Promise<StatusResponse> {
  const res = await fetchWithTimeout(
    `${WORKER_URL}/status`,
    { method: "GET", headers: headers() },
    5_000,
  );
  if (!res.ok) throw new Error(`worker /status ${res.status}`);
  return (await res.json()) as StatusResponse;
}
