"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  Sparkles,
  Mail,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/ui/cn";

type ActionKey = "ingest" | "match" | "digest";

interface JobStatus {
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  lastSuccessAt: number | null;
  running: boolean;
}

interface ActionsStatus {
  jobs: Record<string, JobStatus>;
}

/**
 * Maps a UI action key onto the worker job key it produces. The digest job
 * is keyed per-tenant on the worker side (`digest:<slug>`), but the UI only
 * cares whether *any* digest is running for the current tenant, so we just
 * look for any key that starts with `digest:`.
 */
function jobKeyFor(action: ActionKey, status: ActionsStatus): JobStatus | null {
  if (action === "ingest") return status.jobs.ingest ?? null;
  if (action === "match") return status.jobs.match ?? null;
  // digest: pick the most recently-started digest:* entry
  const digestEntries = Object.entries(status.jobs).filter(([k]) =>
    k.startsWith("digest:"),
  );
  if (digestEntries.length === 0) return null;
  digestEntries.sort(
    ([, a], [, b]) => (b.startedAt ?? 0) - (a.startedAt ?? 0),
  );
  return digestEntries[0]![1];
}

function relativeTime(ms: number | null | undefined): string {
  if (!ms) return "never";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} hr ago`;
  return `${Math.round(diff / 86_400_000)} d ago`;
}

interface ActionConfig {
  key: ActionKey;
  label: string;
  description: string;
  endpoint: string;
  body?: Record<string, unknown>;
  icon: React.ComponentType<{ className?: string }>;
  refreshOnFinish: boolean;
}

const ACTIONS: ActionConfig[] = [
  {
    key: "ingest",
    label: "Fetch latest tenders",
    description: "Pull new opportunities from every active source.",
    endpoint: "/api/v1/actions/ingest",
    icon: Download,
    refreshOnFinish: false,
  },
  {
    key: "match",
    label: "Find new matches",
    description: "Score recently-ingested tenders against your profile.",
    endpoint: "/api/v1/actions/match",
    icon: Sparkles,
    refreshOnFinish: true,
  },
  {
    key: "digest",
    label: "Send digest now",
    description: "Email an immediate summary to the digest recipient.",
    endpoint: "/api/v1/actions/digest",
    icon: Mail,
    refreshOnFinish: false,
  },
];

export function ActionsPanel() {
  const router = useRouter();
  const [status, setStatus] = useState<ActionsStatus>({ jobs: {} });
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshedAfterFinish = useRef<Record<string, boolean>>({});

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/actions/status", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as ActionsStatus;
      setStatus(data);

      // If a "match" job has just finished successfully, ask Next to refresh
      // the dashboard so the new matches appear without a manual reload.
      for (const action of ACTIONS) {
        if (!action.refreshOnFinish) continue;
        const job = jobKeyFor(action.key, data);
        if (!job) continue;
        const k = action.key;
        if (
          !job.running &&
          job.finishedAt &&
          !job.error &&
          !refreshedAfterFinish.current[k]
        ) {
          refreshedAfterFinish.current[k] = true;
          router.refresh();
        }
        if (job.running) {
          refreshedAfterFinish.current[k] = false;
        }
      }
    } catch {
      // swallow — polling is best-effort
    }
  }, [router]);

  // Initial fetch + polling whenever something is running
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    const anyRunning = ACTIONS.some(
      (a) => jobKeyFor(a.key, status)?.running === true,
    );
    if (anyRunning) {
      if (!pollRef.current) {
        pollRef.current = setInterval(fetchStatus, 3000);
      }
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      // one more fetch shortly after so we catch the final finishedAt
      const t = setTimeout(fetchStatus, 1000);
      return () => clearTimeout(t);
    }
    return () => {
      if (pollRef.current && !anyRunning) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [status, fetchStatus]);

  async function trigger(action: ActionConfig) {
    setError(null);
    try {
      const res = await fetch(action.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action.body ?? {}),
      });
      if (!res.ok && res.status !== 202) {
        const body = await res.json().catch(() => ({}));
        setError(
          (body as { message?: string; error?: string }).message ??
            (body as { error?: string }).error ??
            `Failed: ${res.status}`,
        );
        return;
      }
      // Start polling immediately
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run now</CardTitle>
        <CardDescription>
          Skip the schedule and trigger an action immediately. Jobs run in the
          background — you can leave this page open or come back later.
        </CardDescription>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {ACTIONS.map((action) => {
            const job = jobKeyFor(action.key, status);
            const running = job?.running ?? false;
            const failed = job && !running && job.error;
            const lastSuccess = job?.lastSuccessAt ?? null;
            const Icon = action.icon;
            return (
              <div
                key={action.key}
                className={cn(
                  "flex flex-col gap-3 rounded-lg border p-4 transition-colors",
                  running
                    ? "border-indigo-200 bg-indigo-50/50"
                    : failed
                      ? "border-red-200 bg-red-50/50"
                      : "border-zinc-200 bg-white",
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-md bg-zinc-50 p-2">
                    <Icon className="h-4 w-4 text-indigo-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-900">
                      {action.label}
                    </p>
                    <p className="mt-0.5 text-xs leading-snug text-zinc-500">
                      {action.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <StatusBadge job={job} />
                  <Button
                    size="sm"
                    disabled={running}
                    onClick={() => trigger(action)}
                  >
                    {running ? "Running…" : "Run"}
                  </Button>
                </div>

                <p className="text-[11px] text-zinc-500">
                  Last success: {relativeTime(lastSuccess)}
                </p>
              </div>
            );
          })}
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function StatusBadge({ job }: { job: JobStatus | null }) {
  if (!job) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-300" />
        Idle
      </span>
    );
  }
  if (job.running) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700">
        <Loader2 className="h-3 w-3 animate-spin" />
        Running
      </span>
    );
  }
  if (job.error) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700"
        title={job.error}
      >
        <AlertCircle className="h-3 w-3" />
        Failed
      </span>
    );
  }
  if (job.finishedAt) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
        <CheckCircle2 className="h-3 w-3" />
        Done
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500">
      <span className="h-1.5 w-1.5 rounded-full bg-zinc-300" />
      Idle
    </span>
  );
}
