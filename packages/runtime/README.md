# @launchstack/runtime

What a LaunchStack host process wires in: the clock and logger ports, the actor/workspace context shape, the typed error taxonomy, the storage and job-dispatcher slots, and the HMR-safe singleton slot every `configure*`/`get*` pair is built on. It deliberately does not contain any business logic, IO, or dependency — it sits at the bottom of the graph and imports nothing.

## Install

```bash
pnpm add @launchstack/runtime
```

## Use

```ts
import { configureStorage, getStoragePort, createSlot } from "@launchstack/runtime";
import { ConfigError } from "@launchstack/runtime/errors";
```

## API

| Subpath | What it is |
| --- | --- |
| `.` | ports, actor context, errors, slots |
| `./errors` | the typed failure taxonomy → HTTP mapping |
| `./storage` | the StoragePort slot |
| `./jobs` | the JobDispatcherPort slot (deprecated, ADR-003) |
| `./slot` | the HMR-safe singleton slot primitive |
| `./wire-version` | PROTOCOL_VERSION + the compatibility policy |

## Configuration

Nothing here reads `process.env`. Configuration is injected by the
composition root — `createEngine(config)` in `@launchstack/engine`, or the
package's own `configure*` hooks when used standalone.



## Stability

0.x. The error taxonomy and port shapes are stable; `./jobs` is deprecated and will be removed once no external consumer wires its own runner.

## License

Apache-2.0 — see [LICENSE](LICENSE).
