# @launchstack/editing

Tracked-changes Word editing (ADR-007): the wire contract for the adeu document-editing service and its typed client — apply tracked edits, enumerate and act on review items, diff, preview as CriticMarkup. It deliberately does not contain conversion into evidence — nothing here produces ingestable output; it round-trips a document back to the user.

## Install

```bash
pnpm add @launchstack/editing
```

## Use

```ts
import { readDocx, processDocumentBatch, diffDocxFiles } from "@launchstack/editing";
```

## API

| Subpath | What it is |
| --- | --- |
| `.` | the typed client + the wire types |
| `./wire` | the service contract, mirroring app/schemas/adeu.py byte-for-byte |

## Configuration

Nothing here reads `process.env`. Configuration is injected by the
composition root — `createEngine(config)` in `@launchstack/engine`, or the
package's own `configure*` hooks when used standalone.

The client resolves ADEU_SERVICE_URL from the environment — a documented exception inherited from the features tier.

## Stability

0.x. The wire contract is frozen format published by the schema generator.

## License

Apache-2.0 — see [LICENSE](LICENSE).
