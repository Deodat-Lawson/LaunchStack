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
COPY packages/core/package.json ./packages/core/
COPY packages/features/package.json ./packages/features/
COPY apps/web/package.json ./apps/web/
COPY scripts ./scripts
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
# Runs drizzle-kit push from apps/web against the core schema via the
# relative path in drizzle.config.ts. The ensure-pgvector script lives
# at the repo root. db:backfill:versions runs a tsx script that imports
# ~/server/db, so we need the apps/web/src tree at migrate time too.
FROM deps AS migrate
COPY --from=builder /app/packages/core/src ./packages/core/src
COPY --from=builder /app/packages/features/src ./packages/features/src
COPY --from=builder /app/apps/web/drizzle.config.ts ./apps/web/drizzle.config.ts
COPY --from=builder /app/apps/web/src ./apps/web/src
COPY --from=builder /app/apps/web/tsconfig.json ./apps/web/tsconfig.json
COPY --from=builder /app/tsconfig.base.json ./tsconfig.base.json

WORKDIR /app/apps/web
CMD ["sh", "-c", "node ../../scripts/ensure-pgvector.mjs && pnpm db:push && pnpm db:backfill:versions"]

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
