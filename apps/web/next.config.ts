import path from "node:path";
import type { NextConfig } from "next";

import "./src/env";

// Standalone uses symlinks when copying traced deps; Windows often lacks permission (EPERM).
// Use standalone only on non-Windows, or when STANDALONE_BUILD=1 (e.g. CI/Docker or Windows with Developer Mode).
const useStandalone =
  process.env.STANDALONE_BUILD === "1" || process.platform !== "win32";

const config: NextConfig = {
  // Standalone output for Docker deployment (smaller production image).
  // outputFileTracingRoot pins the workspace root so Next traces workspace
  // packages (@launchstack/core, @launchstack/features) into the standalone
  // bundle instead of inferring the root and emitting noisy warnings.
  output: useStandalone ? "standalone" : undefined,
  outputFileTracingRoot: useStandalone
    ? path.join(__dirname, "../../")
    : undefined,

  experimental: {
    middlewareClientMaxBodySize: "128mb",
  },

  // Workspace packages ship raw TypeScript; Next's SWC transpiles on demand.
  transpilePackages: ["@launchstack/core", "@launchstack/features"],

  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "iiazjw8b8a.ufs.sh",
        port: "",
        pathname: "/f/**",
      },
    ],
  },

  // Exclude unnecessary files from Vercel output (moved from experimental in Next.js 15)
  // Apply to all routes using "/*" wildcard
  // Disable server-side source maps to reduce build I/O and output size
  productionBrowserSourceMaps: false,

  // CORS and security headers
  async headers() {
    const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS?.split(",") ?? [];
    return [
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Access-Control-Allow-Origin",
            value: allowedOrigins.length > 0 ? allowedOrigins[0]! : "",
          },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type, Authorization",
          },
          {
            key: "Access-Control-Max-Age",
            value: "86400",
          },
        ],
      },
    ];
  },

  outputFileTracingExcludes: {
    "/*": [
      // Exclude onnxruntime-node (transitive dep via @langchain/community → @huggingface/transformers)
      "node_modules/.pnpm/onnxruntime-node@*/**",
      "node_modules/onnxruntime-node/**",
      "**/onnxruntime-node/**",
      // Exclude sharp native bindings — loaded as serverExternalPackage
      "node_modules/.pnpm/@img+sharp-libvips-linuxmusl-x64@*/**",
      "node_modules/.pnpm/@img+sharp-libvips-linux-x64@*/**",
      // Exclude pdfjs source maps (keep legacy build — used for Node.js/Inngest)
      "node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/build/**/*.map",
    ],
  },

  serverExternalPackages: [
    // LangChain ecosystem — skip webpack tracing, load from node_modules at runtime
    "@langchain/core",
    "@langchain/openai",
    "@langchain/anthropic",
    "@langchain/google-genai",
    "@langchain/ollama",
    "@langchain/community",
    "@langchain/langgraph",
    "@langchain/textsplitters",
    "langchain",
    // AI SDKs
    "openai",
    // AWS SDK
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
    // ML
    "@huggingface/transformers",
    // Document processing
    "pdf2pic",
    "pdfjs-serverless",
    "pdf-lib",
    "mammoth",
    "jszip",
    "readable-stream",
    // Native bindings
    "sharp",
    "@img/sharp-libvips-linuxmusl-x64",
    "@img/sharp-libvips-linux-x64",
    // Database
    "neo4j-driver",
    // Transitive deps via @langchain/community — not available on Alpine (musl)
    "onnxruntime-node",
    "sherpa-onnx-node",
    // Structured logging
    "pino",
    "pino-pretty",
  ],
};

export default config;

