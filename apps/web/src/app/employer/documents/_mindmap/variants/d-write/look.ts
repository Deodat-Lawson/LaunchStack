import { neutralsFor } from "../../model/palette";
import type { FlowLook } from "../types";

/**
 * D · Write it, see it. Mermaid-style: the steps are typed as lines in a
 * panel and the chart draws itself top to bottom in plain, quiet boxes.
 * Starting defaults — the direction's agent refines them.
 */
export const lookD: FlowLook = {
    id: "d",
    chrome: "focus",
    stepShape: "process",
    direction: "down",
    boxLook(shape, mode) {
        const n = neutralsFor(mode);
        return {
            style: { fill: n.paper, stroke: n.hairline, strokeWidth: 1, radius: 6, shadow: false },
            text: { color: n.ink, size: 14, bold: false },
            size: shape === "decision" ? { w: 168, h: 92 } : { w: 168, h: 52 },
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
