import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api";
import { switchActiveTenant } from "@/lib/auth";

/** POST /api/v1/tenants/[id]/activate → switch which tenant the session points at. */
export const POST = apiHandler(async (_req, ctx: { params: { id: string } }) => {
  const { tenantId } = await switchActiveTenant(ctx.params.id);
  return NextResponse.json({ tenantId });
});
