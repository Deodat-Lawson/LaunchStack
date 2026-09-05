# @launchstack/indexing

Takes conversion's output and makes it searchable: the two-stage doc-ingestion pipeline the worker drives, entity extraction on the way to the graph, and knowledge-graph sync into Neo4j. It deliberately does not contain chunking or embedding primitives (conversion and llm own those) — this package composes them into the durable pipeline stages.

## Install

```bash
pnpm add @launchstack/indexing
```

## Use

```ts
import { runExtractionStage, runIndexingStage } from "@launchstack/indexing/doc-ingestion";
import { DocIngestionPipeline } from "@launchstack/indexing";
```

## API

| Subpath | What it is |
| --- | --- |
| `.` | the pipeline, entity extraction, graph sync |
| `./doc-ingestion` | extract stage + index stage, idempotent by content hash |
| `./knowledge-graph` | Neo4j client + document→graph sync (optional peer) |
| `./entity-extraction` | chunk text → stored entities |
| `./pipeline-port` | the ExtractionPipelinePort implementation the worker injects |

## Configuration

Nothing here reads `process.env`. Configuration is injected by the
composition root — `createEngine(config)` in `@launchstack/engine`, or the
package's own `configure*` hooks when used standalone.

`neo4j-driver` is an optional peer — the engine runs without a graph.

Entity extraction (stage F) is opt-in: the host calls
`configureEntityExtraction({ enabled: true })` before ingestion runs, or the
step logs once and skips (ADR-011). apps/web reads `ENABLE_ENTITY_EXTRACTION`
for it.

## Stability

0.x. Both pipeline stages are idempotent on (sourceVersionId, ocrJobId); that property is what makes outbox replay safe and is covered by the integration suite.

## License

Apache-2.0 — see [LICENSE](LICENSE).
