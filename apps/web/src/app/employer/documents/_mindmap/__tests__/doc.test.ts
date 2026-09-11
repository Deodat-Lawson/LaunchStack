import {
    addEdges,
    addNodes,
    ancestorsOf,
    childrenOf,
    collapsedHidden,
    descendantsOf,
    docText,
    edgesForNode,
    graphDescendants,
    graphIndex,
    graphRoots,
    mapNodes,
    nodeById,
    pageBounds,
    removeEdges,
    removeNodes,
    reorderNodes,
    selectionRoot,
    updatePage,
    visibleEdges,
    visibleNodes,
    withDescendants,
} from "../model/doc";
import { createDoc, createEdge, createNode, createPage } from "../model/factory";
import type { DiagramNode, DiagramPage } from "../model/types";

function n(id: string, overrides: Partial<DiagramNode> = {}): DiagramNode {
    return {
        ...createNode({ shape: "rectangle", x: 0, y: 0, w: 50, h: 50 }),
        id,
        ...overrides,
    };
}

/** root → a → a1, root → b. Plus one loose node. */
function treePage(): DiagramPage {
    const root = n("root");
    const a = n("a", { x: 200 });
    const a1 = n("a1", { x: 400 });
    const b = n("b", { x: 200, y: 200 });
    const loose = n("loose", { x: -300 });
    const link = (from: string, to: string) =>
        createEdge({ from: { nodeId: from }, to: { nodeId: to } });
    return {
        ...createPage(),
        nodes: [root, a, a1, b, loose],
        edges: [link("root", "a"), link("a", "a1"), link("root", "b")],
    };
}

describe("containment hierarchy", () => {
    const page: DiagramPage = {
        ...createPage(),
        nodes: [
            n("group", { shape: "group" }),
            n("child1", { parentId: "group" }),
            n("child2", { parentId: "group" }),
            n("grandchild", { parentId: "child1" }),
            n("outsider"),
        ],
    };

    it("lists direct children only", () => {
        expect(childrenOf(page, "group").map(x => x.id)).toEqual(["child1", "child2"]);
    });

    it("walks the whole subtree", () => {
        expect(
            descendantsOf(page, "group")
                .map(x => x.id)
                .sort()
        ).toEqual(["child1", "child2", "grandchild"]);
    });

    it("walks upward", () => {
        expect(ancestorsOf(page, "grandchild").map(x => x.id)).toEqual(["child1", "group"]);
    });

    it("selects the outermost group", () => {
        expect(selectionRoot(page, "grandchild")).toBe("group");
        expect(selectionRoot(page, "outsider")).toBe("outsider");
    });

    it("includes descendants without duplicating", () => {
        expect(withDescendants(page, ["group", "child1"]).sort()).toEqual([
            "child1",
            "child2",
            "grandchild",
            "group",
        ]);
    });

    it("survives a parent cycle without hanging", () => {
        const cyclic: DiagramPage = {
            ...createPage(),
            nodes: [n("x", { parentId: "y" }), n("y", { parentId: "x" })],
        };
        expect(() => ancestorsOf(cyclic, "x")).not.toThrow();
        expect(ancestorsOf(cyclic, "x").length).toBeLessThanOrEqual(2);
    });
});

describe("graph hierarchy", () => {
    const page = treePage();

    it("indexes both directions", () => {
        const idx = graphIndex(page);
        expect(idx.out.get("root")).toEqual(["a", "b"]);
        expect(idx.in.get("a1")).toEqual(["a"]);
    });

    it("ignores self-loops in the index", () => {
        const withLoop: DiagramPage = {
            ...page,
            edges: [...page.edges, createEdge({ from: { nodeId: "a" }, to: { nodeId: "a" } })],
        };
        expect(graphIndex(withLoop).out.get("a")).toEqual(["a1"]);
    });

    it("finds roots", () => {
        expect(
            graphRoots(page)
                .map(x => x.id)
                .sort()
        ).toEqual(["loose", "root"]);
    });

    it("collects downstream nodes", () => {
        expect([...graphDescendants(page, "root")].sort()).toEqual(["a", "a1", "b"]);
        expect([...graphDescendants(page, "a1")]).toEqual([]);
    });

    it("terminates on a cycle, and never calls a node its own descendant", () => {
        const cyclic: DiagramPage = {
            ...page,
            edges: [...page.edges, createEdge({ from: { nodeId: "a1" }, to: { nodeId: "root" } })],
        };
        expect([...graphDescendants(cyclic, "root")].sort()).toEqual(["a", "a1", "b"]);
    });
});

describe("collapse", () => {
    it("hides a collapsed node's subtree but not the node", () => {
        const page = mapNodes(treePage(), ["a"], nd => ({ ...nd, collapsed: true }));
        const hidden = collapsedHidden(page);
        expect(hidden.has("a")).toBe(false);
        expect(hidden.has("a1")).toBe(true);
        expect(visibleNodes(page).map(x => x.id)).not.toContain("a1");
    });

    it("hides connectors that touch a hidden node", () => {
        const page = mapNodes(treePage(), ["a"], nd => ({ ...nd, collapsed: true }));
        const visible = visibleEdges(page);
        expect(visible.some(e => e.to.nodeId === "a1")).toBe(false);
        expect(visible.some(e => e.to.nodeId === "a")).toBe(true);
    });

    it("hides a nested collapsed node too", () => {
        let page = mapNodes(treePage(), ["root"], nd => ({ ...nd, collapsed: true }));
        page = mapNodes(page, ["a"], nd => ({ ...nd, collapsed: true }));
        const hidden = collapsedHidden(page);
        expect(hidden.has("a")).toBe(true);
        expect(hidden.has("a1")).toBe(true);
    });

    it("also respects the explicit hidden flag", () => {
        const page = mapNodes(treePage(), ["b"], nd => ({ ...nd, hidden: true }));
        expect(visibleNodes(page).map(x => x.id)).not.toContain("b");
    });
});

describe("mutations", () => {
    it("deletes only the node itself, not the shapes it points at", () => {
        // Connectors express a relationship, not ownership: removing a box in a
        // flowchart must not take the downstream boxes with it. Deleting a whole
        // mindmap branch is a separate command.
        const page = removeNodes(treePage(), ["a"]);
        expect(page.nodes.map(x => x.id).sort()).toEqual(["a1", "b", "loose", "root"]);
        // Both connectors touching `a` go; root→b stays.
        expect(page.edges).toHaveLength(1);
        expect(page.edges[0]!.to.nodeId).toBe("b");
    });

    it("deletes container children with the container", () => {
        const page: DiagramPage = {
            ...createPage(),
            nodes: [n("g", { shape: "group" }), n("c", { parentId: "g" })],
        };
        expect(removeNodes(page, ["g"]).nodes).toHaveLength(0);
    });

    it("removes edges by id", () => {
        const page = treePage();
        const target = page.edges[0]!.id;
        expect(removeEdges(page, [target]).edges.map(e => e.id)).not.toContain(target);
    });

    it("returns the same page reference when nothing matches", () => {
        const page = treePage();
        expect(removeNodes(page, [])).toBe(page);
        expect(mapNodes(page, ["nope"], nd => nd)).toBe(page);
    });

    it("adds nodes and edges", () => {
        const page = addEdges(addNodes(createPage(), [n("solo")]), [
            createEdge({ from: { point: { x: 0, y: 0 } }, to: { nodeId: "solo" } }),
        ]);
        expect(page.nodes).toHaveLength(1);
        expect(page.edges).toHaveLength(1);
    });

    it("finds edges attached to a node", () => {
        expect(edgesForNode(treePage(), "a")).toHaveLength(2);
    });
});

describe("z-order", () => {
    const page: DiagramPage = { ...createPage(), nodes: [n("1"), n("2"), n("3"), n("4")] };
    const order = (p: DiagramPage) => p.nodes.map(x => x.id);

    it("brings to front and back", () => {
        expect(order(reorderNodes(page, ["1"], "front"))).toEqual(["2", "3", "4", "1"]);
        expect(order(reorderNodes(page, ["4"], "back"))).toEqual(["4", "1", "2", "3"]);
    });

    it("steps one position at a time", () => {
        expect(order(reorderNodes(page, ["2"], "forward"))).toEqual(["1", "3", "2", "4"]);
        expect(order(reorderNodes(page, ["3"], "backward"))).toEqual(["1", "3", "2", "4"]);
    });

    it("moves a multi-selection as a block, preserving its internal order", () => {
        expect(order(reorderNodes(page, ["1", "2"], "front"))).toEqual(["3", "4", "1", "2"]);
        expect(order(reorderNodes(page, ["1", "2"], "forward"))).toEqual(["3", "1", "2", "4"]);
    });

    it("clamps at the edges", () => {
        expect(order(reorderNodes(page, ["1"], "backward"))).toEqual(["1", "2", "3", "4"]);
        expect(order(reorderNodes(page, ["4"], "forward"))).toEqual(["1", "2", "3", "4"]);
    });
});

describe("document helpers", () => {
    it("updates one page immutably", () => {
        const doc = createDoc("Doc", [treePage()]);
        const next = updatePage(doc, doc.pages[0]!.id, p => ({ ...p, name: "Renamed" }));
        expect(next).not.toBe(doc);
        expect(next.pages[0]!.name).toBe("Renamed");
        expect(doc.pages[0]!.name).toBe("Page 1");
    });

    it("returns the same doc when the updater is a no-op", () => {
        const doc = createDoc("Doc", [treePage()]);
        expect(updatePage(doc, doc.pages[0]!.id, p => p)).toBe(doc);
    });

    it("computes page bounds over nodes and free waypoints", () => {
        const page: DiagramPage = {
            ...createPage(),
            nodes: [n("a", { x: 0, y: 0, w: 10, h: 10 })],
            edges: [
                {
                    ...createEdge({
                        from: { point: { x: 0, y: 0 } },
                        to: { point: { x: 0, y: 0 } },
                    }),
                    waypoints: [{ x: 100, y: 100 }],
                },
            ],
        };
        expect(pageBounds(page)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    });

    it("flattens every label into searchable text", () => {
        const page = treePage();
        page.nodes[0]!.text = "Central idea";
        page.edges[0]!.labels = [{ text: "leads to", t: 0.5, offset: 0 }];
        const doc = createDoc("My map", [page]);
        const text = docText(doc);
        expect(text).toContain("My map");
        expect(text).toContain("Central idea");
        expect(text).toContain("leads to");
    });

    it("looks nodes up by id", () => {
        expect(nodeById(treePage(), "a")?.id).toBe("a");
        expect(nodeById(treePage(), "missing")).toBeUndefined();
    });
});
