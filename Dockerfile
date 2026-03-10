# Installing dependencies
FROM node:20-alpine AS deps
RUN npm install -g pnpm@10.15.1
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
# scripts currently only include vad-web assets. 
COPY scripts ./scripts 
RUN pnpm install --frozen-lockfile

# Builder
FROM node:20-alpine AS builder
RUN npm install -g pnpm@10.15.1
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# public/vad is excluded from context; copy from deps (created by postinstall)
COPY --from=deps /app/public/vad ./public/vad

# Build env validation runs at import time; skip during Docker build
ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1

# Build args from docker-compose (passed via --env-file .env)
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG OPENAI_API_KEY
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
ENV OPENAI_API_KEY=${OPENAI_API_KEY}

RUN pnpm build

# Schema sync
FROM node:20-alpine AS migrate
RUN npm install -g pnpm@10.15.1
WORKDIR /app
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts

CMD ["sh", "-c", "node scripts/ensure-pgvector.mjs && pnpm db:push"]

# Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
