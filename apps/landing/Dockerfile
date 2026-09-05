# syntax=docker/dockerfile:1

# The marketing site, containerized so a self-hosted deployment can serve its
# own front door instead of pointing users at launchstack.app. apps/web builds
# from its own Dockerfile; this one exists alongside it.

FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /app

# ── Dependencies ─────────────────────────────────────────────────────
# pnpm resolves the whole workspace from the lockfile, so every member's
# manifest has to be present even though only landing is installed. Keep this
# list in step with the workspace — scripts/ci/check-dockerfile-manifests.mjs
# fails the build if it drifts.
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .pnpmfile.cjs ./
COPY patches ./patches/
COPY packages/runtime/package.json ./packages/runtime/
COPY packages/evidence/package.json ./packages/evidence/
COPY packages/store/package.json ./packages/store/
COPY packages/llm/package.json ./packages/llm/
COPY packages/conversion/package.json ./packages/conversion/
COPY packages/indexing/package.json ./packages/indexing/
COPY packages/retrieval/package.json ./packages/retrieval/
COPY packages/orchestration/package.json ./packages/orchestration/
COPY packages/editing/package.json ./packages/editing/
COPY packages/collab/package.json ./packages/collab/
COPY packages/engine/package.json ./packages/engine/
COPY packages/schema-generator/package.json ./packages/schema-generator/
COPY packages/tools/package.json ./packages/tools/
COPY packages/design-tokens/package.json ./packages/design-tokens/
COPY packages/document-conversion-engine/package.json ./packages/document-conversion-engine/
COPY packages/google-drive/package.json ./packages/google-drive/
COPY pipelines/package.json ./pipelines/
COPY apps/web/package.json ./apps/web/
COPY apps/landing/package.json ./apps/landing/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @launchstack/landing...

# ── Builder ──────────────────────────────────────────────────────────
FROM deps AS builder
COPY tsconfig.base.json ./
COPY packages/design-tokens ./packages/design-tokens
COPY apps/landing ./apps/landing
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @launchstack/landing build

# ── Runner ───────────────────────────────────────────────────────────
# Not a standalone bundle: next.config.ts deliberately omits it, so the
# runtime keeps node_modules rather than a traced copy.
FROM builder AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3001
WORKDIR /app/apps/landing
CMD ["pnpm", "start"]
