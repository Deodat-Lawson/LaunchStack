# @launchstack/orchestration

Durable work between the features (ADR-003): the pipeline events written in the same transaction as the state change they announce, the Postgres outbox store with SKIP LOCKED claiming, the worker's processing tick with bounded retries, and transactional source acceptance. It deliberately does not contain any pipeline stage implementation — stages live in indexing and are injected as ports.

## Install

```bash
pnpm add @launchstack/orchestration
```

## Use

```ts
import { runOutboxTick, createPipelineProcessor, DrizzleOutboxStore } from "@launchstack/orchestration";
import { pipelineEventSchema } from "@launchstack/orchestration/pipeline-events";
```

## API

| Subpath | What it is |
| --- | --- |
| `.` | events, ports, outbox store, tick, source lifecycle, upload acceptance |
| `./pipeline-events` | the six event contracts + deterministic eventIds + parseOcrProvider |
| `./ports` | OutboxStorePort · SourceLifecyclePort · the pipeline stage ports |

## Configuration

Nothing here reads `process.env`. Configuration is injected by the
composition root — `createEngine(config)` in `@launchstack/engine`, or the
package's own `configure*` hooks when used standalone.

Handlers must be idempotent: eventId derives from the state change, so redelivery and replay converge. Dead events stay visible and replayable (docs/runbooks/outbox.md).

## Stability

0.x. The event contracts are frozen wire format published by the schema generator; adding an optional field is compatible, anything else bumps the wire version.

## License

Apache-2.0 — see [LICENSE](LICENSE).
