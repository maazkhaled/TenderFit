#!/usr/bin/env node
/**
 * Run a .sql file against $DATABASE_URL using psql.
 *
 * Solves two annoyances:
 *   1. $DATABASE_URL is set in .env but not exported into ad-hoc shells.
 *   2. Prisma's connection string includes ?schema=public; psql rejects it
 *      with `invalid URI query parameter: "schema"`.
 *
 * Usage:
 *   node packages/db/scripts/run-sql.mjs path/to/file.sql
 *   pnpm db:sql packages/db/src/migrations/005_tender_fts.sql
 *
 * No npm deps — pure Node + spawned psql.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let val = (m[2] ?? "").trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] == null || process.env[m[1]] === "") {
      process.env[m[1]] = val;
    }
  }
}

function stripUriQuery(url) {
  const i = url.indexOf("?");
  return i < 0 ? url : url.slice(0, i);
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node packages/db/scripts/run-sql.mjs <path/to/file.sql>");
    process.exit(2);
  }
  loadDotEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL is not set (checked process.env and ./.env). Add it to .env first.",
    );
    process.exit(2);
  }
  const cleanUrl = stripUriQuery(url);
  console.log(`[db:sql] applying ${file}`);
  const res = spawnSync("psql", [cleanUrl, "-v", "ON_ERROR_STOP=1", "-f", file], {
    stdio: "inherit",
  });
  if (res.error) {
    console.error(`[db:sql] failed to spawn psql: ${res.error.message}`);
    process.exit(1);
  }
  process.exit(res.status ?? 1);
}

main();
