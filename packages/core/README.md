# @launchstack/core

Framework-agnostic engine for document ingestion, RAG, knowledge graphs, OCR, and LLM capability routing. Runs under Next.js, Node, or any host that supplies a `StoragePort`, `JobDispatcherPort`, and (optionally) a `CreditsPort` and `RagPort`.

Core reads **zero environment variables** at runtime — all config is passed in through `CoreConfig`. Hosts adapt their environment once and hand the result to `createEngine`.

## Install

```bash
pnpm add @launchstack/core drizzle-orm postgres
# Optional — only if you use the graph / local OCR stacks:
pnpm add neo4j-driver tesseract.js
```

Requires Node **20+**.

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

// Use the engine
const { db } = engine;
const results = await engine.rag?.port.search({ query: "..." });

// Graceful shutdown (closes DB pool + Neo4j driver if configured)
await engine.close();
```

## Ports

Core depends on the host for four infrastructure concerns. Supply adapters that match your deployment:

| Port | Purpose | Required |
|---|---|---|
| `StoragePort` | Upload, fetch, signed URLs for document blobs (S3, local disk, Postgres base64) | yes |
| `JobDispatcherPort` | Enqueue background jobs (Inngest, Trigger.dev, BullMQ) | no (sync mode works without) |
| `CreditsPort` | Per-tenant token/credit debiting; core calls it before LLM spend | no (unmetered if absent) |
| `RagPort` | Hybrid retrieval over the host's vector + keyword indices | no (features fall back to DB scan) |

Port interfaces live under the matching subpath exports (`@launchstack/core/storage`, `@launchstack/core/jobs`, etc.).

## Subsystem subpaths

Each subsystem exposes its own subpath so consumers can tree-shake:

```
@launchstack/core              // createEngine + top-level types
@launchstack/core/config       // CoreConfig types
@launchstack/core/errors       // LaunchstackError hierarchy
@launchstack/core/db           // Drizzle + schema
@launchstack/core/ingestion    // document chunking + adapters
@launchstack/core/ocr          // (subpaths: /config, /complexity, /processor, /adapters/*)
@launchstack/core/llm          // chat-model factory
@launchstack/core/embeddings   // embedding-provider routing
@launchstack/core/rag          // RAG port + search helpers
@launchstack/core/graph        // Neo4j client
@launchstack/core/guardrails   // PII filter, grounding check, confidence gate
@launchstack/core/providers    // registry for rerank/NER/transcription
@launchstack/core/crypto       // secret-box for per-company credentials
```

## Error model

Core throws typed errors from [`@launchstack/core/errors`](src/errors/index.ts) so hosts can map failures to HTTP (or any other transport) without parsing message strings:

| Class | Code | Typical mapping |
|---|---|---|
| `ConfigError` | `LAUNCHSTACK_CONFIG` | 500 + page an operator |
| `ProviderError` | `LAUNCHSTACK_PROVIDER` | 502 / 503; `retryable` flag on the instance |
| `StorageError` | `LAUNCHSTACK_STORAGE` | 500; do not auto-retry |
| `CreditsError` | `LAUNCHSTACK_CREDITS` | 402 (payment required) |
| `ValidationError` | `LAUNCHSTACK_VALIDATION` | 400 + `field` on the instance |
| `LaunchstackError` | (base) | catch-all — check `code` |

Use the `isLaunchstackError()` guard in host error middleware:

```ts
import { isLaunchstackError } from "@launchstack/core/errors";

export function errorToResponse(err: unknown) {
  if (isLaunchstackError(err)) {
    return { status: mapCodeToStatus(err.code), body: { code: err.code, message: err.message } };
  }
  return { status: 500, body: { code: "INTERNAL", message: "Unexpected error" } };
}
```

## Retry semantics

- **Core retries internally** for: LLM provider calls (with exponential backoff on 429/5xx), embedding requests, OCR router calls
- **Core does NOT retry** for: storage operations (deterministic), credit debits (idempotent guard on the host side), DB queries (let the connection pool handle reconnect)
- **Host is expected to retry** whole operations when the dispatcher (Inngest/Trigger.dev) signals a step failure — that's where durable retry lives

## License

Apache-2.0
