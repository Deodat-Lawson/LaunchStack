import { insertShape } from "../model/commands";
import { activePage, nodeById } from "../model/doc";
import { EditorStore } from "../model/store";
import { buildTemplate } from "../model/templates";
import { paintNewTopics } from "../model/topicStyle";
import { FLOW_LOOKS } from "../variants/looks";
import { FLOW_VARIANT_IDS, type FlowVariantId } from "../variants/types";

/**
 * The rail's Topic tool places a topic, and topics are repainted as branches
 * when they are placed — bold type, an outline. Under a flowchart direction
 * the direction's look has already dressed the box, and the repaint put the
 * bold back (the inconsistency the directions exist to remove). With no
 * direction, topics are painted exactly as before.
 */

function store(variant: FlowVariantId | null): EditorStore {
    const s = new EditorStore(buildTemplate("blank", "Flow", "light"));
    s.setFlowVariant(variant);
    return s;
}

const node = (s: EditorStore, id: string) => nodeById(activePage(s.getState().doc), id)!;

describe.each(FLOW_VARIANT_IDS)("a topic placed under direction %s", variant => {
    it("wears the direction's look, not a branch's", () => {
        const s = store(variant);
        const id = insertShape(s, "mind-branch", { x: 0, y: 0 });
        const look = FLOW_LOOKS[variant].boxLook("mind-branch", "light");
        expect(node(s, id).textStyle).toMatchObject(look.text);
        expect(node(s, id).style).toMatchObject(look.style);
    });

    it("is not repainted after a gesture made it", () => {
        const s = store(variant);
        const id = insertShape(s, "mind-branch", { x: 0, y: 0 });
        const before = node(s, id);
        paintNewTopics(s, [id]);
        expect(node(s, id)).toBe(before);
    });
});

describe("a topic placed with no direction", () => {
    it("is painted as a main branch, as before", () => {
        const s = store(null);
        const id = insertShape(s, "mind-branch", { x: 0, y: 0 });
        expect(node(s, id).textStyle.bold).toBe(true);
    });
});
