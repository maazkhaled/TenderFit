import { redirect } from "next/navigation";
import type { CapabilityProfileInput } from "@beta/shared";
import { getOrInitUserEmail, listOwnedTenants } from "@/lib/auth";
import { getProfileForTenant } from "@/lib/services/profile";
import { ProfileEditor } from "./ProfileEditor";

export const dynamic = "force-dynamic";

interface DbProfile {
  oneLiner: string;
  industries: string[];
  techStack: string[];
  services: string[];
  certifications: string[];
  pastClients: string[];
  pastProjects: unknown;
  geographies: string[];
  teamSize: number;
  budgetMinUsd: number;
  budgetMaxUsd: number;
  languages: string[];
}

function dbToFormProfile(
  companyName: string,
  profile: DbProfile | null,
): Partial<CapabilityProfileInput> {
  if (!profile) return { companyName };
  return {
    companyName,
    oneLiner: profile.oneLiner,
    industries: profile.industries,
    techStack: profile.techStack,
    services: profile.services,
    certifications: profile.certifications,
    pastClients: profile.pastClients,
    pastProjects: Array.isArray(profile.pastProjects)
      ? (profile.pastProjects as CapabilityProfileInput["pastProjects"])
      : [],
    geographies: profile.geographies,
    teamSize: profile.teamSize,
    budgetRangeUsd: { min: profile.budgetMinUsd, max: profile.budgetMaxUsd },
    languages: profile.languages?.length ? profile.languages : ["en"],
  };
}

export default async function ProfilePage() {
  // First visit primes the cookie email.
  await getOrInitUserEmail();
  const tenants = await listOwnedTenants();

  // Brand-new user (no tenants yet): bounce them to the onboard form which
  // creates the first tenant. The legacy /onboard route is kept for that path.
  if (tenants.length === 0) {
    redirect("/onboard");
  }

  const active = tenants.find((t) => t.isActive) ?? tenants[0]!;
  const data = await getProfileForTenant(active.id);
  const initial = dbToFormProfile(active.companyName, data?.profile ?? null);

  return (
    <ProfileEditor
      tenants={tenants}
      activeTenantId={active.id}
      hasExistingProfile={Boolean(data?.profile)}
      initial={initial}
    />
  );
}
