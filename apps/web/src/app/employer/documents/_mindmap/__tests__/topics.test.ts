import {
    addChildTopic,
    addSiblingTopic,
    deleteTopicsOrSelection,
    moveTopicAmongSiblings,
    outdentTopic,
    selectTopicInDirection,
    toggleCollapseSelection,
} from "../model/commands";
import {
    activePage,
    branchOf,
    graphIndex,
    graphRoots,
    insertEdgesBeside,
    mapNodes,
    nodeById,
    topicInDirection,
    topicParent,
} from "../model/doc";
import { createDoc, createEdge, createNode, createPage } from "../model/factory";
import { EditorStore } from "../model/store";
import { buildTemplate } from "../model/templates";
import { restyleMovedTopics } from "../model/topicStyle";
import type { DiagramNode, DiagramPage, ShapeId } from "../model/types";

/**
 * The outliner operations behind the keyboard: where a new sibling goes,
 * outdent, reorder, delete-with-branch, spatial navigation and folding.
 *
 * Child order is edge order — the layouts read a node's children off
 * `page.edges` — so most of these assert on `graphIndex(page).out`, which is
 * exactly the order the layout will draw.
 */

jest.mock("../model/topicStyle", () => ({ restyleMovedTopics: jest.fn() }));
const restyle = restyleMovedTopics as jest.MockedFunction<typeof restyleMovedTopics>;

beforeEach(() => restyle.mockReset());

function topic(
    id: string,
    shape: ShapeId,
    x: number,
    y: number,
    overrides: Partial<DiagramNode> = {}
): DiagramNode {
    const w = shape === "mind-root" ? 200 : 150;
    const h = shape === "mind-root" ? 80 : 48;
    return { ...createNode({ shape, x, y, w, h, text: id }), id, ...overrides };
}

function link(from: string, to: string) {
    return createEdge({ from: { nodeId: from }, to: { nodeId: to } });
}

/**
 *            ┌ A ─ A1, A2
 *   L ── R ──┼ B ─ B1
 *            └ C
 *
 * Laid out by hand, so the spatial tests can reason about centres.
 */
function map(): EditorStore {
    const nodes = [
        topic("R", "mind-root", 0, 0),
        topic("A", "mind-branch", 300, -100),
        topic("B", "mind-branch", 300, 16),
        topic("C", "mind-branch", 300, 132),
        topic("A1", "mind-leaf", 520, -140),
        topic("A2", "mind-leaf", 520, -50),
        topic("B1", "mind-leaf", 520, 16),
        topic("L", "mind-branch", -250, 16),
    ];
    const edges = [
        link("R", "A"),
        link("A", "A1"),
        link("A", "A2"),
        link("R", "B"),
        link("B", "B1"),
        link("R", "C"),
        link("R", "L"),
    ];
    return new EditorStore(createDoc("Map", [{ ...createPage(), nodes, edges }]));
}

function page(store: EditorStore): DiagramPage {
    return activePage(store.getState().doc);
}

function children(store: EditorStore, id: string): string[] {
    return graphIndex(page(store)).out.get(id) ?? [];
}

/** The mindmap template, auto-arrange on — the shape of a real new map. */
function template() {
    const store = new EditorStore(buildTemplate("mindmap", "Plan"));
    const p = page(store);
    const root = p.nodes[0]!.id;
    const branches = graphIndex(p).out.get(root)!;
    return { store, root, branches };
}

describe("adding a sibling", () => {
    it("goes right after the topic it was made from, not at the end", () => {
        const store = map();
        const id = addSiblingTopic(store, "A")!;
        expect(children(store, "R")).toEqual(["A", id, "B", "C", "L"]);
        expect(store.selectedNodeIds()).toEqual([id]);
        expect(store.getState().editing).toEqual({ kind: "node", id });
    });

    it("goes right before it on request (⇧Enter)", () => {
        const store = map();
        const id = addSiblingTopic(store, "B", "before")!;
        expect(children(store, "R")).toEqual(["A", id, "B", "C", "L"]);
    });

    it("on the centre is a child, never a second centre", () => {
        const store = map();
        const before = graphRoots(page(store)).length;
        const id = addSiblingTopic(store, "R")!;
        expect(topicParent(page(store), id)).toBe("R");
        expect(graphRoots(page(store))).toHaveLength(before);
    });

    it("is drawn where it was inserted when the map arranges itself", () => {
        const { store, branches } = template();
        const [first, second] = branches as [string, string];
        const id = addSiblingTopic(store, first)!;
        const p = page(store);
        const y = (n: string) => nodeById(p, n)!.y;
        expect(y(id)).toBeGreaterThan(y(first));
        expect(y(id)).toBeLessThan(y(second));
    });

    it("is one undo step, layout pass included", () => {
        const { store, branches } = template();
        const before = page(store);
        addSiblingTopic(store, branches[0]!);
        store.undo();
        expect(page(store)).toBe(before);
    });

    it("leaves addChildTopic appending by default", () => {
        const store = map();
        const id = addChildTopic(store, "R")!;
        expect(children(store, "R")).toEqual(["A", "B", "C", "L", id]);
    });
});

describe("outdent", () => {
    it("lifts a topic, with its subtree, to sit right after its old parent", () => {
        const store = map();
        store.updatePage(p => ({
            ...p,
            nodes: [...p.nodes, topic("A1x", "mind-leaf", 700, -140)],
            edges: [...p.edges, link("A1", "A1x")],
        }));
        expect(outdentTopic(store, "A1")).toBe(true);
        expect(children(store, "R")).toEqual(["A", "A1", "B", "C", "L"]);
        expect(children(store, "A")).toEqual(["A2"]);
        expect(children(store, "A1")).toEqual(["A1x"]);
        expect(store.selectedNodeIds()).toEqual(["A1"]);
        expect(restyle).toHaveBeenCalledWith(store, ["A1"]);
    });

    it("never makes a second centre", () => {
        const store = map();
        const before = page(store);
        expect(outdentTopic(store, "A")).toBe(false);
        expect(outdentTopic(store, "R")).toBe(false);
        expect(page(store)).toBe(before);
        expect(restyle).not.toHaveBeenCalled();
    });

    it("is one undo step: the move, the restyle and the layout together", () => {
        const { store, branches } = template();
        // Make the restyle write, so the step provably contains it.
        restyle.mockImplementation((s, ids) =>
            s.updatePage(p => mapNodes(p, ids, nd => ({ ...nd, text: `${nd.text}!` })), {
                label: "Restyle",
            })
        );
        const before = page(store);
        const leaf = graphIndex(before).out.get(branches[0]!)![0]!;
        expect(outdentTopic(store, leaf)).toBe(true);
        expect(nodeById(page(store), leaf)!.text.endsWith("!")).toBe(true);
        expect(store.historyLabels().undo).toBe("Outdent topic");
        store.undo();
        expect(page(store)).toBe(before);
    });
});

describe("reordering siblings", () => {
    it("moves a topic up and down among its siblings", () => {
        const store = map();
        expect(moveTopicAmongSiblings(store, "B", -1)).toBe(true);
        expect(children(store, "R")).toEqual(["B", "A", "C", "L"]);
        expect(moveTopicAmongSiblings(store, "B", 1)).toBe(true);
        expect(moveTopicAmongSiblings(store, "B", 1)).toBe(true);
        expect(children(store, "R")).toEqual(["A", "C", "B", "L"]);
        expect(store.selectedNodeIds()).toEqual(["B"]);
    });

    it("stops at either end, and does nothing to the centre", () => {
        const store = map();
        const before = page(store);
        expect(moveTopicAmongSiblings(store, "A", -1)).toBe(false);
        expect(moveTopicAmongSiblings(store, "L", 1)).toBe(false);
        expect(moveTopicAmongSiblings(store, "R", 1)).toBe(false);
        expect(page(store)).toBe(before);
    });

    it("steps over a cross-link, which is not a sibling", () => {
        const store = map();
        // R also points at A1 (A's child): a relationship line, not a branch.
        store.updatePage(p => ({
            ...p,
            edges: [...p.edges, createEdge({ from: { nodeId: "R" }, to: { nodeId: "A1" } })],
        }));
        expect(moveTopicAmongSiblings(store, "L", 1)).toBe(false);
        expect(topicParent(page(store), "A1")).toBe("A");
    });

    it("keeps each topic's parent edge its first incoming edge", () => {
        const store = map();
        moveTopicAmongSiblings(store, "A", 1);
        const p = page(store);
        for (const id of ["A", "B", "C", "A1", "A2", "B1", "L"]) {
            expect(topicParent(p, id)).toBe(id.length === 2 ? id[0] : "R");
        }
    });

    it("is one undo step on an arranged map", () => {
        const { store, branches } = template();
        const before = page(store);
        moveTopicAmongSiblings(store, branches[1]!, -1);
        expect(graphIndex(page(store)).out.get(page(store).nodes[0]!.id)![0]).toBe(branches[1]);
        expect(store.historyLabels().undo).toBe("Reorder topic");
        store.undo();
        expect(page(store)).toBe(before);
    });
});

describe("deleting topics", () => {
    it("takes the topic's whole branch and selects its parent", () => {
        const store = map();
        store.selectNodes(["A"]);
        deleteTopicsOrSelection(store);
        const ids = page(store).nodes.map(n => n.id);
        for (const gone of ["A", "A1", "A2"]) expect(ids).not.toContain(gone);
        expect(ids).toEqual(expect.arrayContaining(["R", "B", "B1", "C", "L"]));
        expect(store.selectedNodeIds()).toEqual(["R"]);
    });

    it("keeps the children, in the topic's slot, with ⌥ (keepChildren)", () => {
        const store = map();
        store.selectNodes(["A"]);
        deleteTopicsOrSelection(store, { keepChildren: true });
        expect(children(store, "R")).toEqual(["A1", "A2", "B", "C", "L"]);
        expect(store.selectedNodeIds()).toEqual(["R"]);
        expect(restyle).toHaveBeenCalledWith(store, ["A1", "A2"]);
    });

    it("selects nothing after deleting the centre", () => {
        const store = map();
        store.selectNodes(["R"]);
        deleteTopicsOrSelection(store);
        expect(page(store).nodes).toHaveLength(0);
        expect(store.getState().selection).toEqual([]);
    });

    it("selects the nearest survivor when the parent goes too", () => {
        const store = map();
        store.selectNodes(["A1", "A"]);
        deleteTopicsOrSelection(store);
        expect(store.selectedNodeIds()).toEqual(["R"]);
    });

    it("spares a topic another branch only cross-links to", () => {
        const store = map();
        store.updatePage(p => ({ ...p, edges: [...p.edges, link("A", "B1")] }));
        store.selectNodes(["A"]);
        deleteTopicsOrSelection(store);
        expect(nodeById(page(store), "B1")).toBeDefined();
    });

    it("leaves a mixed selection to plain deleteSelection", () => {
        const sticky = createNode({ shape: "sticky", x: 900, y: 0 });
        const store = map();
        store.updatePage(p => ({ ...p, nodes: [...p.nodes, sticky] }));
        store.selectNodes(["A", sticky.id]);
        deleteTopicsOrSelection(store);
        const ids = page(store).nodes.map(n => n.id);
        expect(ids).not.toContain("A");
        expect(ids).not.toContain(sticky.id);
        // Plain delete: the children stay behind.
        expect(ids).toEqual(expect.arrayContaining(["A1", "A2"]));
        expect(store.getState().selection).toEqual([]);
    });

    it("never cascades through flowchart boxes", () => {
        const box = (id: string, x: number) => ({
            ...createNode({ shape: "rectangle", x, y: 0 }),
            id,
        });
        const store = new EditorStore(
            createDoc("Flow", [
                {
                    ...createPage(),
                    nodes: [box("a", 0), box("b", 200), box("c", 400)],
                    edges: [link("a", "b"), link("b", "c")],
                },
            ])
        );
        store.selectNodes(["b"]);
        deleteTopicsOrSelection(store);
        expect(page(store).nodes.map(n => n.id)).toEqual(["a", "c"]);
    });

    it("is one undo step on an arranged map", () => {
        const { store, branches } = template();
        const before = page(store);
        store.selectNodes([branches[0]!]);
        deleteTopicsOrSelection(store);
        store.undo();
        expect(page(store)).toBe(before);
    });
});

describe("folding", () => {
    it("toggles every selected topic that has children, mixed states folding", () => {
        const store = map();
        store.updatePage(p => mapNodes(p, ["A"], nd => ({ ...nd, collapsed: true })));
        store.selectNodes(["A", "B", "C"]);
        toggleCollapseSelection(store);
        const p = page(store);
        expect(nodeById(p, "A")!.collapsed).toBe(true);
        expect(nodeById(p, "B")!.collapsed).toBe(true);
        // C has no children; it is not a branch to fold.
        expect(nodeById(p, "C")!.collapsed).toBeFalsy();
        toggleCollapseSelection(store);
        expect(nodeById(page(store), "A")!.collapsed).toBe(false);
        expect(nodeById(page(store), "B")!.collapsed).toBe(false);
    });

    it("drops selected topics that the fold just hid", () => {
        const store = map();
        store.selectNodes(["A", "A1"]);
        toggleCollapseSelection(store);
        expect(store.selectedNodeIds()).toEqual(["A"]);
    });

    it("does nothing to a leaf", () => {
        const store = map();
        store.selectNodes(["C"]);
        toggleCollapseSelection(store);
        expect(store.getState().canUndo).toBe(false);
    });
});

describe("spatial navigation", () => {
    const go = (store: EditorStore, from: string, dir: "left" | "right" | "up" | "down") =>
        topicInDirection(page(store), from, dir);

    it("prefers the topic straight ahead to a nearer one off to the side", () => {
        const store = map();
        expect(go(store, "R", "right")).toBe("B");
        expect(go(store, "R", "left")).toBe("L");
        expect(go(store, "B", "up")).toBe("A");
        expect(go(store, "B", "down")).toBe("C");
        expect(go(store, "B", "right")).toBe("B1");
        expect(go(store, "A", "right")).toBe("A1");
        expect(go(store, "A1", "down")).toBe("A2");
    });

    it("finds nothing past the edge of the map", () => {
        const store = map();
        expect(go(store, "L", "left")).toBeNull();
        expect(go(store, "A1", "right")).toBeNull();
    });

    it("skips topics inside a collapsed branch, folded in the file or in view", () => {
        const store = map();
        store.updatePage(p => mapNodes(p, ["A"], nd => ({ ...nd, collapsed: true })));
        store.selectNodes(["A"]);
        // A1 and A2 are folded away; B1 is the next topic that way.
        expect(selectTopicInDirection(store, "A", "right")).toBe("B1");

        const viewFolded = map();
        viewFolded.setFolded(["B"]);
        expect(selectTopicInDirection(viewFolded, "B", "right")).toBe("A2");
    });

    it("ignores shapes that are not topics", () => {
        const store = map();
        const sticky = createNode({ shape: "sticky", x: 420, y: 16, w: 40, h: 48 });
        store.updatePage(p => ({ ...p, nodes: [...p.nodes, sticky] }));
        expect(go(store, "B", "right")).toBe("B1");
    });

    it("selects the topic and pans only as far as needed to show it", () => {
        const store = map();
        const size = { w: 600, h: 400 };
        store.setViewport({ x: -100, y: -100, zoom: 1 });
        store.selectNodes(["R"]);
        // B is on screen: no pan.
        expect(selectTopicInDirection(store, "R", "right", size)).toBe("B");
        expect(store.getState().viewport).toMatchObject({ x: -100, y: -100 });
        expect(store.selectedNodeIds()).toEqual(["B"]);
        // B1 ends at x = 670, past the 500 the screen shows: pan right.
        selectTopicInDirection(store, "B", "right", size);
        const v = store.getState().viewport;
        expect(v.x).toBeGreaterThan(-100);
        expect(v.x + size.w).toBeGreaterThanOrEqual(670);
        expect(v.y).toBe(-100);
    });
});

describe("history grouping", () => {
    it("folds every commit inside a group into one undo entry", () => {
        const store = map();
        const before = page(store);
        store.group("Two edits", () => {
            store.updatePage(p => mapNodes(p, ["A"], nd => ({ ...nd, text: "one" })));
            store.updatePage(p => mapNodes(p, ["B"], nd => ({ ...nd, text: "two" })));
        });
        expect(store.historyLabels().undo).toBe("Two edits");
        store.undo();
        expect(page(store)).toBe(before);
        expect(store.getState().canUndo).toBe(false);
    });

    it("nests into the outermost group, and records nothing when nothing changed", () => {
        const store = map();
        store.group("Outer", () => {
            store.group("Inner", () => {
                store.updatePage(p => mapNodes(p, ["A"], nd => ({ ...nd, text: "x" })));
            });
        });
        expect(store.historyLabels().undo).toBe("Outer");
        store.undo();
        expect(store.getState().canUndo).toBe(false);

        store.group("Nothing", () => undefined);
        expect(store.getState().canUndo).toBe(false);
    });
});

describe("doc helpers", () => {
    it("inserts edges beside an anchor, or appends without one", () => {
        const store = map();
        const p = page(store);
        const e = link("R", "Z");
        const anchor = p.edges.find(x => x.to.nodeId === "B")!;
        expect(insertEdgesBeside(p, [e], anchor.id, "before").edges.indexOf(e)).toBe(
            p.edges.indexOf(anchor)
        );
        expect(insertEdgesBeside(p, [e], anchor.id, "after").edges.indexOf(e)).toBe(
            p.edges.indexOf(anchor) + 1
        );
        expect(insertEdgesBeside(p, [e], "missing", "after").edges.at(-1)).toBe(e);
    });

    it("counts a branch as everything that would be left without a parent", () => {
        const store = map();
        expect([...branchOf(page(store), ["A"])].sort()).toEqual(["A", "A1", "A2"]);
        expect(branchOf(page(store), ["R"]).size).toBe(8);
    });

    it("finds a topic's parent among topics only", () => {
        const store = map();
        const sticky = createNode({ shape: "sticky", x: 0, y: 300 });
        store.updatePage(p => ({
            ...p,
            nodes: [...p.nodes, sticky],
            edges: [link(sticky.id, "R"), ...p.edges],
        }));
        expect(topicParent(page(store), "R")).toBeNull();
        expect(topicParent(page(store), "A")).toBe("R");
    });
});
