import { NextResponse } from "next/server";
import { CapabilityProfileSchema } from "@beta/shared";
import { apiHandler, parseJson } from "@/lib/api";
import { signInAsTenant } from "@/lib/auth";
import { upsertProfileForTenant } from "@/lib/services/profile";

export const POST = apiHandler(async (req) => {
  const input = await parseJson(req, CapabilityProfileSchema);
  const { tenantId, slug } = await signInAsTenant(input.companyName, input.companyName);
  await upsertProfileForTenant(tenantId, input);
  return NextResponse.json({ tenantId, slug }, { status: 201 });
});
