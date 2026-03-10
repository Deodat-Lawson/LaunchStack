import type { NextConfig } from "next";

import "./src/env";

// Standalone uses symlinks when copying traced deps; Windows often lacks permission (EPERM).
// Use standalone only on non-Windows, or when STANDALONE_BUILD=1 (e.g. CI/Docker or Windows with Developer Mode).
const useStandalone =
  process.env.STANDALONE_BUILD === "1" || process.platform !== "win32";

const config: NextConfig = {
  // Standalone output for Docker deployment (smaller production image)
  output: useStandalone ? "standalone" : undefined,

  // Force HuggingFace Transformers to use web backend (WASM) instead of Node.js (onnxruntime-node)
  // This prevents the 404MB onnxruntime-node package from being required
  env: {
    TRANSFORMERS_BACKEND: "wasm",
    USE_ONNX_NODE: "false",
    ONNX_EXECUTION_PROVIDERS: "wasm",
  },

  // Webpack config: externals for optional / heavy packages
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webpack: (webpackConfig: any, { isServer }: { isServer: boolean }) => {
    if (isServer) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      webpackConfig.externals = webpackConfig.externals ?? [];
      // Mark onnxruntime-node as external - never bundle it
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      webpackConfig.externals.push({
        "onnxruntime-node": "commonjs onnxruntime-node",
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return webpackConfig;
  },

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
  outputFileTracingExcludes: {
    "/*": [
      // Exclude the massive onnxruntime-node package (404MB) - we use web/WASM backend only
      "node_modules/.pnpm/onnxruntime-node@*/**",
      "node_modules/onnxruntime-node/**",
      "**/onnxruntime-node/**",
      // Exclude sharp native bindings - use external package
      "node_modules/.pnpm/@img+sharp-libvips-linuxmusl-x64@*/**",
      "node_modules/.pnpm/@img+sharp-libvips-linux-x64@*/**",
      // Exclude HuggingFace heavy files since we lazy load
      "node_modules/.pnpm/@huggingface+transformers@*/node_modules/@huggingface/transformers/dist/**/*.wasm",
      "node_modules/.pnpm/@huggingface+transformers@*/node_modules/@huggingface/transformers/models/**",
      // Exclude pdfjs heavy files since we lazy load (keep legacy build - used for Node.js/Inngest)
      "node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/build/**/*.map",
      // Exclude pdf-parse test data (8MB)
      "node_modules/.pnpm/pdf-parse@*/node_modules/pdf-parse/test/**",
      "node_modules/pdf-parse/test/**",
    ],
  },

  // Exclude heavy packages from serverless bundle to reduce size (Next.js 15+)
  // These packages are loaded from node_modules at runtime instead
  serverExternalPackages: [
    "@huggingface/transformers",
    "pdf2pic",
    "pdfjs-serverless",
    "onnxruntime-web",
    "sharp",
    "@img/sharp-libvips-linuxmusl-x64",
    "@img/sharp-libvips-linux-x64",
    "pdf-lib",
  ],
};

export default config;

