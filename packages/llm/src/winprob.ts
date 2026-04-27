import type {
  CapabilityProfile,
  NormalizedTender,
  WinProbability,
} from "@beta/shared";

export interface WinProbabilityEstimate {
  winProbability: WinProbability;
  reason: string;
}

export interface SimilarHistoricalWin {
  sector?: string | null;
  country?: string | null;
  buyer?: string | null;
  valueUsd?: number | null;
}

export function estimateWinProbability(
  profile: CapabilityProfile,
  tender: NormalizedTender,
  similarHistoricalWins: SimilarHistoricalWin[] = [],
): WinProbabilityEstimate {
  let score = 0;
  const factors: string[] = [];

  const profileGeos = new Set(
    profile.geographies.map((g) => g.toUpperCase()),
  );
  const isGlobal = profileGeos.size === 0;
  const tenderCountry = tender.country?.toUpperCase() ?? null;

  if (isGlobal) {
    score += 1;
    factors.push("company operates globally");
  } else if (tenderCountry && profileGeos.has(tenderCountry)) {
    score += 2;
    factors.push(`geography match (${tenderCountry})`);
  } else if (tenderCountry) {
    score -= 2;
    factors.push(`geography mismatch (tender ${tenderCountry} vs ${[...profileGeos].join("/")})`);
  }

  const tMin = tender.budgetMinUsd;
  const tMax = tender.budgetMaxUsd;
  const cMin = profile.budgetRangeUsd.min;
  const cMax = profile.budgetRangeUsd.max;
  const tenderMid =
    tMin != null && tMax != null
      ? (tMin + tMax) / 2
      : tMax ?? tMin ?? null;

  if (tenderMid == null) {
    factors.push("tender budget unspecified");
  } else if (cMax === 0 && cMin === 0) {
    factors.push("company budget range unspecified");
  } else if (tenderMid >= cMin && tenderMid <= cMax) {
    score += 2;
    factors.push("tender budget within company range");
  } else if (tenderMid < cMin) {
    score -= 1;
    factors.push("tender below company minimum");
  } else {
    score -= 2;
    factors.push("tender exceeds company budget ceiling");
  }

  if (
    profile.teamSize > 0 &&
    profile.teamSize < 5 &&
    tenderMid != null &&
    tenderMid > 1_000_000
  ) {
    score -= 3;
    factors.push("team < 5 vs tender > $1M (capacity risk)");
  } else if (profile.teamSize >= 20 && tenderMid != null && tenderMid > 1_000_000) {
    score += 1;
    factors.push("sufficient team size for large tender");
  }

  const tenderSector = (tender.sector ?? "").toLowerCase().trim();
  const profileIndustries = profile.industries.map((s) => s.toLowerCase().trim());
  if (tenderSector && profileIndustries.some((i) => i && (i.includes(tenderSector) || tenderSector.includes(i)))) {
    score += 2;
    factors.push(`sector overlap (${tender.sector})`);
  } else if (tenderSector) {
    factors.push(`no direct sector match for "${tender.sector}"`);
  }

  const projectSectors = profile.pastProjects
    .map((p) => (p.sector ?? "").toLowerCase().trim())
    .filter(Boolean);
  if (
    tenderSector &&
    projectSectors.some(
      (s) => s.includes(tenderSector) || tenderSector.includes(s),
    )
  ) {
    score += 2;
    factors.push("relevant past project in same sector");
  }

  if (similarHistoricalWins.length > 0) {
    const wonInCountry = tenderCountry
      ? similarHistoricalWins.some(
          (w) => (w.country ?? "").toUpperCase() === tenderCountry,
        )
      : false;
    const wonInSector = tenderSector
      ? similarHistoricalWins.some((w) =>
          (w.sector ?? "").toLowerCase().includes(tenderSector),
        )
      : false;
    if (wonInCountry) {
      score += 2;
      factors.push("prior win in same country");
    }
    if (wonInSector) {
      score += 2;
      factors.push("prior win in same sector");
    }
    if (!wonInCountry && !wonInSector) {
      factors.push(
        `${similarHistoricalWins.length} historical wins, none directly comparable`,
      );
    }
  }

  let winProbability: WinProbability;
  if (score >= 5) winProbability = "high";
  else if (score >= 1) winProbability = "medium";
  else winProbability = "low";

  const reason =
    factors.length > 0
      ? `${winProbability.toUpperCase()} (score=${score}): ${factors.join("; ")}`
      : `${winProbability.toUpperCase()} (score=${score}): insufficient signals`;

  return { winProbability, reason };
}
