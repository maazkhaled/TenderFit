import { createHash } from "node:crypto";
import type { CapabilityProfile, NormalizedTender } from "@beta/shared";
import { getEmbeddingProvider } from "./providers";
import { readEmbeddingConfig } from "./providers/config";
import { embeddingCache } from "./util/embed-cache";

// mxbai-embed-large and most BGE/nomic-embed-text variants have a 512-token
// context (~2000 chars). Voyage and OpenAI go to 8K+. Override via env if you
// switch to a long-context model.
// Default 1000 chars (~250 tokens) — safe for any embedder including the
// 512-token mxbai/bge family. Bump to 6000+ for Voyage / OpenAI / nomic-v1.5.
const EMBED_INPUT_CHAR_CAP = Number.parseInt(
  process.env.EMBED_INPUT_CHAR_CAP ?? "1000",
  10,
);
const TENDER_DESC_MAX = Math.max(200, EMBED_INPUT_CHAR_CAP - 300); // leave room for title/buyer/sector lines

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

function capForEmbed(text: string): string {
  if (text.length <= EMBED_INPUT_CHAR_CAP) return text;
  return text.slice(0, EMBED_INPUT_CHAR_CAP);
}

async function embedSingle(text: string): Promise<number[]> {
  const provider = getEmbeddingProvider();
  const capped = capForEmbed(text);
  const cached = embeddingCache.get(provider.name, capped);
  if (cached) return cached;
  const [vec] = await provider.embed([capped]);
  if (!vec) throw new Error("embed: empty response");
  embeddingCache.set(provider.name, capped, vec);
  return vec;
}

export async function embedCapabilityProfile(
  profile: CapabilityProfile,
): Promise<number[]> {
  return embedSingle(flattenProfile(profile));
}

export async function embedTender(
  tender: NormalizedTender,
): Promise<number[]> {
  return embedSingle(flattenTender(tender));
}

// ---- Cache-key helpers (used by the worker to decide skip vs re-embed) ----

/** "<provider>:<model>" — stamped onto rows so a provider/model swap invalidates. */
export function activeEmbeddingModelStamp(): string {
  const cfg = readEmbeddingConfig();
  return `${cfg.provider}:${cfg.model}`;
}

function hashFor(text: string): string {
  return createHash("sha256")
    .update(`${activeEmbeddingModelStamp()}|${capForEmbed(text)}`)
    .digest("hex");
}

export function embeddingHashForProfile(profile: CapabilityProfile): string {
  return hashFor(flattenProfile(profile));
}

export function embeddingHashForTender(tender: NormalizedTender): string {
  return hashFor(flattenTender(tender));
}
