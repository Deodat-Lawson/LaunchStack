import {
    addConnected,
    addNextStep,
    deleteTopicsOrSelection,
    flowDirection,
    setAutoLayout,
    setDiagramKind,
} from "../model/commands";
import { activePage, stepsFrom, worksAsFlow } from "../model/doc";
import { createDoc, createEdge, createNode, createPage } from "../model/factory";
import { nodeBounds, rectsIntersect } from "../model/geometry";
import { EditorStore } from "../model/store";
import type { DiagramEdge, DiagramKind, DiagramNode } from "../model/types";

/**
 * The editor used as a flowchart: Tab adds the next step (not a mindmap
 * topic), Delete takes one box, and nothing re-arranges what was placed by
 * hand — whether the boxes are process shapes or topic shapes.
 */

function storeWith(kind: DiagramKind, nodes: DiagramNode[], edges: DiagramEdge[] = []) {
    const doc = createDoc("Flow", [{ ...createPage(), nodes, edges }]);
    return new EditorStore({ ...doc, settings: { ...doc.settings, kind } });
}
const page = (s: EditorStore) => activePage(s.getState().doc);
const node = (s: EditorStore, id: string) => page(s).nodes.find(n => n.id === id)!;

describe("which documents work as flowcharts", () => {
    it("flowcharts and boards do; mindmaps do not", () => {
        expect(worksAsFlow("flowchart")).toBe(true);
        expect(worksAsFlow("board")).toBe(true);
        expect(worksAsFlow("mindmap")).toBe(false);
        expect(worksAsFlow("freeform")).toBe(false);
    });

    it("a freeform drawing answers per shape: any box but a topic steps", () => {
        const box = createNode({ shape: "process", x: 0, y: 0 });
        const topic = createNode({ shape: "mind-branch", x: 0, y: 0 });
        expect(stepsFrom("freeform", box)).toBe(true);
        expect(stepsFrom("freeform", topic)).toBe(false);
        expect(stepsFrom("flowchart", topic)).toBe(true);
        expect(stepsFrom("mindmap", box)).toBe(false);
    });
});

describe("Tab on a flowchart: the next step", () => {
    it("is the same shape and colours, to the right, joined by an arrow", () => {
        const a = createNode({ shape: "process", x: 0, y: 0, w: 160, h: 70, text: "Write" });
        a.style = { ...a.style, fill: "oklch(0.9 0.05 200)", stroke: "oklch(0.5 0.1 200)" };
        const store = storeWith("flowchart", [a]);
        const id = addNextStep(store, a.id)!;
        const next = node(store, id);
        expect(next.shape).toBe("process");
        expect(next.style.fill).toBe(a.style.fill);
        expect(next.text).toBe("");
        expect(next.x).toBeGreaterThan(a.x + a.w);
        expect(next.y + next.h / 2).toBeCloseTo(a.y + a.h / 2);
        const edge = page(store).edges.find(e => e.to.nodeId === id)!;
        expect(edge.from.nodeId).toBe(a.id);
        expect(edge.endArrow).not.toBe("none");
        // Straight into its label, selected.
        expect(store.getState().editing).toMatchObject({ kind: "node", id });
        expect(store.selectedNodeIds()).toEqual([id]);
    });

    it("carries on the way the line came in", () => {
        const a = createNode({ shape: "process", x: 0, y: 0, w: 160, h: 70 });
        const b = createNode({ shape: "process", x: 0, y: 200, w: 160, h: 70 });
        const store = storeWith(
            "flowchart",
            [a, b],
            [createEdge({ from: { nodeId: a.id }, to: { nodeId: b.id } })]
        );
        expect(flowDirection(page(store), b.id)).toBe("down");
        const id = addNextStep(store, b.id)!;
        expect(node(store, id).y).toBeGreaterThan(b.y + b.h);
    });

    it("fans a second step out beside the first instead of stacking them", () => {
        const a = createNode({ shape: "decision", x: 0, y: 0, w: 140, h: 100 });
        const store = storeWith("flowchart", [a]);
        const first = node(store, addNextStep(store, a.id)!);
        const second = node(store, addNextStep(store, a.id)!);
        expect(rectsIntersect(nodeBounds(first), nodeBounds(second))).toBe(false);
    });

    it("copies the look of the arrows already there", () => {
        const a = createNode({ shape: "process", x: 0, y: 0 });
        const b = createNode({ shape: "process", x: -300, y: 0 });
        const into: DiagramEdge = {
            ...createEdge({ from: { nodeId: b.id }, to: { nodeId: a.id }, kind: "curved" }),
        };
        into.style = { ...into.style, stroke: "oklch(0.5 0.15 30)", strokeWidth: 3 };
        const store = storeWith("flowchart", [a, b], [into]);
        const id = addNextStep(store, a.id)!;
        const edge = page(store).edges.find(e => e.to.nodeId === id)!;
        expect(edge.kind).toBe("curved");
        expect(edge.style.stroke).toBe("oklch(0.5 0.15 30)");
        expect(edge.style.strokeWidth).toBe(3);
    });

    it("is one undo step", () => {
        const a = createNode({ shape: "process", x: 0, y: 0 });
        const store = storeWith("flowchart", [a]);
        addNextStep(store, a.id);
        store.undo();
        expect(page(store).nodes).toHaveLength(1);
        expect(page(store).edges).toHaveLength(0);
    });

    it("from a topic-shaped box makes a step, not a mindmap child", () => {
        const t = createNode({ shape: "mind-branch", x: 0, y: 0, w: 170, h: 56, text: "Leader" });
        const store = storeWith("flowchart", [t]);
        const id = addConnected(store, t.id)!;
        const edge = page(store).edges.find(e => e.to.nodeId === id)!;
        // A topic child would hang off a line with no arrowhead.
        expect(edge.endArrow).not.toBe("none");
        expect(node(store, id).x).toBeGreaterThan(t.x + t.w);
    });
});

describe("Tab elsewhere", () => {
    it("still adds a child topic on a mindmap", () => {
        const root = createNode({ shape: "mind-root", x: 0, y: 0, w: 210, h: 78 });
        const store = storeWith("mindmap", [root]);
        const id = addConnected(store, root.id)!;
        expect(node(store, id).shape).toBe("mind-branch");
        expect(page(store).edges.find(e => e.to.nodeId === id)!.endArrow).toBe("none");
    });

    it("on a freeform drawing, steps from a box and branches from a topic", () => {
        const box = createNode({ shape: "process", x: 0, y: 0 });
        const topic = createNode({ shape: "mind-branch", x: 0, y: 400 });
        const store = storeWith("freeform", [box, topic]);
        const step = node(store, addConnected(store, box.id)!);
        expect(step.shape).toBe("process");
        const child = node(store, addConnected(store, topic.id)!);
        expect(child.shape).toMatch(/^mind-/);
    });
});

describe("Delete on a flowchart", () => {
    it("takes the box, never the steps after it — topic-shaped or not", () => {
        const a = createNode({ shape: "mind-branch", x: 0, y: 0 });
        const b = createNode({ shape: "mind-branch", x: 300, y: 0 });
        const c = createNode({ shape: "mind-branch", x: 600, y: 0 });
        const store = storeWith(
            "flowchart",
            [a, b, c],
            [
                createEdge({ from: { nodeId: a.id }, to: { nodeId: b.id } }),
                createEdge({ from: { nodeId: b.id }, to: { nodeId: c.id } }),
            ]
        );
        store.selectNodes([b.id]);
        deleteTopicsOrSelection(store);
        expect(
            page(store)
                .nodes.map(n => n.id)
                .sort()
        ).toEqual([a.id, c.id].sort());
    });
});

describe("Works as", () => {
    it("switching to a flowchart turns auto-arrange off, and a flowchart never re-flows", () => {
        const a = createNode({ shape: "mind-branch", x: 0, y: 0 });
        const b = createNode({ shape: "mind-branch", x: 500, y: 333 });
        const store = storeWith(
            "mindmap",
            [a, b],
            [createEdge({ from: { nodeId: a.id }, to: { nodeId: b.id } })]
        );
        setAutoLayout(store, { kind: "mindmap" });
        setDiagramKind(store, "flowchart");
        expect(store.getState().doc.settings).toMatchObject({
            kind: "flowchart",
            autoLayout: null,
        });
        const before = node(store, b.id);
        addConnected(store, a.id);
        expect(node(store, b.id)).toMatchObject({ x: before.x, y: before.y });
    });
});
