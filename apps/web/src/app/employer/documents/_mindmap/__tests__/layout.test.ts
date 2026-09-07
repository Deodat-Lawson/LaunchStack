import { computeLayout, suggestChildPosition } from "../model/layout";
import { createEdge, createNode, createPage } from "../model/factory";
import { rectsIntersect } from "../model/geometry";
import type { DiagramNode, DiagramPage } from "../model/types";

function node(id: string, w = 120, h = 50): DiagramNode {
    return { ...createNode({ shape: "rectangle", x: 0, y: 0, w, h }), id };
}

function link(from: string, to: string) {
    return createEdge({ from: { nodeId: from }, to: { nodeId: to } });
}

/** root with three children; the middle child has four of its own. */
function lopsidedTree(): DiagramPage {
    return {
        ...createPage(),
        nodes: [
            node("root"),
            node("c1"),
            node("c2"),
            node("c3"),
            node("g1"),
            node("g2"),
            node("g3"),
            node("g4"),
        ],
        edges: [
            link("root", "c1"),
            link("root", "c2"),
            link("root", "c3"),
            link("c2", "g1"),
            link("c2", "g2"),
            link("c2", "g3"),
            link("c2", "g4"),
        ],
    };
}

function placedRects(page: DiagramPage, positions: Map<string, { x: number; y: number }>) {
    return page.nodes
        .filter(n => positions.has(n.id))
        .map(n => {
            const p = positions.get(n.id)!;
            return { id: n.id, x: p.x, y: p.y, w: n.w, h: n.h };
        });
}

function anyOverlap(rects: { id: string; x: number; y: number; w: number; h: number }[]): string[] {
    const clashes: string[] = [];
    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i]!;
            const b = rects[j]!;
            // Shrink by a hair so shapes that merely touch are not counted.
            if (
                rectsIntersect({ ...a, w: a.w - 1, h: a.h - 1 }, { ...b, w: b.w - 1, h: b.h - 1 })
            ) {
                clashes.push(`${a.id}/${b.id}`);
            }
        }
    }
    return clashes;
}

describe("tree layout", () => {
    it("places every node exactly once", () => {
        const page = lopsidedTree();
        const positions = computeLayout(page, { kind: "tree", direction: "right" });
        expect(positions.size).toBe(page.nodes.length);
    });

    it("produces no overlapping shapes even when branches differ in size", () => {
        const page = lopsidedTree();
        const positions = computeLayout(page, { kind: "tree", direction: "right" });
        expect(anyOverlap(placedRects(page, positions))).toEqual([]);
    });

    it("advances along the direction of growth", () => {
        const page = lopsidedTree();
        const right = computeLayout(page, { kind: "tree", direction: "right" });
        expect(right.get("c1")!.x).toBeGreaterThan(right.get("root")!.x);
        expect(right.get("g1")!.x).toBeGreaterThan(right.get("c2")!.x);

        const down = computeLayout(page, { kind: "tree", direction: "down" });
        expect(down.get("c1")!.y).toBeGreaterThan(down.get("root")!.y);

        const left = computeLayout(page, { kind: "tree", direction: "left" });
        expect(left.get("c1")!.x).toBeLessThan(left.get("root")!.x);

        const up = computeLayout(page, { kind: "tree", direction: "up" });
        expect(up.get("c1")!.y).toBeLessThan(up.get("root")!.y);
    });

    it("centres a parent on the block its children occupy", () => {
        const page = lopsidedTree();
        const positions = computeLayout(page, { kind: "tree", direction: "right" });
        const parent = positions.get("c2")!;
        const kids = ["g1", "g2", "g3", "g4"].map(id => positions.get(id)!);
        const top = Math.min(...kids.map(k => k.y));
        const bottom = Math.max(...kids.map(k => k.y + 50));
        expect(parent.y + 25).toBeCloseTo((top + bottom) / 2, 0);
    });

    it("handles a graph with no root by falling back to the first node", () => {
        const page: DiagramPage = {
            ...createPage(),
            nodes: [node("x"), node("y")],
            edges: [link("x", "y"), link("y", "x")],
        };
        const positions = computeLayout(page, { kind: "tree" });
        expect(positions.size).toBeGreaterThan(0);
    });

    it("returns nothing for an empty page", () => {
        expect(computeLayout(createPage(), { kind: "tree" }).size).toBe(0);
    });
});

describe("mindmap layout", () => {
    it("splits first-level topics onto both sides of the root", () => {
        const page = lopsidedTree();
        const positions = computeLayout(page, { kind: "mindmap" });
        const root = positions.get("root")!;
        const sides = ["c1", "c2", "c3"].map(id => Math.sign(positions.get(id)!.x - root.x));
        expect(sides).toContain(1);
        expect(sides).toContain(-1);
    });

    it("keeps the root where it was", () => {
        const page = lopsidedTree();
        page.nodes[0]!.x = 500;
        page.nodes[0]!.y = 300;
        const positions = computeLayout(page, { kind: "mindmap" });
        expect(positions.get("root")).toEqual({ x: 500, y: 300 });
    });

    it("does not overlap shapes", () => {
        const page = lopsidedTree();
        const positions = computeLayout(page, { kind: "mindmap" });
        expect(anyOverlap(placedRects(page, positions))).toEqual([]);
    });

    it("skips a collapsed branch's children", () => {
        const page = lopsidedTree();
        page.nodes[2]!.collapsed = true; // c2
        const positions = computeLayout(page, { kind: "mindmap" });
        expect(positions.has("g1")).toBe(false);
        expect(positions.has("c2")).toBe(true);
    });
});

describe("radial layout", () => {
    it("pushes each ring further from the centre", () => {
        const page = lopsidedTree();
        const positions = computeLayout(page, { kind: "radial" });
        const root = positions.get("root")!;
        const centre = { x: root.x + 60, y: root.y + 25 };
        const distance = (id: string) => {
            const p = positions.get(id)!;
            return Math.hypot(p.x + 60 - centre.x, p.y + 25 - centre.y);
        };
        expect(distance("g1")).toBeGreaterThan(distance("c2"));
    });
});

describe("grid layout", () => {
    it("packs a subset into rows without overlap", () => {
        const page = lopsidedTree();
        const subset = ["c1", "c2", "c3", "g1"];
        const positions = computeLayout(page, { kind: "grid", columns: 2 }, subset);
        expect(positions.size).toBe(4);
        expect(anyOverlap(placedRects(page, positions))).toEqual([]);
    });

    it("defaults to a roughly square arrangement", () => {
        const page = lopsidedTree();
        const positions = computeLayout(page, { kind: "grid" });
        expect(positions.size).toBe(page.nodes.length);
    });
});

describe("suggestChildPosition", () => {
    it("places the first child beside its parent", () => {
        const page = lopsidedTree();
        page.nodes[0]!.x = 0;
        page.nodes[0]!.y = 0;
        const at = suggestChildPosition({ ...page, edges: [] }, "root", { w: 120, h: 50 }, "right");
        expect(at.x).toBeGreaterThan(120);
        expect(at.y).toBeCloseTo(0);
    });

    it("stacks later children below the existing ones", () => {
        const page = lopsidedTree();
        page.nodes.forEach((n, i) => {
            n.x = i * 200;
            n.y = i * 100;
        });
        const at = suggestChildPosition(page, "c2", { w: 120, h: 50 }, "right");
        const lowest = Math.max(
            ...["g1", "g2", "g3", "g4"].map(id => {
                const nd = page.nodes.find(n => n.id === id)!;
                return nd.y + nd.h;
            })
        );
        expect(at.y).toBeGreaterThanOrEqual(lowest);
    });

    it("returns the origin for an unknown parent", () => {
        expect(suggestChildPosition(createPage(), "nope", { w: 10, h: 10 })).toEqual({
            x: 0,
            y: 0,
        });
    });
});
