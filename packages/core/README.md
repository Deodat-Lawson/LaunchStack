# @launchstack/core

The **compatibility facade** for the Launchstack engine (ADR-002). Every
subpath this package has ever exported keeps working, and every one of them
re-exports from the layered engine packages that now hold the
implementation:

| Package | Holds |
|---|---|
| `@launchstack/protocol` | Cross-language contracts: pipeline events, `EvidenceDocument`, compute-service schemas (+ generated JSON Schema) |
| `@launchstack/evidence` | Pure company-state logic: citation anchors, supersession, diffing, conflicts, freshness |
| `@launchstack/application` | Use cases + ports: command acceptance, outbox processing, citation building |
| `@launchstack/adapters` | Implementations: Postgres (incl. the transactional outbox + engine schema), storage, providers, LLM routing, ingestion pipeline, `createEngine` |

`packages/core/src` contains **re-exports only** — enforced in CI by
`scripts/ci/check-core-facade.mjs`. New code should import from the layered
packages directly; this facade exists so published consumers never break.

Core also owns the **engine migrations** (`packages/core/drizzle`, ledger
`_launchstack_migrations`) and their runner (`scripts/migrate.mjs`) —
migration history is immutable and did not move.

## Install

```bash
pnpm add @launchstack/core drizzle-orm postgres
# Optional — only if you use the graph / local OCR stacks:
pnpm add neo4j-driver tesseract.js
```

Requires Node **20+**. The facade pulls the four engine packages as regular
dependencies; you do not install them separately.

## Usage

The engine reads **zero environment variables** (lint-enforced across all
engine packages) — all configuration is passed through `CoreConfig`:

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
  ocr: {
    defaultProvider: "NATIVE_PDF",
    // The document-converter service (routing/vision/parsing):
    converter: { url: "http://localhost:8002", apiKey: "…" },
  },
  providers: {},
  storage: myStoragePort,
});

const { db } = engine;
// …
await engine.close(); // closes DB pool + Neo4j driver if configured
```

`apps/web/src/server/engine.ts` in the Launchstack repository is the
reference composition root (also reused by `apps/worker`).

## Ports

The engine depends on the host for infrastructure concerns:

| Port | Purpose | Required |
|---|---|---|
| `StoragePort` | Upload/fetch/delete for document blobs (S3, Postgres base64, …) | yes |
| `CreditsPort` | Per-workspace token debiting before LLM spend | no (unmetered if absent) |
| `RagPort` | Hybrid retrieval over the host's ensemble | no |
| `JobDispatcherPort` | Deprecated (ADR-003): ingestion now flows through the transactional outbox (`pdr_ai_v2_event_outbox`) consumed by a worker process. Kept for external consumers who wire their own runner. | no |

## Subsystem subpaths

Unchanged — each subsystem keeps its subpath (`/config`, `/errors`, `/db`,
`/db/schema`, `/ingestion`, `/ocr/*`, `/llm`, `/embeddings`, `/rag`,
`/rag/retrievers`, `/graph`, `/guardrails`, `/providers/*`, `/crypto`,
`/credits`, `/jobs`, `/storage`, `/collab/*`). CI proves every subpath
loads under plain Node ESM from the packed tarball
(`scripts/ci/check-package-exports.mjs`).

## Error model

Typed errors from `@launchstack/core/errors` (re-exported from
`@launchstack/adapters/errors`) so hosts can map failures to HTTP without
parsing message strings.

## License

Apache-2.0 — see [LICENSE](LICENSE).
