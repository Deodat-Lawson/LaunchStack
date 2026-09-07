# @launchstack/schema-generator

Walks every feature's wire contracts (conversion, orchestration, editing) and emits one versioned JSON Schema bundle under `schemas/v1/` — the single directory the Python services' contract tests validate against. It deliberately does not contain any contract of its own — contracts live inside their features; this package only walks and emits.

## Install

```bash
pnpm add @launchstack/schema-generator
```

## Use

```ts
pnpm --filter @launchstack/schema-generator schemas:generate   # (re)write schemas/v1
pnpm --filter @launchstack/schema-generator schemas:check      # CI: fail on drift
```

## API

| Subpath | What it is |
| --- | --- |
| `.` | re-export of PROTOCOL_VERSION for convenience |

## Configuration

Nothing here reads `process.env`. Configuration is injected by the
composition root — `createEngine(config)` in `@launchstack/engine`, or the
package's own `configure*` hooks when used standalone.

Contract files may import zod only — lint-enforced. `--check` fails CI when the generated bundle drifts from the zod source.

## Stability

0.x for the package; the emitted `schemas/v1` bundle is frozen wire format: adding an optional field is compatible, anything else requires a parallel v{n} bundle.

## License

Apache-2.0 — see [LICENSE](LICENSE).
