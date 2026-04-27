import type { CapabilityProfile, NormalizedTender } from "@beta/shared";
import { voyageEmbed } from "./clients";

const TENDER_DESC_MAX = 6000;

function joinList(label: string, items: string[]): string {
  if (!items || items.length === 0) return `${label}: (none)`;
  return `${label}: ${items.join(", ")}`;
}

function flattenProfile(profile: CapabilityProfile): string {
  const projects =
    profile.pastProjects.length === 0
      ? "Past projects: (none)"
      : "Past projects:\n" +
        profile.pastProjects
          .map((p) => {
            const sector = p.sector ? ` (${p.sector})` : "";
            return `- ${p.title}${sector}: ${p.summary}`;
          })
          .join("\n");

  const geo =
    profile.geographies.length === 0
      ? "Geographies: global / unspecified"
      : `Geographies: ${profile.geographies.join(", ")}`;

  return [
    `Company: ${profile.companyName}`,
    `One-liner: ${profile.oneLiner}`,
    joinList("Services", profile.services),
    joinList("Tech stack", profile.techStack),
    joinList("Industries", profile.industries),
    joinList("Certifications", profile.certifications),
    joinList("Past clients", profile.pastClients),
    projects,
    geo,
    `Team size: ${profile.teamSize}`,
    `Budget range USD: ${profile.budgetRangeUsd.min}-${profile.budgetRangeUsd.max}`,
    joinList("Languages", profile.languages),
  ].join("\n");
}

function flattenTender(tender: NormalizedTender): string {
  const desc = (tender.description ?? "").slice(0, TENDER_DESC_MAX);
  const cpv = tender.cpvCodes.length
    ? `CPV: ${tender.cpvCodes.join(", ")}`
    : "CPV: (none)";
  return [
    `Title: ${tender.title}`,
    `Buyer: ${tender.buyer}`,
    `Sector: ${tender.sector ?? "(unspecified)"}`,
    `Country: ${tender.country ?? "(unspecified)"}`,
    `Description: ${desc}`,
    cpv,
  ].join("\n");
}

export async function embedCapabilityProfile(
  profile: CapabilityProfile,
): Promise<number[]> {
  const text = flattenProfile(profile);
  const [vec] = await voyageEmbed([text]);
  if (!vec) throw new Error("embedCapabilityProfile: empty response");
  return vec;
}

export async function embedTender(
  tender: NormalizedTender,
): Promise<number[]> {
  const text = flattenTender(tender);
  const [vec] = await voyageEmbed([text]);
  if (!vec) throw new Error("embedTender: empty response");
  return vec;
}
