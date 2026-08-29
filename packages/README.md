# packages/ — the bricks

Level one: each package answers a single question. The compositions live in
[`../pipelines/`](../pipelines) and may import any brick; no brick may
import a composition (lint-enforced).

```
runtime  evidence            ← the bottom: ports/slots/errors · pure domain math
   │
store  llm                   ← persistence · everything that calls a model
   │
orchestration                ← events, outbox, worker tick, source acceptance
   │
conversion                   ← any source → EvidenceDocument (docs, audio, video, OCR)
   │
indexing                     ← EvidenceDocument → chunks, vectors, graph
   │
search                       ← question → cited answer
   │
engine                       ← createEngine(): the one-install aggregate
```

Beside the spine: **collab** (agent meetings, node builtins only),
**editing** (tracked-changes Word editing), **document-conversion-engine** (the Gotenberg
PDF-rendering client — Office/HTML/Markdown → PDF), **schema-generator**
(walks the feature wire contracts, emits the one schemas/v1 bundle the
Python services test against), **design-tokens** (pure CSS).

Reaching for a starting point: install `@launchstack/engine` for everything
behind one `createEngine(config)`, or the single brick you need. Every
package README opens with what it is, what it deliberately does not
contain, and its full subpath API.

Contributing a new tool: one directory inside the feature it belongs to,
named for the question it answers — `types.ts` (input and output types,
nothing else), the algorithm, `index.ts`, its test beside it, and a README
whose first three lines are Input / Does / Output. `evidence/` is the
package to imitate.
