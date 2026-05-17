/**
 * Load .env into process.env at process start.
 *
 * Duplicate of worker/src/util/load-env.ts — kept here so packages/llm
 * entrypoints (notably the doctor CLI) can self-bootstrap their config
 * without taking a dependency on the worker package. See that file for
 * the full design rationale.
 *
 * Import this module for its side effect as the *very first* line of every
 * entry point that reads env-driven config:
 *
 *   import "./util/load-env.js";
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
