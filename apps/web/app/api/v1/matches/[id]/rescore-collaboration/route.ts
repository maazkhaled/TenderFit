import { NextResponse } from "next/server";
import { scoreMatch } from "@beta/llm";
import { apiHandler, requireSession } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import {
  profileRowToCapability,
  tenderRowToNormalized,
} from "@/lib/services/llm-mapping";

/**
 * POST /api/v1/matches/[id]/rescore-collaboration
 *
 * Regenerates the collaborationSuggestion field for an existing match.
 * Used to backfill matches that were scored before the JV suggestion
 * feature landed — the LLM prompt didn't ask for a suggestion at score
 * time, so those rows have collaborationSuggestion = NULL even for
 * low-fit tenders that would benefit from a partner.
 *
 * We re-run the FULL scoreMatch (which also produces fitScore,
 * rationale, etc.) but ONLY persist the collaborationSuggestion into
 * the existing row. That keeps the user-visible scores stable — the
 * dashboard doesn't shift, no MatchResult.createdAt changes — while
 * populating the new field.
 *
 * Similarity used here comes from the persisted rationale's implied
 * cosine hint (we don't re-run retrieval since the match is already
 * created). If we ever need a purer signal we can grab the tender's
 * live embedding, but for the sole purpose of nudging the LLM into
 * producing the suggestion the exact similarity value doesn't matter.
 */
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

  // Pass the persisted fitScore as similarity hint (normalized to 0..1)
  // so the LLM is nudged toward re-producing something close to the
  // original assessment — we only need the collaborationSuggestion out
  // of this call. The rest is discarded.
  const similarity = Math.min(1, Math.max(0, match.fitScore / 100));
  const result = await scoreMatch(profile, tender, similarity);

  // Cast the update payload — the sandbox's Prisma client is stale
  // relative to the new schema.prisma. Production builds regenerate
  // the client during Docker build so the cast is only a build-time
  // convenience, not a runtime concern.
  await prisma.matchResult.update({
    where: { id: match.id },
    data: {
      collaborationSuggestion: (result.collaborationSuggestion ?? null) as any,
    } as any,
  });

  return NextResponse.json(
    { collaborationSuggestion: result.collaborationSuggestion ?? null },
    { status: 200 },
  );
});
