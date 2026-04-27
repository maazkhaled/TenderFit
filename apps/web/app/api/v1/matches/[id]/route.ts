import { NextResponse } from "next/server";
import { apiHandler, requireSession } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";
import { getMatchForTenant } from "@/lib/services/matches";

type Ctx = { params: { id: string } };

export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const { tenantId } = await requireSession();
  const match = await getMatchForTenant(tenantId, params.id);
  if (!match) throw new NotFoundError();
  return NextResponse.json({ match });
});
