# @launchstack/core

Framework-agnostic engine for document ingestion, RAG, knowledge graphs, OCR,
and LLM capability routing. Runs under Next, Node, or any host that supplies
a `StoragePort`, `JobDispatcherPort`, and (optionally) a `CreditsPort`.

Core never reads `process.env` — all runtime config is passed in through
`CoreConfig`. Hosts adapt their environment once and hand the result to
`createEngine`.

## Install

```bash
pnpm add @launchstack/core drizzle-orm postgres
# Optional — only if you use the graph / local OCR stacks:
pnpm add neo4j-driver tesseract.js
```

## Usage

```ts
import { createEngine } from "@launchstack/core";

const engine = createEngine({
  db: { url: process.env.DATABASE_URL! },
  llm: {
    openai: process.env.OPENAI_API_KEY
      ? { apiKey: process.env.OPENAI_API_KEY }
      : undefined,
  },
  embeddings: { indexName: "openai-3-small" },
  ocr: { defaultProvider: "NATIVE_PDF" },
  providers: {},
  storage: myStoragePort,
  jobs: { dispatcher: myJobDispatcherPort },
  credits: { port: myCreditsPort }, // optional
});

// engine.db, engine.storage, engine.neo4j(), …
```

See the restructure plan in the Launchstack monorepo for a complete tour of
which subsystems live here and how hosts are expected to wire them.

## License

MIT
