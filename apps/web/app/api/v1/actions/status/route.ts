import { NextResponse } from "next/server";
import { apiHandler, requireSession } from "@/lib/api";
import { getStatus } from "@/lib/services/worker-client";

/**
 * GET /api/v1/actions/status
 *
 * Returns the running/finished/error state of every job tracked by the
 * worker's HTTP server. Used by the dashboard's ActionsPanel to poll
 * progress while a button-triggered job is in flight.
 */
export const GET = apiHandler(async () => {
  await requireSession();
  const status = await getStatus();
  return NextResponse.json(status);
});
