// MUST be first — see worker/src/util/load-env.ts.
import "./util/load-env.js";

import { prisma } from "@beta/db";
import {
  buildDigestForTenant,
  renderDigestHtml,
  sendDigest,
} from "@beta/notifications";
import { isDueNow } from "./util/schedule.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface ParsedArgs {
  tenantSlug: string | null;
}

function parseArgs(argv: string[]): ParsedArgs {
  let tenantSlug: string | null = null;
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--tenant=")) {
      tenantSlug = arg.slice("--tenant=".length);
    } else if (arg === "--tenant") {
      tenantSlug = "";
    }
  }
  return { tenantSlug };
}

async function processTenant(tenantId: string): Promise<void> {
  const schedule = await prisma.digestSchedule.findUnique({
    where: { tenantId },
  });

  const since = schedule?.lastSentAt ?? new Date(Date.now() - SEVEN_DAYS_MS);

  const payload = await buildDigestForTenant(tenantId, since);
  if (!payload) {
    console.log(`[digest] tenant=${tenantId} no qualifying matches, skipping`);
    return;
  }

  const html = renderDigestHtml(payload);
  const result = await sendDigest(payload, html);
  const idSummary =
    result.messageIds.length > 0 ? ` ids=${result.messageIds.length}` : "";
  const errSummary =
    result.errors.length > 0 ? ` errors=${result.errors.length}` : "";
  console.log(
    `[digest] tenant=${tenantId} matches=${payload.matches.length} recipients=${result.recipients} delivered=${result.delivered} mode=${result.mode}${idSummary}${errSummary}`,
  );

  await prisma.digestSchedule.updateMany({
    where: { tenantId },
    data: { lastSentAt: new Date() },
  });
}

export async function runDigest(argv: string[] = process.argv): Promise<void> {
  const { tenantSlug } = parseArgs(argv);
  const now = new Date();

  if (tenantSlug) {
    const tenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true, slug: true },
    });
    if (!tenant) {
      console.error(`[digest] tenant slug not found: ${tenantSlug}`);
      return;
    }
    await processTenant(tenant.id);
    return;
  }

  const schedules = await prisma.digestSchedule.findMany({
    where: { enabled: true },
    include: { tenant: { select: { slug: true } } },
  });

  let due = 0;
  for (const s of schedules) {
    const dueNow = isDueNow(
      {
        frequency: s.frequency,
        intervalDays: s.intervalDays,
        hourLocal: s.hourLocal,
        hourLocalEnd: s.hourLocalEnd,
        dayOfWeek: s.dayOfWeek,
        dayOfMonth: s.dayOfMonth,
        timezone: s.timezone,
        enabled: s.enabled,
        lastSentAt: s.lastSentAt,
      },
      now,
    );
    if (!dueNow) continue;
    due += 1;
    await processTenant(s.tenantId);
  }
  console.log(`[digest] processed ${due} due tenant(s)`);
}

const isDirect = (() => {
  const arg = process.argv[1] ?? "";
  return arg.endsWith("digest-runner.ts") || arg.endsWith("digest-runner.js");
})();

if (isDirect) {
  runDigest()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error("[digest] fatal:", err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
