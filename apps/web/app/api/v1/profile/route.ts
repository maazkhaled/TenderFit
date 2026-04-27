import { NextResponse } from "next/server";
import { CapabilityProfileSchema } from "@beta/shared";
import { apiHandler, parseJson, requireSession } from "@/lib/api";
import {
  getProfileForTenant,
  upsertProfileForTenant,
} from "@/lib/services/profile";

export const GET = apiHandler(async () => {
  const { tenantId } = await requireSession();
  const data = await getProfileForTenant(tenantId);
  if (!data) return NextResponse.json({ profile: null });
  return NextResponse.json({
    companyName: data.tenant.companyName,
    profile: data.profile,
  });
});

export const PUT = apiHandler(async (req) => {
  const { tenantId } = await requireSession();
  const input = await parseJson(req, CapabilityProfileSchema);
  const profile = await upsertProfileForTenant(tenantId, input);
  return NextResponse.json({ profile });
});
