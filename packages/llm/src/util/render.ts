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

  const parts = [
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
  ];

  // When ignoreLocation is on, omit the Geographies section *and* tell the
  // model explicitly not to weigh location. Telling it is important: with
  // the section silently missing, the LLM may still surface "no country
  // information available" as a gap. An explicit instruction defuses that.
  if (profile.ignoreLocation) {
    parts.push(
      ``,
      `Geography policy:`,
      `  This company has opted in to international collaboration / joint`,
      `  ventures. IGNORE country / geography mismatch when scoring fit,`,
      `  listing gaps, or assessing win probability. Do not flag "company`,
      `  not located in tender country" as a gap.`,
    );
  } else {
    parts.push(``, `Geographies:`, geo);
  }

  return parts.join("\n");
}

export interface RenderTenderOptions {
  /** When true, the tender's Country line is omitted to match an ignoreLocation profile. */
  ignoreLocation?: boolean;
}

export function renderTenderForLLM(
  tender: NormalizedTender,
  options: RenderTenderOptions = {},
): string {
  const budget =
    tender.budgetMinUsd == null && tender.budgetMaxUsd == null
      ? "(unspecified)"
      : `${tender.budgetMinUsd ?? "?"} - ${tender.budgetMaxUsd ?? "?"} USD`;

  const lines: string[] = [
    `# Tender`,
    `Title: ${tender.title}`,
    `Source: ${tender.source}`,
    `Buyer: ${tender.buyer}`,
  ];
  if (!options.ignoreLocation) {
    lines.push(`Country: ${tender.country ?? "(unspecified)"}`);
  }
  lines.push(
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
  );
  return lines.join("\n");
}
