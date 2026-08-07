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
# Runs drizzle-kit push from apps/web against the core schema via the
# relative path in drizzle.config.ts. ensure-pgvector.mjs +
# backfill-document-versions.ts both live under apps/web/scripts/ so
# they resolve postgres + dotenv from apps/web's isolated node_modules.
FROM deps AS migrate
COPY --from=builder /app/packages/core/src ./packages/core/src
COPY --from=builder /app/packages/features/src ./packages/features/src
COPY --from=builder /app/apps/web/drizzle.config.ts ./apps/web/drizzle.config.ts
COPY --from=builder /app/apps/web/scripts ./apps/web/scripts
COPY --from=builder /app/apps/web/src ./apps/web/src
COPY --from=builder /app/apps/web/tsconfig.json ./apps/web/tsconfig.json
COPY --from=builder /app/tsconfig.base.json ./tsconfig.base.json

WORKDIR /app/apps/web
CMD ["sh", "-c", "pnpm db:push && pnpm db:backfill:versions"]

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
