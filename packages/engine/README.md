# @launchstack/engine

The one-install aggregate: `createEngine()` assembles the feature packages behind a single `CoreConfig`, and re-exports their surfaces for consumers who want one dependency instead of eight. It deliberately does not contain logic of its own — everything here is composition and re-export.

## Install

```bash
pnpm add @launchstack/engine
```

## Use

```ts
import { createEngine } from "@launchstack/engine";

const engine = createEngine({
    db: { url: process.env.DATABASE_URL! },
    llm: {},
    embeddings: { indexName: "legacy-openai-1536" },
    ocr: { defaultProvider: "NATIVE_PDF" },
    providers: {},
    storage: myStoragePort,
});
await engine.close();
```

## API

| Subpath | What it is |
| --- | --- |
| `.` | createEngine + the aggregate re-export surface |
| `./config` | CoreConfig and its slices |

## Configuration

Nothing here reads `process.env`. Configuration is injected by the
composition root — `createEngine(config)` in `@launchstack/engine`, or the
package's own `configure*` hooks when used standalone.

The engine reads zero environment variables — all configuration flows through `CoreConfig` from the composition root (`apps/web/src/server/engine.ts` is the in-repo reference).

## Stability

0.x. The aggregate exists for one-install consumers; fine-grained installs of the feature packages are the primary surface.

## License

Apache-2.0 — see [LICENSE](LICENSE).
