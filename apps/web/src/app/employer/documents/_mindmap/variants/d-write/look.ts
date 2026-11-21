import { neutralsFor } from "../../model/palette";
import type { ShapeId } from "../../model/types";
import type { FlowLook } from "../types";
import { isStepNode, relayoutAfterStep, shapeForKind } from "./chart";
import { oneLine, stepKindOf } from "./syntax";

/**
 * D · Write it, see it. Mermaid-style: the steps are typed as lines in a
 * panel and the chart draws itself top to bottom in plain, quiet boxes.
 *
 * | Part      | Default                                                     |
 * | --------- | ----------------------------------------------------------- |
 * | Step      | rectangle, radius 6, 168 × 52, grows taller with its words  |
 * | Decision  | diamond, 168 × 92                                           |
 * | Start/End | pill, 120 × 44                                              |
 * | Fill      | the board's paper                                           |
 * | Outline   | 1px hairline                                                |
 * | Text      | 14px regular ink, centred — never bold, on any box          |
 * | Arrow     | elbow, 1.5px soft ink, arrowhead; branch words 12px on it   |
 *
 * One weight everywhere is the point: the complaint this direction answers
 * is boxes that came out bold or not depending on how they were made. Every
 * path — a line, Tab, a double-click, the palette — gets this one look.
 */

const SIZES: Partial<Record<ShapeId, { w: number; h: number }>> = {
    decision: { w: 168, h: 92 },
    terminator: { w: 120, h: 44 },
};
const STEP_SIZE = { w: 168, h: 52 };

export const lookD: FlowLook = {
    id: "d",
    chrome: "focus",
    stepShape: "process",
    direction: "down",
    boxLook(shape, mode) {
        const n = neutralsFor(mode);
        return {
            style: {
                fill: n.paper,
                stroke: n.hairline,
                strokeWidth: 1,
                strokeStyle: "solid",
                radius: 6,
                shadow: false,
                opacity: 1,
            },
            text: {
                color: n.ink,
                size: 14,
                family: "sans",
                bold: false,
                italic: false,
                align: "center",
                valign: "middle",
            },
            size: SIZES[shape] ?? STEP_SIZE,
        };
    },
    edgeLook(mode) {
        return {
            kind: "elbow",
            style: { stroke: neutralsFor(mode).inkSoft, strokeWidth: 1.5, strokeStyle: "solid" },
            endArrow: "arrow",
        };
    },
    /** After anything, the next step is a plain step: a question is typed, not inherited. */
    nextShape: () => "process",
    /** Tab puts the new step after its box, as a new line would, and re-lays the chart. */
    relayout: relayoutAfterStep,
    /** The same rule as a line: ends in "?" is a diamond, Start/End is a pill. */
    afterText(node, text) {
        if (!isStepNode(node)) return null;
        const shape = shapeForKind(stepKindOf(oneLine(text)), node.shape, "process");
        return shape === node.shape ? null : { shape };
    },
};
