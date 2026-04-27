import { NextResponse } from "next/server";
import { generateCapabilityStatement } from "@beta/llm";
import { apiHandler, requireSession } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import {
  profileRowToCapability,
  tenderRowToNormalized,
} from "@/lib/services/llm-mapping";

type Ctx = { params: { id: string } };

export const POST = apiHandler<Ctx>(async (_req, { params }) => {
  const { tenantId } = await requireSession();

  const match = await prisma.matchResult.findFirst({
    where: { id: params.id, tenantId },
    include: {
      tender: true,
      tenant: {
        select: {
          companyName: true,
          profile: true,
        },
      },
    },
  });
  if (!match || !match.tenant?.profile) throw new NotFoundError();

  const profile = profileRowToCapability(
    match.tenant.profile,
    match.tenant.companyName,
  );
  const tender = tenderRowToNormalized(match.tender);

  const statement = await generateCapabilityStatement(profile, tender, {
    fitScore: match.fitScore,
    rationale: match.rationale,
    gaps: Array.isArray(match.gaps) ? (match.gaps as any) : [],
    winProbability: match.winProbability,
    winProbabilityReason: match.winProbabilityReason,
    modelVersion: match.modelVersion,
  });

  await prisma.matchResult.update({
    where: { id: match.id },
    data: { capabilityStatement: statement },
  });

  return NextResponse.json({ capabilityStatement: statement }, { status: 200 });
});
