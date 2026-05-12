import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api";
import { deleteOwnedTenant } from "@/lib/auth";

/** DELETE /api/v1/tenants/[id] → permanently delete a tenant + its profile + matches. */
export const DELETE = apiHandler(async (_req, ctx: { params: { id: string } }) => {
  await deleteOwnedTenant(ctx.params.id);
  return NextResponse.json({ ok: true });
});
