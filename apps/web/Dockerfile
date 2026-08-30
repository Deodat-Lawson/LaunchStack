# syntax=docker/dockerfile:1

# ── Base: shared Alpine + corepack-managed pnpm ──────────────────────
FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /app

# ── Dependencies ─────────────────────────────────────────────────────
# Copy only the manifests + lockfile so that source changes don't bust
# this layer. pnpm install reads the workspace graph from these files
# alone and resolves every workspace:* link.
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .pnpmfile.cjs ./
COPY patches ./patches/
COPY packages/runtime/package.json ./packages/runtime/
COPY packages/evidence/package.json ./packages/evidence/
COPY packages/store/package.json ./packages/store/
COPY packages/llm/package.json ./packages/llm/
COPY packages/conversion/package.json ./packages/conversion/
COPY packages/indexing/package.json ./packages/indexing/
COPY packages/search/package.json ./packages/search/
COPY packages/orchestration/package.json ./packages/orchestration/
COPY packages/editing/package.json ./packages/editing/
COPY packages/google-drive/package.json ./packages/google-drive/
COPY packages/collab/package.json ./packages/collab/
COPY packages/engine/package.json ./packages/engine/
COPY packages/schema-generator/package.json ./packages/schema-generator/
COPY packages/tools/package.json ./packages/tools/
COPY packages/design-tokens/package.json ./packages/design-tokens/
COPY pipelines/package.json ./pipelines/
COPY apps/web/package.json ./apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── Builder ──────────────────────────────────────────────────────────
# Starts from the deps image (keeps every node_modules + .pnpm symlink
# intact) and overlays the source. node_modules + .next are in
# .dockerignore so the source COPYs don't clobber installed deps.
FROM deps AS builder
COPY tsconfig.base.json ./
COPY packages ./packages
COPY pipelines ./pipelines
# apps/web only — apps/worker has its own image and apps/landing is not
# containerized at all. `.dockerignore` already excludes landing; naming the
# directory explicitly makes it structural rather than a matter of ignore-file
# hygiene. Matches apps/worker/Dockerfile, which copies its two apps by name.
COPY apps/web ./apps/web

ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1
# Force standalone on Linux (the Next config already enables it on non-
# Windows, but being explicit keeps the Docker path deterministic).
ENV STANDALONE_BUILD=1


RUN --mount=type=cache,id=nextjs-cache,target=/app/apps/web/.next/cache \
    pnpm --filter @launchstack/web build

# ── Schema sync (migrate) ────────────────────────────────────────────
# Applies the ordered SQL migrations in packages/store/drizzle — the same
# command local dev and CI run. The runner is
# plain ESM depending only on postgres + dotenv, so this stage needs neither
# the app source nor drizzle-kit nor tsx.
#
# No backfill here: data backfills are separate, resumable, and explicitly
# invoked (see the `backfill` compose profile). Running one on every container
# boot meant an unbounded scan on every restart.
# Copied straight from the build context, not from `builder`: migrations are
# static SQL and the runner is plain ESM, so this stage no longer depends on
# the app compiling at all. `docker compose up migrate` is now fast and cannot
# be broken by a TypeScript error in the web app.
FROM deps AS migrate
COPY packages/store/drizzle ./packages/store/drizzle
COPY packages/store/scripts ./packages/store/scripts
COPY apps/web/drizzle ./apps/web/drizzle

WORKDIR /app/packages/store
# Engine set first, then product: product migrations carry foreign keys into
# engine tables, so the order is load-bearing, not cosmetic.
CMD ["sh", "-c", "node scripts/migrate.mjs && node scripts/migrate.mjs --set=product"]

# ── Runner ───────────────────────────────────────────────────────────
# Next's standalone output for a pnpm workspace places the server entry
# at apps/web/server.js inside .next/standalone/, with a pruned
# node_modules tree alongside it. We copy that slice verbatim, plus the
# public/ and .next/static/ directories that standalone omits.
FROM node:20-alpine AS runner
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
# The chat model configuration is read at runtime, not bundled by the
# standalone build. docker-compose bind-mounts it read-only over this path so
# it stays editable without a rebuild; shipping it as well is what lets the
# image run on its own, which is the point of having a default endpoint at all.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/config ./apps/web/config

USER nextjs

# Run from the directory that holds server.js. CHAT_MODELS_CONFIG defaults to
# the relative path `config/chat-models.yaml`, which only finds the file copied
# above if the process starts here. Next's standalone entrypoint happens to
# `process.chdir(__dirname)` to this same directory on its first line, so this
# is a no-op today — but it is a generated file we do not control, and a
# container whose configuration is found by accident is one bad upgrade away
# from not finding it. Stating the working directory makes the default path
# correct by construction.
WORKDIR /app/apps/web

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
