# Weekly Decision Agenda — local TL checks

Use this runner to verify TL-owned data access, permissions/API and persistence
on an isolated local database. A/B implementation, app startup and provider keys
are not required.

## Prerequisites

- Check out the LaunchStack branch containing this runner.
- Install Node.js 20 or later and pnpm 10.15.1, the repository's pinned version.
  Follow the root README if pnpm is not available.
- Install and start Docker Desktop with Linux containers and Docker Compose v2.
- Keep local port `55434` available. The runner reserves this port for its test DB.
- Allow network access for the first dependency install and container-image pull.

Run commands from the repository root.

## Run the checks

```sh
pnpm test:tl
```

The runner installs dependencies from the existing lockfile if they are missing,
starts the dedicated database defined in `scripts/dev/vantage-tl.compose.yml`,
waits for readiness, applies/checks migrations and runs the Vantage pipeline,
selected web/API/auth and server-history tests. Typechecking and lint are separate
checks; the runner does not start the application.
Read its final result: skipped database tests do not establish a database pass.

The default setup does not need an application `.env` file. Its database is
`vantage_tl_contract_v1`, bound only to `127.0.0.1:55434`. The database suites require
the explicit test URL and refuse other host/port/database targets. The launcher
pins child-process database URLs to this target rather than using the root `.env`
or inherited application database URLs.

On the first run, the runner generates a local test password and writes the
Git-ignored `scripts/dev/vantage-tl.env.local`; no manual copy is required.
`scripts/dev/vantage-tl.env.example` documents the optional password setting.
Keep the generated file for reruns. Existing database volumes retain their
initial credentials; changing a settings file does not reset that database.

## What the checks establish

The real PostgreSQL cases exercise migrations, company scoping, report/action
storage, idempotent decisions, concurrent writes, rollback and human-content
protection. Route cases call actual Next.js handlers; auth-context cases query
actual users, memberships, active workspaces and role permissions in the test DB.

Session identity/cookie access and generation results are explicit test doubles.
These checks do not issue or verify a real login cookie, start an HTTP server,
call a model provider or demonstrate the frontend. They do not complete A/B's
implementation or integrated acceptance. See the [acceptance record](weekly-decision-agenda-week1.md)
for the observed results and remaining checks.

## Launcher verification, 2026-10-17

The initial launcher run was observed on Windows in a fresh source copy based on
`8e61bfd9`, with only the launcher/documentation changes overlaid. It started
without `node_modules`, an application `.env` or the earlier excluded drafts.
The runner installed 1,968 locked dependencies using the existing pnpm cache,
created its dedicated Docker container/volume and applied all 4 engine and 28
product migrations.

| Check                                    | Observed result                                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Initial fresh-copy `pnpm test:tl`        | 247 passed: 51 pipeline + 196 web/server-history cases                                                                             |
| Real PostgreSQL cases within that run    | 41 passed: 20 storage + 8 route + 13 auth-context cases                                                                            |
| Launcher helper unit tests               | 4 passed, separate from the 247 application tests                                                                                  |
| Hardened launcher in a second fresh copy | Frozen install and all 247 tests passed despite inherited production/Compose settings and invalid external DB URLs                 |
| Stop and normal rerun                    | Named service stopped, volume retained; rerun passed all 247 tests and reused the same container, migration ledger and credentials |
| Occupied-port guard                      | Refused startup while the dedicated DB was stopped                                                                                 |
| Remote Docker guard                      | Refused an SSH `DOCKER_HOST`                                                                                                       |

The second fresh copy also had no `node_modules`, application `.env` or excluded
drafts. Its inherited `NODE_ENV=production`, `COMPOSE_REMOVE_ORPHANS=1` and invalid
external database URLs did not redirect the launcher or its children. The normal
rerun after `--stop` retained the exact container ID, product migration-ledger
fingerprint and local credential-file SHA. Stop preserved the runner's own volume;
no data reset or volume deletion was used.

The launcher uses direct process invocation rather than shell-specific commands;
actual runtime verification so far is Windows only. A cache-backed locked install
does not establish an uncached registry download. The repository's root ESLint
configuration intentionally ignores untyped operational scripts; Node syntax
checks, helper unit tests and Prettier are the appropriate launcher checks. This
record does not claim a whole-repository lint or full end-to-end pass.

## Stop and rerun

The database stays running after a test run for quick reruns. Run `pnpm test:tl`
again to reuse it. Each database test removes only its own synthetic fixtures.

```sh
pnpm test:tl --stop
```

This stops only the named TL test service and preserves its data volume. It does
not remove volumes, reset data or stop unrelated database services. The next
normal run starts the same dedicated service again. There is no reset flag.

If port `55434` is occupied, inspect the existing listener/container before
retrying. Do not substitute a business database or remove unrelated containers.
If Docker is unavailable, start Docker Desktop and retry the same command.

For actual app testing after A/B integration, normal authenticated sessions and
the separate pilot operator/workspace gates are still required. The runner does
not install B's adapter or configure the application for interactive use.
