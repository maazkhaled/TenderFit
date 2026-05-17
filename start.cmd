@echo off
REM ============================================================================
REM TenderFit - one-click app launcher (Windows).
REM
REM Double-click this file in File Explorer. It opens up to three new console
REM windows:
REM
REM   - "TenderFit ollama" - the Ollama LLM server (skipped if you don't have
REM     ollama installed or already running)
REM   - "TenderFit web"    - the Next.js dev server (port 3000)
REM   - "TenderFit worker" - the cron worker
REM
REM To stop the app, close each console window (or press Ctrl+C inside it).
REM Postgres is assumed to be running as a Windows service - install/configure
REM postgresql separately (e.g. via the installer at postgresql.org).
REM
REM Single-window UX with prefixed output isn't easily doable in cmd; if you
REM prefer that, use Windows Terminal tabs or WSL with the start.command file
REM from this directory.
REM ============================================================================

cd /d "%~dp0"

REM ---- Quick prereq sanity check ---------------------------------------------
where pnpm >nul 2>nul
if errorlevel 1 (
  echo [start] ERROR: pnpm not found on PATH. Install Node.js then `npm install -g pnpm`.
  pause
  exit /b 1
)

REM ---- Ollama (skip if already up or not installed) --------------------------
curl -s -o NUL -m 2 http://localhost:11434/api/tags
if errorlevel 1 (
  where ollama >nul 2>nul
  if not errorlevel 1 (
    echo [start] Ollama not running - starting in a new window
    start "TenderFit ollama" cmd /k "ollama serve"
    timeout /t 2 /nobreak >nul
  ) else (
    echo [start] WARN: ollama not installed. LLM scoring will fail until you install + run it.
  )
)

echo.
echo [start] ===============================================
echo [start] Web    -^> http://localhost:3000
echo [start] Worker -^> cron (ingest 6h, match 1h, digest 15m)
echo [start] Close each console window to stop that piece.
echo [start] ===============================================
echo.

start "TenderFit web"    cmd /k "pnpm dev:web"
start "TenderFit worker" cmd /k "pnpm --filter worker dev"

REM Keep this launcher window open briefly so the user can read the banner,
REM then exit. The spawned windows continue running independently.
timeout /t 4 /nobreak >nul
exit /b 0
