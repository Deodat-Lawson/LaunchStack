# @launchstack/evidence

Pure company-state logic: citation anchors, fact assertions and conflicts, the fact ledger, version diffing, freshness, and supersession. Every function takes its clock and policy as parameters, so identical inputs always give identical outputs. It deliberately does not contain a database, HTTP, Node built-ins, ambient time, or tenant/billing/auth concepts — and it has zero dependencies.

## Install

```bash
pnpm add @launchstack/evidence
```

## Use

```ts
import { anchorKey, detectConflicts, diffVersions, computeFreshness } from "@launchstack/evidence";

const key = anchorKey({ sourceVersionId: 42, span: { page: 4, endPage: 6 } });
```

## API

| Subpath | What it is |
| --- | --- |
| `.` | all seven tools: citation-anchors, fact-assertions, fact-conflicts, fact-ledger, version-diff, version-freshness, version-supersession |

## Configuration

Nothing here reads `process.env`. Configuration is injected by the
composition root — `createEngine(config)` in `@launchstack/engine`, or the
package's own `configure*` hooks when used standalone.

There is nothing to configure — every function is pure.

## Stability

0.x, but the most stable surface in the repository: six test files cover the seven tools, and the anchor key format is load-bearing for stored citations.

## License

Apache-2.0 — see [LICENSE](LICENSE).
