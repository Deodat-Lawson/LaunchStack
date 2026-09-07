# strategies — the named ANN variants

**What they are.** The actual nearest-neighbour algorithms behind the vector
retriever, each an individually documented module. `ANNOptimizer` is the
config-driven dispatcher consumers hold; strategy functions are also
callable directly.

| Strategy | Module | Mechanism | Reaches for |
| --- | --- | --- | --- |
| `hnsw` | `exact.ts` | Ordered cosine-distance scan, 5× over-sample then in-memory refine; rides the column's HNSW index when one exists | Small scopes; the universal fallback |
| `ivf` | `ivf.ts` | Rank per-document centroid clusters, scan only the top `probeCount` clusters' chunks | Many documents, few relevant |
| `prefiltered` | `prefiltered.ts` | Score whole documents via centroids, scan qualifying documents best-first until `limit` fills | Medium scopes with skewed relevance |
| `matryoshka` | `matryoshka.ts` | 512-dim short-vector coarse pass (HNSW-indexed) → full-dim re-rank of the survivors | Large scopes where full-dim scans are too slow |
| `hybrid` | `index.ts` | Adaptive: ≤5 docs → exact, ≤20 → prefiltered, else matryoshka | The default when the scope size varies |

**Shared machinery.** `clusters.ts` builds and caches the per-document
centroid clusters (1h in-process TTL; `ANNOptimizer.clearCache()` resets).
`sanitize.ts` strips query vectors out of error messages before logging.

**Contract.** Every strategy returns `ANNResult[]` filtered to
`distance ≤ threshold`, sorted ascending by distance, and degrades to `[]`
on error — a failing strategy thins results, never throws.
