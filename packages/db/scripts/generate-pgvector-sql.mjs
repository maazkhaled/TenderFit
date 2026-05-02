#!/usr/bin/env node
/**
 * Generates packages/db/src/migrations/001_pgvector.sql by substituting
 * {{EMBEDDING_DIM}} from the EMBEDDING_DIM env var (default 1024).
 *
 * Run via `pnpm db:vector-sql`. Then apply:
 *   psql "$DATABASE_URL" -f packages/db/src/migrations/001_pgvector.sql
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "src", "migrations");
const templatePath = join(migrationsDir, "001_pgvector.sql.template");
const outPath = join(migrationsDir, "001_pgvector.sql");

const dimRaw = process.env.EMBEDDING_DIM ?? "1024";
const dim = Number.parseInt(dimRaw, 10);
if (!Number.isFinite(dim) || dim <= 0) {
  console.error(`generate-pgvector-sql: invalid EMBEDDING_DIM=${dimRaw}`);
  process.exit(1);
}

const tpl = readFileSync(templatePath, "utf8");
const sql = tpl.replaceAll("{{EMBEDDING_DIM}}", String(dim));

writeFileSync(outPath, sql);
console.log(`generate-pgvector-sql: wrote ${outPath} with EMBEDDING_DIM=${dim}`);
