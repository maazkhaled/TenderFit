import type { CapabilityProfile, NormalizedTender } from "@beta/shared";

const TENDER_DESC_MAX = 6000;

function bullets(items: string[]): string {
  if (!items || items.length === 0) return "  (none)";
  return items.map((s) => `  - ${s}`).join("\n");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "… [truncated]";
}

export function renderProfileForLLM(profile: CapabilityProfile): string {
  const projects =
    profile.pastProjects.length === 0
      ? "  (none)"
      : profile.pastProjects
          .map((p) => {
            const meta: string[] = [];
            if (p.sector) meta.push(`sector=${p.sector}`);
            if (typeof p.valueUsd === "number") meta.push(`valueUsd=${p.valueUsd}`);
            const metaStr = meta.length ? ` [${meta.join(", ")}]` : "";
            return `  - ${p.title}${metaStr}: ${p.summary}`;
          })
          .join("\n");

  const geo =
    profile.geographies.length === 0
      ? "  (global / unspecified)"
      : bullets(profile.geographies);

  return [
    `# Company Profile`,
    `Company: ${profile.companyName}`,
    `One-liner: ${profile.oneLiner}`,
    `Team size: ${profile.teamSize}`,
    `Budget range (USD): ${profile.budgetRangeUsd.min} - ${profile.budgetRangeUsd.max}`,
    `Languages: ${profile.languages.join(", ") || "(unspecified)"}`,
    ``,
    `Industries:`,
    bullets(profile.industries),
    ``,
    `Services:`,
    bullets(profile.services),
    ``,
    `Tech stack:`,
    bullets(profile.techStack),
    ``,
    `Certifications:`,
    bullets(profile.certifications),
    ``,
    `Past clients:`,
    bullets(profile.pastClients),
    ``,
    `Past projects:`,
    projects,
    ``,
    `Geographies:`,
    geo,
  ].join("\n");
}

export function renderTenderForLLM(tender: NormalizedTender): string {
  const budget =
    tender.budgetMinUsd == null && tender.budgetMaxUsd == null
      ? "(unspecified)"
      : `${tender.budgetMinUsd ?? "?"} - ${tender.budgetMaxUsd ?? "?"} USD`;

  return [
    `# Tender`,
    `Title: ${tender.title}`,
    `Source: ${tender.source}`,
    `Buyer: ${tender.buyer}`,
    `Country: ${tender.country ?? "(unspecified)"}`,
    `Sector: ${tender.sector ?? "(unspecified)"}`,
    `CPV codes: ${tender.cpvCodes.length ? tender.cpvCodes.join(", ") : "(none)"}`,
    `Budget: ${budget}`,
    `Currency: ${tender.currency ?? "(unspecified)"}`,
    `Language: ${tender.language}`,
    `Published: ${tender.publishedAt.toISOString()}`,
    `Deadline: ${tender.deadlineAt ? tender.deadlineAt.toISOString() : "(none)"}`,
    `URL: ${tender.url}`,
    ``,
    `Description:`,
    truncate(tender.description ?? "", TENDER_DESC_MAX),
  ].join("\n");
}
