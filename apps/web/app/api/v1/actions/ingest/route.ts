import { NextResponse } from "next/server";
import { apiHandler, requireSession } from "@/lib/api";
import { triggerIngest } from "@/lib/services/worker-client";

/**
 * POST /api/v1/actions/ingest
 *
 * Manually trigger an ingest of every enabled source. Returns immediately
 * with { status: "started" | "already_running" }; the actual work runs in
 * the worker container. Use GET /api/v1/actions/status to poll progress.
 */
export const POST = apiHandler(async () => {
  await requireSession();
  const result = await triggerIngest();
  return NextResponse.json(result, { status: result.status === "started" ? 202 : 200 });
});
