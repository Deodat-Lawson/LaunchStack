# apps/worker — the durable workflow coordinator (ADR-003).
#
# The worker runs TypeScript directly via tsx: it imports server modules
# from apps/web/src through the `~/*` path alias (transitional composition
# reuse, see ADR-002 consequences), so a bundling build would have to
# compile most of the web app anyway. Type safety is enforced by
# `pnpm --filter @launchstack/worker typecheck` in CI, not deferred.
FROM node:20-alpine AS base
# corepack is needed only for the build-time `pnpm install`; container start
# runs tsx directly (see CMD) so cold start needs no corepack/network.
RUN corepack enable
WORKDIR /app

# Workspace manifests first so dependency layers cache across source edits.
# .pnpmfile.cjs shapes dependency resolution (drops the heavy transformers
# peer) — omitting it breaks the frozen-lockfile install.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .pnpmfile.cjs ./
COPY patches ./patches
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/runtime/package.json ./packages/runtime/
COPY packages/evidence/package.json ./packages/evidence/
COPY packages/store/package.json ./packages/store/
COPY packages/llm/package.json ./packages/llm/
COPY packages/conversion/package.json ./packages/conversion/
COPY packages/indexing/package.json ./packages/indexing/
COPY packages/search/package.json ./packages/search/
COPY packages/orchestration/package.json ./packages/orchestration/
COPY packages/editing/package.json ./packages/editing/
COPY packages/document-conversion-engine/package.json ./packages/document-conversion-engine/
COPY packages/google-drive/package.json ./packages/google-drive/
COPY packages/collab/package.json ./packages/collab/
COPY packages/engine/package.json ./packages/engine/
COPY packages/schema-generator/package.json ./packages/schema-generator/
COPY packages/tools/package.json ./packages/tools/
COPY packages/design-tokens/package.json ./packages/design-tokens/
COPY pipelines/package.json ./pipelines/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages ./packages
COPY pipelines ./pipelines
COPY apps/web ./apps/web
COPY apps/worker ./apps/worker

# wget for the compose healthcheck.
RUN apk add --no-cache wget

RUN addgroup -S worker && adduser -S worker -G worker
USER worker

# EXPOSE and HEALTHCHECK hardcode 8020: WORKER_PORT must stay 8020
# in-container (remap on the host side via compose port mapping instead).
EXPOSE 8020
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=60s \
  CMD wget -qO- http://127.0.0.1:8020/healthz || exit 1

WORKDIR /app/apps/worker
# Invoke tsx via its install-time bin shim (created by `pnpm install` at
# apps/worker/node_modules/.bin/tsx) instead of `pnpm start`: as the non-root
# user, `pnpm` re-resolves itself through corepack, which downloads pnpm from
# the registry on every cold start — a network dependency at boot.
CMD ["node_modules/.bin/tsx", "src/main.ts"]
