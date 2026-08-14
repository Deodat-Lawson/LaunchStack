# Launchstack

**A TypeScript engine for AI-native applications.** Ingestion, OCR, RAG, knowledge graph, LLM abstractions, and background jobs — ports-based, and wired into a Next.js reference app that shows how the pieces fit together.

[![license](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![CI](https://github.com/Deodat-Lawson/LaunchStack/actions/workflows/CI.yml/badge.svg)](https://github.com/Deodat-Lawson/LaunchStack/actions/workflows/CI.yml)
[![types](https://img.shields.io/badge/types-TypeScript-blue.svg)](https://www.typescriptlang.org/)

[Run it](#run-it-locally) · [Repository layout](#repository-layout) · [Packages](#whats-in-the-box) · [Architecture](#architecture) · [Chat models](docs/chat-models.md) · [Contributing](CONTRIBUTING.md)

---

## Status

The engine packages (`@launchstack/protocol`, `evidence`, `application`, `adapters`, and the `core` facade) are **not yet on npm** — the first release will publish them together through the Changesets flow in [`release.yml`](.github/workflows/release.yml) (the old hardcoded-repo gate and missing `.changeset/` that blocked releases are fixed; the workflow validates the packed tarball with `publint` and a Node-ESM loadability check for every subpath). Until that first release lands, consume the engine by running this repository.

To try Launchstack today, run the app below.

---

## Run it locally

**Requirements:** Node ≥ 20 and pnpm 10.15.1 (`corepack enable` picks up the pinned version).

```bash
git clone https://github.com/Deodat-Lawson/LaunchStack.git
cd LaunchStack
pnpm install
cp .env.example .env
```

`apps/web/src/env.ts` will refuse to boot without `DATABASE_URL` and `CLERK_SECRET_KEY`. Chat needs no variable at all: with `CHAT_BASE_URL` unset it defaults to Google Gemini's OpenAI-compatible endpoint, authenticated with `GOOGLE_AI_API_KEY`. Set `CHAT_BASE_URL` (plus `CHAT_API_KEY`) to reach anything else. There is still no *per-vendor* variable: a bare `OPENAI_API_KEY`, `OPENROUTER_API_KEY` or `OLLAMA_BASE_URL` will *not* configure chat, and none of them is forwarded to the Gemini default — a key names who you are, not where the request goes, and every one of those providers speaks the same OpenAI chat-completions protocol, so each is reached through `CHAT_BASE_URL` like any other. Only `AI_BASE_URL`/`AI_API_KEY`, a straight rename of the canonical pair, is still translated for a release with a deprecation warning. See [Chat models](#chat-models).

### With Docker (recommended)

```bash
make up-prod     # lite stack, detached (~400MB RAM)
make up-ocr      # adds Docling for Office docs, detached (~1.2GB RAM)
make logs        # follow logs
make down        # stop containers (keeps volumes — DB + S3 data persists)
make down-clean  # stop + wipe volumes (fresh DB on next up)
```

`make up` also exists but runs in the **foreground** — you will need a second shell to run `make down`. Use `make up-prod` unless you want to watch the build. `make up-fast` builds Next.js on the host first and is the quickest iteration loop.

### Without Docker

You need a Postgres with the **pgvector** extension available — the migration
runner enables it and exits non-zero on stock Postgres.

```bash
pnpm --filter @launchstack/web    db:migrate   # apply BOTH migration sets (engine, then product)
pnpm --filter @launchstack/core   db:seed      # optional: one company/user/document
pnpm --filter @launchstack/web    dev          # Next.js on :3000
pnpm --filter @launchstack/worker dev          # the durable worker on :8020 — ingestion runs here, not in web
pnpm --filter @launchstack/web    inngest:dev  # optional: Inngest dev UI on :8288, pointed at the worker's :8020/api/inngest
```

`web dev` is plain `next dev` — it accepts uploads but processes nothing.
Run the worker alongside it or documents will sit queued forever; the
Inngest dev server is only needed for the Inngest-hosted background
verticals (trend search, prospector, …), not for ingestion.

`db:migrate` is the same command CI, Docker and the Vercel production build run.
Running it from `@launchstack/core` applies only the engine set — that is what a
consumer embedding the engine uses, not what a full app needs.
Nothing else creates schema — see [Changing the database](CONTRIBUTING.md#changing-the-database).

> **If you ran `make up` first**, note that Compose publishes Postgres on host port **5433** with database `pdr_ai_v2`, while `.env.example` ships `localhost:5432/pdr_ai`. Point `DATABASE_URL` at `localhost:5433/pdr_ai_v2` to reuse the container's database.

<details>
<summary>Windows (no <code>make</code>)</summary>

```powershell
docker compose --env-file .env up --build -d                 # lite
docker compose --env-file .env --profile ocr up --build -d   # with Docling

docker compose --env-file .env down --remove-orphans      # stop (keeps volumes)
docker compose --env-file .env down -v --remove-orphans   # stop + wipe volumes
```

Or install `make` via [Chocolatey](https://chocolatey.org/) (`choco install make`) or [Scoop](https://scoop.sh/) (`scoop install make`).

</details>

> **The repository root is not an application.** It is a pnpm workspace: no runtime dependencies, no server, no app code. `pnpm dev` at the root fails with `ERR_PNPM_NO_SCRIPT` — always target a package with `--filter`. Only repo-wide commands live at the root: `lint`, `lint:fix`, `typecheck`, `check`, `format:write`, `format:check`, and the Changesets scripts.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full dev guide.

---

## Repository layout

[**`REPOSITORY.md`**](REPOSITORY.md) is the map: every directory, all deploy targets, and which areas are engine versus hosted product. Read it before the layout below surprises you.

| Path | What it is |
|---|---|
| [`apps/web`](apps/web) | The Next.js app: UI, auth, command acceptance, synchronous reads. |
| [`apps/worker`](apps/worker) | The durable workflow coordinator — consumes the ingestion outbox and hosts the background jobs (ADR-003). |
| [`packages/protocol`](packages/protocol), [`packages/evidence`](packages/evidence), [`packages/application`](packages/application), [`packages/adapters`](packages/adapters) | The layered engine (ADR-002): contracts → pure company-state logic → use cases/ports → implementations. |
| [`packages/core`](packages/core) | The published compatibility facade over the engine packages. |
| [`packages/features`](packages/features) | Vertical features built on the engine. |
| [`services/`](services) | Compute services — document-converter (Node), transcription and document-editor (Python). Not part of the pnpm workspace; each manages its own dependencies. |
| [`scripts/`](scripts) | `ci/` for gates, `ops/` for operational tasks, `dev/` for manual developer probes. |

---

## What's in the box

| Package | Status | What it does |
|---|---|---|
| [`@launchstack/core`](packages/core) | unpublished | The engine: `db`, `llm`, `embeddings`, `ocr`, `rag`, `graph`, `crypto`, `guardrails`, `ingestion`, `providers`, `storage`, `jobs`, `credits`, `errors`. |
| [`@launchstack/features/*`](packages/features) | internal | Vertical features built on core: `adeu`, `client-prospector`, `company-metadata`, `doc-ingestion`, `legal-templates`, `marketing-pipeline`, `repo-explainer`, `trend-search`, `voice` |
| `mcp`, `workflow-generation`, `rules-extraction`, `connectors` | roadmap | Scaffolding only — each is a README plus an `index.ts` containing `export {}`. **Not** declared in `packages/features` exports, so they are not importable yet. |
| [`apps/web`](apps/web) | — | The Next.js reference app — how we wire everything together |

Features import core via subpath imports (`@launchstack/core/db`, `@launchstack/core/ocr/processor`, etc.). The reference app imports features and supplies the ports (storage, jobs, credits, RAG) that connect to real infrastructure.

---

## Architecture

Core exposes ports that the host wires up. Features depend only on these ports; they never reach into the app or the framework.

```
          ┌───────────── apps/web (Next.js host) ─────────────┐
          │  env.ts  →  engine.ts  →  createEngine(config)    │
          │              │                                    │
          │              └─ wires: StoragePort (S3)           │
          │                        JobDispatcherPort (Inngest)│
          │                        CreditsPort (DB)           │
          │                        RagPort (hybrid search)    │
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

- **Core** knows no framework. Config arrives through `CoreConfig`.
- **Features** can read `process.env`, but cannot import from the host app.
- **Host** owns env, auth, routing, and implements the ports.
- [`eslint.config.js`](eslint.config.js) declares these boundaries and CI enforces them: the lint step is blocking (ADR-006) and the tree lints clean. The engine packages read no `process.env` — the no-env rule is lint-enforced, not aspirational.

### Wiring the engine

`createEngine(config)` opens the database pool and registers the storage, jobs, credits, RAG, database and Neo4j slots. Several subsystems are configured through **separate** registration calls — [`apps/web/src/server/engine.ts`](apps/web/src/server/engine.ts) makes seven of them: `configureAppChatModels`, `configureEmbeddingIndexRegistry`, `configureEmbeddingFactory`, `configureCompanyEmbeddingDefaults`, `configureProviders`, `configureSecretBox`, and `configureOcr`. Chat is the odd one out: `createEngine` already applies `config.llm.chat` itself, so `configureAppChatModels` only re-registers the same configuration and your own host needs no separate chat call. Slots are read lazily, so what matters is that they are set before a subsystem is first *used*.

```ts
import { readFileSync } from "node:fs";
import { createEngine } from "@launchstack/core";
import { createChatModelsConfig } from "@launchstack/core/llm";
import { configureOcr } from "@launchstack/core/ocr/config";
import { configureSecretBox } from "@launchstack/core/crypto";
// …plus the embeddings and provider registrations listed above

const engine = createEngine({
  db: { url: process.env.DATABASE_URL! },
  llm: {
    // Chat: one OpenAI-compatible endpoint; models and routes come from YAML.
    chat: createChatModelsConfig({
      yaml: readFileSync("apps/web/config/chat-models.yaml", "utf8"),
      endpoint: {
        baseUrl: process.env.CHAT_BASE_URL!,
        apiKey: process.env.CHAT_API_KEY, // omit for keyless endpoints
      },
    }),
    // Non-chat OpenAI-compatible work keeps its own credential — it must
    // never borrow the chat endpoint's key.
    openai: { apiKey: process.env.OPENAI_API_KEY! },
  },
  embeddings: { indexName: "legacy-openai-1536" },
  ocr: { defaultProvider: "NATIVE_PDF" },
  providers: {},
  storage: myStoragePort,           // you implement StoragePort (S3, local, …)
  jobs: { dispatcher: myDispatcher }, // a JobDispatcherPort: { dispatch(), name }
});

const { db } = engine;  // Drizzle client
await engine.close();   // graceful shutdown
```

`jobs.dispatcher` is a **port, not a vendor SDK** — `apps/web` wraps its Inngest client in `createAppJobDispatcherPort()` rather than passing the client directly. Read `engine.ts` rather than this excerpt when wiring your own host.

`createEngine` and the registration functions both store state on `globalThis` (18 `createSlot` call sites across core). That is a deliberate defence against Next.js HMR re-evaluation and bundler dual-copies, but it means **one engine per process**.

---

## Reference app

[`apps/web`](apps/web) is a Next.js app built on the engine. It demonstrates:

- Clerk employer/employee auth with role-aware middleware
- Document upload + optional OCR (`NATIVE_PDF`, Docling, Azure, Landing.AI, Datalab)
- PostgreSQL + pgvector semantic retrieval for RAG
- AI chat with agent guardrails (PII filter, grounding, confidence gate)
- Predictive document analysis — eight document types are defined, though the request validator currently accepts only `contract`, `financial`, `technical`, `compliance` and `general`
- Marketing pipeline for Reddit, X, LinkedIn, Bluesky
- Inngest-backed background jobs
- Optional LangSmith tracing

### Chat models

Chat reaches **one endpoint** that implements the OpenAI chat-completions
protocol — Google Gemini (the default), OpenRouter, MiniMax, vLLM, llama.cpp, LM
Studio, Ollama's `/v1` surface, and most gateways all qualify. Point
`CHAT_BASE_URL` at it and give it a credential if it needs one:

```dotenv
CHAT_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
CHAT_API_KEY=AIza...
```

Gemini is the default: leave `CHAT_BASE_URL` unset and set `GOOGLE_AI_API_KEY`
instead, and chat reaches the same endpoint.

That endpoint can serve **many models**. Which model handles general chat,
cheap extraction, reasoning, and images is written in
`apps/web/config/chat-models.yaml`, where each model either references a
bundled preset or declares its own behavior:

```yaml
version: 1
models:
  primary:
    id: gemini-2.5-flash
    preset: google/gemini-2.5-flash
routes:
  default: primary
```

Behavior is never inferred from a model id, and specialized routes fail
closed: if no vision-capable model is configured, the image control is
disabled rather than an image being sent to a model that will ignore it.
See [docs/chat-models.md](docs/chat-models.md) for presets, route inheritance,
the five reasoning modes, and how to add a preset.

Chat configuration is independent from embeddings, OCR, transcription,
reranking, and text-to-speech; configure only the supporting capabilities you
enable. Those never borrow the chat credential.

Docker Compose forwards `CHAT_BASE_URL`, `CHAT_API_KEY`, and
`CHAT_MODELS_CONFIG` from `.env` to the reference app container, and mounts
`apps/web/config/chat-models.yaml` so you can edit it without rebuilding.

### Supported document sources

The ingestion pipeline reads exports from common tools without requiring OAuth — just drop the files in:

| Source | Export | Adapter |
|---|---|---|
| Notion | Markdown & CSV / HTML | TextAdapter, HtmlAdapter |
| Google Docs / Sheets | DOCX / CSV / XLSX | DocxAdapter, SpreadsheetAdapter |
| Google Drive | Takeout ZIP | ZipAdapter (delegates per entry) |
| Slack | Workspace export JSON | JsonExportAdapter |
| GitHub | Code ZIP, `gh issue/pr list --json` | ZipAdapter, JsonExportAdapter |

Plus first-class PDF, DOCX, PPTX, XLSX, MD, HTML, TXT, and image adapters.

> **ZIP caveat:** `ZipAdapter` skips `JsonExportAdapter` and `ImageAdapter` for entries *inside* an archive. A Slack export shipped as a ZIP of JSON therefore yields no pages — unzip it and drop the loose `.json` files in instead.

---

## Using core standalone

`@launchstack/core` is the published compatibility facade over the layered engine packages (`@launchstack/protocol` / `evidence` / `application` / `adapters` — ADR-002): every historical subpath keeps working and re-exports from those packages, and CI proves each one loads under plain Node ESM (`scripts/ci/check-package-exports.mjs`). The engine packages read no `process.env` (lint-enforced) — configuration arrives through `CoreConfig` and typed ports; `apps/web/src/server/engine.ts` is the reference composition root.

One tenancy caveat remains by design: the engine's search contract is keyed on `companyId`, so a consumer adopts that workspace model (without inheriting auth, billing, or product tables). See [`REPOSITORY.md`](REPOSITORY.md).

---

## Community & support

- **Issues** — [github.com/Deodat-Lawson/LaunchStack/issues](https://github.com/Deodat-Lawson/LaunchStack/issues)
- **Security** — email per [SECURITY.md](SECURITY.md)

---

## Contributing

We welcome PRs — start with [CONTRIBUTING.md](CONTRIBUTING.md). A few things to know up front:

- One issue per PR
- Changes to the published engine packages should come with a [Changeset](https://github.com/changesets/changesets) (`pnpm changeset`)
- ESLint declares the core/features/host import boundaries and CI enforces them (lint is blocking); don't work around them

## License

Licensed under the [Apache License 2.0](LICENSE). By contributing you agree your contributions will be released under the same license.
