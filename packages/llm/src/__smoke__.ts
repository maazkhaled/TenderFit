/**
 * Tiny smoke test that exercises scoreMatch end-to-end with the configured
 * provider. Run via:
 *   pnpm --filter @beta/llm exec tsx src/__smoke__.ts
 */

import { scoreMatch } from "./score";
import { generateCapabilityStatement } from "./capability-statement";
import type { CapabilityProfile, NormalizedTender } from "@beta/shared";

const profile: CapabilityProfile = {
  companyName: "Acme Cloud Co",
  oneLiner: "AWS-native custom software dev shop in Karachi, 18 engineers.",
  industries: ["fintech", "logistics"],
  techStack: ["TypeScript", "AWS", "Postgres", "React", "Terraform"],
  services: ["custom software dev", "cloud migration", "DevOps"],
  certifications: ["ISO 27001"],
  pastClients: ["Bank Alfalah", "TPL Trakker"],
  pastProjects: [
    {
      title: "Mobile banking revamp",
      summary: "Re-architected a tier-1 mobile banking app on AWS.",
      sector: "fintech",
      valueUsd: 750_000,
    },
  ],
  geographies: ["PK", "AE"],
  teamSize: 18,
  budgetRangeUsd: { min: 100_000, max: 1_500_000 },
  languages: ["en", "ur"],
  ignoreLocation: false,
};

const tender: NormalizedTender = {
  externalId: "smoke-1",
  source: "ppra_pk",
  title: "Cloud-native banking core modernisation",
  description:
    "We are seeking a vendor with proven experience modernising mobile banking on AWS, with ISO 27001 certification, prior delivery to a tier-1 Pakistani bank, and a team of at least 15 engineers based in Pakistan.",
  url: "https://example.gov.pk/tenders/smoke-1",
  buyer: "State Bank of Examplistan",
  country: "PK",
  sector: "fintech",
  cpvCodes: [],
  budgetMinUsd: 400_000,
  budgetMaxUsd: 1_200_000,
  currency: "USD",
  publishedAt: new Date(),
  deadlineAt: new Date(Date.now() + 30 * 24 * 3600_000),
  language: "en",
  raw: {},
};

async function main() {
  console.log("=== smoke: scoreMatch ===");
  const t0 = Date.now();
  const match = await scoreMatch(profile, tender, 0.71);
  console.log(`took ${(Date.now() - t0) / 1000}s`);
  console.log(JSON.stringify(match, null, 2));

  console.log("\n=== smoke: generateCapabilityStatement ===");
  const t1 = Date.now();
  const cs = await generateCapabilityStatement(profile, tender, match);
  console.log(`took ${(Date.now() - t1) / 1000}s`);
  console.log(cs);
}

main().catch((err) => {
  console.error("smoke: FAIL", err);
  process.exit(1);
});
