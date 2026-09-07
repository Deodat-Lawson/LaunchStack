import {
    addChildTopic,
    addPage,
    alignSelection,
    applySwatch,
    applyTheme,
    deleteBranch,
    deleteNodeReconnecting,
    deletePage,
    deleteSelection,
    distributeSelection,
    duplicateSelection,
    flipSelection,
    groupSelection,
    matchSize,
    reorder,
    reverseEdges,
    runLayout,
    scaleNodesToBounds,
    searchDoc,
    selectConnected,
    selectSameShape,
    setEdgeKind,
    setNodeText,
    setShapeType,
    styleSelection,
    toggleCollapse,
    toggleLock,
    translateNodes,
    ungroupSelection,
} from "../model/commands";
import { activePage, graphIndex, nodeById } from "../model/doc";
import { createDoc, createEdge, createNode, createPage } from "../model/factory";
import { SWATCH_BY_ID } from "../model/palette";
import { EditorStore } from "../model/store";
import type { DiagramNode, DiagramPage } from "../model/types";

function node(id: string, overrides: Partial<DiagramNode> = {}): DiagramNode {
    return {
        ...createNode({ shape: "rectangle", x: 0, y: 0, w: 100, h: 50 }),
        id,
        ...overrides,
    };
}

function storeWith(page: Partial<DiagramPage>): EditorStore {
    return new EditorStore(createDoc("Test", [{ ...createPage(), nodes: [], edges: [], ...page }]));
}

function page(store: EditorStore): DiagramPage {
    return activePage(store.getState().doc);
}

describe("translateNodes", () => {
    it("moves the node and its containment children", () => {
        const p: DiagramPage = {
            ...createPage(),
            nodes: [node("g", { shape: "group" }), node("c", { parentId: "g", x: 20 })],
        };
        const next = translateNodes(p, ["g"], { x: 10, y: 5 });
        expect(next.nodes.map(n => [n.x, n.y])).toEqual([
            [10, 5],
            [30, 5],
        ]);
    });

    it("drags waypoints along when both ends move", () => {
        const p: DiagramPage = {
            ...createPage(),
            nodes: [node("a"), node("b", { x: 300 })],
            edges: [
                {
                    ...createEdge({ from: { nodeId: "a" }, to: { nodeId: "b" } }),
                    waypoints: [{ x: 150, y: 150 }],
                },
            ],
        };
        const next = translateNodes(p, ["a", "b"], { x: 10, y: 0 });
        expect(next.edges[0]!.waypoints[0]).toEqual({ x: 160, y: 150 });
    });

    it("leaves waypoints alone when only one end moves", () => {
        const p: DiagramPage = {
            ...createPage(),
            nodes: [node("a"), node("b", { x: 300 })],
            edges: [
                {
                    ...createEdge({ from: { nodeId: "a" }, to: { nodeId: "b" } }),
                    waypoints: [{ x: 150, y: 150 }],
                },
            ],
        };
        expect(translateNodes(p, ["a"], { x: 10, y: 0 }).edges[0]!.waypoints[0]).toEqual({
            x: 150,
            y: 150,
        });
    });

    it("is a no-op for a zero delta", () => {
        const p: DiagramPage = { ...createPage(), nodes: [node("a")] };
        expect(translateNodes(p, ["a"], { x: 0, y: 0 })).toBe(p);
    });
});

describe("alignment", () => {
    const build = () =>
        storeWith({
            nodes: [
                node("a", { x: 0, y: 0, w: 100, h: 50 }),
                node("b", { x: 40, y: 200, w: 60, h: 30 }),
                node("c", { x: 300, y: 400, w: 80, h: 20 }),
            ],
        });

    it("aligns left edges", () => {
        const store = build();
        store.selectNodes(["a", "b", "c"]);
        alignSelection(store, "left");
        expect(page(store).nodes.map(n => n.x)).toEqual([0, 0, 0]);
    });

    it("aligns right edges", () => {
        const store = build();
        store.selectNodes(["a", "b", "c"]);
        alignSelection(store, "right");
        const right = page(store).nodes.map(n => n.x + n.w);
        expect(new Set(right).size).toBe(1);
    });

    it("aligns centres", () => {
        const store = build();
        store.selectNodes(["a", "b", "c"]);
        alignSelection(store, "hcenter");
        const centres = page(store).nodes.map(n => n.x + n.w / 2);
        expect(new Set(centres.map(v => Math.round(v))).size).toBe(1);
    });

    it("does nothing with fewer than two shapes", () => {
        const store = build();
        store.selectNodes(["a"]);
        alignSelection(store, "left");
        expect(store.getState().canUndo).toBe(false);
    });

    it("distributes the gaps evenly", () => {
        const store = storeWith({
            nodes: [
                node("a", { x: 0, w: 100 }),
                node("b", { x: 120, w: 100 }),
                node("c", { x: 600, w: 100 }),
            ],
        });
        store.selectNodes(["a", "b", "c"]);
        distributeSelection(store, "h");
        const nodes = page(store).nodes;
        const gap1 = nodes[1]!.x - (nodes[0]!.x + nodes[0]!.w);
        const gap2 = nodes[2]!.x - (nodes[1]!.x + nodes[1]!.w);
        expect(gap1).toBeCloseTo(gap2);
    });

    it("needs three shapes to distribute", () => {
        const store = build();
        store.selectNodes(["a", "b"]);
        distributeSelection(store, "h");
        expect(store.getState().canUndo).toBe(false);
    });

    it("matches sizes to the largest", () => {
        const store = build();
        store.selectNodes(["a", "b", "c"]);
        matchSize(store, "both");
        expect(page(store).nodes.every(n => n.w === 100 && n.h === 50)).toBe(true);
    });
});

describe("grouping", () => {
    it("wraps the selection in a group sized to its bounds", () => {
        const store = storeWith({
            nodes: [node("a", { x: 0, y: 0, w: 100, h: 50 }), node("b", { x: 200, y: 100 })],
        });
        store.selectNodes(["a", "b"]);
        groupSelection(store);

        const group = page(store).nodes.find(n => n.shape === "group");
        expect(group).toBeDefined();
        expect(group!.w).toBe(300);
        expect(group!.h).toBe(150);
        expect(page(store).nodes.filter(n => n.parentId === group!.id)).toHaveLength(2);
        expect(store.selectedNodeIds()).toEqual([group!.id]);
    });

    it("needs two shapes", () => {
        const store = storeWith({ nodes: [node("a")] });
        store.selectNodes(["a"]);
        groupSelection(store);
        expect(page(store).nodes.some(n => n.shape === "group")).toBe(false);
    });

    it("releases children and removes the group", () => {
        const store = storeWith({
            nodes: [node("a"), node("b", { x: 200 })],
        });
        store.selectNodes(["a", "b"]);
        groupSelection(store);
        ungroupSelection(store);
        expect(page(store).nodes.some(n => n.shape === "group")).toBe(false);
        expect(page(store).nodes.every(n => n.parentId === null)).toBe(true);
        expect(store.selectedNodeIds().sort()).toEqual(["a", "b"]);
    });
});

describe("deletion", () => {
    const build = () => {
        const store = storeWith({
            nodes: [node("root"), node("mid", { x: 200 }), node("leaf", { x: 400 })],
            edges: [
                createEdge({ from: { nodeId: "root" }, to: { nodeId: "mid" } }),
                createEdge({ from: { nodeId: "mid" }, to: { nodeId: "leaf" } }),
            ],
        });
        return store;
    };

    it("removes only the selection and its connectors", () => {
        const store = build();
        store.selectNodes(["mid"]);
        deleteSelection(store);
        expect(
            page(store)
                .nodes.map(n => n.id)
                .sort()
        ).toEqual(["leaf", "root"]);
        expect(page(store).edges).toHaveLength(0);
        expect(store.getState().selection).toEqual([]);
    });

    it("reconnects orphans to the grandparent", () => {
        const store = build();
        deleteNodeReconnecting(store, "mid");
        const idx = graphIndex(page(store));
        expect(idx.out.get("root")).toEqual(["leaf"]);
    });

    it("deletes the whole downstream branch on request", () => {
        const store = build();
        deleteBranch(store, "mid");
        expect(page(store).nodes.map(n => n.id)).toEqual(["root"]);
    });
});

describe("duplication", () => {
    it("copies the selection with fresh ids, offset from the original", () => {
        const store = storeWith({ nodes: [node("a", { text: "Hello" })] });
        store.selectNodes(["a"]);
        duplicateSelection(store);

        const nodes = page(store).nodes;
        expect(nodes).toHaveLength(2);
        expect(nodes[1]!.id).not.toBe("a");
        expect(nodes[1]!.text).toBe("Hello");
        expect(nodes[1]!.x).toBe(nodes[0]!.x + 24);
        expect(store.selectedNodeIds()).toEqual([nodes[1]!.id]);
    });

    it("carries internal connectors along", () => {
        const store = storeWith({
            nodes: [node("a"), node("b", { x: 200 })],
            edges: [createEdge({ from: { nodeId: "a" }, to: { nodeId: "b" } })],
        });
        store.selectNodes(["a", "b"]);
        duplicateSelection(store);

        expect(page(store).edges).toHaveLength(2);
        const copy = page(store).edges[1]!;
        expect(copy.from.nodeId).not.toBe("a");
        expect(copy.to.nodeId).not.toBe("b");
    });
});

describe("styling", () => {
    it("applies a swatch to fill, stroke and text at once", () => {
        const store = storeWith({ nodes: [node("a")] });
        store.selectNodes(["a"]);
        applySwatch(store, "teal");
        const nd = nodeById(page(store), "a")!;
        expect(nd.style.fill).toBe(SWATCH_BY_ID.teal!.fill);
        expect(nd.style.stroke).toBe(SWATCH_BY_ID.teal!.stroke);
        expect(nd.textStyle.color).toBe(SWATCH_BY_ID.teal!.ink);
    });

    it("ignores an unknown swatch", () => {
        const store = storeWith({ nodes: [node("a")] });
        store.selectNodes(["a"]);
        applySwatch(store, "chartreuse");
        expect(store.getState().canUndo).toBe(false);
    });

    it("patches only the given style keys", () => {
        const store = storeWith({ nodes: [node("a")] });
        store.selectNodes(["a"]);
        const before = nodeById(page(store), "a")!.style.fill;
        styleSelection(store, { strokeWidth: 4 });
        const after = nodeById(page(store), "a")!;
        expect(after.style.strokeWidth).toBe(4);
        expect(after.style.fill).toBe(before);
    });

    it("changes shape without moving the node", () => {
        const store = storeWith({ nodes: [node("a", { x: 30, y: 40 })] });
        store.selectNodes(["a"]);
        setShapeType(store, "decision");
        const nd = nodeById(page(store), "a")!;
        expect(nd.shape).toBe("decision");
        expect([nd.x, nd.y]).toEqual([30, 40]);
    });

    it("repaints the page for a theme", () => {
        const store = storeWith({
            nodes: [node("a"), node("b", { x: 200 })],
            edges: [createEdge({ from: { nodeId: "a" }, to: { nodeId: "b" } })],
        });
        applyTheme(store, "ocean");
        expect(store.getState().doc.settings.paletteId).toBe("ocean");
        const colours = page(store).nodes.map(n => n.style.fill);
        expect(new Set(colours).size).toBeGreaterThan(1);
    });

    it("locks and unlocks as one toggle", () => {
        const store = storeWith({ nodes: [node("a"), node("b")] });
        store.selectNodes(["a", "b"]);
        toggleLock(store);
        expect(page(store).nodes.every(n => n.locked)).toBe(true);
        toggleLock(store);
        expect(page(store).nodes.every(n => !n.locked)).toBe(true);
    });
});

describe("transforms", () => {
    it("mirrors positions about the selection bounds", () => {
        const store = storeWith({
            nodes: [node("a", { x: 0, w: 100 }), node("b", { x: 300, w: 100 })],
        });
        store.selectNodes(["a", "b"]);
        flipSelection(store, "h");
        const xs = page(store).nodes.map(n => n.x);
        expect(xs).toEqual([300, 0]);
    });

    it("scales a set of nodes into a new bounding box", () => {
        const p: DiagramPage = {
            ...createPage(),
            nodes: [node("a", { x: 0, y: 0, w: 100, h: 50 })],
        };
        const next = scaleNodesToBounds(
            p,
            ["a"],
            { x: 0, y: 0, w: 100, h: 50 },
            { x: 0, y: 0, w: 200, h: 100 }
        );
        expect([next.nodes[0]!.w, next.nodes[0]!.h]).toEqual([200, 100]);
    });

    it("never scales below the shape's minimum size", () => {
        const p: DiagramPage = { ...createPage(), nodes: [node("a", { w: 100, h: 50 })] };
        const next = scaleNodesToBounds(
            p,
            ["a"],
            { x: 0, y: 0, w: 100, h: 50 },
            { x: 0, y: 0, w: 1, h: 1 }
        );
        expect(next.nodes[0]!.w).toBeGreaterThanOrEqual(12);
    });
});

describe("z-order commands", () => {
    it("raises the selection to the front", () => {
        const store = storeWith({ nodes: [node("a"), node("b"), node("c")] });
        store.selectNodes(["a"]);
        reorder(store, "front");
        expect(page(store).nodes.map(n => n.id)).toEqual(["b", "c", "a"]);
    });
});

describe("connectors", () => {
    it("changes the kind of the selected connectors", () => {
        const store = storeWith({
            nodes: [node("a"), node("b")],
            edges: [createEdge({ from: { nodeId: "a" }, to: { nodeId: "b" } })],
        });
        const edgeId = page(store).edges[0]!.id;
        store.setSelection([{ kind: "edge", id: edgeId }]);
        setEdgeKind(store, "curved");
        expect(page(store).edges[0]!.kind).toBe("curved");
    });

    it("changes the document default when nothing is selected", () => {
        const store = storeWith({ nodes: [] });
        setEdgeKind(store, "straight");
        expect(store.getState().doc.settings.defaultEdgeKind).toBe("straight");
    });

    it("swaps ends and arrowheads when reversed", () => {
        const store = storeWith({
            nodes: [node("a"), node("b")],
            edges: [
                {
                    ...createEdge({ from: { nodeId: "a" }, to: { nodeId: "b" } }),
                    startArrow: "none" as const,
                    endArrow: "arrow" as const,
                },
            ],
        });
        store.setSelection([{ kind: "edge", id: page(store).edges[0]!.id }]);
        reverseEdges(store);
        const edge = page(store).edges[0]!;
        expect(edge.from.nodeId).toBe("b");
        expect(edge.to.nodeId).toBe("a");
        expect(edge.startArrow).toBe("arrow");
        expect(edge.endArrow).toBe("none");
    });
});

describe("mindmap commands", () => {
    it("adds a child topic connected to its parent, ready to type into", () => {
        const store = storeWith({ nodes: [node("root", { shape: "mind-root" })] });
        const childId = addChildTopic(store, "root");
        expect(childId).toBeTruthy();

        const idx = graphIndex(page(store));
        expect(idx.out.get("root")).toEqual([childId]);
        expect(store.getState().editing).toEqual({ kind: "node", id: childId });
        expect(store.selectedNodeIds()).toEqual([childId]);
    });

    it("places each new child clear of its siblings", () => {
        const store = storeWith({ nodes: [node("root", { shape: "mind-root" })] });
        const first = addChildTopic(store, "root")!;
        const second = addChildTopic(store, "root")!;
        const a = nodeById(page(store), first)!;
        const b = nodeById(page(store), second)!;
        expect(b.y).toBeGreaterThanOrEqual(a.y + a.h);
    });

    it("toggles a branch collapsed", () => {
        const store = storeWith({ nodes: [node("a")] });
        toggleCollapse(store, "a");
        expect(nodeById(page(store), "a")!.collapsed).toBe(true);
        toggleCollapse(store, "a");
        expect(nodeById(page(store), "a")!.collapsed).toBe(false);
    });

    it("repositions nodes when a layout runs", () => {
        const store = storeWith({
            nodes: [node("root"), node("a"), node("b")],
            edges: [
                createEdge({ from: { nodeId: "root" }, to: { nodeId: "a" } }),
                createEdge({ from: { nodeId: "root" }, to: { nodeId: "b" } }),
            ],
        });
        runLayout(store, { kind: "tree", direction: "right" });
        const a = nodeById(page(store), "a")!;
        const root = nodeById(page(store), "root")!;
        expect(a.x).toBeGreaterThan(root.x);
        expect(store.getState().canUndo).toBe(true);
    });
});

describe("text", () => {
    it("sets a node's label", () => {
        const store = storeWith({ nodes: [node("a")] });
        setNodeText(store, "a", "Hello");
        expect(nodeById(page(store), "a")!.text).toBe("Hello");
    });
});

describe("pages", () => {
    it("adds and activates a page", () => {
        const store = storeWith({ nodes: [] });
        addPage(store, "Second");
        expect(store.getState().doc.pages).toHaveLength(2);
        expect(activePage(store.getState().doc).name).toBe("Second");
    });

    it("refuses to delete the last page", () => {
        const store = storeWith({ nodes: [] });
        deletePage(store, store.getState().doc.pages[0]!.id);
        expect(store.getState().doc.pages).toHaveLength(1);
    });

    it("moves the active page when the current one is deleted", () => {
        const store = storeWith({ nodes: [] });
        const first = store.getState().doc.pages[0]!.id;
        addPage(store, "Second");
        deletePage(store, store.getState().doc.activePageId);
        expect(store.getState().doc.activePageId).toBe(first);
    });
});

describe("selection helpers", () => {
    it("selects every node of the same shape", () => {
        const store = storeWith({
            nodes: [node("a"), node("b", { shape: "ellipse" }), node("c")],
        });
        store.selectNodes(["a"]);
        selectSameShape(store);
        expect(store.selectedNodeIds().sort()).toEqual(["a", "c"]);
    });

    it("walks the connected component in both directions", () => {
        const store = storeWith({
            nodes: [node("a"), node("b"), node("c"), node("island")],
            edges: [
                createEdge({ from: { nodeId: "a" }, to: { nodeId: "b" } }),
                createEdge({ from: { nodeId: "c" }, to: { nodeId: "b" } }),
            ],
        });
        store.selectNodes(["b"]);
        selectConnected(store);
        expect(store.selectedNodeIds().sort()).toEqual(["a", "b", "c"]);
    });
});

describe("search", () => {
    it("finds node text, connector labels and comments", () => {
        const store = storeWith({
            nodes: [node("a", { text: "Roadmap Q3" })],
            edges: [
                {
                    ...createEdge({ from: { nodeId: "a" }, to: { nodeId: "a" } }),
                    labels: [{ text: "depends on roadmap", t: 0.5, offset: 0 }],
                },
            ],
        });
        const hits = searchDoc(store.getState().doc, "roadmap");
        expect(hits.map(h => h.kind).sort()).toEqual(["edge", "node"]);
    });

    it("returns nothing for an empty query", () => {
        const store = storeWith({ nodes: [node("a", { text: "x" })] });
        expect(searchDoc(store.getState().doc, "   ")).toEqual([]);
    });
});
