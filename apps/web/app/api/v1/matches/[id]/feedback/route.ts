import { NextResponse } from "next/server";
import { FeedbackInputSchema } from "@beta/shared";
import { apiHandler, parseJson, requireSession } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";

type Ctx = { params: { id: string } };

export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const { tenantId } = await requireSession();
  const input = await parseJson(req, FeedbackInputSchema);

  const match = await prisma.matchResult.findFirst({
    where: { id: params.id, tenantId },
    select: { id: true },
  });
  if (!match) throw new NotFoundError();

  const feedback = await prisma.matchFeedback.upsert({
    where: { matchId: match.id },
    create: {
      matchId: match.id,
      tenantId,
      interested: input.interested,
      note: input.note,
    },
    update: {
      interested: input.interested,
      note: input.note,
    },
  });

  return NextResponse.json({ feedback });
});
