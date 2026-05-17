import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, requireSession } from "@/lib/api";
import { listMatchesForTenant } from "@/lib/services/matches";
import { TenderSourceSchema } from "@beta/shared";

/**
 * `status` controls which slice of matches the dashboard / archive page sees.
 * Default is "active" so any UI that forgets to set it gets a deadline-safe
 * answer — no expired tenders sneaking onto the live dashboard.
 */
const StatusSchema = z.enum(["active", "archived", "all"]).default("active");

const QuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  minScore: z.coerce.number().int().min(0).max(100).default(0),
  sourceFilter: z.coerce.boolean().default(false),
  sources: z.array(TenderSourceSchema).default([]),
  status: StatusSchema,
});

function readSources(url: URL) {
  return url.searchParams
    .getAll("sources")
    .flatMap((value) => value.split(","))
    .map((source) => source.trim())
    .filter(Boolean);
}

export const GET = apiHandler(async (req) => {
  const { tenantId } = await requireSession();
  const url = new URL(req.url);
  const parsed = QuerySchema.parse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    minScore: url.searchParams.get("minScore") ?? undefined,
    sourceFilter: url.searchParams.get("sourceFilter") ?? undefined,
    sources: readSources(url),
    status: url.searchParams.get("status") ?? undefined,
  });
  const matches = await listMatchesForTenant({ tenantId, ...parsed });
  return NextResponse.json({ matches });
});
