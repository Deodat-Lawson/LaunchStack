# syntax=docker/dockerfile:1

FROM node:24-trixie-slim AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .pnpmfile.cjs ./
COPY patches ./patches
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
COPY apps/call-worker/package.json ./apps/call-worker/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages ./packages
COPY pipelines ./pipelines
COPY apps/call-worker ./apps/call-worker
RUN pnpm --filter @launchstack/call-worker build
RUN pnpm --filter @launchstack/call-worker deploy --prod /prod/call-worker --legacy

FROM node:24-trixie-slim AS runner
# Runtime audio capture targets Linux ALSA devices. Docker Desktop cannot pass
# a macOS host microphone through to this Linux container; run the worker on
# the macOS host for local capture instead.
# This image is an explicit microphone-only development fallback. It does not
# contain the macOS ScreenCaptureKit helper, and Docker Desktop cannot expose
# the host's combined system audio to a Linux container.
ENV CALL_NOTES_SYSTEM_AUDIO_ENABLED="false"
RUN apt-get update \
    && apt-get install --no-install-recommends --yes ffmpeg alsa-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /prod/call-worker ./
USER node
CMD ["node", "dist/main.js"]
