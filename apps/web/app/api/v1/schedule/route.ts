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
  // Normalise: only persist fields meaningful for the chosen cadence so the
  // DB doesn't carry stale per-mode state (e.g. a dayOfWeek left over from
  // an earlier weekly setting that the user switched to daily).
  const data = {
    frequency: input.frequency,
    intervalDays: input.frequency === "every_n_days" ? input.intervalDays : 2,
    hourLocal: input.hourLocal,
    hourLocalEnd: input.hourLocalEnd,
    dayOfWeek: input.frequency === "weekly" ? input.dayOfWeek : null,
    dayOfMonth: input.frequency === "monthly" ? input.dayOfMonth : null,
    timezone: input.timezone,
    enabled: input.enabled,
    minFitScore: input.minFitScore,
    // Deduplicate + lowercase emails before persist so "Foo@bar.com" and
    // "foo@bar.com" don't both end up in the array.
    recipients: Array.from(
      new Set(input.recipients.map((r) => r.trim().toLowerCase())),
    ).filter((r) => r.length > 0),
  };
  const schedule = await prisma.digestSchedule.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data,
  });
  return NextResponse.json({ schedule });
});
