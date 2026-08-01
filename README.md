# Launchstack

**A TypeScript engine for AI-native applications.** Ingestion, OCR, RAG, knowledge graph, LLM abstractions, and background jobs — ports-based, and wired into a Next.js reference app that shows how the pieces fit together.

[![license](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![CI](https://github.com/Deodat-Lawson/LaunchStack/actions/workflows/CI.yml/badge.svg)](https://github.com/Deodat-Lawson/LaunchStack/actions/workflows/CI.yml)
[![types](https://img.shields.io/badge/types-TypeScript-blue.svg)](https://www.typescriptlang.org/)

[Run it](#run-it-locally) · [Repository layout](#repository-layout) · [Packages](#whats-in-the-box) · [Architecture](#architecture) · [Contributing](CONTRIBUTING.md)

---

## Status

`@launchstack/core` is **not published to npm yet**. `pnpm add @launchstack/core` will not resolve. The engine currently runs as part of this monorepo, and the separation work needed to publish it is in progress — see [Using core standalone](#using-core-standalone).

If you want to try Launchstack today, run the reference app below.

---

## Run it locally

```bash
git clone https://github.com/Deodat-Lawson/LaunchStack.git
cd LaunchStack
pnpm install
cp .env.example .env          # fill in required keys
```

Then either run the full stack in Docker:

```bash
make up          # lite (~400MB RAM)
make up-ocr      # with Docling for Office docs (~1.2GB RAM)
```

Or run the web app directly against a local database:

```bash
pnpm --filter @launchstack/web db:push    # sync Drizzle schema
pnpm --filter @launchstack/web dev        # Next.js + Inngest on :3000 and :8288
```

**Stop the stack:**

```bash
make down         # stop containers (keeps volumes — DB + S3 data persists)
make down-clean   # stop + wipe volumes (fresh DB on next up)
```

<details>
<summary>Windows (no <code>make</code>)</summary>

```powershell
docker compose --env-file .env up --build                                                                   # lite
docker compose --env-file .env --profile ocr -f docker-compose.yml -f docker-compose.ocr.yml up --build -d   # with Docling

docker compose --env-file .env down                      # stop (keeps volumes)
docker compose --env-file .env down -v --remove-orphans  # stop + wipe volumes
```

Or install `make` via [Chocolatey](https://chocolatey.org/) (`choco install make`) or [Scoop](https://scoop.sh/) (`scoop install make`).

</details>

> **The repository root is not an application.** It is a pnpm workspace: zero dependencies, no server, no app code. `pnpm dev` at the root does nothing — always target a package with `--filter`. Only repo-wide commands (`lint`, `typecheck`, `format:*`, `check`, and the Changesets scripts) live at the root.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full dev guide.

---

## Repository layout

[**`REPOSITORY.md`**](REPOSITORY.md) is the map: every directory, all deploy targets, and which areas are engine versus hosted product. Read it before the layout below surprises you.

The short version:

| Path | What it is |
|---|---|
| [`apps/web`](apps/web) | The Next.js reference app. Its Dockerfiles live beside it, not at the root. |
| [`packages/core`](packages/core) | The engine. |
| [`packages/features`](packages/features) | Vertical features built on core. |
| [`services/`](services), [`sidecar/`](sidecar) | Standalone containers — two Python, one Node. Not part of the pnpm workspace; each manages its own dependencies. |
| [`scripts/`](scripts) | `ops/` for operational tasks, `dev/` for manual developer probes. |

Two boundary caveats worth knowing up front, both tracked in `REPOSITORY.md`: `packages/core` currently contains the SaaS database schema, and the RAG pipeline implementation still lives under `apps/web`. Directory names are not yet a reliable guide to what is engine and what is product.

---

## What's in the box

| Package | Status | What it does |
|---|---|---|
| [`@launchstack/core`](packages/core) | unpublished | The engine. DB, LLM, embeddings, OCR, RAG, graph, crypto, guardrails, ingestion. |
| [`@launchstack/features/*`](packages/features) | internal | Vertical features built on core: `adeu`, `client-prospector`, `company-metadata`, `doc-ingestion`, `legal-templates`, `marketing-pipeline`, `repo-explainer`, `trend-search`, `voice` |
| [`@launchstack/features/mcp`](packages/features/src/mcp) *(planned)* | roadmap | MCP server factory — expose core capabilities as tools |
| [`@launchstack/features/workflow-generation`](packages/features/src/workflow-generation) *(planned)* | roadmap | LLM-authored workflow DSL |
| [`@launchstack/features/rules-extraction`](packages/features/src/rules-extraction) *(planned)* | roadmap | Regulatory rule extraction |
| [`@launchstack/features/connectors`](packages/features/src/connectors) *(planned)* | roadmap | Third-party connector integrations |
| [`apps/web`](apps/web) | — | The Next.js reference app — how we wire everything together |

Features import core via subpath imports (`@launchstack/core/db`, `@launchstack/core/ocr/processor`, etc.). The reference app imports features and supplies the ports (storage, jobs, credits, RAG) that connect to real infrastructure.

---

## Architecture

Core exposes ports that the host wires up. Features depend only on these ports; they never reach into the app or the framework.

```
          ┌───────────── apps/web (Next.js host) ────────────┐
          │  env.ts  →  engine.ts  →  createEngine(config)   │
          │              │                                   │
          │              └─ wires: StoragePort (S3)          │
          │                        JobDispatcherPort (Inngest)
          │                        CreditsPort (DB)          │
          │                        RagPort (hybrid search)   │
          └──────────────────┬────────────────────────────────┘
                             │
          ┌──────────────────▼────────────────────┐
          │   @launchstack/features/*             │
          │   (adeu, marketing-pipeline, ...)     │
          │   import via @launchstack/core/<sub>  │
          └──────────────────┬────────────────────┘
                             │
          ┌──────────────────▼────────────────────┐
          │   @launchstack/core                   │
          │   db · llm · embeddings · ocr · rag · │
          │   graph · guardrails · ingestion      │
          └───────────────────────────────────────┘
```

- **Core** knows no framework. Config is meant to arrive through `CoreConfig`.
- **Features** can read `process.env`, but cannot import from the host app.
- **Host** owns env, auth, routing, and implements the ports.
- ESLint enforces these boundaries — see [`eslint.config.js`](eslint.config.js).

### Wiring the engine

`createEngine(config)` opens the database pool and registers the storage, jobs, credits and RAG ports. It is **not** sufficient on its own: several subsystems are configured through separate registration calls that the host must make first.

```ts
import { createEngine } from "@launchstack/core";
import { configureChatModels } from "@launchstack/core/llm";
import { configureOcr } from "@launchstack/core/ocr/config";
import { configureSecretBox } from "@launchstack/core/crypto";
// …plus embeddings and provider registration

configureChatModels({ /* … */ });
configureOcr({ /* … */ });
configureSecretBox({ key: /* … */ });

const engine = createEngine({
  db: { url: process.env.DATABASE_URL! },
  llm: { openai: { apiKey: process.env.OPENAI_API_KEY! } },
  embeddings: { indexName: "openai-3-small" },
  ocr: { defaultProvider: "DOCLING" },
  providers: {},
  storage: myStoragePort,        // you implement StoragePort (S3, local, etc.)
  jobs: { dispatcher: inngest }, // or any JobDispatcherPort
});

const { db } = engine;  // Drizzle client
await engine.close();   // graceful shutdown
```

[`apps/web/src/server/engine.ts`](apps/web/src/server/engine.ts) is the complete, working version — read it rather than this excerpt when wiring your own host.

These registration functions currently store state on `globalThis`, which means **one engine per process**. Consolidating them into the engine instance is planned work.

---

## Reference app

[`apps/web`](apps/web) is a Next.js app built on the engine. It demonstrates:

- Clerk employer/employee auth with role-aware middleware
- Document upload + optional OCR (Marker, Docling, Azure, Landing.AI, Datalab)
- PostgreSQL + pgvector semantic retrieval for RAG
- AI chat with agent guardrails (PII filter, grounding, confidence gate)
- Predictive document analysis across 8 document types
- Marketing pipeline for Reddit, X, LinkedIn, Bluesky
- Inngest-backed background jobs
- Optional LangSmith tracing

### Supported document sources

The ingestion pipeline reads exports from common tools without requiring OAuth — just drop the files in:

| Source | Export | Adapter |
|---|---|---|
| Notion | Markdown & CSV / HTML | TextAdapter, HtmlAdapter |
| Google Docs / Sheets | DOCX / CSV / XLSX | DocxAdapter, SpreadsheetAdapter |
| Google Drive | Takeout ZIP | DocxAdapter |
| Slack | Workspace export JSON | JsonExportAdapter |
| GitHub | Code ZIP, `gh issue/pr list --json` | TextAdapter, JsonExportAdapter |

Plus first-class PDF, DOCX, PPTX, XLSX, MD, HTML, TXT, and image adapters.

---

## Using core standalone

The goal is for `@launchstack/core` to be a plain TypeScript library you can drop into any Node 20+ project with a Postgres database. It is not there yet. Three things are outstanding:

1. **It is not published.** The package also resolves its `exports` to `./src/*.ts` while shipping only `dist`, so a published tarball would currently contain no importable entry point.
2. **It is not environment-independent.** Nine files under `packages/core/src` still read `process.env` as documented transitional fallbacks, despite the ESLint rule forbidding it.
3. **It still owns product concerns.** The SaaS database schema lives in core, and its search contract is keyed on `companyId`, so consumers would inherit our tenancy model.

See [`packages/core/README.md`](packages/core/README.md) for the current API surface and port interfaces, and [`REPOSITORY.md`](REPOSITORY.md) for the tracked list of boundary issues.

---

## Community & support

- **Issues** — [github.com/Deodat-Lawson/LaunchStack/issues](https://github.com/Deodat-Lawson/LaunchStack/issues)
- **Security** — email per [SECURITY.md](SECURITY.md)

---

## Contributing

We welcome PRs — start with [CONTRIBUTING.md](CONTRIBUTING.md). A few things to know up front:

- One issue per PR
- Changes to `packages/core/` need a [Changeset](https://github.com/changesets/changesets) (`pnpm changeset`)
- ESLint enforces core/features/host import boundaries; don't work around them

## License

Licensed under the [Apache License 2.0](LICENSE). By contributing you agree your contributions will be released under the same license.
