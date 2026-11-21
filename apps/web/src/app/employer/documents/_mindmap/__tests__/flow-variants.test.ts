import { addNextStep, insertShape } from "../model/commands";
import { activePage, nodeById } from "../model/doc";
import { EditorStore } from "../model/store";
import { buildTemplate } from "../model/templates";
import { activeFlowLook, FLOW_LOOKS } from "../variants/looks";
import { FLOW_VARIANT_IDS, isFlowVariantId } from "../variants/types";

/**
 * The switch the flowchart directions plug into (`variants/`). Each
 * direction's own behaviour is tested in its own file; these pin the shared
 * contract: off by default, on only for flowcharts, and when on, every new box
 * and arrow is dressed by the direction.
 */

function flowStore(variant: (typeof FLOW_VARIANT_IDS)[number] | null = null): EditorStore {
    const store = new EditorStore(buildTemplate("blank", "Flow", "light"));
    store.setFlowVariant(variant);
    return store;
}

const page = (store: EditorStore) => activePage(store.getState().doc);

describe("flow variants: the switch", () => {
    it("is off unless the editor is given one", () => {
        expect(
            new EditorStore(buildTemplate("blank", "Flow", "light")).getState().flowVariant
        ).toBe(null);
    });

    it("recognises exactly the four directions", () => {
        expect(FLOW_VARIANT_IDS).toEqual(["a", "b", "c", "d"]);
        expect(isFlowVariantId("b")).toBe(true);
        expect(isFlowVariantId("e")).toBe(false);
        expect(isFlowVariantId(null)).toBe(false);
    });

    it("applies only to a document worked as a flowchart", () => {
        const store = new EditorStore(buildTemplate("mindmap", "Map", "light"));
        store.setFlowVariant("a");
        expect(activeFlowLook(store.getState())).toBeNull();
        expect(activeFlowLook(flowStore("a").getState())?.id).toBe("a");
    });

    it("leaves today's boxes alone when no direction is chosen", () => {
        const plain = flowStore(null);
        const id = insertShape(plain, "process", { x: 0, y: 0 });
        const box = nodeById(page(plain), id)!;
        const look = FLOW_LOOKS.c.boxLook("process", "light");
        expect(box.style.fill).not.toBe(look.style.fill);
    });
});

describe.each(FLOW_VARIANT_IDS)("flow variant %s: every new box and arrow", variant => {
    it("dresses a placed box in the direction's look", () => {
        const store = flowStore(variant);
        const id = insertShape(store, "process", { x: 0, y: 0 });
        const box = nodeById(page(store), id)!;
        const look = FLOW_LOOKS[variant].boxLook("process", "light");
        expect(box.style).toMatchObject(look.style);
        expect(box.textStyle).toMatchObject(look.text);
        if (look.size) expect({ w: box.w, h: box.h }).toEqual(look.size);
    });

    it("dresses Tab's next step and its arrow alike", () => {
        const store = flowStore(variant);
        const first = insertShape(store, "process", { x: 0, y: 0 });
        store.setEditing(null);
        const next = addNextStep(store, first)!;
        store.setEditing(null);
        const a = nodeById(page(store), first)!;
        const b = nodeById(page(store), next)!;
        expect(b.textStyle.size).toBe(a.textStyle.size);
        expect(b.textStyle.bold).toBe(a.textStyle.bold);
        const edge = page(store).edges.find(e => e.to.nodeId === next)!;
        expect(edge.kind).toBe(FLOW_LOOKS[variant].edgeLook("light").kind);
    });

    it("sends the first step the direction's way", () => {
        const store = flowStore(variant);
        const first = insertShape(store, "process", { x: 0, y: 0 });
        const next = addNextStep(store, first)!;
        const a = nodeById(page(store), first)!;
        const b = nodeById(page(store), next)!;
        const dx = b.x + b.w / 2 - (a.x + a.w / 2);
        const dy = b.y + b.h / 2 - (a.y + a.h / 2);
        if (FLOW_LOOKS[variant].relayout) return; // its own layout decides
        if (FLOW_LOOKS[variant].direction === "down") expect(dy).toBeGreaterThan(Math.abs(dx));
        else expect(dx).toBeGreaterThan(Math.abs(dy));
    });
});
