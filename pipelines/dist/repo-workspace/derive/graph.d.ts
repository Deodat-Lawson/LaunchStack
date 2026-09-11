/**
 * The file-reference graph and its ranking — the deterministic core of the
 * repo map (design §3.3, the Aider result: files = nodes, symbol references
 * = edges, PageRank picks what matters).
 *
 * Pure math over `FileSymbols`: no IO, no model, no randomness. Same input
 * ⇒ same ranking, which is what makes the context bundle reproducible.
 */
import type { FileSymbols } from "../types.js";
export interface GraphEdge {
    from: string;
    to: string;
    weight: number;
}
export interface SymbolGraph {
    /** Sorted node ids (file paths). */
    nodes: string[];
    edges: GraphEdge[];
    /** definition name → paths that define it (sorted). */
    definers: Map<string, string[]>;
    /** definition name → total number of files referencing it. */
    referenceCounts: Map<string, number>;
}
/**
 * Build the graph: an edge A→B exists when A references a name B defines.
 * A name defined in k files contributes 1/k weight to each definer, so
 * ambiguous names don't dominate the ranking.
 */
export declare function buildSymbolGraph(files: FileSymbols[]): SymbolGraph;
export interface PageRankOptions {
    damping?: number;
    iterations?: number;
    /** Bias the restart vector toward these nodes (e.g. entry points). */
    personalization?: ReadonlyMap<string, number>;
}
/**
 * Personalized PageRank on the sparse graph. Fixed iteration count instead
 * of a convergence epsilon — determinism beats the last decimal place here.
 * Returns a map whose values sum to ~1 (exactly 0-sum when there are no
 * nodes).
 */
export declare function pageRank(graph: SymbolGraph, options?: PageRankOptions): Map<string, number>;
//# sourceMappingURL=graph.d.ts.map