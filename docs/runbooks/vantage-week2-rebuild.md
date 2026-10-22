# Vantage Week 2 reconstruction — 2026-10-22

Base: `0432b4b440456ee50f1e715bb13d6ae4d72b2ce7` (`integration/vantage-e2e-demo`).
This is a new implementation, not a recovery of the unavailable personal-machine
commits `a0ebec1a`, `80186fc2`, and `53eda9b0`. Their previously reported test
counts are historical statements, not evidence for this branch.

## Scope and acceptance

The implementation follows the uploaded **Vantage — Technical Design Doc** and
**Vantage — Week 2 Plan**, including the Tech Lead's independent P0/P1 scope.
See [the v1 amendment](../design/vantage-contract-v1-amendment-2026-10-22.md)
for the implemented client/server contract and
[the proposed V0 ADR](../architecture/ADR-vantage-context-v0-2026-10-22.md)
for the separately exported Joseph/Sophia handoffs and shared infrastructure.

The core v1 changes are optimistic Topic writes, direct historical source reads,
private-only controls, safe save acknowledgement, final generation-source
revalidation, Weekly Review/Weekly Actions navigation, previous-week context,
and the existing atomic Decision/optional Commitment workflow.

Numeric observations retain the finite signed-number contract. A count domain
is not inferred from a display label or free-text unit. Typed count constraints
and their migration/CSV policy require a separate approved contract.

## Reproduce locally

Install the locked dependencies with `pnpm install --frozen-lockfile`. The
reconstruction was installed offline with the existing package store, using
Node 24.13.0 and pnpm 10.15.1. No lockfile change was needed.

Run the independent TL suite:

```sh
node --test scripts/dev/vantage-integration-runtime.test.mjs scripts/dev/vantage-integration-tl-test.test.mjs
node scripts/dev/vantage-integration-tl-test.mjs
```

This launcher checks ownership and database identity before applying existing
migrations. It creates only `launchstack-vantage-week2-tl-20261022` resources,
with database `vantage_week2_tl_contract_v1` at `127.0.0.1:55437`.
The generated local password file is Git-ignored. Never add it to an artifact.

Run the real HTTP/browser environment:

```sh
node scripts/dev/vantage-integration-runtime.mjs --prepare-fresh
node scripts/dev/vantage-integration-runtime.mjs --serve
# In a second terminal after the app is ready:
node scripts/dev/vantage-integration-runtime.mjs --e2e
node scripts/dev/vantage-integration-probes.mjs
```

`--prepare-fresh` requires the app to be stopped. It creates a new synthetic
namespace in the owned database and archives the previous ignored runtime
configuration; it never deletes prior rows. `--prepare` reuses the current
namespace and is idempotent. The happy-path browser suite expects a namespace
without an existing report, so run the full browser suite before API probes.
The launcher starts the app with Turbopack, matching the app's default dev
mode; this avoided a webpack memory-threshold restart seen in an early run.

Use the Chromium build matching the locked Playwright dependency. If missing,
install it from `apps/web` with `pnpm exec playwright install chromium`.
The dedicated application uses **http://localhost:3103** consistently for
authentication, cookies, redirects and browser requests. Its database is
`vantage_week2_rebuild_20261022` at `127.0.0.1:55436`; the different database
host does not change the browser origin. Three accounts and all records are
synthetic. The original demo's app/database ports and resources are not reused.

The launcher rejects application `.env` files, removes inherited provider
settings from child processes, disables connectors/email/workers, and points
the model endpoint to an unavailable loopback address. Rules-only generation
is deliberate. Reports in `test-output/vantage-week2-rebuild-20261022/reports`
and `api-probes-latest.json` are sanitized; `runtime.json` and local environment
files contain credentials and must remain private and ignored.

Stop the foreground app with Ctrl+C, then stop only the owned databases:

```sh
node scripts/dev/vantage-integration-runtime.mjs --stop
node scripts/dev/vantage-integration-tl-test.mjs --stop
```

Volumes and test data are preserved. Neither launcher resets databases or
removes volumes.

## Verification boundaries

Keep these evidence categories separate:

- Pipeline unit tests and mocked provider tests establish deterministic contract
  behavior; they do not establish live model quality.
- The TL runner enables real PostgreSQL storage/API/authorization suites, but
  uses session/cookie and generation doubles.
- API probes and Playwright use real loopback Better Auth and the isolated
  PostgreSQL database; failure injection is limited to the browser transport.
- V0 tests run the implemented source registry, assembler, adapters and
  transaction guard against injected fixture providers. They do not establish
  production document ACL resolution, Joseph's persistence, Sophia's retriever,
  public research or live role-conditioned model quality.

The short v1 pilot write transaction uses a table lock covering agenda and
generation-source tables. It is conservative and serializes writes across
workspaces; no model call occurs under this lock. Replacing it for a multi-tenant
production rollout requires a separate concurrency design and regression tests.

No live model, external research, real customer data, production deployment,
main-branch integration, or repository-wide full test/build acceptance is
claimed by this reconstruction.
