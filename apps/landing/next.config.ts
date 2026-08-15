import path from "node:path";
import { config as loadDotenv } from "dotenv";
import type { NextConfig } from "next";

// `.env` lives at the monorepo root, but Next (running from apps/landing/) only
// auto-loads `.env` from its own cwd. Load the root file here so NEXT_PUBLIC_*
// values are in process.env before the bundler inlines them into client chunks.
// Mirrors apps/web/src/env.ts's dotenv call, minus the Zod gate: this app reads
// two optional URLs with production defaults, so there is nothing to validate —
// a wrong value produces a visibly wrong link, not a runtime crash.
loadDotenv({ path: path.resolve(__dirname, "../../.env") });

const config: NextConfig = {
  // Deliberately NOT `output: "standalone"`. This app is never containerized —
  // docker-compose and the GHCR images build apps/web only (see .dockerignore).
  // outputFileTracingRoot still pins the workspace root so Next doesn't walk up
  // looking for a lockfile and emit noisy warnings.
  outputFileTracingRoot: path.join(__dirname, "../../"),

  // Same reason as apps/web: pin the Turbopack root to the monorepo root so
  // `next dev --turbo` can't land on a stray lockfile above the repo.
  turbopack: {
    root: path.join(__dirname, "../../"),
  },

  // `pnpm lint` at the root is the lint authority (same rationale as apps/web).
  eslint: { ignoreDuringBuilds: true },

  productionBrowserSourceMaps: false,
};

export default config;
