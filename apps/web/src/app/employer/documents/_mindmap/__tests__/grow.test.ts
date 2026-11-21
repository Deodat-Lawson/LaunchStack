import { createNode } from "../model/factory";
import { GROW_MAX_TEXT_WIDTH, growsWithText, sizeForText } from "../model/grow";
import { shapeTextBox } from "../model/shapes";
import { layoutText } from "../model/text";

/**
 * Boxes grow with their text: wider first, up to a cap, then taller; never
 * below the size they were drawn at; anchored by their text alignment.
 * (Under Jest, text is measured with the fallback width table in text.ts.)
 */

const LONG = "Propose RPC to the other zones, which are the followers in this protocol";

describe("sizeForText", () => {
    it("leaves a box alone when its words already fit", () => {
        const box = createNode({ shape: "process", x: 10, y: 20, w: 160, h: 70 });
        expect(sizeForText(box, "Write")).toEqual({ x: 10, y: 20, w: 160, h: 70 });
    });

    it("widens a box for a longer label, then wraps it at the cap and grows taller", () => {
        const box = createNode({ shape: "process", x: 0, y: 0, w: 160, h: 70 });
        const words = `${LONG}. ${LONG}.`;
        const r = sizeForText(box, words);
        const text = shapeTextBox("process", r.w, r.h);
        expect(r.w).toBeGreaterThan(160);
        expect(text.w).toBeLessThanOrEqual(GROW_MAX_TEXT_WIDTH);
        expect(r.h).toBeGreaterThan(70);
        // What is drawn fits: the label laid out in the grown box's text area.
        const laid = layoutText(words, box.textStyle, text.w);
        expect(laid.height).toBeLessThanOrEqual(text.h);
        expect(laid.width).toBeLessThanOrEqual(text.w);
    });

    it("never drops below the size the box started at", () => {
        const big = createNode({ shape: "process", x: 0, y: 0, w: 400, h: 300 });
        expect(sizeForText(big, "Hi")).toMatchObject({ w: 400, h: 300 });
    });

    it("grows centred text on both sides, so a box keeps its place in the flow", () => {
        const box = createNode({ shape: "process", x: 100, y: 100, w: 160, h: 70 });
        const r = sizeForText(box, LONG);
        expect(r.x + r.w / 2).toBeCloseTo(180);
        expect(r.y + r.h / 2).toBeCloseTo(135);
    });

    it("grows left/top-aligned text right and down from where it was put", () => {
        const mark = createNode({ shape: "text", x: 100, y: 100, w: 180, h: 44 });
        const r = sizeForText(mark, `${LONG}\n${LONG}`);
        expect(r.x).toBe(100);
        expect(r.y).toBe(100);
        expect(r.h).toBeGreaterThan(44);
    });

    it("keeps a sticky note's width and grows it down", () => {
        const sticky = createNode({ shape: "sticky", x: 0, y: 0 });
        const r = sizeForText(sticky, `${LONG} ${LONG} ${LONG}`);
        expect(r.w).toBe(sticky.w);
        expect(r.h).toBeGreaterThan(sticky.h);
    });

    it("fits a diamond, whose text area is a fraction of its size", () => {
        const d = createNode({ shape: "decision", x: 0, y: 0 });
        const r = sizeForText(d, LONG);
        const text = shapeTextBox("decision", r.w, r.h);
        const laid = layoutText(LONG, d.textStyle, text.w);
        expect(laid.height).toBeLessThanOrEqual(text.h);
    });

    it("leaves containers and locked shapes to their owners", () => {
        const frame = createNode({ shape: "frame", x: 0, y: 0 });
        expect(growsWithText(frame)).toBe(false);
        expect(sizeForText(frame, LONG)).toMatchObject({ w: frame.w, h: frame.h });
        const locked = { ...createNode({ shape: "process", x: 0, y: 0 }), locked: true };
        expect(growsWithText(locked)).toBe(false);
    });
});
