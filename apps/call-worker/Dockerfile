# syntax=docker/dockerfile:1

FROM node:24-trixie-slim AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .pnpmfile.cjs ./
COPY patches ./patches
COPY packages/core/package.json ./packages/core/
COPY packages/features/package.json ./packages/features/
COPY apps/call-worker/package.json ./apps/call-worker/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY packages/features ./packages/features
COPY apps/call-worker ./apps/call-worker
RUN pnpm --filter @launchstack/call-worker build
RUN pnpm --filter @launchstack/call-worker deploy --prod /prod/call-worker --legacy

FROM node:24-trixie-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /prod/call-worker ./
USER node
CMD ["node", "dist/main.js"]
