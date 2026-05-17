/**
 * Recursive semantic chunker.
 *
 * Why this exists: tender descriptions on TED, SAM, and the World Bank
 * routinely run 5k–50k chars. Embedding only the first ~1k chars (the old
 * default in embed.ts) silently dropped most of the requirements, scope, and
 * staffing language that the matcher needs to see. A naive whole-document
 * embed is also lossy — averaging a 30k-char vector blurs the signal.
 *
 * The fix is the 2024-2026 best-practice pipeline: split long text into
 * overlapping chunks, embed each, aggregate. Aggregation here is mean-pool
 * weighted by chunk length, because:
 *   - the canonical Tender embedding column is `vector(1024)` — single vector
 *     per row, no schema break
 *   - mean-pool preserves "the average of what this tender is about"
 *   - precision is recovered downstream by the cross-encoder reranker, which
 *     re-scores the title+excerpt against the profile per candidate
 *
 * Future work flagged in retrieve.ts: store per-chunk vectors in a TenderChunk
 * table so dense retrieval can do max-similarity instead of mean-vector.
 *
 * The splitter is recursive (langchain-style): try the biggest natural
 * boundary first (\n\n), fall back to smaller ones (\n, ". ", " ", char). It's
 * deterministic and dependency-free — no tiktoken, no langchain.
 */

const DEFAULT_TARGET_CHARS = 1500;
const DEFAULT_OVERLAP_CHARS = 200;
const MIN_CHUNK_CHARS = 50; // anything smaller than this is treated as a "fragment" and merged forward

const SEPARATORS: readonly string[] = ["\n\n", "\n", ". ", " ", ""];

export interface ChunkOptions {
  /** Target character count per chunk. Default 1500 (~375 tokens). */
  targetChars?: number;
  /** Overlap between adjacent chunks. Default 200 chars. Set to 0 to disable. */
  overlapChars?: number;
}

export interface TextChunk {
  text: string;
  /** Char offset in the original string. Useful for highlighting / debugging. */
  start: number;
  /** Exclusive end offset. */
  end: number;
}

/**
 * Split `text` into chunks of roughly `targetChars` characters, with `overlapChars`
 * carried between adjacent chunks. Returns the original string as a single chunk
 * if it already fits.
 *
 * Empty / whitespace-only input returns []. This is deliberate — callers should
 * not embed empty strings.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): TextChunk[] {
  const target = Math.max(MIN_CHUNK_CHARS, opts.targetChars ?? DEFAULT_TARGET_CHARS);
  const overlap = Math.max(0, Math.min(target - 1, opts.overlapChars ?? DEFAULT_OVERLAP_CHARS));
  const normalized = text ?? "";
  if (normalized.trim().length === 0) return [];
  if (normalized.length <= target) {
    return [{ text: normalized, start: 0, end: normalized.length }];
  }

  // Recursive split into raw pieces that are each <= target chars.
  const pieces = recursiveSplit(normalized, target, 0);
  if (pieces.length === 0) return [];

  // Greedy pack pieces into chunks of roughly `target` chars, then add overlap
  // between adjacent chunks by carrying the tail of each into the next.
  const packed: TextChunk[] = [];
  let buffer: TextChunk | null = null;
  for (const piece of pieces) {
    if (buffer == null) {
      buffer = { ...piece };
      continue;
    }
    const wouldBe = buffer.end - buffer.start + (piece.end - piece.start);
    if (wouldBe <= target) {
      buffer = {
        text: normalized.slice(buffer.start, piece.end),
        start: buffer.start,
        end: piece.end,
      };
    } else {
      packed.push(buffer);
      buffer = { ...piece };
    }
  }
  if (buffer != null) packed.push(buffer);

  if (overlap === 0 || packed.length < 2) return packed;

  const withOverlap: TextChunk[] = [packed[0]!];
  for (let i = 1; i < packed.length; i++) {
    const prev = packed[i - 1]!;
    const cur = packed[i]!;
    const carryStart = Math.max(prev.start, prev.end - overlap);
    withOverlap.push({
      text: normalized.slice(carryStart, cur.end),
      start: carryStart,
      end: cur.end,
    });
  }
  return withOverlap;
}

/**
 * Length-weighted mean pooling over chunk vectors. Returns a single vector of
 * the same dimension. Throws on dimension mismatch — callers should never feed
 * vectors from different embedding models.
 *
 * Why length-weighted: a 1500-char chunk carries more signal than a 200-char
 * tail fragment. Equal weighting would let short fragments distort the mean.
 */
export function meanPool(vectors: number[][], weights: number[]): number[] {
  if (vectors.length === 0) throw new Error("meanPool: no vectors");
  if (vectors.length !== weights.length) {
    throw new Error(
      `meanPool: vectors.length (${vectors.length}) !== weights.length (${weights.length})`,
    );
  }
  const dim = vectors[0]!.length;
  if (dim === 0) throw new Error("meanPool: zero-dimension vector");
  for (const v of vectors) {
    if (v.length !== dim) {
      throw new Error(`meanPool: vector dim mismatch (${v.length} vs ${dim})`);
    }
  }
  let totalWeight = 0;
  for (const w of weights) {
    if (!Number.isFinite(w) || w < 0) {
      throw new Error(`meanPool: weight must be finite and >= 0 (got ${w})`);
    }
    totalWeight += w;
  }
  if (totalWeight === 0) {
    // Degenerate: all-zero weights. Fall back to uniform.
    const uniform = new Array<number>(vectors.length).fill(1);
    return meanPool(vectors, uniform);
  }
  const out = new Array<number>(dim).fill(0);
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i]!;
    const w = weights[i]!;
    for (let j = 0; j < dim; j++) {
      out[j] = (out[j] as number) + (v[j] as number) * w;
    }
  }
  for (let j = 0; j < dim; j++) {
    out[j] = (out[j] as number) / totalWeight;
  }
  return out;
}

// ---- internals --------------------------------------------------------------

function recursiveSplit(
  text: string,
  target: number,
  startOffset: number,
): TextChunk[] {
  if (text.length <= target) {
    return text.length === 0
      ? []
      : [{ text, start: startOffset, end: startOffset + text.length }];
  }

  for (const sep of SEPARATORS) {
    const parts = sep === "" ? splitFixed(text, target) : splitOnSeparator(text, sep);
    if (parts.length <= 1) continue;
    const out: TextChunk[] = [];
    let cursor = 0;
    for (const part of parts) {
      const absoluteStart = startOffset + cursor;
      if (part.length === 0) {
        cursor += sep.length;
        continue;
      }
      if (part.length <= target) {
        out.push({ text: part, start: absoluteStart, end: absoluteStart + part.length });
      } else {
        out.push(...recursiveSplit(part, target, absoluteStart));
      }
      cursor += part.length + sep.length;
    }
    return out;
  }

  // Should be unreachable — sep "" always splits to <= target pieces.
  return splitFixed(text, target).map((part, idx) => ({
    text: part,
    start: startOffset + idx * target,
    end: startOffset + idx * target + part.length,
  }));
}

function splitOnSeparator(text: string, sep: string): string[] {
  if (sep.length === 0) return [text];
  return text.split(sep);
}

function splitFixed(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}
