import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, parseJson, requireSession } from "@/lib/api";
import { triggerDigest } from "@/lib/services/worker-client";
import { prisma } from "@/lib/db";

const Body = z.object({
  /** Tenant slug to send the digest for. Falls back to the active session tenant. */
  tenantSlug: z.string().min(1).optional(),
});

/**
 * POST /api/v1/actions/digest
 *
 * Sends an immediate digest email for the active tenant (or a slug from the
 * request body if the caller wants to target a specific one). Returns
 * { status: "started" | "already_running" }.
 */
export const POST = apiHandler(async (req) => {
  const { tenantId } = await requireSession();
  const { tenantSlug } = await parseJson(req, Body).catch(() => ({ tenantSlug: undefined as string | undefined }));

  let slug = tenantSlug;
  if (!slug) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { slug: true },
    });
    if (!tenant) {
      return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
    }
    slug = tenant.slug;
  }

  const result = await triggerDigest(slug);
  return NextResponse.json(result, { status: result.status === "started" ? 202 : 200 });
});
