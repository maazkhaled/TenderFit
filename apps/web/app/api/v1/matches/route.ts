import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, requireSession } from "@/lib/api";
import { listMatchesForTenant } from "@/lib/services/matches";

const QuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  minScore: z.coerce.number().int().min(0).max(100).default(0),
});

export const GET = apiHandler(async (req) => {
  const { tenantId } = await requireSession();
  const url = new URL(req.url);
  const parsed = QuerySchema.parse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    minScore: url.searchParams.get("minScore") ?? undefined,
  });
  const matches = await listMatchesForTenant({ tenantId, ...parsed });
  return NextResponse.json({ matches });
});
