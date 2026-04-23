# Launchstack

**The TypeScript engine for AI-native Next.js apps.** Ingestion, OCR, RAG, knowledge graph, LLM abstractions, and background jobs — ports-based, framework-agnostic, and designed to be wired into the Next.js app you already have.

[![npm](https://img.shields.io/npm/v/@launchstack/core.svg)](https://www.npmjs.com/package/@launchstack/core)
[![license](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![CI](https://github.com/launchstack/launchstack/actions/workflows/CI.yml/badge.svg)](https://github.com/launchstack/launchstack/actions/workflows/CI.yml)
[![types](https://img.shields.io/badge/types-TypeScript-blue.svg)](https://www.typescriptlang.org/)

[Quickstart](#quickstart) · [Packages](#whats-in-the-box) · [Architecture](#architecture) · [Reference app](#reference-app) · [Contributing](CONTRIBUTING.md) · [Discussions](https://github.com/launchstack/launchstack/discussions)

---

## Quickstart

```bash
pnpm add @launchstack/core
```

```ts
import { createEngine } from "@launchstack/core";

const engine = createEngine({
  db: { url: process.env.DATABASE_URL! },
  llm: { openai: { apiKey: process.env.OPENAI_API_KEY! } },
  embeddings: { indexName: "openai-3-small" },
  ocr: { defaultProvider: "DOCLING" },
  providers: {},
  storage: myStoragePort,        // you implement StoragePort (S3, local, etc.)
  jobs: { dispatcher: inngest }, // or any JobDispatcherPort
});

// Use any subsystem
const { db } = engine;
const results = await engine.rag?.port.search({ query: "What's in my docs?" });
await engine.close(); // graceful shutdown
```

Core reads **zero environment variables** at runtime — you supply the config, which makes the engine portable across Next.js, CLIs, workers, and MCP servers.

---

## What's in the box

| Package | Status | What it does |
|---|---|---|
| [`@launchstack/core`](packages/core) | **published** | The engine. DB, LLM, embeddings, OCR, RAG, graph, crypto, guardrails, ingestion. Framework-agnostic. |
| [`@launchstack/features/*`](packages/features) | internal | Vertical features built on top of core: `adeu`, `client-prospector`, `company-metadata`, `doc-ingestion`, `legal-templates`, `marketing-pipeline`, `repo-explainer`, `trend-search`, `voice` |
| [`@launchstack/features/mcp`](packages/features/src/mcp) *(planned)* | roadmap | MCP server factory — expose core capabilities as tools |
| [`@launchstack/features/workflow-generation`](packages/features/src/workflow-generation) *(planned)* | roadmap | LLM-authored workflow DSL |
| [`@launchstack/features/rules-extraction`](packages/features/src/rules-extraction) *(planned)* | roadmap | Regulatory rule extraction |
| [`@launchstack/features/connectors`](packages/features/src/connectors) *(planned)* | roadmap | Third-party connector integrations |
| [`apps/web`](apps/web) | — | The Next.js reference app — how we wire everything together |

Features import core via subpath imports (`@launchstack/core/db`, `@launchstack/core/ocr/processor`, etc.). The reference app imports features and supplies the ports (storage, jobs, credits, RAG) that connect to real infrastructure.

---

## Architecture

Core exposes four **ports** that the host wires up. Features depend only on these ports; they never reach into the app or the framework.

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

- **Core** reads no env, knows no framework. All config comes through `CoreConfig`.
- **Features** can read `process.env`, but cannot import from the host app.
- **Host** owns env, auth, routing, and implements the ports.
- ESLint enforces these boundaries — see [`eslint.config.js`](eslint.config.js).

---

## Reference app

[`apps/web`](apps/web) is a production-grade Next.js app built on the engine. It demonstrates:

- Clerk employer/employee auth with role-aware middleware
- Document upload + optional OCR (Marker, Docling, Azure, Landing.AI, Datalab)
- PostgreSQL + pgvector semantic retrieval for RAG
- AI chat with agent guardrails (PII filter, grounding, confidence gate)
- Predictive document analysis across 8 document types (contract, financial, technical, compliance, educational, HR, research, general)
- Marketing pipeline for Reddit, X, LinkedIn, Bluesky
- Inngest-backed background jobs
- Optional LangSmith tracing

**Run it locally:**

```bash
git clone https://github.com/launchstack/launchstack.git
cd launchstack
pnpm install
cp .env.example .env          # fill in required keys
pnpm db:push                  # sync Drizzle schema
pnpm dev                      # Next.js + Inngest on :3000 and :8288
```

Or spin the full stack (Postgres + SeaweedFS + sidecars) with Docker:

```bash
# macOS / Linux
make up          # lite (~400MB RAM)
make up-ocr      # with Docling for Office docs (~1.2GB RAM)
```

```powershell
# Windows (PowerShell or cmd — requires Docker Desktop)
docker compose --env-file .env up --build                                                      # lite (~400MB RAM)
docker compose --env-file .env --profile ocr -f docker-compose.yml -f docker-compose.ocr.yml up --build -d   # with Docling (~1.2GB RAM)
```

> Or install `make` on Windows via [Chocolatey](https://chocolatey.org/) (`choco install make`) or [Scoop](https://scoop.sh/) (`scoop install make`) to use the `make up` shortcuts.

**Stop the stack:**

```bash
# macOS / Linux
make down         # stop containers (keeps volumes — DB + S3 data persists)
make down-clean   # stop + wipe volumes (fresh DB on next up)
```

```powershell
# Windows
docker compose --env-file .env down                     # stop containers (keeps volumes)
docker compose --env-file .env down -v --remove-orphans # stop + wipe volumes (fresh DB)
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full dev guide.

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

`@launchstack/core` is a plain TypeScript library published to npm — **you don't need the monorepo to use it**. Drop it into any Node-20+ project that has a Postgres database and implement a `StoragePort`. The reference app is one way to wire it up; it isn't the only way.

See [`packages/core/README.md`](packages/core/README.md) for the full API surface and port interfaces.

---

## Community & support

- **Discussions** — [github.com/launchstack/launchstack/discussions](https://github.com/launchstack/launchstack/discussions)
- **Issues** — [github.com/launchstack/launchstack/issues](https://github.com/launchstack/launchstack/issues)
- **Security** — email per [SECURITY.md](SECURITY.md)

---

## Contributing

We welcome PRs — start with [CONTRIBUTING.md](CONTRIBUTING.md). A few things to know up front:

- One issue per PR
- Changes to `packages/core/` need a [Changeset](https://github.com/changesets/changesets) (`pnpm changeset`)
- ESLint enforces core/features/host import boundaries; don't work around them

## License

Licensed under the [Apache License 2.0](LICENSE). By contributing you agree your contributions will be released under the same license.
