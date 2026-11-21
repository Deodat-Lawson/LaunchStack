import { neutralsFor, swatchFor } from "../../model/palette";
import type { ShapeId } from "../../model/types";
import type { FlowLook } from "../types";

/** Each kind of box has its own soft colour, so the chart reads by colour. */
const HUE: Partial<Record<ShapeId, string>> = {
    process: "blue",
    decision: "amber",
    terminator: "green",
    data: "violet",
};

/**
 * C · Drop and pick. FigJam/Miro-style: drag an arrow into space and pick
 * what goes there; boxes are colour-coded by kind, with no outline.
 * Starting defaults — the direction's agent refines them.
 */
export const lookC: FlowLook = {
    id: "c",
    chrome: "focus",
    stepShape: "process",
    direction: "right",
    boxLook(shape, mode) {
        const sw = swatchFor(HUE[shape] ?? "blue", mode);
        return {
            style: { fill: sw.fill, stroke: "none", strokeWidth: 0, radius: 12, shadow: true },
            text: { color: sw.ink, size: 15, bold: false },
            size: shape === "decision" ? { w: 168, h: 100 } : { w: 168, h: 64 },
        };
    },
    edgeLook(mode) {
        return {
            kind: "curved",
            style: { stroke: neutralsFor(mode).inkSoft, strokeWidth: 2 },
            endArrow: "arrow",
        };
    },
};
