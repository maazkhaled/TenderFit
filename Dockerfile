# syntax=docker/dockerfile:1.7

# =============================================================================
# Project Beta — single Dockerfile with two build targets:
#   --target web     → Next.js 14 production server on :3000
#   --target worker  → Long-running cron worker (worker/src/cron.ts)
#
# Why one file: the pnpm install + prisma generate layer is identical for both
# services, so a single Dockerfile with shared base stages keeps the image
# cache warm and avoids drift between web/worker dependencies.
# =============================================================================

# ----- Stage 1: base -----
# Pinned to Node 20 LTS. Use Debian slim instead of Alpine so Prisma uses the
# glibc OpenSSL engine target; the Alpine musl ARM engine download is more
# brittle on Apple Silicon Docker builds.
#
# Note: we deliberately do NOT use `corepack prepare` here. Corepack in
# node:20 images intermittently fails to fetch pnpm from npm with
# "Internal Error: Error when performing the request to registry.npmjs.org"
# due to a strict signature-check timeout. Direct `npm install -g pnpm` is
# the standard workaround and is what we use everywhere else.
FROM node:20-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@9.12.0
WORKDIR /app

# ----- Stage 2: dependency install -----
# Copy only the manifests first so this layer caches when source changes
# but dependencies don't.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY worker/package.json ./worker/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/ingest/package.json ./packages/ingest/
COPY packages/llm/package.json ./packages/llm/
# notifications package may or may not exist depending on branch state — copy
# defensively so we never break the build if it's added.
COPY packages/notifications/package.json* ./packages/notifications/
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
# Generate the Prisma client once, here, so both web and worker stages inherit it.
RUN for attempt in 1 2 3; do \
      pnpm db:generate && break; \
      if [ "$attempt" = "3" ]; then exit 1; fi; \
      sleep 5; \
    done

# ----- Stage 3: build the workspace -----
FROM deps AS builder
COPY . .
# Build every package (TypeScript compile) + the Next.js production output.
RUN pnpm build

# =============================================================================
# Target: web — Next.js production server
# =============================================================================
FROM base AS web
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Copy installed deps + built workspace. We're not using next.js standalone
# output because the pnpm-workspace symlink resolution gets messy; the full
# node_modules tree is ~250MB which is fine for one VM.
COPY --from=builder /app /app
WORKDIR /app/apps/web

EXPOSE 3000
# `next start` reads .next/ from the builder stage.
CMD ["pnpm", "start"]

# =============================================================================
# Target: worker — long-running cron process (ingest + match + digest)
# =============================================================================
# The worker needs Chromium because several upstream tender portals
# (GeBIZ Singapore, GeM India, GCA UK, CanadaBuys, IADB, AfDB, JICA) are
# pure JS-rendered SPAs with no server-side HTML for the listings. The
# playwright npm package is in @beta/ingest's deps; here we install the
# OS-level dependencies + the Chromium browser binary itself.
#
# Size cost: ~300 MB on top of the base. Worth it — without it those
# six adapters can't function.
#
# Pinned via package-lock for the npm package; Playwright keeps the
# matching browser version in sync via `playwright install`.
FROM base AS worker
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY --from=builder /app /app
WORKDIR /app

# Install Chromium + the minimum apt deps Playwright needs to run it
# headless on Debian slim. --with-deps pulls in the right libnss3,
# libatk1.0-0, libcups2, etc. so we don't have to enumerate them.
RUN pnpm exec playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/worker

# tsx executes TypeScript directly — matches how the worker runs in dev.
# No `pnpm build` step is required for the worker because tsx handles it.
CMD ["pnpm", "exec", "tsx", "src/cron.ts"]
