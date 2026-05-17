import { createHash } from "node:crypto";
import type { CapabilityProfile, NormalizedTender } from "@beta/shared";
import { getEmbeddingProvider } from "./providers";
import { readEmbeddingConfig } from "./providers/config";
import { embeddingCache } from "./util/embed-cache";
import { chunkText, meanPool } from "./util/chunk";

// The embedder's *single-input* cap (per text). Voyage / OpenAI handle 8K+
// tokens; mxbai/bge variants cap at 512. We cap input text at this many chars
// before sending. Default 6000 chars (~1500 tokens) — comfortable for Voyage,
// trims for short-context local models. Override per-deployment.
const EMBED_INPUT_CHAR_CAP = Number.parseInt(
  process.env.EMBED_INPUT_CHAR_CAP ?? "6000",
  10,
);

// Long-text chunking thresholds. If a tender description plus header exceeds
// LONG_TEXT_THRESHOLD, we split into chunks and mean-pool the resulting vectors
// so signal from the latter pages isn't lost.
const LONG_TEXT_THRESHOLD = Number.parseInt(
  process.env.EMBED_LONG_TEXT_THRESHOLD ?? String(EMBED_INPUT_CHAR_CAP),
  10,
);
const CHUNK_TARGET_CHARS = Number.parseInt(
  process.env.EMBED_CHUNK_TARGET_CHARS ?? "1500",
  10,
);
const CHUNK_OVERLAP_CHARS = Number.parseInt(
  process.env.EMBED_CHUNK_OVERLAP_CHARS ?? "200",
  10,
);
const CHUNK_MAX_BATCH = Number.parseInt(
  process.env.EMBED_CHUNK_MAX_BATCH ?? "16",
  10,
);

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

/**
 * Tender header — fields that are nearly always short. Embedded inline with
 * each chunk so the chunk vector retains identity context (title/buyer/sector)
 * even when the chunk is from the middle of a long description.
 */
function tenderHeader(tender: NormalizedTender): string {
  const cpv = tender.cpvCodes.length
    ? `CPV: ${tender.cpvCodes.join(", ")}`
    : "CPV: (none)";
  return [
    `Title: ${tender.title}`,
    `Buyer: ${tender.buyer}`,
    `Sector: ${tender.sector ?? "(unspecified)"}`,
    `Country: ${tender.country ?? "(unspecified)"}`,
    cpv,
  ].join("\n");
}

function flattenTenderShort(tender: NormalizedTender): string {
  const header = tenderHeader(tender);
  const room = Math.max(200, EMBED_INPUT_CHAR_CAP - header.length - 16);
  const desc = (tender.description ?? "").slice(0, room);
  return `${header}\nDescription: ${desc}`;
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

/**
 * Batched embedding with chunk-level cache lookup. Only chunks not in the cache
 * are sent to the provider.
 */
async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const provider = getEmbeddingProvider();
  const capped = texts.map(capForEmbed);
  const out: (number[] | null)[] = capped.map((t) =>
    embeddingCache.get(provider.name, t),
  );
  const missingIdx: number[] = [];
  const missing: string[] = [];
  for (let i = 0; i < capped.length; i++) {
    if (out[i] == null) {
      missingIdx.push(i);
      missing.push(capped[i]!);
    }
  }
  if (missing.length === 0) return out as number[][];
  // Honour CHUNK_MAX_BATCH so we don't blow past provider request size limits.
  for (let start = 0; start < missing.length; start += CHUNK_MAX_BATCH) {
    const slice = missing.slice(start, start + CHUNK_MAX_BATCH);
    const vectors = await provider.embed(slice);
    if (vectors.length !== slice.length) {
      throw new Error(
        `embedBatch: provider returned ${vectors.length} vectors for ${slice.length} inputs`,
      );
    }
    for (let j = 0; j < slice.length; j++) {
      const text = slice[j]!;
      const vec = vectors[j]!;
      embeddingCache.set(provider.name, text, vec);
      out[missingIdx[start + j]!] = vec;
    }
  }
  return out.map((v, i) => {
    if (v == null) throw new Error(`embedBatch: missing vector at index ${i}`);
    return v;
  });
}

export async function embedCapabilityProfile(
  profile: CapabilityProfile,
): Promise<number[]> {
  return embedSingle(flattenProfile(profile));
}

/**
 * Tender embedding. Short tenders are embedded as a single vector. Long
 * tenders (description longer than LONG_TEXT_THRESHOLD) are chunked, each
 * chunk is embedded with the tender header prepended, and the resulting
 * vectors are length-weighted mean-pooled. The output dimension is identical
 * to the single-shot case, so the pgvector column doesn't change.
 */
export async function embedTender(
  tender: NormalizedTender,
): Promise<number[]> {
  const fullText = flattenTenderShort(tender);
  const desc = tender.description ?? "";
  if (desc.length <= LONG_TEXT_THRESHOLD) {
    return embedSingle(fullText);
  }
  const header = tenderHeader(tender);
  // Chunk only the description; prepend header to each chunk so embeddings
  // share the title/buyer/sector identity signal.
  const chunks = chunkText(desc, {
    targetChars: CHUNK_TARGET_CHARS,
    overlapChars: CHUNK_OVERLAP_CHARS,
  });
  if (chunks.length === 0) {
    // No useful description text — fall back to short-form embedding.
    return embedSingle(fullText);
  }
  const inputs = chunks.map(
    (c) => `${header}\nDescription (chunk): ${c.text}`,
  );
  const vectors = await embedBatch(inputs);
  const weights = chunks.map((c) => c.text.length);
  return meanPool(vectors, weights);
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

/**
 * Hash for cache invalidation. Includes the full normalized description so
 * that any edit to the long-form text re-triggers a chunk re-embed.
 */
export function embeddingHashForTender(tender: NormalizedTender): string {
  const header = tenderHeader(tender);
  return createHash("sha256")
    .update(
      `${activeEmbeddingModelStamp()}|${header}|${tender.description ?? ""}`,
    )
    .digest("hex");
}

export const __test__ = {
  flattenProfile,
  flattenTenderShort,
  tenderHeader,
  LONG_TEXT_THRESHOLD,
  EMBED_INPUT_CHAR_CAP,
};
