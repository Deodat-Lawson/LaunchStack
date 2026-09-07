# ADR-002: Layered Engine Packages With a Published Compatibility Facade

**Status:** Accepted
**Date:** 2026-08-09
**Deciders:** Repository maintainers (decision made from observed repository behavior; see ADR-001 for the staged-cleanup mandate this completes)

## Context

Launchstack is a cited company-memory system. The engine/product split begun in
ADR-001 left the engine code distributed across `packages/core` (schema, OCR,
providers, embeddings, retrieval), `packages/features/doc-ingestion` (the real
pipeline body), and `apps/web` (ensemble retrieval, ingestion orchestration,
twelve Inngest functions). There is no package that owns contracts, no package
that owns pure evidence/company-state logic, and no process that owns durable
work other than the Next.js app itself.

`@launchstack/core` is published to npm. Its subpath exports are validated in
CI by `scripts/ci/check-package-exports.mjs` against the packed tarball, so its
public surface is load-bearing for external consumers and cannot silently
change.

## Decision

Adopt four new workspace packages with a strict, ESLint-enforced dependency
direction, and demote `packages/core` to a compatibility facade:

```
packages/protocol      ← nothing (zod only)
packages/evidence      ← protocol
packages/application   ← protocol, evidence
packages/adapters      ← protocol, evidence, application
packages/core          ← re-exports adapters/application/evidence/protocol
apps/*, services/*     ← any of the above (never the reverse)
```

- **`packages/protocol`** — cross-language contracts only: versioned zod
  schemas for the event envelope and the four pipeline events, the
  `EvidenceDocument` produced by the document-converter service, the
  transcription and adeu-ai-docs-editing service contracts, and a generator that
  emits JSON Schema files consumed by the Python services' contract tests.
- **`packages/evidence`** — pure company-state logic: immutable evidence
  records, citation anchors, version diffing, supersession, conflict
  detection, reconciliation, and freshness. No database, no HTTP, no
  `process.env`, no Next.js, no tenant/billing/auth concepts.
- **`packages/application`** — commands, queries, and ports. Use cases receive
  an explicit `AppContext` (repositories, converter/transcription ports,
  embedder, clock, logger, authorization scope). Workspace/company identity is
  translated into plain ids at this boundary; nothing below it knows about
  Clerk, cookies, or memberships.
- **`packages/adapters`** — implementations of the application ports: Drizzle/
  Postgres repositories (including the transactional outbox), object-storage
  access, HTTP clients for the compute services, and model-provider adapters.
  Everything that used to be implementation inside `packages/core` migrates
  here (or to `evidence` when pure); moved trees keep their internal relative
  imports so history and behavior are preserved.
- **`packages/core`** — remains the published package and becomes a facade:
  every existing subpath keeps working but re-exports from the packages above.
  No new business logic may be added to core; ESLint enforces that core files
  contain re-exports only (`scripts/ci/check-core-facade.mjs`).

All five packages are published together through the existing Changesets flow
so that core's re-exports resolve for npm consumers. `check-package-exports`
continues to gate the release.

## Consequences

- External consumers of `@launchstack/core` see no breaking change; the
  facade is validated by the existing export-loadability check plus new facade
  tests.
- The engine schema source moves to `packages/adapters/src/db/schema/`;
  `packages/core/drizzle/` remains the engine migrations directory and ledger
  (`_launchstack_migrations`) because migration history is immutable
  (REPOSITORY.md “Migrations are immutable”).
- `apps/web` and `apps/worker` compose the system through
  `packages/application`'s context types instead of reaching into core
  internals; the `getEngine()` global remains only inside the compatibility
  facade path and the app composition roots.
- The `services/*` runtimes stay outside the pnpm workspace (deliberate, see
  REPOSITORY.md) but consume the generated JSON Schemas from
  `packages/protocol` for contract tests.
