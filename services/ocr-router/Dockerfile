# syntax=docker/dockerfile:1
FROM node:20-alpine

# pdf2pic requires graphicsmagick for PDF→image rendering
RUN apk add --no-cache graphicsmagick ghostscript

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Remove devDependencies after compilation
RUN npm prune --omit=dev

EXPOSE 8002

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8002/health || exit 1

CMD ["node", "dist/server.js"]
