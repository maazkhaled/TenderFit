import type { CapabilityProfileInput } from "@beta/shared";
import { prisma } from "../db";

export async function getProfileForTenant(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { profile: true },
  });
  if (!tenant) return null;
  return { tenant, profile: tenant.profile };
}

export async function upsertProfileForTenant(
  tenantId: string,
  input: CapabilityProfileInput,
) {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { companyName: input.companyName },
  });

  const data = {
    oneLiner: input.oneLiner,
    industries: input.industries,
    techStack: input.techStack,
    services: input.services,
    certifications: input.certifications,
    pastClients: input.pastClients,
    pastProjects: input.pastProjects,
    geographies: input.geographies,
    teamSize: input.teamSize,
    budgetMinUsd: input.budgetRangeUsd.min,
    budgetMaxUsd: input.budgetRangeUsd.max,
    languages: input.languages,
    embeddingStatus: "pending" as const,
  };

  return prisma.capabilityProfile.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data,
  });
}
