#!/bin/bash
#
# TenderFit — one-click app launcher (macOS).
#
# Double-click this file in Finder to start the whole app in a single Terminal
# window:
#
#   1. Best-effort starts Postgres (via `brew services`) if it isn't running
#   2. Best-effort starts Ollama (only when .env still uses ollama or lmstudio
#      for chat) if it isn't running
#   3. Starts the Next.js web server (port 3000)
#   4. Starts the cron worker (ingest 6h, match 1h, digest 15m)
#
# All output is interleaved in THIS window with `[web]` and `[worker]` prefixes.
# Press Ctrl+C or close the window to shut everything down cleanly — the trap
# at the top of this script kills every child process it spawned (it leaves
# Postgres and Ollama running, since those are typically long-lived services).
#
# Troubleshooting: if Finder shows "this app can't be opened", run once from a
# terminal: `chmod +x start.command`. macOS Gatekeeper may also ask for
# permission the first time.

set -uo pipefail

# Always resolve to the directory containing this script — Finder launches
# .command files with the user's home directory as CWD by default.
cd "$(dirname "$0")"

# Cleanup hook: kill every process this script started (the pipeline subshells
# and their children) on any exit. Uses `pkill -P $$` to target only direct
# children, so the parent Terminal session stays alive.
cleanup() {
  echo ""
  echo "[start] shutting down web + worker…"
  pkill -P $$ 2>/dev/null
  # Give them a beat to flush logs before the script returns.
  sleep 0.3
  echo "[start] done"
}
trap cleanup INT TERM EXIT

# ---- Postgres ---------------------------------------------------------------
if command -v pg_isready >/dev/null 2>&1; then
  if ! pg_isready -q -h localhost -p 5432 2>/dev/null; then
    if command -v brew >/dev/null 2>&1; then
      echo "[start] Postgres not running — attempting: brew services start postgresql@17"
      brew services start postgresql@17 >/dev/null 2>&1 \
        || brew services start postgresql >/dev/null 2>&1 \
        || echo "[start] WARN: could not auto-start Postgres. Web requests will fail until you start it."
      sleep 2
    else
      echo "[start] WARN: Postgres not reachable and brew not found. Start Postgres manually."
    fi
  fi
fi

# ---- Ollama (only if .env keeps chat on Ollama/LM Studio) -------------------
NEED_OLLAMA="yes"
if [ -f .env ] && grep -qE '^[[:space:]]*LLM_PROVIDER=' .env; then
  if ! grep -qE '^[[:space:]]*LLM_PROVIDER=("?ollama"?|"?lmstudio"?)' .env; then
    NEED_OLLAMA="no"
  fi
fi
if [ "$NEED_OLLAMA" = "yes" ]; then
  if ! curl -s -o /dev/null -m 2 http://localhost:11434/api/tags; then
    if command -v ollama >/dev/null 2>&1; then
      echo "[start] Ollama not running — starting in background (log: /tmp/tenderfit-ollama.log)"
      nohup ollama serve >/tmp/tenderfit-ollama.log 2>&1 &
      disown
      sleep 2
    else
      echo "[start] WARN: ollama is not installed. LLM scoring will fail until you install + run it."
    fi
  fi
fi

# ---- Make sure pnpm is on PATH ---------------------------------------------
if ! command -v pnpm >/dev/null 2>&1; then
  # Common install paths if Finder spawned us with a thin PATH.
  for p in "/opt/homebrew/bin" "/usr/local/bin" "$HOME/.npm-global/bin" "$HOME/.local/bin"; do
    if [ -x "$p/pnpm" ]; then
      export PATH="$p:$PATH"
      break
    fi
  done
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "[start] ERROR: pnpm not found on PATH. Install with: brew install pnpm"
  exit 1
fi

echo ""
echo "[start] ==============================================="
echo "[start] Web    -> http://localhost:3000"
echo "[start] Worker -> cron (ingest 6h, match 1h, digest 15m)"
echo "[start] Press Ctrl+C (or close window) to stop."
echo "[start] ==============================================="
echo ""

# Run both long-lived processes in the background, piping their output through
# awk with fflush() so the line buffer doesn't hold logs hostage. Each line is
# tagged with its origin to make the interleaved stream readable.
pnpm dev:web              2>&1 | awk '{print "[web]    " $0; fflush()}' &
pnpm --filter worker dev  2>&1 | awk '{print "[worker] " $0; fflush()}' &

# Wait blocks until both pipelines exit or the trap fires.
wait
