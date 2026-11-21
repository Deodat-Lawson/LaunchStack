import { neutralsFor, swatchFor } from "../../model/palette";
import type { FlowLook } from "../types";

/**
 * B · Quick-add arrows. Lucidchart/draw.io-style: free placement, a classic
 * tinted box with a thin outline, and + arrows on every side of a box.
 * Starting defaults — the direction's agent refines them.
 */
export const lookB: FlowLook = {
    id: "b",
    chrome: "everything",
    stepShape: "process",
    direction: "right",
    boxLook(shape, mode) {
        const sw = swatchFor("blue", mode);
        return {
            style: { fill: sw.fill, stroke: sw.stroke, strokeWidth: 1, radius: 4, shadow: false },
            text: { color: neutralsFor(mode).ink, size: 13, bold: false },
            size: shape === "decision" ? { w: 160, h: 90 } : { w: 160, h: 60 },
        };
    },
    edgeLook(mode) {
        return {
            kind: "elbow",
            style: { stroke: neutralsFor(mode).ink, strokeWidth: 1.25 },
            endArrow: "arrow",
        };
    },
};
