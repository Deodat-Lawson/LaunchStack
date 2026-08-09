# syntax=docker/dockerfile:1
FROM node:20-alpine

# pdf2pic renders PDF pages via graphicsmagick + ghostscript
RUN apk add --no-cache graphicsmagick ghostscript

WORKDIR /app

# npm ci against the committed lockfile — reproducible builds (the old
# ocr-router ran `npm install` with no lockfile).
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Remove devDependencies after compilation
RUN npm prune --omit=dev

# Run as non-root (same addgroup/adduser pattern as services/transcription).
# The SigLIP WASM fallback (@huggingface/transformers) caches model downloads
# under its own package directory — node_modules/@huggingface/transformers/
# .cache is its default cacheDir and it does NOT honour HF_HOME — so that
# path must be writable by the runtime user. Everything else it writes goes
# to /tmp (world-writable already).
RUN addgroup -S converter && adduser -S converter -G converter \
    && mkdir -p node_modules/@huggingface/transformers/.cache \
    && chown -R converter:converter node_modules/@huggingface/transformers/.cache

USER converter

EXPOSE 8002

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8002/health || exit 1

CMD ["node", "dist/server.js"]
