import { NextResponse } from "next/server";
import { DigestScheduleInputSchema } from "@beta/shared";
import { apiHandler, parseJson, requireSession } from "@/lib/api";
import { prisma } from "@/lib/db";

export const GET = apiHandler(async () => {
  const { tenantId } = await requireSession();
  const schedule = await prisma.digestSchedule.findUnique({ where: { tenantId } });
  return NextResponse.json({ schedule });
});

export const PUT = apiHandler(async (req) => {
  const { tenantId } = await requireSession();
  const input = await parseJson(req, DigestScheduleInputSchema);
  const data = {
    frequency: input.frequency,
    hourLocal: input.hourLocal,
    dayOfWeek: input.dayOfWeek,
    timezone: input.timezone,
    enabled: input.enabled,
    minFitScore: input.minFitScore,
  };
  const schedule = await prisma.digestSchedule.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data,
  });
  return NextResponse.json({ schedule });
});
