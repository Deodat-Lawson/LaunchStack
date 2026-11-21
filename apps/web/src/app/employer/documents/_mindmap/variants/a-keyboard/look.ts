import { neutralsFor } from "../../model/palette";
import type { FlowLook } from "../types";

/**
 * A · Keyboard flow. Whimsical-style: steps run top to bottom, every box is
 * the same neutral box with regular-weight text, and the keyboard does the
 * drawing. Starting defaults — the direction's agent refines them.
 */
export const lookA: FlowLook = {
    id: "a",
    chrome: "focus",
    stepShape: "process",
    direction: "down",
    boxLook(shape, mode) {
        const n = neutralsFor(mode);
        return {
            style: { fill: n.paper, stroke: n.ink, strokeWidth: 1.5, radius: 8, shadow: false },
            text: { color: n.ink, size: 14, bold: false, align: "center", valign: "middle" },
            size: shape === "decision" ? { w: 176, h: 96 } : { w: 176, h: 56 },
        };
    },
    edgeLook(mode) {
        return {
            kind: "elbow",
            style: { stroke: neutralsFor(mode).inkSoft, strokeWidth: 1.5 },
            endArrow: "arrow",
        };
    },
};
