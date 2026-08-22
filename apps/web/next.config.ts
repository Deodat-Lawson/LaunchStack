import path from "node:path";
import type { NextConfig } from "next";

import "./src/env";

// Standalone uses symlinks when copying traced deps; Windows often lacks permission (EPERM).
// Use standalone only on non-Windows, or when STANDALONE_BUILD=1 (e.g. CI/Docker or Windows with Developer Mode).
const useStandalone = process.env.STANDALONE_BUILD === "1" || process.platform !== "win32";

const config: NextConfig = {
    // Standalone output for Docker deployment (smaller production image).
    // outputFileTracingRoot pins the workspace root so Next traces workspace
    // packages (@launchstack/core, @launchstack/features) into the standalone
    // bundle instead of inferring the root and emitting noisy warnings.
    output: useStandalone ? "standalone" : undefined,
    outputFileTracingRoot: useStandalone ? path.join(__dirname, "../../") : undefined,

    // Pin the Turbopack workspace root to the monorepo root. Without this Next
    // walks up looking for a lockfile and can land on a stray ~/package-lock.json,
    // which breaks module resolution under `next dev --turbo`.
    turbopack: {
        root: path.join(__dirname, "../../"),
    },

    experimental: {
        middlewareClientMaxBodySize: "128mb",
    },

    // Workspace packages ship raw TypeScript; Next's SWC transpiles on demand.
    transpilePackages: [
        "@launchstack/core",
        "@launchstack/features",
        "@launchstack/tools",
        "@launchstack/protocol",
        "@launchstack/evidence",
        "@launchstack/application",
        "@launchstack/adapters",
    ],

    // Production builds fail on type errors (ADR-006). Lint runs as its own
    // blocking CI step over the whole workspace with the repo's flat config;
    // Next's per-build lint pass is redundant with it and uses a different
    // config surface, so it stays off — `pnpm lint` is the authority.
    eslint: { ignoreDuringBuilds: true },

    // Remote image hosts. This list used to name two specific *.ufs.sh
    // subdomains — Launchstack's own UploadThing app IDs — which no other
    // deployment can serve images from.
    //
    // Note this is intrinsically build-time: next/image validates against the
    // compiled list, so a prebuilt GHCR image cannot pick up a new host without
    // a rebuild. That is the argument for the wildcard below rather than an
    // enumeration — a self-hoster's own UploadThing app gets a different
    // subdomain, and it should just work.
    images: {
        remotePatterns: [
            // Any UploadThing app, not just ours. Only relevant when UploadThing is
            // actually configured; harmless otherwise.
            { protocol: "https", hostname: "**.ufs.sh", pathname: "/f/**" },
            // The instance's own S3-compatible endpoint, when one is set.
            ...(() => {
                const raw = process.env.S3_PUBLIC_ENDPOINT ?? process.env.NEXT_PUBLIC_S3_ENDPOINT;
                if (!raw) return [];
                try {
                    const { protocol, hostname, port } = new URL(raw);
                    return [
                        {
                            protocol: protocol.replace(":", "") as "http" | "https",
                            hostname,
                            port,
                            pathname: "/**",
                        },
                    ];
                } catch {
                    return [];
                }
            })(),
            // Escape hatch: comma-separated hostnames, e.g. "cdn.example.com,img.example.com".
            ...(process.env.IMAGE_REMOTE_PATTERNS?.split(",") ?? [])
                .map(h => h.trim())
                .filter(Boolean)
                .map(hostname => ({
                    protocol: "https" as const,
                    hostname,
                    pathname: "/**",
                })),
        ],
    },

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

    // The evaluate route reads benchmark reference markdown from the features
    // package at runtime via fs; Next's tracer can't see those reads, so pull
    // the files into the standalone output explicitly.
    outputFileTracingIncludes: {
        "/api/marketing-pipeline/evaluate": [
            "../../packages/features/src/marketing-pipeline/benchmark/references/**",
        ],
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
        // Structured logging
        "pino",
        "pino-pretty",
        // Pure-CJS fuzzy match library used by note-anchor rehydration; webpack
        // tracing against its minimal package.json confuses Next's route manifest
        // in certain builds — bypass by externalizing.
        "diff-match-patch",
        // react-pdf + its pdfjs peer use native `new URL('...', import.meta.url)`
        // worker resolution and ship multiple entry points that trip up Next's
        // route-manifest tracing; same remedy as pdfjs-serverless above.
        "react-pdf",
        "pdfjs-dist",
    ],
};

export default config;
