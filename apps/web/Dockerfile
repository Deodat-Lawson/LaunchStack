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
COPY packages/core/package.json ./packages/core/
COPY packages/features/package.json ./packages/features/
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
COPY apps ./apps

ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1
# Force standalone on Linux (the Next config already enables it on non-
# Windows, but being explicit keeps the Docker path deterministic).
ENV STANDALONE_BUILD=1

ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}

RUN --mount=type=cache,id=nextjs-cache,target=/app/apps/web/.next/cache \
    pnpm --filter @launchstack/web build

# ── Schema sync (migrate) ────────────────────────────────────────────
# Applies the ordered SQL migrations in packages/core/drizzle — the same
# command local dev, CI and the Vercel production build run. The runner is
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
COPY packages/core/drizzle ./packages/core/drizzle
COPY packages/core/scripts ./packages/core/scripts
COPY apps/web/drizzle ./apps/web/drizzle

WORKDIR /app/packages/core
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

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]
