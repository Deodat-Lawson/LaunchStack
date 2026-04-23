# Contributing to Launchstack

Thanks for your interest in contributing! This document covers how to set up a dev environment, the change-management workflow, and what we expect in a pull request.

## Before you start

- **One issue per PR.** If your change spans multiple concerns, split it.
- Search [existing issues](https://github.com/launchstack/launchstack/issues) and [discussions](https://github.com/launchstack/launchstack/discussions) before opening a new one.
- Substantial features (new packages, new ports, API-breaking changes) should be discussed in an issue first — we want to agree on the shape before you invest time writing code.

## Repo layout

```
packages/core        @launchstack/core — framework-agnostic engine (published to npm)
packages/features    vertical features that sit on top of core (private, not published)
apps/web             Next.js reference app that wires the engine
services/            Python/ML sidecars (sidecar, ocr-router, ocr-worker)
```

The **core/features/host boundary is enforced by ESLint** (see [`eslint.config.js`](eslint.config.js)):

- `@launchstack/core` must not import Next.js, Clerk, React, or `process.env`. It's Node-only and framework-agnostic.
- `@launchstack/features` must not import from the host app (`~/*`) or pull in Next/Clerk/React. Features can read `process.env`.
- Violations fail lint.

## Local dev

### Requirements

- Node.js **20+**
- pnpm **10+** (matches the `packageManager` field in [`package.json`](package.json); use `corepack enable` if you don't have it)
- Docker & Docker Compose (for the full local stack with Postgres + sidecars)

### Minimal setup (hosted Postgres)

```bash
git clone https://github.com/launchstack/launchstack.git
cd launchstack
pnpm install
cp .env.example .env                  # fill in DATABASE_URL + CLERK + OPENAI keys
pnpm db:push                          # sync Drizzle schema
pnpm dev                              # Next.js + Inngest dev server (concurrently)
```

### Full local stack (Postgres + SeaweedFS + sidecars)

```bash
make up            # lite stack (~400MB RAM, native OCR only)
make up-ocr        # full stack with Docling for Office docs
make up-fast       # build Next on host first, then compose (fastest for testing prod image)
make down          # tear down
make down-clean    # tear down + wipe volumes
```

Once the stack is up: app at `localhost:3000`, Inngest dashboard at `localhost:8288`, sidecar API at `localhost:8000/docs`.

## Quality checks

Run before opening a PR:

```bash
pnpm check         # eslint + pnpm -r typecheck
pnpm test          # Jest (apps/web)
```

All three must pass in CI. Boundary rules (no `process.env` in core, no `~/*` in features) are checked by ESLint — don't try to work around them with `/* eslint-disable */`; talk to us if the rule seems wrong.

## Changesets (for releases)

We publish `@launchstack/core` to npm using [Changesets](https://github.com/changesets/changesets). **If your PR changes anything under `packages/core/`**, you must add a changeset:

```bash
pnpm changeset
```

Follow the prompt — pick `patch` / `minor` / `major` and write a short user-facing summary of what changed. The tool writes a Markdown file under `.changeset/` that you commit with your PR.

On merge to `main`, the Changesets bot opens (or updates) a "Version Packages" PR. Merging that PR publishes the new version to npm.

Changes to `packages/features/` and `apps/web/` **do not** need a changeset — they're private.

## Pull request checklist

Before requesting review:

- [ ] Commits are focused and have meaningful messages
- [ ] `pnpm check` passes
- [ ] `pnpm test` passes
- [ ] Changeset added if `packages/core/` changed
- [ ] New env vars documented in [`.env.example`](.env.example) and [`apps/web/src/env.ts`](apps/web/src/env.ts)
- [ ] If the change touches UI, you've exercised the flow in a browser (not just a successful build)
- [ ] PR description explains **why**, not just **what**

## Code style

- TypeScript strict mode; prefer `type` over `interface` for shapes
- Import types with `import type`
- Don't add comments that restate the code. Only comment when the *why* is non-obvious.
- Match the surrounding file's style — no sweeping refactors in feature PRs

## Getting help

- **Questions**: [GitHub Discussions](https://github.com/launchstack/launchstack/discussions)
- **Bug reports**: [New issue](https://github.com/launchstack/launchstack/issues/new/choose)
- **Security**: see [SECURITY.md](SECURITY.md) — do not open public issues for vulnerabilities

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
