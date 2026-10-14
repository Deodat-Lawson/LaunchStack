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
retrieval                    ← question → cited answer
   │
tools  engine                ← shared capabilities · createEngine(): the one-install aggregate

google-drive                 ← beside the spine: Drive v3 + OAuth token client
```

Beside the spine: **collab** (agent meetings, node builtins only),
**editing** (tracked-changes Word editing), **document-conversion-engine** (the Gotenberg
PDF-rendering client — Office/HTML/Markdown → PDF), **google-drive** (Drive v3
and OAuth token endpoints with injected credentials), **schema-generator**
(walks conversion, orchestration and editing wire contracts, emits
the one schemas/v1 bundle the Python services test against),
**design-tokens** (private, pure CSS).

Reaching for a starting point: use `@launchstack/engine` for the engine spine
behind one `createEngine(config)`, or the single brick you need. Package
READMEs describe their scope and API where present; each `package.json`
exports map is the authoritative list of public subpaths.

Contributing a new tool: one directory inside the brick it belongs to,
named for the question it answers — `types.ts` (input and output types,
nothing else), the algorithm, `index.ts`, its test beside it, and a README
whose first three lines are Input / Does / Output. Shared capabilities live
in `tools/src/`; vertical-only behavior stays in `../pipelines/src/`.
`evidence/` is the package to imitate.
