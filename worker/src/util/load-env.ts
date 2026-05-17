/**
 * Load .env into process.env at process start.
 *
 * Pure Node, no deps. Walks up from cwd looking for a .env file (handles
 * `pnpm --filter worker run match` where cwd = worker/ and .env lives at the
 * monorepo root). Parses simple KEY=VALUE / KEY="VALUE" lines and populates
 * process.env, preserving any var already set in the calling shell.
 *
 * Why this exists: Prisma's internal env loader only handles its own
 * DATABASE_URL/DIRECT_URL — it does not populate arbitrary keys for the rest
 * of the app. Without this module, LLM_PROVIDER / EMBEDDING_PROVIDER /
 * RERANK_PROVIDER / VOYAGE_API_KEY edits in .env silently have no effect on
 * the worker process, and the matcher quietly falls back to provider defaults.
 *
 * Import this module for its side effect as the *very first* line of every
 * entry point that reads env-driven config:
 *
 *   import "./util/load-env.js";
 *
 * Set DEBUG_ENV=1 to log how many vars were loaded and from where.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function findEnvFile(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const envPath = findEnvFile();
if (envPath) {
  const text = readFileSync(envPath, "utf8");
  let loaded = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1] as string;
    const rawValue = (m[2] ?? "").trim();
    let val = rawValue;
    let isQuoted = false;
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
      isQuoted = true;
    }
    // Trailing `# comment` is only stripped when the value isn't quoted.
    if (!isQuoted) {
      const hashAt = val.indexOf(" #");
      if (hashAt >= 0) val = val.slice(0, hashAt).trimEnd();
    }
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = val;
      loaded += 1;
    }
  }
  if (process.env.DEBUG_ENV) {
    // eslint-disable-next-line no-console
    console.log(`[env] loaded ${loaded} vars from ${envPath}`);
  }
}
