import { Prisma } from "@prisma/client";
import { EMBEDDING_DIM as SHARED_EMBEDDING_DIM } from "@beta/shared";
import { prisma } from "./index";

export const EMBEDDING_DIM = SHARED_EMBEDDING_DIM;

export type EmbeddingTable = "Tender" | "CapabilityProfile";

function toVectorLiteral(values: number[]): string {
  if (values.length !== EMBEDDING_DIM) {
    throw new Error(
      `Embedding length ${values.length} does not match expected ${EMBEDDING_DIM}. ` +
        `Either set EMBEDDING_DIM=${values.length} (and re-run \`pnpm db:vector-sql\` + apply the migration), ` +
        `or pick an EMBEDDING_MODEL whose native dim is ${EMBEDDING_DIM}.`,
    );
  }
  return `[${values.join(",")}]`;
}

export interface WriteEmbeddingMeta {
  hash: string;
  model: string;
}

export async function writeEmbedding(
  table: EmbeddingTable,
  id: string,
  values: number[],
  meta?: WriteEmbeddingMeta,
): Promise<void> {
  const literal = toVectorLiteral(values);
  const sql = meta
    ? Prisma.sql`UPDATE ${Prisma.raw(`"${table}"`)}
        SET embedding = ${literal}::vector,
            "embeddingStatus" = 'ready',
            "embeddingHash"  = ${meta.hash},
            "embeddingModel" = ${meta.model}
        WHERE id = ${id}`
    : Prisma.sql`UPDATE ${Prisma.raw(`"${table}"`)}
        SET embedding = ${literal}::vector,
            "embeddingStatus" = 'ready'
        WHERE id = ${id}`;
  await prisma.$executeRaw(sql);
}

export async function readEmbeddingMeta(
  table: EmbeddingTable,
  id: string,
): Promise<{ hash: string | null; model: string | null } | null> {
  const rows = await prisma.$queryRaw<
    Array<{ embeddingHash: string | null; embeddingModel: string | null }>
  >(
    Prisma.sql`SELECT "embeddingHash", "embeddingModel"
      FROM ${Prisma.raw(`"${table}"`)}
      WHERE id = ${id}
      LIMIT 1`,
  );
  const r = rows[0];
  if (!r) return null;
  return { hash: r.embeddingHash, model: r.embeddingModel };
}

export async function markEmbeddingFailed(
  table: EmbeddingTable,
  id: string,
): Promise<void> {
  const sql = Prisma.sql`UPDATE ${Prisma.raw(`"${table}"`)}
    SET "embeddingStatus" = 'failed'
    WHERE id = ${id}`;
  await prisma.$executeRaw(sql);
}

export async function findNearestTenders(
  capabilityProfileId: string,
  limit: number,
): Promise<{ id: string; distance: number }[]> {
  const rows = await prisma.$queryRaw<{ id: string; distance: number }[]>(
    Prisma.sql`SELECT t.id AS id,
        (t.embedding <=> p.embedding) AS distance
      FROM "Tender" t,
           "CapabilityProfile" p
      WHERE p.id = ${capabilityProfileId}
        AND t.embedding IS NOT NULL
        AND p.embedding IS NOT NULL
      ORDER BY t.embedding <=> p.embedding ASC
      LIMIT ${limit}`,
  );
  return rows;
}
