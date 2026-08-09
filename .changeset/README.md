# Changesets

This folder drives the npm release of **`@launchstack/core`** — the open-source
engine. It is the only publishable package in the repository; `@launchstack/web`
and `@launchstack/features` are `private: true` and are listed in `ignore` in
`config.json`, so the closed-source product can never be published by accident.

## Adding a changeset

Any PR that changes `packages/core` in a way a consumer would notice needs one:

```bash
pnpm changeset
```

Pick `@launchstack/core`, pick the bump, and write the entry for **someone
installing the package from npm** — not for a teammate reading the diff.

| Bump | Use for |
| --- | --- |
| `patch` | Bug fix, no API change |
| `minor` | New export, new optional peer dependency, backwards-compatible behaviour |
| `major` | Removed or renamed an export, changed a signature, dropped a `peerDependency` |

Changing the `exports` map is a **public API change** — adding a subpath is
`minor`, removing or renaming one is `major`, even when no `.ts` file moved.

Internal-only changes (tests, comments, a refactor with no surface change) do not
need one. CI does not fail for a missing changeset; nothing releases without one.

## What happens on merge

`.github/workflows/release.yml` runs on push to `main`:

1. builds `packages/core` to `dist/`
2. packs the tarball and validates it with `publint` + `@arethetypeswrong/cli`
3. verifies the built package is importable by plain Node ESM
4. hands off to `changesets/action` — which opens a **version PR** if changesets
   are pending, or publishes to npm when that PR merges

So merging a changeset does not publish. Merging the version PR does.

## Local check before pushing

```bash
pnpm --filter @launchstack/core build
node scripts/ci/check-package-exports.mjs
```

Step 3 above exists because `publint` alone does **not** catch extensionless
relative imports in emitted ESM — we shipped-tested a tarball that passed
publint and still failed `import()` with `ERR_MODULE_NOT_FOUND`.
