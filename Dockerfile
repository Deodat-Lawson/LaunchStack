# syntax=docker/dockerfile:1

# ── Base: shared Alpine + corepack-managed pnpm ──────────────────────
FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /app

# ── Dependencies ─────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml .pnpmfile.cjs ./
COPY scripts ./scripts
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── Builder ──────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules

# Copy config files first (change less often → better layer caching)
COPY package.json tsconfig.json next.config.ts drizzle.config.ts tailwind.config.ts postcss.config.js ./
COPY src/env.ts ./src/env.ts
# Copy stable library/server code first (changes less often → better layer caching)
COPY src/lib ./src/lib
COPY src/server ./src/server
COPY src/types ./src/types
COPY src/scripts ./src/scripts
COPY src/styles ./src/styles
COPY src/middleware.ts ./src/middleware.ts
# Copy application code last (changes most often — only this layer rebuilds)
COPY src/app ./src/app
COPY src/components ./src/components
COPY public ./public
COPY scripts ./scripts

ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1

ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}

RUN --mount=type=cache,id=nextjs-cache,target=/app/.next/cache \
    pnpm build

# ── Schema sync (migrate) ───────────────────────────────────────────
# Reuses node_modules from deps instead of running a second install
FROM base AS migrate
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts

CMD ["sh", "-c", "node scripts/ensure-pgvector.mjs && pnpm db:push && pnpm db:backfill:versions"]

# ── Runner ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
