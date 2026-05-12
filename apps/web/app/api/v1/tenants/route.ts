import { NextResponse } from "next/server";
import { z } from "zod";
import { CapabilityProfileSchema } from "@beta/shared";
import { apiHandler, parseJson } from "@/lib/api";
import {
  createTenantForEmail,
  getOrInitUserEmail,
  listOwnedTenants,
} from "@/lib/auth";
import { upsertProfileForTenant } from "@/lib/services/profile";

/** GET /api/v1/tenants → list tenants owned by current session email. */
export const GET = apiHandler(async () => {
  // Initialise the cookie's userEmail if absent — first visit goes here.
  await getOrInitUserEmail();
  const tenants = await listOwnedTenants();
  return NextResponse.json({ tenants });
});

const CreateBodySchema = z.union([
  // Full profile path — same shape the onboard form posts.
  CapabilityProfileSchema,
  // Empty-tenant path — just a company name; profile is filled later.
  z.object({ companyName: z.string().min(1) }),
]);

/** POST /api/v1/tenants → create a new tenant (optionally with profile) under current email. */
export const POST = apiHandler(async (req) => {
  const input = await parseJson(req, CreateBodySchema);
  const email = await getOrInitUserEmail();
  const { tenantId, slug } = await createTenantForEmail(email, input.companyName);

  // If the caller sent a full profile, save it immediately so the match
  // worker can score on the next tick.
  if ("oneLiner" in input) {
    await upsertProfileForTenant(tenantId, input);
  }
  return NextResponse.json({ tenantId, slug }, { status: 201 });
});
