/** @type {import('jest').Config} */
export const config = {
    testEnvironment: "node",
    setupFiles: ["<rootDir>/jest.setup.ts"],
    transform: {
        "^.+\\.(ts|tsx|js|jsx|mjs)$": ["babel-jest", { configFile: "./jest.babel.config.cjs" }],
    },
    transformIgnorePatterns: [
        "node_modules/(?!(react-markdown|remark-gfm|remark-math|rehype-katex|unified|bail|is-plain-obj|trough|vfile|unist-.*|micromark.*|mdast.*|hast-.*|decode-named-character-reference|character-entities|property-information|hast-util-whitespace|space-separated-tokens|comma-separated-tokens|ccount|escape-string-regexp|markdown-table)/)",
    ],
    // Keep ~/* pointed at apps/web src. The @launchstack/* mappings resolve the
    // workspace subpaths (e.g. @launchstack/core/ocr/trigger → the TS source)
    // so jest doesn't have to hit the built dist/.
    moduleNameMapper: {
        "^~/(.*)$": "<rootDir>/src/$1",
        "^@schema$": "<rootDir>/src/lib/agents/evals/campaign/contract.ts",
        "^@launchstack/engine$": "<rootDir>/../../packages/engine/src/index.ts",
        "^@launchstack/engine/config$": "<rootDir>/../../packages/engine/src/config/index.ts",
        "^@launchstack/engine/(.*)$": "<rootDir>/../../packages/engine/src/$1",
        "^@launchstack/runtime$": "<rootDir>/../../packages/runtime/src/index.ts",
        "^@launchstack/runtime/errors$": "<rootDir>/../../packages/runtime/src/errors.ts",
        "^@launchstack/runtime/storage$":
            "<rootDir>/../../packages/runtime/src/storage-port/index.ts",
        "^@launchstack/runtime/jobs$":
            "<rootDir>/../../packages/runtime/src/job-dispatcher-port/index.ts",
        "^@launchstack/runtime/slot$": "<rootDir>/../../packages/runtime/src/singleton-slot.ts",
        "^@launchstack/runtime/wire-version$":
            "<rootDir>/../../packages/runtime/src/wire-version.ts",
        "^@launchstack/store$": "<rootDir>/../../packages/store/src/index.ts",
        "^@launchstack/store/client$": "<rootDir>/../../packages/store/src/db/index.ts",
        "^@launchstack/store/schema$": "<rootDir>/../../packages/store/src/db/schema.ts",
        "^@launchstack/store/schema/(.*)$": "<rootDir>/../../packages/store/src/db/schema/$1",
        "^@launchstack/store/tables$": "<rootDir>/../../packages/store/src/db/tables.ts",
        "^@launchstack/store/pg-vector$": "<rootDir>/../../packages/store/src/db/pgVector.ts",
        "^@launchstack/store/backfills$":
            "<rootDir>/../../packages/store/src/db/backfills/index.ts",
        "^@launchstack/store/crypto$": "<rootDir>/../../packages/store/src/crypto/index.ts",
        "^@launchstack/store/credits$": "<rootDir>/../../packages/store/src/credits/index.ts",
        "^@launchstack/llm$": "<rootDir>/../../packages/llm/src/index.ts",
        "^@launchstack/llm/embeddings$": "<rootDir>/../../packages/llm/src/embeddings/index.ts",
        "^@launchstack/llm/guardrails$": "<rootDir>/../../packages/llm/src/guardrails/index.ts",
        "^@launchstack/llm/providers$": "<rootDir>/../../packages/llm/src/providers/index.ts",
        "^@launchstack/llm/providers/(.*)$": "<rootDir>/../../packages/llm/src/providers/$1",
        "^@launchstack/llm/(.*)$": "<rootDir>/../../packages/llm/src/$1",
        "^@launchstack/conversion$": "<rootDir>/../../packages/conversion/src/index.ts",
        "^@launchstack/conversion/ocr$":
            "<rootDir>/../../packages/conversion/src/ocr-processing/index.ts",
        "^@launchstack/conversion/ocr/adapters/(.*)$":
            "<rootDir>/../../packages/conversion/src/ocr-processing/adapters/$1",
        "^@launchstack/conversion/ocr/(.*)$":
            "<rootDir>/../../packages/conversion/src/ocr-processing/$1",
        "^@launchstack/conversion/document-converter$":
            "<rootDir>/../../packages/conversion/src/document-converter/index.ts",
        "^@launchstack/conversion/document-converter/(.*)$":
            "<rootDir>/../../packages/conversion/src/document-converter/$1",
        "^@launchstack/conversion/audio-transcription$":
            "<rootDir>/../../packages/conversion/src/audio-transcription/index.ts",
        "^@launchstack/conversion/video-transcription$":
            "<rootDir>/../../packages/conversion/src/video-transcription/index.ts",
        "^@launchstack/conversion/(.*)$": "<rootDir>/../../packages/conversion/src/$1",
        "^@launchstack/indexing$": "<rootDir>/../../packages/indexing/src/index.ts",
        "^@launchstack/indexing/doc-ingestion$":
            "<rootDir>/../../packages/indexing/src/doc-ingestion/index.ts",
        "^@launchstack/indexing/knowledge-graph$":
            "<rootDir>/../../packages/indexing/src/knowledge-graph/index.ts",
        "^@launchstack/indexing/(.*)$": "<rootDir>/../../packages/indexing/src/$1",
        "^@launchstack/retrieval$": "<rootDir>/../../packages/retrieval/src/index.ts",
        "^@launchstack/retrieval/retrievers$":
            "<rootDir>/../../packages/retrieval/src/algorithms/index.ts",
        "^@launchstack/retrieval/reranking$":
            "<rootDir>/../../packages/retrieval/src/algorithms/reranking/index.ts",
        "^@launchstack/retrieval/citation-builder$":
            "<rootDir>/../../packages/retrieval/src/tools/citation-builder/index.ts",
        "^@launchstack/retrieval/algorithms$":
            "<rootDir>/../../packages/retrieval/src/algorithms/index.ts",
        "^@launchstack/retrieval/tools$": "<rootDir>/../../packages/retrieval/src/tools/index.ts",
        "^@launchstack/retrieval/(.*)$": "<rootDir>/../../packages/retrieval/src/$1",
        "^@launchstack/orchestration$": "<rootDir>/../../packages/orchestration/src/index.ts",
        "^@launchstack/orchestration/pipeline-events$":
            "<rootDir>/../../packages/orchestration/src/pipeline-events.ts",
        "^@launchstack/orchestration/(.*)$": "<rootDir>/../../packages/orchestration/src/$1",
        "^@launchstack/collab$": "<rootDir>/../../packages/collab/src/index.ts",
        "^@launchstack/editing$": "<rootDir>/../../packages/editing/src/index.ts",
        "^@launchstack/editing/wire$": "<rootDir>/../../packages/editing/src/wire.ts",
        "^@launchstack/evidence$": "<rootDir>/../../packages/evidence/src/index.ts",
        "^@launchstack/tools$": "<rootDir>/../../packages/tools/src/index.ts",
        "^@launchstack/tools/(.*)$": "<rootDir>/../../packages/tools/src/$1",
        "^@launchstack/pipelines$": "<rootDir>/../../pipelines/src/index.ts",
        "^@launchstack/pipelines/(.*)$": "<rootDir>/../../pipelines/src/$1",
        "\\.(css|less|scss|sass)$": "<rootDir>/__mocks__/styleMock.js",
    },
    moduleDirectories: ["node_modules", "src"],
    moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "mjs", "cjs"],
    testMatch: ["**/__tests__/**/*.(test|spec).[jt]s?(x)"],
    verbose: true,
};

export default config;
