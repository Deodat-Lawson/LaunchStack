import { sizeForText } from "../../model/grow";
import { neutralsFor } from "../../model/palette";
import { isContainer } from "../../model/shapes";
import type { DiagramNode, ShapeId } from "../../model/types";
import type { FlowLook } from "../types";
import { DECISION_SIZE, isQuestion, STEP_SIZE, tidyChart } from "../../model/flowchart/arrange";

/**
 * A · Keyboard flow. Whimsical-style: steps run top to bottom, every box is
 * the same neutral box with regular-weight text, and the keyboard does the
 * drawing — the chart lays itself out after every step.
 *
 * The defaults, decided once so no two boxes differ:
 *
 * | What     | Default                                                      |
 * | -------- | ------------------------------------------------------------ |
 * | Step     | process box, 176 × 56, radius 8                              |
 * | Decision | diamond, 176 × 96 (a label ending in "?" makes one)          |
 * | Fill     | the paper                                                    |
 * | Outline  | ink, 1.5px, no shadow                                        |
 * | Text     | 14px regular ink, centred; wraps at the box's width and the  |
 * |          | box grows down, never wider                                  |
 * | Arrow    | elbow, soft ink 1.5px, filled arrowhead                      |
 *
 * Annotations (text marks, sticky notes, frames) keep their own look: they
 * are notes about the chart, not steps in it.
 */

/** Shapes dressed as a step box: same width, same height, same type. */
const BOXES: ReadonlySet<ShapeId> = new Set<ShapeId>([
    "process",
    "rectangle",
    "rounded-rectangle",
    "terminator",
    "data",
    "mind-root",
    "mind-branch",
]);
/** Shapes dressed as a decision. */
const DIAMONDS: ReadonlySet<ShapeId> = new Set<ShapeId>(["decision", "diamond"]);
/** Shapes that are notes on the chart rather than steps in it. */
const ANNOTATIONS: ReadonlySet<ShapeId> = new Set<ShapeId>(["text", "sticky", "mind-leaf"]);

function isAnnotation(shape: ShapeId): boolean {
    return ANNOTATIONS.has(shape) || isContainer(shape);
}

/**
 * `node` reshaped as `shape` at `base` size, grown down for `text`, and kept
 * centred where it was.
 */
function reshaped(
    node: DiagramNode,
    shape: ShapeId,
    base: { w: number; h: number },
    text: string
): Pick<DiagramNode, "shape" | "x" | "y" | "w" | "h"> {
    const fresh: DiagramNode = { ...node, shape, w: base.w, h: base.h };
    const { w, h } = sizeForText(fresh, text, { keepWidth: true });
    return {
        shape,
        w,
        h,
        x: Math.round(node.x + node.w / 2 - w / 2),
        y: Math.round(node.y + node.h / 2 - h / 2),
    };
}

export const lookA: FlowLook = {
    id: "a",
    chrome: "focus",
    stepShape: "process",
    direction: "down",
    fixedWidth: true,
    boxLook(shape, mode) {
        if (isAnnotation(shape)) return { style: {}, text: {} };
        const n = neutralsFor(mode);
        return {
            style: {
                fill: n.paper,
                stroke: n.ink,
                strokeWidth: 1.5,
                strokeStyle: "solid",
                radius: 8,
                shadow: false,
            },
            text: {
                color: n.ink,
                size: 14,
                bold: false,
                italic: false,
                align: "center",
                valign: "middle",
            },
            size: DIAMONDS.has(shape) ? DECISION_SIZE : BOXES.has(shape) ? STEP_SIZE : undefined,
        };
    },
    edgeLook(mode) {
        return {
            kind: "elbow",
            style: { stroke: neutralsFor(mode).inkSoft, strokeWidth: 1.5 },
            endArrow: "arrow",
        };
    },
    // Whatever Tab is pressed on, what comes next is a plain step: a branch
    // out of a decision is an action, and a new question is typed as one.
    nextShape: () => "process",
    relayout: (page, added) => tidyChart(page, [added]),
    afterText(node, text) {
        // The words decide: a question is a decision, and a decision whose
        // question mark is taken away goes back to being a step.
        if (node.shape === "process" && isQuestion(text)) {
            return reshaped(node, "decision", DECISION_SIZE, text);
        }
        if (node.shape === "decision" && text.trim() !== "" && !isQuestion(text)) {
            return reshaped(node, "process", STEP_SIZE, text);
        }
        return null;
    },
};
