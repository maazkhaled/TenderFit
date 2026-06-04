import { NextResponse } from "next/server";
import { apiHandler, requireSession } from "@/lib/api";
import { triggerMatch } from "@/lib/services/worker-client";

/**
 * POST /api/v1/actions/match
 *
 * Manually re-run the match pipeline for every tenant. Returns immediately
 * with { status: "started" | "already_running" }. The actual work runs in
 * the worker container.
 */
export const POST = apiHandler(async () => {
  await requireSession();
  const result = await triggerMatch();
  return NextResponse.json(result, { status: result.status === "started" ? 202 : 200 });
});
