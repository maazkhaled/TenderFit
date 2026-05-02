import { Prisma } from "@prisma/client";
import { EMBEDDING_DIM as SHARED_EMBEDDING_DIM } from "@beta/shared";
import { prisma } from "./index";

export const EMBEDDING_DIM = SHARED_EMBEDDING_DIM;

export type EmbeddingTable = "Tender" | "CapabilityProfile";

function toVectorLiteral(values: number[]): string {
  if (values.length !== EMBEDDING_DIM) {
    throw new Error(
      `Embedding length ${values.length} does not match expected ${EMBEDDING_DIM}`,
    );
  }
  return `[${values.join(",")}]`;
}

export async function writeEmbedding(
  table: EmbeddingTable,
  id: string,
  values: number[],
): Promise<void> {
  const literal = toVectorLiteral(values);
  const sql = Prisma.sql`UPDATE ${Prisma.raw(`"${table}"`)}
    SET embedding = ${literal}::vector,
        "embeddingStatus" = 'ready'
    WHERE id = ${id}`;
  await prisma.$executeRaw(sql);
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
