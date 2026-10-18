# Launchstack

**A TypeScript engine for AI-native applications.** Ingestion, OCR, RAG, knowledge graph, LLM abstractions, and background jobs — ports-based, and wired into a Next.js reference app that shows how the pieces fit together.

[![license](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![CI](https://github.com/Deodat-Lawson/LaunchStack/actions/workflows/CI.yml/badge.svg)](https://github.com/Deodat-Lawson/LaunchStack/actions/workflows/CI.yml)
[![types](https://img.shields.io/badge/types-TypeScript-blue.svg)](https://www.typescriptlang.org/)

[Run it](#run-it-locally) · [Repository layout](#repository-layout) · [Packages](#whats-in-the-box) · [Architecture](#architecture) · [Chat models](docs/chat-models.md) · [Contributing](CONTRIBUTING.md)

---

## Status

The publishable bricks in [`packages/`](packages) and the compositions package [`@launchstack/pipelines`](pipelines) are **not yet on npm**. The engine aggregate is `@launchstack/engine`; `@launchstack/design-tokens` is private. The first release will publish the public packages together through the Changesets flow in [`release.yml`](.github/workflows/release.yml), which builds the bricks and pipelines, validates the packed engine tarball with `publint`, and checks every declared publishable subpath for Node-ESM loadability. Until that first release lands, consume the engine by running this repository.

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

`apps/web/src/env.ts` refuses to boot without `DATABASE_URL` and `BETTER_AUTH_SECRET`. Compose supplies the database, file storage, and every local service; `.env.example` already points `DATABASE_URL` at it. A usable instance — sign-up, searchable uploads, chat — needs these in `.env`:

| Variable | Value |
|---|---|
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `http://localhost:3000` (the `.env.example` default). Without it, browser sign-up is refused with "Invalid origin". |
| Chat | **Gemini:** `GOOGLE_AI_API_KEY`, with `CHAT_BASE_URL` unset. **Azure OpenAI:** `CHAT_BASE_URL=https://<resource>.openai.azure.com/openai/v1`, `CHAT_API_KEY`, and `CHAT_MODELS_CONFIG=config/chat-models.azure.yaml`. See [Chat models](#chat-models). |
| Embeddings | `EMBEDDING_API_BASE_URL` + `EMBEDDING_API_KEY`. There is **no default**: without them, uploads are read and chunked but never become searchable. Azure OpenAI fits the default `EMBEDDING_INDEX` (`legacy-openai-1536`) as-is, with `text-embedding-3-large` deployed under that name. Gemini needs `EMBEDDING_INDEX=gemini-embedding-768` on a fresh database. |

There is no *per-vendor* variable: a bare `OPENAI_API_KEY`, `OPENROUTER_API_KEY` or `OLLAMA_BASE_URL` will *not* configure chat, and none of them is forwarded to the Gemini default — every one of those providers speaks the OpenAI chat-completions protocol, so each is reached through `CHAT_BASE_URL`. Only `AI_BASE_URL`/`AI_API_KEY`, a straight rename of the canonical pair, is still translated for a release with a deprecation warning.

### With Docker (recommended)

```bash
make up-prod     # lite stack, detached (~400MB RAM); OCR via Azure if its key is set
make up-ocr      # adds Docling: Office docs, and the OCR fallback after Azure (~1.2GB RAM)
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
DEV_SEED_PASSWORD=<8+ chars> pnpm --filter @launchstack/web db:seed  # optional: one workspace + owner/admin/member/viewer@launchstack.test
pnpm --filter @launchstack/web    dev          # Next.js on :3000
pnpm --filter @launchstack/worker dev          # the durable worker on :8020 — ingestion runs here, not in web
pnpm --filter @launchstack/landing dev         # optional: the public site on :3001 — where the logo and sign-out lead in dev
pnpm --filter @launchstack/web    inngest:dev  # optional: Inngest dev UI on :8288, pointed at the worker's :8020/api/inngest
```

`web dev` is plain `next dev` — it accepts uploads but processes nothing.
Run the worker alongside it or documents will sit queued forever; the
Inngest dev server is only needed for the Inngest-hosted background
verticals (trend search, prospector, …), not for ingestion.

`db:migrate` is the same command CI, Docker and the production image build run.
Running it from `@launchstack/store` applies only the engine set — that is what a
consumer embedding the engine uses, not what a full app needs.
Nothing else creates schema — see [Changing the database](CONTRIBUTING.md#changing-the-database).

`db:seed` also works against the Compose database. Its accounts sign in at
`/signin` with the `DEV_SEED_PASSWORD` you passed.

> `.env.example` points `DATABASE_URL` at `localhost:5433/pdr_ai_v2`, which is what Compose publishes — so the Docker and non-Docker paths share one database by default. Running your own Postgres instead? Use the commented `localhost:5432/pdr_ai` line in its place.

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

### Self-hosting

A deployment is self-hosted unless you set `DEPLOYMENT_MODE=cloud`, and the
defaults are chosen for that case: usage is recorded but never gated, no
telemetry is loaded, no assets are fetched from a CDN, and the instance
identifies itself by the host you serve it from. **The first person to sign up
becomes the owner** of the workspace they create, already verified — there is no
separate admin bootstrap.

This repository builds the application. The marketing site at launchstack.app is
a separate app ([`apps/landing`](apps/landing)) that Docker and Compose do not
build — on your own instance, `/` is the sign-in page, not a pitch.

Full details, including what degrades without which optional service, are in
[Self-hosting defaults](docs/deployment.md#self-hosting-defaults).

---

## Repository layout

[**`REPOSITORY.md`**](REPOSITORY.md) is the map: every directory, all deploy targets, and which areas are engine versus hosted product. Read it before the layout below surprises you.

| Path | What it is |
|---|---|
| [`apps/web`](apps/web) | The Next.js app: UI, auth, command acceptance, synchronous reads. |
| [`apps/landing`](apps/landing) | The public site (launchstack.app): landing, pricing, contact, deployment guide. No database, no auth; **not** part of any self-hosted deployment. |
| [`apps/worker`](apps/worker) | The durable workflow coordinator — consumes the ingestion outbox and hosts the background jobs (ADR-003). |
| [`packages/`](packages) | The bricks: persistence, model calls, orchestration, conversion, indexing, retrieval, shared tools and independent clients. See [`packages/README.md`](packages/README.md) for the spine and side packages. |
| [`packages/engine`](packages/engine) | The one-install engine aggregate: `createEngine(CoreConfig)` assembles the engine spine and re-exports selected brick APIs. |
| [`pipelines/`](pipelines) | One package, `@launchstack/pipelines`, containing 13 product verticals that compose the bricks. Bricks never import pipelines. |
| [`services/`](services) | Compute services — document-converter (Node), transcription and adeu-ai-docs-editing (Python). Not part of the pnpm workspace; each manages its own dependencies. |
| [`scripts/`](scripts) | `ci/` for gates, `ops/` for operational tasks, `dev/` for manual developer probes. |

---

## What's in the box

| Package | Status | What it does |
|---|---|---|
| [`@launchstack/engine`](packages/engine) | unpublished | `createEngine(CoreConfig)`: database, storage and graph handles; registration of the engine's shared configuration and ports. |
| [`@launchstack/runtime`](packages/runtime) | unpublished | Host ports, actor context, typed errors and HMR-safe singleton slots. |
| [`@launchstack/evidence`](packages/evidence) | unpublished | Pure company-state logic: evidence, citations, versioning, conflicts, reconciliation and freshness. |
| [`@launchstack/store`](packages/store) | unpublished | Drizzle/Postgres persistence, engine schema and migrations, credentials, file tokens and credits. |
| [`@launchstack/llm`](packages/llm) | unpublished | Structured output, guardrails, chat configuration, model providers and embeddings. |
| [`@launchstack/orchestration`](packages/orchestration) | unpublished | Transactional outbox, source lifecycle, worker tick and stage ports. |
| [`@launchstack/conversion`](packages/conversion) | unpublished | Sources to `EvidenceDocument`: document conversion, OCR, transcription and archive expansion. |
| [`@launchstack/indexing`](packages/indexing) | unpublished | Chunking, embeddings, entity extraction, Neo4j sync and the document-ingestion pipeline. |
| [`@launchstack/retrieval`](packages/retrieval) | unpublished | Hybrid retrieval, reranking and permission-scoped citations. |
| [`@launchstack/tools`](packages/tools) | unpublished | Shared capabilities composed by verticals: company context, web research, social publishing, grants and stage execution. |
| [`@launchstack/editing`](packages/editing) | unpublished | Typed client and wire contract for adeu tracked-changes Word editing. |
| [`@launchstack/collab`](packages/collab) | unpublished | Channels, multi-agent meetings, human takeover and signed HTTP coordination. |
| [`@launchstack/document-conversion-engine`](packages/document-conversion-engine) | unpublished | Gotenberg client for Office, HTML and Markdown to PDF. |
| [`@launchstack/google-drive`](packages/google-drive) | unpublished | Drive v3 and OAuth token client with injected credentials. |
| [`@launchstack/schema-generator`](packages/schema-generator) | unpublished | Versioned JSON Schema bundle from conversion, orchestration and editing wire contracts. |
| [`@launchstack/design-tokens`](packages/design-tokens) | private | Shared CSS design tokens for the apps. |
| [`@launchstack/pipelines`](pipelines) | unpublished | 13 verticals: client-prospector, company-metadata, connectors, distribution, email, founder-weekly-review, legal-templates, marketing, proposals, repo-explainer, repo-workspace, trend-search and vantage. |
| [`apps/web`](apps/web) | — | The Next.js reference app — how we wire everything together |

Pipelines compose bricks through their public package APIs; bricks never import pipelines. The reference app imports both tiers and supplies the storage, credits and RAG ports that connect to real infrastructure. Document ingestion uses the transactional outbox consumed by `apps/worker`, not a jobs port in the app's engine config.

---

## Architecture

The apps host the compositions in `pipelines/` and the bricks in `packages/`. Pipelines can import bricks, but never the reverse; the engine spine stays independent of the app and framework.

```
          ┌───────────── apps/web (Next.js host) ──────────────────────────────┐
          │ env.ts → server/engine.ts → getEngine()                            │
          │ configure* → createEngine(config) from @launchstack/engine         │
          │ StoragePort (S3) · CreditsPort (DB) · RagPort (hybrid RAG)         │
          │ apps/worker → same getEngine() (dynamic import)                    │
          │ Document ingestion: transactional outbox → worker                  │
          └─────────────────────────────┬──────────────────────────────────────┘
                                        │
          ┌─────────────────────────────▼──────────────────────────────────────┐
          │ @launchstack/pipelines · 13 product verticals                      │
          │ Compositions import bricks; no brick imports pipelines             │
          └─────────────────────────────┬──────────────────────────────────────┘
                                        │
          ┌─────────────────────────────▼──────────────────────────────────────┐
          │ @launchstack/tools · shared capabilities                           │
          │ @launchstack/engine · createEngine(CoreConfig)                     │
          └─────────────────────────────┬──────────────────────────────────────┘
                                        │
          ┌─────────────────────────────▼──────────────────────────────────────┐
          │ retrieval → indexing → conversion → orchestration                  │
          │ llm → store → runtime                                              │
          │ evidence · pure company-state logic used by retrieval              │
          └────────────────────────────────────────────────────────────────────┘
```

- **Engine** knows no framework. Config arrives through `CoreConfig` and the bricks' `configure*` hooks.
- **Pipelines** are product compositions in one package. They can read `process.env` and import bricks, but cannot import Next, Clerk, React or the host app.
- **Host** owns env, auth and routing, and implements the storage, credits and RAG ports. The worker boots the same `getEngine()` composition root and consumes the ingestion outbox.
- [`eslint.config.js`](eslint.config.js) declares these boundaries and CI enforces them: lint is blocking (ADR-006). The engine spine has lint-enforced no-env rules, with transcription-client exceptions; `tools` and `editing` allow env reads, and `schema-generator` has no no-env rule.

### Wiring the engine

`createEngine(config)` opens the database pool and registers the database, storage, metering and Neo4j slots, plus credits and RAG ports when supplied. Several subsystems need **separate** registration calls — [`apps/web/src/server/engine.ts`](apps/web/src/server/engine.ts) makes seven: the host-local `configureAppChatModels`, `configureEmbeddingIndexRegistry`, `configureCompanyEmbeddingDefaults`, `configureProviders`, `configureSecretBox`, `configureOcr` and `configureEntityExtraction`. The chat helper loads the app's YAML and registers the same `config.llm.chat` that `createEngine` applies; a custom host can pass a chat config directly without that app-local helper. Slots are read lazily, so register them before a subsystem is first *used*.

```ts
import { readFileSync } from "node:fs";
import { createEngine, type CoreConfig } from "@launchstack/engine";
import { createChatModelsConfig } from "@launchstack/llm";
import {
  configureEmbeddingIndexRegistry,
  configureCompanyEmbeddingDefaults,
} from "@launchstack/llm/embeddings";
import { configureProviders } from "@launchstack/llm/providers/registry";
import { configureSecretBox } from "@launchstack/store/crypto";
import { configureOcr } from "@launchstack/conversion/ocr/config";
import { configureEntityExtraction } from "@launchstack/indexing";

const config: CoreConfig = {
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
    // Non-chat credentials stay separate from the chat endpoint's key.
    auxiliaryOpenAI: {
      baseUrl: process.env.AI_BASE_URL,
      apiKey: process.env.AI_BASE_URL
        ? (process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY)
        : undefined,
      googleApiKey: process.env.GOOGLE_AI_API_KEY,
    },
  },
  embeddings: {
    indexName: "legacy-openai-1536",
    secretsKey: process.env.EMBEDDING_SECRETS_KEY,
    override: {
      baseUrl: process.env.EMBEDDING_API_BASE_URL,
      apiKey: process.env.EMBEDDING_API_KEY,
      model: process.env.EMBEDDING_MODEL,
    },
  },
  ocr: { defaultProvider: "NATIVE_PDF" },
  providers: {},
  storage: myStoragePort, // your host's StoragePort implementation
};

configureEmbeddingIndexRegistry({ defaultIndexKey: config.embeddings.indexName });
// Choose the endpoint and its credential as a pair, as the app root does.
const embeddingEndpoint = config.embeddings.override?.baseUrl
  ? config.embeddings.override
  : config.llm.auxiliaryOpenAI;
configureCompanyEmbeddingDefaults({
  embeddingIndexKey: config.embeddings.indexName,
  openAIApiKey: embeddingEndpoint?.apiKey,
  openAIBaseUrl: embeddingEndpoint?.baseUrl,
});
configureProviders({
  aiBaseUrl: config.llm.auxiliaryOpenAI?.baseUrl,
  aiApiKey: config.llm.auxiliaryOpenAI?.apiKey,
  googleApiKey: config.llm.auxiliaryOpenAI?.googleApiKey,
  rerank: config.providers.rerank,
  ner: config.providers.ner,
});
configureSecretBox({ key: config.embeddings.secretsKey });
configureOcr(config.ocr);
configureEntityExtraction({ enabled: process.env.ENABLE_ENTITY_EXTRACTION === "true" });
const engine = createEngine(config);

const { db } = engine;  // Drizzle client
await engine.close();   // graceful shutdown
```

The reference app has **no jobs port**: document ingestion is driven by the transactional outbox consumed by `apps/worker`. `CoreConfig` still accepts an optional `jobs.dispatcher` for hosts using the runtime job-dispatcher slot, but `apps/web` does not configure it. Read the full composition root rather than this excerpt when wiring your own host.

The registration functions store state on `globalThis` (20 `createSlot` call sites across `packages/*/src`), and the app caches its engine there too. That is a deliberate defence against Next.js HMR re-evaluation and bundler dual-copies, but it means **one engine per process**.

---

## Reference app

[`apps/web`](apps/web) is a Next.js app built on the engine. It demonstrates:

- First-party auth (better-auth, in the app's own Postgres) with per-workspace roles, folder-level access, invitations and an audit log (ADR-010)
- Document upload with OCR on by default: Azure reads every PDF and image, Docling is the fallback, then Landing.AI / Datalab if configured; the PDF's own text layer is the last resort
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
    id: gemini-3.8-flash
    preset: google/gemini-3.8-flash
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
`CHAT_MODELS_CONFIG` from `.env` to both the app and the worker, and mounts
`apps/web/config/` so you can edit or switch model files without rebuilding.
`CHAT_MODELS_CONFIG` is relative to `apps/web`: the repo ships
`config/chat-models.yaml` (Gemini) and `config/chat-models.azure.yaml`
(Azure OpenAI, GPT-6 Luna).

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

## Using the engine standalone

`@launchstack/engine` is the one-install aggregate: `createEngine(CoreConfig)` assembles the engine spine and re-exports selected runtime, database, conversion, indexing and orchestration APIs. Import model, OCR, embedding and retrieval APIs from their owning bricks' public subpaths; individual bricks can also be consumed separately. CI checks the declared publishable subpaths under plain Node ESM (`scripts/ci/check-package-exports.mjs`). The engine package reads no `process.env` (lint-enforced) — configuration arrives through `CoreConfig`, typed ports and separate `configure*` hooks; [`apps/web/src/server/engine.ts`](apps/web/src/server/engine.ts) is the reference composition root.

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
- ESLint declares the bricks/pipelines/host import boundaries and CI enforces them (lint is blocking); don't work around them

## License

Licensed under the [Apache License 2.0](LICENSE). By contributing you agree your contributions will be released under the same license.

Third-party dependencies bundled into the published images and the compute
services keep their own licenses; their notices are collected in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md), which is generated from the
lockfiles:

```bash
node scripts/licenses/generate-attributions.mjs
```
