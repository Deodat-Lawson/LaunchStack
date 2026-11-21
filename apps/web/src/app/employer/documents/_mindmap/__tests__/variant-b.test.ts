import { addNextStep, insertShape } from "../model/commands";
import { activePage, nodeById } from "../model/doc";
import { createDoc, createEdge, createNode, createPage } from "../model/factory";
import { nodeCenter } from "../model/geometry";
import { EditorStore } from "../model/store";
import type { DiagramNode, MindmapDoc } from "../model/types";
import { addPicked, PICKER_SHAPES, quickAdd } from "../variants/b-quick-add/commands";
import { lookB } from "../variants/b-quick-add/look";
import { FAN_GAP, placeBeside, QUICK_GAP } from "../variants/b-quick-add/placement";
import { quickAddState } from "../variants/b-quick-add/state";
import { uiB } from "../variants/b-quick-add/ui";

/**
 * Direction B · Quick-add arrows, below the canvas: where a + arrow puts its
 * box, what the picker makes, and that both are one undo step dressed like
 * every other new box. The gestures themselves are driven on a mounted
 * canvas in `variant-b-canvas.test.tsx`.
 */

function flowDoc(nodes: DiagramNode[] = []): MindmapDoc {
    const doc = createDoc("Flow", [{ ...createPage(), nodes, edges: [] }]);
    doc.settings = { ...doc.settings, kind: "flowchart" };
    return doc;
}

function storeWith(nodes: DiagramNode[] = []): EditorStore {
    const store = new EditorStore(flowDoc(nodes));
    store.setFlowVariant("b");
    store.setViewport({ x: 0, y: 0, zoom: 1 });
    return store;
}

const page = (store: EditorStore) => activePage(store.getState().doc);
const node = (store: EditorStore, id: string) => nodeById(page(store), id)!;

/** A box in B's look, as the editor would make it. */
function stepBox(x: number, y: number, text = ""): DiagramNode {
    const look = lookB.boxLook("process", "light");
    return createNode({
        shape: "process",
        x,
        y,
        w: look.size!.w,
        h: look.size!.h,
        text,
        style: look.style,
        textStyle: look.text,
    });
}

describe("variant B: the look", () => {
    it("gives every new box the same regular 13px type, whichever way it is made", () => {
        const store = storeWith();
        const first = insertShape(store, "process", { x: 0, y: 0 });
        store.setEditing(null);
        const tabbed = addNextStep(store, first)!;
        store.setEditing(null);
        const arrowed = quickAdd(store, first, "s")!;
        store.setEditing(null);
        const picked = addPicked(
            store,
            { sourceId: first, port: "e", world: { x: 600, y: 400 }, offset: { x: 0, y: 0 } },
            "decision"
        );
        const types = [first, tabbed, arrowed, picked].map(id => node(store, id).textStyle);
        for (const t of types) {
            expect(t.size).toBe(13);
            expect(t.bold).toBe(false);
            expect(t.italic).toBe(false);
            expect(t.align).toBe("center");
        }
    });

    it("keeps every box 160 wide, with the diamond and cylinder taller for their words", () => {
        for (const shape of PICKER_SHAPES) {
            expect(lookB.boxLook(shape, "light").size?.w).toBe(160);
        }
        expect(lookB.boxLook("process", "light").size?.h).toBe(60);
        expect(lookB.boxLook("decision", "light").size?.h).toBe(90);
        expect(lookB.boxLook("database", "dark").size?.h).toBe(80);
    });

    it("labels its arrows in the board's own soft ink", () => {
        const light = lookB.edgeLook("light").text!;
        const dark = lookB.edgeLook("dark").text!;
        expect(light.bold).toBe(false);
        expect(light.color).not.toBe(dark.color);
    });
});

describe("variant B: where a + arrow puts its box", () => {
    const size = { w: 160, h: 60 };

    it("goes one gap out on the side clicked, lined up with its source", () => {
        const a = stepBox(0, 0);
        const p = flowDoc([a]).pages[0]!;
        const c = nodeCenter(a);
        expect(placeBeside(p, a, "e", size)).toEqual({ x: c.x + 160 + QUICK_GAP, y: c.y });
        expect(placeBeside(p, a, "w", size)).toEqual({ x: c.x - 160 - QUICK_GAP, y: c.y });
        expect(placeBeside(p, a, "s", size)).toEqual({ x: c.x, y: c.y + 60 + QUICK_GAP });
        expect(placeBeside(p, a, "n", size)).toEqual({ x: c.x, y: c.y - 60 - QUICK_GAP });
    });

    it("fans out past every box already in the way", () => {
        const a = stepBox(0, 0);
        const right = stepBox(160 + QUICK_GAP, 0);
        const belowRight = stepBox(160 + QUICK_GAP, 60 + FAN_GAP);
        const p = flowDoc([a, right, belowRight]).pages[0]!;
        const at = placeBeside(p, a, "e", size);
        // Two rows taken, so the third.
        expect(at).toEqual({ x: 80 + 160 + QUICK_GAP, y: 30 + 2 * (60 + FAN_GAP) });
        // Up and down arrows fan out to the right.
        const under = stepBox(0, 60 + QUICK_GAP);
        const q = flowDoc([a, under]).pages[0]!;
        expect(placeBeside(q, a, "s", size)).toEqual({
            x: 80 + 160 + FAN_GAP,
            y: 30 + 60 + QUICK_GAP,
        });
    });
});

describe("variant B: clicking a + arrow", () => {
    it("adds an empty copy of the box, joined from the side clicked, label open", () => {
        const a = { ...stepBox(0, 0, "Receive order"), style: { ...stepBox(0, 0).style } };
        const store = storeWith([a]);
        const id = quickAdd(store, a.id, "e")!;
        const made = node(store, id);
        expect(made.shape).toBe("process");
        expect(made.text).toBe("");
        expect({ w: made.w, h: made.h }).toEqual({ w: a.w, h: a.h });
        expect(made.style).toEqual(a.style);
        expect(made.textStyle).toEqual(a.textStyle);
        expect(nodeCenter(made)).toEqual({ x: 80 + 160 + QUICK_GAP, y: 30 });

        const [edge] = page(store).edges;
        expect(edge!.from).toEqual({ nodeId: a.id, port: "e" });
        expect(edge!.to).toEqual({ nodeId: id, port: "auto" });
        expect(edge!.kind).toBe("elbow");
        expect(store.selectedNodeIds()).toEqual([id]);
        expect(store.getState().editing).toEqual({ kind: "node", id });
    });

    it("copies a decision as a decision, and a recoloured box in its colours", () => {
        const d = createNode({ shape: "decision", x: 0, y: 0, w: 160, h: 90 });
        const green = { ...d, style: { ...d.style, fill: "oklch(0.9 0.1 150)" } };
        const store = storeWith([green]);
        const id = quickAdd(store, green.id, "s")!;
        expect(node(store, id).shape).toBe("decision");
        expect(node(store, id).h).toBe(90);
        expect(node(store, id).style.fill).toBe("oklch(0.9 0.1 150)");
    });

    it("starts a copy of a box that grew for its words at the empty size", () => {
        const long = stepBox(0, 0, "A step with a label long enough to make its box grow");
        const grown = { ...long, w: 300, h: 80 };
        const store = storeWith([grown]);
        const id = quickAdd(store, grown.id, "s")!;
        expect({ w: node(store, id).w, h: node(store, id).h }).toEqual({ w: 160, h: 60 });
    });

    it("is one undo step for the box and its arrow", () => {
        const a = stepBox(0, 0);
        const store = storeWith([a]);
        quickAdd(store, a.id, "e");
        expect(page(store).nodes).toHaveLength(2);
        expect(page(store).edges).toHaveLength(1);
        store.undo();
        expect(page(store).nodes).toHaveLength(1);
        expect(page(store).edges).toHaveLength(0);
    });
});

describe("variant B: a click on a dot is not a click on an arrow", () => {
    it("adds nothing unless the press began on a + arrow", () => {
        const a = stepBox(0, 0);
        const store = storeWith([a]);
        // An ordinary dot: the canvas asks the direction, which declines.
        expect(uiB.onPortClick!(store, a.id, "e")).toBe(false);
        expect(page(store).nodes).toHaveLength(1);
        // Armed by a press on the arrow, the same click adds the box…
        quickAddState(store).arm(a.id, "e");
        expect(uiB.onPortClick!(store, a.id, "e")).toBe(true);
        expect(page(store).nodes).toHaveLength(2);
        // …once: the next dot click is a dot click again.
        expect(uiB.onPortClick!(store, a.id, "e")).toBe(false);
        expect(page(store).nodes).toHaveLength(2);
    });

    it("does not count an arrow pressed on one side as a click on another", () => {
        const a = stepBox(0, 0);
        const store = storeWith([a]);
        quickAddState(store).arm(a.id, "s");
        expect(uiB.onPortClick!(store, a.id, "e")).toBe(false);
        expect(page(store).nodes).toHaveLength(1);
    });
});

describe("variant B: an arrow let go over empty space", () => {
    const drop = { world: { x: 500, y: 337 }, screen: { x: 500, y: 337 } };

    it("asks for a shape and puts nothing on the page while it asks", () => {
        const a = stepBox(0, 0);
        const store = storeWith([a]);
        const before = store.getState().doc;
        expect(uiB.onConnectDropInSpace!(store, { ...drop, sourceId: a.id, port: "e" })).toBe(true);
        expect(quickAddState(store).getPick()).toMatchObject({ sourceId: a.id, world: drop.world });
        expect(store.getState().doc).toBe(before);
        // Dismissed: still nothing, and nothing to undo.
        quickAddState(store).closePick();
        expect(store.getState().doc).toBe(before);
        expect(store.getState().canUndo).toBe(false);
    });

    it("makes the shape picked at the drop, joined from the source, in one undo step", () => {
        const a = stepBox(0, 0);
        const store = storeWith([a]);
        const id = addPicked(
            store,
            { sourceId: a.id, port: "e", world: drop.world, offset: { x: 0, y: 0 } },
            "decision"
        );
        const made = node(store, id);
        expect(made.shape).toBe("decision");
        expect(nodeCenter(made)).toEqual(drop.world);
        expect({ w: made.w, h: made.h }).toEqual({ w: 160, h: 90 });
        expect(made.style).toMatchObject(lookB.boxLook("decision", "light").style);
        const [edge] = page(store).edges;
        expect(edge!.from).toEqual({ nodeId: a.id, port: "auto" });
        expect(edge!.to).toEqual({ nodeId: id, port: "auto" });
        expect(store.getState().editing).toEqual({ kind: "node", id });
        store.undo();
        expect(page(store).nodes).toHaveLength(1);
        expect(page(store).edges).toHaveLength(0);
    });

    it("lines the shape up with its source when let go just off its centre line", () => {
        const a = stepBox(0, 0);
        const store = storeWith([a]);
        const id = addPicked(
            store,
            { sourceId: a.id, port: "s", world: { x: 88, y: 260 }, offset: { x: 0, y: 0 } },
            "process"
        );
        expect(nodeCenter(node(store, id))).toEqual({ x: 80, y: 260 });
    });

    it("still makes the shape if its source went away meanwhile", () => {
        const store = storeWith([]);
        const id = addPicked(
            store,
            { sourceId: "gone", port: "e", world: { x: 0, y: 0 }, offset: { x: 0, y: 0 } },
            "terminator"
        );
        expect(node(store, id).shape).toBe("terminator");
        expect(page(store).edges).toHaveLength(0);
    });
});

describe("variant B: edges it makes", () => {
    it("labels in the look's type", () => {
        const a = stepBox(0, 0);
        const store = storeWith([a]);
        quickAdd(store, a.id, "e");
        const edge = page(store).edges[0]!;
        expect(edge.textStyle).toMatchObject(lookB.edgeLook("light").text!);
    });

    it("leaves createEdge as it was when no label type is given", () => {
        const e = createEdge({ from: { point: { x: 0, y: 0 } }, to: { point: { x: 1, y: 1 } } });
        expect(e.textStyle.size).toBe(12);
        expect(e.textStyle.color).toBe("oklch(0.42 0.01 280)");
    });
});
