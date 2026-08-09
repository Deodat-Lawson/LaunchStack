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

EXPOSE 8002

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8002/health || exit 1

CMD ["node", "dist/server.js"]
