import { describe, expect, it } from "vitest";

import type { FileSymbols } from "../types";
import { buildSymbolGraph, pageRank } from "./graph";

const file = (
    path: string,
    definitions: string[] = [],
    references: string[] = []
): FileSymbols => ({ path, definitions, references });

function rankSum(ranks: Map<string, number>): number {
    let sum = 0;
    for (const value of ranks.values()) sum += value;
    return sum;
}

describe("buildSymbolGraph", () => {
    it("creates an edge A→B when A references a name B defines", () => {
        const graph = buildSymbolGraph([file("a.ts", [], ["helper"]), file("b.ts", ["helper"])]);
        expect(graph.nodes).toEqual(["a.ts", "b.ts"]);
        expect(graph.edges).toEqual([{ from: "a.ts", to: "b.ts", weight: 1 }]);
    });

    it("creates no edge for references nobody defines", () => {
        const graph = buildSymbolGraph([file("a.ts", [], ["ghost"]), file("b.ts", ["helper"])]);
        expect(graph.edges).toEqual([]);
        expect(graph.referenceCounts.has("ghost")).toBe(false);
    });

    it("excludes self-edges but still counts the reference", () => {
        const graph = buildSymbolGraph([file("a.ts", ["own"], ["own"])]);
        expect(graph.edges).toEqual([]);
        expect(graph.referenceCounts.get("own")).toBe(1);
    });

    it("splits weight 1/k across the k definers of an ambiguous name", () => {
        const graph = buildSymbolGraph([
            file("a.ts", [], ["helper"]),
            file("b.ts", ["helper"]),
            file("c.ts", ["helper"]),
        ]);
        expect(graph.edges).toEqual([
            { from: "a.ts", to: "b.ts", weight: 0.5 },
            { from: "a.ts", to: "c.ts", weight: 0.5 },
        ]);
    });

    it("accumulates weight across multiple referenced names on the same edge", () => {
        const graph = buildSymbolGraph([
            file("a.ts", [], ["one", "two"]),
            file("b.ts", ["one", "two"]),
        ]);
        expect(graph.edges).toEqual([{ from: "a.ts", to: "b.ts", weight: 2 }]);
    });

    it("counts referencing files per name in referenceCounts", () => {
        const graph = buildSymbolGraph([
            file("core.ts", ["shared"]),
            file("a.ts", [], ["shared"]),
            file("b.ts", [], ["shared"]),
        ]);
        expect(graph.referenceCounts.get("shared")).toBe(2);
    });

    it("maps each definition name to its sorted definers, without duplicates", () => {
        const graph = buildSymbolGraph([
            file("z.ts", ["helper", "helper"]),
            file("a.ts", ["helper"]),
        ]);
        expect(graph.definers.get("helper")).toEqual(["a.ts", "z.ts"]);
    });

    it("orders nodes and edges deterministically regardless of input order", () => {
        const shuffled = [
            file("c.ts", ["gamma"], ["alpha"]),
            file("a.ts", ["alpha"], ["beta"]),
            file("b.ts", ["beta"], ["alpha", "gamma"]),
        ];
        const graph = buildSymbolGraph(shuffled);
        expect(graph.nodes).toEqual(["a.ts", "b.ts", "c.ts"]);
        expect(graph.edges).toEqual([
            { from: "a.ts", to: "b.ts", weight: 1 },
            { from: "b.ts", to: "a.ts", weight: 1 },
            { from: "b.ts", to: "c.ts", weight: 1 },
            { from: "c.ts", to: "a.ts", weight: 1 },
        ]);

        const reversed = buildSymbolGraph([...shuffled].reverse());
        expect(reversed.nodes).toEqual(graph.nodes);
        expect(reversed.edges).toEqual(graph.edges);
    });

    it("round-trips file paths containing spaces through the edge keys", () => {
        const graph = buildSymbolGraph([
            file("app.ts", [], ["spacedHelper"]),
            file("src/my lib.ts", ["spacedHelper"]),
        ]);
        expect(graph.edges).toEqual([{ from: "app.ts", to: "src/my lib.ts", weight: 1 }]);
    });
});

describe("pageRank", () => {
    it("returns an empty map for an empty graph", () => {
        const graph = buildSymbolGraph([]);
        expect(pageRank(graph).size).toBe(0);
    });

    it("produces ranks summing to ~1", () => {
        const graph = buildSymbolGraph([
            file("core.ts", ["coreFn"]),
            file("a.ts", ["aFn"], ["coreFn"]),
            file("b.ts", ["bFn"], ["coreFn", "aFn"]),
            file("c.ts", [], ["coreFn"]),
        ]);
        expect(rankSum(pageRank(graph))).toBeCloseTo(1, 8);
    });

    it("ranks a file referenced by many above a leaf", () => {
        const graph = buildSymbolGraph([
            file("core.ts", ["coreFn"]),
            file("a.ts", [], ["coreFn"]),
            file("b.ts", [], ["coreFn"]),
            file("c.ts", [], ["coreFn"]),
        ]);
        const ranks = pageRank(graph);
        const core = ranks.get("core.ts") ?? 0;
        const leaf = ranks.get("a.ts") ?? 0;
        expect(core).toBeGreaterThan(leaf);
    });

    it("redistributes dangling-node mass so the sum stays ~1", () => {
        // b.ts has no out-edges at all: pure sink.
        const graph = buildSymbolGraph([file("a.ts", [], ["sink"]), file("b.ts", ["sink"])]);
        const ranks = pageRank(graph);
        expect(rankSum(ranks)).toBeCloseTo(1, 8);
        expect(ranks.get("b.ts") ?? 0).toBeGreaterThan(ranks.get("a.ts") ?? 0);
    });

    it("keeps the sum ~1 on a fully disconnected graph", () => {
        const graph = buildSymbolGraph([file("a.ts"), file("b.ts"), file("c.ts")]);
        const ranks = pageRank(graph);
        expect(rankSum(ranks)).toBeCloseTo(1, 8);
        expect(ranks.get("a.ts")).toBeCloseTo(1 / 3, 8);
    });

    it("biases ranks toward the personalized node", () => {
        // Perfectly symmetric two-node cycle: without personalization both
        // sides tie; personalization must break the tie toward a.ts.
        const files = [file("a.ts", ["aFn"], ["bFn"]), file("b.ts", ["bFn"], ["aFn"])];
        const graph = buildSymbolGraph(files);

        const neutral = pageRank(graph);
        expect(neutral.get("a.ts") ?? 0).toBeCloseTo(neutral.get("b.ts") ?? 0, 8);

        const biased = pageRank(graph, { personalization: new Map([["a.ts", 1]]) });
        expect(biased.get("a.ts") ?? 0).toBeGreaterThan(biased.get("b.ts") ?? 0);
        expect(rankSum(biased)).toBeCloseTo(1, 8);
    });

    it("funnels everything to the personalized node when nothing links out", () => {
        const graph = buildSymbolGraph([file("a.ts"), file("b.ts"), file("c.ts")]);
        const ranks = pageRank(graph, { personalization: new Map([["a.ts", 1]]) });
        expect(ranks.get("a.ts") ?? 0).toBeCloseTo(1, 8);
        expect(ranks.get("b.ts") ?? 0).toBeCloseTo(0, 8);
    });

    it("ignores personalization that names no known node", () => {
        const graph = buildSymbolGraph([file("a.ts"), file("b.ts")]);
        const uniform = pageRank(graph);
        const bogus = pageRank(graph, { personalization: new Map([["ghost.ts", 1]]) });
        expect(bogus).toEqual(uniform);
    });

    it("is deterministic: two runs produce deep-equal maps", () => {
        const graph = buildSymbolGraph([
            file("core.ts", ["coreFn"], ["utilFn"]),
            file("util.ts", ["utilFn"]),
            file("a.ts", [], ["coreFn"]),
            file("b.ts", [], ["coreFn", "utilFn"]),
        ]);
        expect(pageRank(graph)).toEqual(pageRank(graph));
    });
});
