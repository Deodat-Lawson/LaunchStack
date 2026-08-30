"use client";

import { useRef, useState } from "react";
import { MarkdownViewer } from "~/app/employer/documents/components/MarkdownViewer";
import type { ViewerHighlight } from "~/lib/find-text-range";

/**
 * Local harness for the markdown document viewer. The fixture exercises every
 * feature the viewer supports — GFM, math, code, mermaid, footnotes — and is
 * served to the component through a data: URL so the real fetch path runs
 * without a backend. Gated by the server page.
 */
const FIXTURE = `# LaunchStack Q3 Retrieval Plan

This is a **fixture document** for the markdown viewer. It exists to answer one
question: does an uploaded \`.md\` file read like a document, not like source code?

> The corpus is only as useful as the day-one reading experience. If the first
> upload looks broken, nobody adds a second one.

## Where we are

The retrieval stack indexes uploads immediately and re-embeds connector content
incrementally. See the [consolidation design](https://example.com/design) for the
package layout, or jump to [the risks](#risks) below.[^1]

### Current metrics

| Metric              | Q2 actual | Q3 target | Status |
| ------------------- | --------- | --------- | ------ |
| Recall@10           | 0.71      | 0.80      | 🟡     |
| Median query latency | 340 ms    | 250 ms    | 🟢     |
| Corpus size         | 12k docs  | 40k docs  | 🟢     |

### Scoring

Ranking blends BM25 with cosine similarity. The blend weight $\\alpha$ is tuned
per workspace:

$$
\\mathrm{score}(q, d) = \\alpha \\cdot \\mathrm{BM25}(q, d) + (1 - \\alpha) \\cdot \\cos(\\mathbf{q}, \\mathbf{d})
$$

## Workstreams

- [x] Ship the Google Drive connector
- [x] Incremental re-embedding on content hash change
- [ ] Slack channel backfill
- [ ] Cross-encoder reranking behind a flag
  - [ ] Latency budget: +80 ms max

## Pipeline shape

\`\`\`mermaid
flowchart LR
    U[Upload] --> X[Extract]
    X --> C[Chunk]
    C --> E[Embed]
    E --> I[(Index)]
    Q[Query] --> R[Retrieve]
    I --> R
    R --> K[Rerank]
\`\`\`

## Reference implementation

\`\`\`ts
export async function retrieve(query: string, k = 10): Promise<Chunk[]> {
    const [sparse, dense] = await Promise.all([
        bm25.search(query, k * 4),
        vectors.search(await embed(query), k * 4),
    ]);
    // Reciprocal-rank fusion keeps either signal from dominating.
    return fuse(sparse, dense).slice(0, k);
}
\`\`\`

## Risks

1. Connector rate limits throttle the initial Drive backfill
2. Re-embedding storms when a large folder is renamed
3. ~~Cold-start latency~~ — solved by warming the index at boot

---

*Last updated by the retrieval working group.*

[^1]: Footnotes render at the bottom with a back-link.
`;

const DATA_URL = `data:text/markdown;charset=utf-8,${encodeURIComponent(FIXTURE)}`;

/**
 * Simulated citation snippets, raw-chunk-style: whitespace-normalized source
 * markdown with the syntax markers the renderer consumes, exactly what the
 * retrieval pipeline hands the viewer.
 */
const SIMULATED_CITATIONS = [
    "The corpus is only as useful as the day-one reading experience. If the first upload looks broken, nobody adds a second one.",
    "| Recall@10 | 0.71 | 0.80 |",
    "Re-embedding storms when a large folder is renamed",
] as const;

export function MarkdownViewerPreview() {
    const [highlight, setHighlight] = useState<ViewerHighlight | null>(null);
    const nonce = useRef(0);
    const citeIndex = useRef(0);

    return (
        <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
            <button
                type="button"
                data-testid="simulate-citation"
                onClick={() => {
                    nonce.current += 1;
                    const text =
                        SIMULATED_CITATIONS[citeIndex.current % SIMULATED_CITATIONS.length]!;
                    citeIndex.current += 1;
                    setHighlight({ text, nonce: nonce.current });
                }}
                style={{
                    position: "fixed",
                    right: 16,
                    bottom: 16,
                    zIndex: 50,
                    padding: "8px 14px",
                    borderRadius: 8,
                    background: "var(--accent)",
                    color: "white",
                    fontSize: 12,
                    fontWeight: 600,
                }}
            >
                Simulate citation click
            </button>
            <MarkdownViewer url={DATA_URL} title="q3-retrieval-plan.md" highlight={highlight} />
        </div>
    );
}
