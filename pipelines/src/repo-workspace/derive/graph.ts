/**
 * The file-reference graph and its ranking — the deterministic core of the
 * repo map (design §3.3, the Aider result: files = nodes, symbol references
 * = edges, PageRank picks what matters).
 *
 * Pure math over `FileSymbols`: no IO, no model, no randomness. Same input
 * ⇒ same ranking, which is what makes the context bundle reproducible.
 */

import type { FileSymbols } from "../types";

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
export function buildSymbolGraph(files: FileSymbols[]): SymbolGraph {
    const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const nodes = sorted.map(f => f.path);

    const definers = new Map<string, string[]>();
    for (const file of sorted) {
        for (const name of file.definitions) {
            const list = definers.get(name);
            if (list) {
                if (!list.includes(file.path)) list.push(file.path);
            } else {
                definers.set(name, [file.path]);
            }
        }
    }
    for (const list of definers.values()) list.sort();

    const referenceCounts = new Map<string, number>();
    const edgeWeights = new Map<string, number>();
    for (const file of sorted) {
        for (const name of file.references) {
            const targets = definers.get(name);
            if (!targets) continue;
            referenceCounts.set(name, (referenceCounts.get(name) ?? 0) + 1);
            const weight = 1 / targets.length;
            for (const target of targets) {
                if (target === file.path) continue;
                const key = `${file.path}\u0000${target}`;
                edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + weight);
            }
        }
    }

    const edges: GraphEdge[] = [...edgeWeights.entries()]
        .map(([key, weight]) => {
            const [from, to] = key.split("\u0000") as [string, string];
            return { from, to, weight };
        })
        .sort((a, b) =>
            a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0
        );

    return { nodes, edges, definers, referenceCounts };
}

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
export function pageRank(graph: SymbolGraph, options?: PageRankOptions): Map<string, number> {
    const damping = options?.damping ?? 0.85;
    const iterations = options?.iterations ?? 40;
    const { nodes, edges } = graph;
    const n = nodes.length;
    const ranks = new Map<string, number>();
    if (n === 0) return ranks;

    // Restart vector: uniform, or the normalized personalization.
    const restart = new Map<string, number>();
    const personalization = options?.personalization;
    if (personalization && personalization.size > 0) {
        let total = 0;
        for (const node of nodes) total += personalization.get(node) ?? 0;
        if (total > 0) {
            for (const node of nodes) restart.set(node, (personalization.get(node) ?? 0) / total);
        }
    }
    if (restart.size === 0) {
        for (const node of nodes) restart.set(node, 1 / n);
    }

    const outWeight = new Map<string, number>();
    for (const edge of edges) {
        outWeight.set(edge.from, (outWeight.get(edge.from) ?? 0) + edge.weight);
    }

    for (const node of nodes) ranks.set(node, 1 / n);

    for (let i = 0; i < iterations; i++) {
        const next = new Map<string, number>();
        for (const node of nodes) next.set(node, (1 - damping) * restart.get(node)!);

        // Dangling mass (nodes with no out-edges) is redistributed by the
        // restart vector so the ranks keep summing to 1.
        let danglingMass = 0;
        for (const node of nodes) {
            if (!outWeight.has(node)) danglingMass += ranks.get(node)!;
        }
        if (danglingMass > 0) {
            for (const node of nodes) {
                next.set(node, next.get(node)! + damping * danglingMass * restart.get(node)!);
            }
        }

        for (const edge of edges) {
            const share = ranks.get(edge.from)! * (edge.weight / outWeight.get(edge.from)!);
            next.set(edge.to, next.get(edge.to)! + damping * share);
        }
        for (const node of nodes) ranks.set(node, next.get(node)!);
    }

    return ranks;
}
