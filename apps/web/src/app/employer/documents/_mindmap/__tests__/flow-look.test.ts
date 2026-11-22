import { addNextStep, commitNodeText, insertShape } from "../model/commands";
import { activePage, nodeById } from "../model/doc";
import { flowchartLook, flowLookOf, KINDS, TEXT_SIZE } from "../model/flowchart/look";
import { EditorStore } from "../model/store";
import { buildTemplate } from "../model/templates";
import { paintNewTopics } from "../model/topicStyle";
import type { DiagramKind, ShapeId } from "../model/types";

/**
 * The flowchart look is always on: every document worked as a flowchart
 * (`worksAsFlow` — a flowchart or a board) dresses every new box and arrow
 * in it, by every path that goes through the model. The UI paths (the
 * double-click menu, a drawn rectangle, a palette drop) are in the render
 * tests. A mindmap and a freeform drawing are as they were.
 */

function storeOf(kind: DiagramKind, board: "light" | "dark" = "light"): EditorStore {
    const template = kind === "mindmap" ? "mindmap" : "blank";
    const store = new EditorStore(buildTemplate(template, "Doc", board));
    store.update(d => ({ ...d, settings: { ...d.settings, kind } }), { transient: true });
    return store;
}

const page = (store: EditorStore) => activePage(store.getState().doc);
const node = (store: EditorStore, id: string) => nodeById(page(store), id)!;

describe("the flowchart look: when it applies", () => {
    it.each(["flowchart", "board"] as const)("applies to a %s", kind => {
        expect(flowLookOf(storeOf(kind).getState().doc)).toBe(flowchartLook);
    });

    it.each(["mindmap", "freeform"] as const)("does not apply to a %s", kind => {
        expect(flowLookOf(storeOf(kind).getState().doc)).toBeNull();
    });

    it("leaves a freeform drawing's boxes as they were", () => {
        const store = storeOf("freeform");
        const id = insertShape(store, "process", { x: 0, y: 0 });
        expect(node(store, id).style.fill).not.toBe(
            flowchartLook.boxLook("process", "light").style.fill
        );
    });
});

describe.each(["light", "dark"] as const)("the flowchart look on a %s board", board => {
    const kinds = Object.keys(KINDS) as ShapeId[];

    it.each(kinds)("dresses a placed %s by its kind: no outline, 15px regular", shape => {
        const store = storeOf("flowchart", board);
        const id = insertShape(store, shape, { x: 0, y: 0 });
        const box = node(store, id);
        const look = flowchartLook.boxLook(shape, board);
        expect(box.style).toMatchObject(look.style);
        expect(box.style.stroke).toBe("none");
        expect(box.textStyle).toMatchObject({ size: TEXT_SIZE, bold: false });
        expect({ w: box.w, h: box.h }).toEqual(look.size);
    });

    it("dresses Tab's next step and its arrow alike, and sends it down", () => {
        const store = storeOf("flowchart", board);
        const first = insertShape(store, "process", { x: 0, y: 0 });
        store.setEditing(null);
        const next = addNextStep(store, first)!;
        store.setEditing(null);
        const a = node(store, first);
        const b = node(store, next);
        expect(b.textStyle).toMatchObject({ size: TEXT_SIZE, bold: false });
        expect(b.style.fill).toBe(a.style.fill);
        const edge = page(store).edges.find(e => e.to.nodeId === next)!;
        const look = flowchartLook.edgeLook(board);
        expect(edge).toMatchObject({ kind: look.kind, endArrow: look.endArrow, style: look.style });
        expect(edge.textStyle).toMatchObject(look.text!);
        expect(b.y).toBeGreaterThan(a.y + a.h);
        expect(b.x + b.w / 2).toBe(a.x + a.w / 2);
    });
});

/**
 * The rail's Topic tool places a topic, and topics are repainted as branches
 * when they are placed — bold type, an outline. On a flowchart the look has
 * already dressed the box, and the repaint would put the bold back.
 */
describe("a topic placed on a flowchart", () => {
    it("wears the step look, not a branch's", () => {
        const store = storeOf("flowchart");
        const id = insertShape(store, "mind-branch", { x: 0, y: 0 });
        const look = flowchartLook.boxLook("mind-branch", "light");
        expect(node(store, id).textStyle).toMatchObject(look.text);
        expect(node(store, id).style).toMatchObject(look.style);
    });

    it("is not repainted after a gesture made it", () => {
        const store = storeOf("flowchart");
        const id = insertShape(store, "mind-branch", { x: 0, y: 0 });
        const before = node(store, id);
        paintNewTopics(store, [id]);
        expect(node(store, id)).toBe(before);
    });

    it("on a mindmap, is painted as a main branch, as before", () => {
        const store = storeOf("mindmap");
        const id = insertShape(store, "mind-branch", { x: 0, y: 0 });
        expect(node(store, id).textStyle.bold).toBe(true);
    });
});

describe("a box whose words change its kind", () => {
    it("wearing the flowchart look, takes the new kind's size and colour", () => {
        const store = storeOf("flowchart");
        const id = insertShape(store, "process", { x: 0, y: 0 });
        commitNodeText(store, node(store, id), "Paid?");
        expect(node(store, id)).toMatchObject({
            shape: "decision",
            ...KINDS.decision!.size,
            style: { fill: flowchartLook.boxLook("decision", "light").style.fill },
        });
    });

    it("with colours of its own (a template's), is reshaped but never repainted", () => {
        const store = new EditorStore(buildTemplate("flowchart", "Doc", "light"));
        const start = page(store).nodes.find(n => n.text === "Start")!;
        commitNodeText(store, start, "Begin here");
        const after = node(store, start.id);
        expect(after.shape).toBe("process");
        expect(after.style).toEqual(start.style);
        expect(after.textStyle).toEqual(start.textStyle);
        expect(after.x + after.w / 2).toBeCloseTo(start.x + start.w / 2);
    });
});
