import { graphIndex, nodeLookup } from "../model/doc";
import { createEdge, createNode, createPage } from "../model/factory";
import { nodeBounds } from "../model/geometry";
import { routeEdge, routeEdgeCached } from "../model/routing";
import type { DiagramEdge, DiagramNode, DiagramPage } from "../model/types";

/**
 * The three caches behind Fix 3.
 *
 * All are keyed on document objects, which is only sound because the document
 * is edited immutably — an edit produces a new object, which misses the cache.
 * These tests pin both halves: that a hit returns the *same object* (which is
 * what makes React's `memo` work downstream), and that a real change misses.
 */

/** A chain of `n` nodes, each joined to the next. */
function chain(n: number): DiagramPage {
    const nodes: DiagramNode[] = [];
    for (let i = 0; i < n; i++) {
        nodes.push(
            createNode({ shape: "rectangle", x: i * 300, y: 0, w: 160, h: 60, text: `N${i}` })
        );
    }
    const edges: DiagramEdge[] = [];
    for (let i = 0; i < n - 1; i++) {
        edges.push(
            createEdge({
                from: { nodeId: nodes[i]!.id, port: "auto" },
                to: { nodeId: nodes[i + 1]!.id, port: "auto" },
            })
        );
    }
    return { ...createPage(), nodes, edges };
}

/** Move one node, immutably, the way a drag frame does. */
function moveNode(page: DiagramPage, id: string, dx: number): DiagramPage {
    return {
        ...page,
        nodes: page.nodes.map(n => (n.id === id ? { ...n, x: n.x + dx } : n)),
    };
}

function routeAll(page: DiagramPage): Map<string, ReturnType<typeof routeEdge>> {
    const lookup = nodeLookup(page);
    const map = new Map<string, ReturnType<typeof routeEdge>>();
    for (const e of page.edges) map.set(e.id, routeEdgeCached(e, lookup));
    return map;
}

describe("routeEdgeCached", () => {
    it("returns the identical object when nothing changed", () => {
        const page = chain(3);
        const lookup = nodeLookup(page);
        const edge = page.edges[0]!;

        const first = routeEdgeCached(edge, lookup);
        const second = routeEdgeCached(edge, nodeLookup(page));

        // Identity, not equality: a fresh-but-equal object would still defeat
        // `EdgeView`'s memo, which is the whole point of the cache.
        expect(second).toBe(first);
    });

    it("agrees with routeEdge", () => {
        const page = chain(4);
        const lookup = nodeLookup(page);

        for (const edge of page.edges) {
            expect(routeEdgeCached(edge, lookup)).toEqual(routeEdge(edge, lookup));
        }
    });

    it("re-routes only the edges touching the node that moved", () => {
        const page = chain(200);
        expect(page.edges).toHaveLength(199);

        const before = routeAll(page);

        // Drag one node in the middle of the chain.
        const moved = page.nodes[100]!;
        const after = routeAll(moveNode(page, moved.id, 40));

        const changed = page.edges.filter(e => after.get(e.id) !== before.get(e.id));

        // Only the two edges attached to it: 199 - 2 = 197 keep their routes.
        expect(changed).toHaveLength(2);
        for (const e of changed) {
            expect([e.from.nodeId, e.to.nodeId]).toContain(moved.id);
        }
    });

    it("re-routes when an endpoint moves", () => {
        const page = chain(3);
        const edge = page.edges[0]!;
        const before = routeEdgeCached(edge, nodeLookup(page));

        const next = moveNode(page, page.nodes[0]!.id, 120);
        const after = routeEdgeCached(edge, nodeLookup(next));

        expect(after).not.toBe(before);
        expect(after.start.x).not.toBe(before.start.x);
    });

    it("re-routes when the edge itself changed", () => {
        const page = chain(3);
        const edge = page.edges[0]!;
        const lookup = nodeLookup(page);
        const before = routeEdgeCached(edge, lookup);

        // A new edge object — dropping a bend into it — must not hit the cache.
        const bent: DiagramEdge = { ...edge, waypoints: [{ x: 200, y: 200 }] };
        const after = routeEdgeCached(bent, lookup);

        expect(after).not.toBe(before);
        expect(after.points.length).toBeGreaterThan(2);
    });

    it("re-routes when an endpoint node disappears", () => {
        const page = chain(2);
        const edge = page.edges[0]!;
        const before = routeEdgeCached(edge, nodeLookup(page));

        const orphaned = { ...page, nodes: [page.nodes[0]!] };
        const after = routeEdgeCached(edge, nodeLookup(orphaned));

        expect(after).not.toBe(before);
    });
});

describe("graphIndex cache", () => {
    it("returns the identical index for the same page object", () => {
        const page = chain(5);
        expect(graphIndex(page)).toBe(graphIndex(page));
    });

    it("recomputes for a new page object, and is correct", () => {
        const page = chain(5);
        const before = graphIndex(page);

        const extra = createEdge({
            from: { nodeId: page.nodes[0]!.id, port: "auto" },
            to: { nodeId: page.nodes[4]!.id, port: "auto" },
        });
        const next = { ...page, edges: [...page.edges, extra] };
        const after = graphIndex(next);

        expect(after).not.toBe(before);
        expect(after.out.get(page.nodes[0]!.id)).toContain(page.nodes[4]!.id);
        // The old index must not have been mutated behind the caller's back.
        expect(before.out.get(page.nodes[0]!.id)).not.toContain(page.nodes[4]!.id);
    });
});

describe("nodeBounds cache", () => {
    it("returns the identical rect for the same node object", () => {
        const node = createNode({ shape: "rectangle", x: 10, y: 20, w: 100, h: 50 });
        expect(nodeBounds(node)).toBe(nodeBounds(node));
    });

    it("recomputes for a moved node", () => {
        const node = createNode({ shape: "rectangle", x: 10, y: 20, w: 100, h: 50 });
        const before = nodeBounds(node);
        const after = nodeBounds({ ...node, x: 500 });

        expect(after).not.toBe(before);
        expect(after.x).toBe(500);
        expect(before.x).toBe(10);
    });

    it("still accounts for rotation", () => {
        const node = createNode({ shape: "rectangle", x: 0, y: 0, w: 100, h: 20 });
        const straight = nodeBounds(node);
        const turned = nodeBounds({ ...node, rotation: 90 });

        // A 90° turn swaps the extents; caching must not flatten that.
        expect(Math.round(turned.w)).toBe(Math.round(straight.h));
        expect(Math.round(turned.h)).toBe(Math.round(straight.w));
    });
});
