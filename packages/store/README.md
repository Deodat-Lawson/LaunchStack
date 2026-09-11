# @launchstack/store

LaunchStack's shared persistence: the Drizzle client bound to the engine schema (25 tables), the raw postgres.js client, sealed credential storage, signed file-access tokens, per-workspace credit metering, and one-off backfills. Owns the engine migration ledger (`drizzle/`, ledger `_launchstack_migrations`). It deliberately does not contain product tables (those live in apps/web's own migration set) or any model/LLM code.

## Install

```bash
pnpm add @launchstack/store
```

## Use

```ts
import { createDb } from "@launchstack/store/client";
import { documentVersions } from "@launchstack/store/schema";

const { db } = createDb({ url: process.env.DATABASE_URL! });
```

## API

| Subpath | What it is |
| --- | --- |
| `.` | client + crypto + credits barrels |
| `./client` | createDb, getDb, the raw postgres.js client |
| `./schema` | the engine schema barrel |
| `./schema/base` | sources, versions, jobs, companies |
| `./schema/outbox` | the transactional outbox table (orchestration owns its behavior) |
| `./schema/knowledge-graph` | entity/mention/relationship tables (indexing owns their behavior) |
| `./crypto` | secret-box sealing + signed file-access tokens |
| `./credits` | per-workspace token debiting |
| `./backfills` | one-off data corrections |

## Configuration

Nothing here reads `process.env`. Configuration is injected by the
composition root — `createEngine(config)` in `@launchstack/engine`, or the
package's own `configure*` hooks when used standalone.

`check-schema-boundary.mjs` fails the build if an engine table ever references a product one — the engine's migrations must build a working database on their own.

## Stability

0.x. The migration ledger is immutable, checksummed history: it relocated here byte-identically and its files never change after landing. The `pdr_ai_v2_` table prefix predates this package and must be settled before any 1.0.

## License

Apache-2.0 — see [LICENSE](LICENSE).
