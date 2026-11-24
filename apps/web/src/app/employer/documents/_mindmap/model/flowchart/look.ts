/**
 * The flowchart look the product ships: every new box is coloured by its
 * kind, and the chart runs top to bottom with plain right-angled arrows.
 *
 * | Kind      | Shape      | Size      | Fill          | Outline | Text                       |
 * | --------- | ---------- | --------- | ------------- | ------- | -------------------------- |
 * | Step      | process    | 168 × 64  | blue swatch   | none    | 15px regular, swatch ink   |
 * | Decision  | decision   | 168 × 104 | amber swatch  | none    | 15px regular, swatch ink   |
 * | Start/End | terminator | 152 × 56  | green swatch  | none    | 15px regular, swatch ink   |
 * | Data      | data       | 184 × 64  | violet swatch | none    | 15px regular, swatch ink   |
 * | Note      | sticky     | 168 × 112 | sticky yellow | none    | 15px regular, left and top |
 *
 * Every box: radius 12 where the shape rounds, a soft shadow, nothing bold,
 * no outline — but a shape's own lines (a database's lid, a class's
 * dividers, the sheets of a document stack) are drawn in the deeper tone of
 * its colour, so a new box looks exactly as it does after a colour is picked.
 * Plain boxes from the toolbar or the library (rectangles, topic boxes) are
 * steps in all but name, so they get a step's size and colour; other library
 * shapes keep their own proportions and take the step colour. Frames, text
 * marks and shapes drawn in lines (a rule, brackets, a stick figure) keep
 * their own look. Arrows: right-angled, 1.5px, the board's soft ink, an
 * arrowhead, 12px regular labels.
 *
 * A plain step's words can make it another kind (the same rule as the step
 * language in `./syntax.ts`): a label ending in "?" makes a decision,
 * "Start"/"End" a pill; the box is reshaped and recoloured in the same undo
 * step. Words never take a kind away: a decision or a pill picked from a
 * menu keeps its kind whatever it is labelled. Boxes keep
 * their width and grow down as their words wrap, so a column of steps stays
 * on one centre line.
 *
 * Colours come from the swatch tables (`swatchFor`), so a dark board gets the
 * dark tones; every kind's ink clears 4.5:1 on its own fill in both lightings.
 * Board colours are document data, not theme tokens (see the README).
 */

import { isTopicShape, worksAsFlow } from "../doc";
import type { CreateEdgeOptions } from "../factory";
import { sizeForText } from "../grow";
import {
    neutralsFor,
    stickyColors,
    stickyInk,
    swatchFor,
    themeMode,
    type ThemeMode,
} from "../palette";
import { shapeDef } from "../shapes";
import type { DiagramNode, MindmapDoc, ShapeId } from "../types";
import { tidyChart } from "./arrange";
import type { BoxLook, FlowLook } from "./lookTypes";
import { isStepNode, shapeForKind } from "./steps";
import { oneLine, stepKindOf } from "./syntax";

/** The one size every label is set in. */
export const TEXT_SIZE = 15;

interface Kind {
    /** A swatch id, or `sticky` for the note's own yellow. */
    hue: string;
    size: { w: number; h: number };
}

export const KINDS: Readonly<Partial<Record<ShapeId, Kind>>> = {
    process: { hue: "blue", size: { w: 168, h: 64 } },
    decision: { hue: "amber", size: { w: 168, h: 104 } },
    terminator: { hue: "green", size: { w: 152, h: 56 } },
    data: { hue: "violet", size: { w: 184, h: 64 } },
    sticky: { hue: "sticky", size: { w: 168, h: 112 } },
};

/** A box that is none of the five kinds is coloured as a step. */
const STEP_HUE = "blue";

/** Plain boxes that are a step in all but name: a step's size as well as its colour. */
const STEP_LIKE: ReadonlySet<ShapeId> = new Set<ShapeId>([
    "rectangle",
    "rounded-rectangle",
    "mind-root",
    "mind-branch",
]);

/**
 * A kind's fill, the ink its label is set in, and the deeper tone its own
 * lines are drawn in (a database's lid, a class's dividers), for one
 * lighting. A note has no lines of its own.
 */
export function kindColours(
    shape: ShapeId,
    mode: ThemeMode
): { fill: string; ink: string; line: string } {
    const hue = KINDS[shape]?.hue ?? STEP_HUE;
    if (hue === "sticky") {
        return { fill: stickyColors(mode)[0]!, ink: stickyInk(mode), line: "none" };
    }
    const sw = swatchFor(hue, mode);
    return { fill: sw.fill, ink: sw.ink, line: sw.stroke };
}

/**
 * Shapes that are their lines rather than a filled box: a rule, a pen
 * stroke, a pair of brackets, a stick figure, a subtopic's underline. Dressed
 * as a box they were filled and lost their lines — nothing showed at all.
 * They keep their own drawing on every board.
 */
export function drawnInLines(shape: ShapeId): boolean {
    return shape === "mind-leaf" || (shapeDef(shape).chromeless === true && shape !== "text");
}

/**
 * Whether a box wears the flowchart look as it was given: no outline and
 * the fill of its kind. A box with colours of its own (a template's, an
 * older document's) is never repainted. Boxes dressed before 2026-11-23
 * stored no outline as `stroke: "none"`; since then they carry the line
 * tone their inner lines are drawn in, at no width.
 */
function wearsKindColour(node: DiagramNode, mode: ThemeMode): boolean {
    const noOutline = node.style.stroke === "none" || node.style.strokeWidth === 0;
    return noOutline && node.style.fill === kindColours(node.shape, mode).fill;
}

function boxLook(shape: ShapeId, mode: ThemeMode): BoxLook {
    // Frames, lanes and groups are sized by what they hold and painted as
    // paper; a free text mark has no box; a rule, a stick figure or a pen
    // stroke is drawn in lines. All keep their own colours.
    if (shapeDef(shape).container || shape === "text" || drawnInLines(shape)) {
        return { style: {}, text: { size: TEXT_SIZE, bold: false } };
    }
    const kind = KINDS[shape];
    const { fill, ink, line } = kindColours(shape, mode);
    const note = shape === "sticky";
    return {
        // No outline: the stroke is the tone the box's own lines are drawn
        // in, at no width — the state picking a colour leaves it in, so a new
        // box and a recoloured one look the same.
        style: { fill, stroke: line, strokeWidth: 0, radius: 12, shadow: true, opacity: 1 },
        text: {
            color: ink,
            size: TEXT_SIZE,
            family: "sans",
            bold: false,
            italic: false,
            underline: false,
            strike: false,
            // A note reads like something written on it; a box like a label.
            align: note ? "left" : "center",
            valign: note ? "top" : "middle",
        },
        ...(kind ? { size: kind.size } : STEP_LIKE.has(shape) ? { size: KINDS.process!.size } : {}),
    };
}

/** What Tab adds after a box: after a pill, a question or a note, a plain step. */
function nextShape(source: DiagramNode): ShapeId {
    const s = source.shape;
    if (s === "terminator" || s === "decision" || s === "sticky" || s === "text") return "process";
    if (s === "mind-root" || s === "mind-branch" || s === "mind-leaf") return "process";
    return s;
}

/**
 * A plain step whose words now make it another kind — "In stock?" a
 * decision, "Start" or "End" a pill — reshaped about the same centre and
 * grown down for its words. Words only ever promote a plain step: a decision
 * or a pill keeps its kind whatever it is labelled ("Approve", "Order
 * placed", "Start X"), since the kind someone picked stays until they change
 * the shape themselves. A box wearing the flowchart look takes the new
 * kind's size and colour; one with colours of its own (a template's, an
 * older document's) keeps them, and its size — it is never repainted. Null
 * when the kind is unchanged or the box is not a plain step.
 */
function afterText(
    node: DiagramNode,
    text: string,
    mode: ThemeMode
): Partial<Pick<DiagramNode, "shape" | "x" | "y" | "w" | "h" | "style" | "textStyle">> | null {
    if (!isStepNode(node) || text.trim() === "") return null;
    if (node.shape === "decision" || node.shape === "terminator") return null;
    const kind = stepKindOf(oneLine(text));
    if (kind === "step") return null;
    const shape = shapeForKind(kind, node.shape, "process");
    if (shape === node.shape) return null;
    const dressed = wearsKindColour(node, mode);
    const look = boxLook(shape, mode);
    const base = (dressed ? look.size : undefined) ?? { w: node.w, h: node.h };
    const fresh: DiagramNode = {
        ...node,
        shape,
        w: base.w,
        h: base.h,
        textStyle: dressed ? { ...node.textStyle, ...look.text } : node.textStyle,
    };
    const { w, h } = sizeForText(fresh, text, { keepWidth: true });
    return {
        shape,
        w,
        h,
        x: Math.round(node.x + node.w / 2 - w / 2),
        y: Math.round(node.y + node.h / 2 - h / 2),
        ...(dressed ? { style: { ...node.style, ...look.style } } : {}),
        textStyle: fresh.textStyle,
    };
}

export const flowchartLook: FlowLook = {
    id: "flowchart",
    chrome: "focus",
    stepShape: "process",
    direction: "down",
    fixedWidth: true,
    boxLook,
    edgeLook(mode) {
        const n = neutralsFor(mode);
        return {
            kind: "elbow",
            style: { stroke: n.inkSoft, strokeWidth: 1.5, strokeStyle: "solid" },
            startArrow: "none",
            endArrow: "arrow",
            // A branch's "Yes" / "No": a step below the boxes' type, in the
            // board's own soft ink so it reads on dark paper as on light.
            text: { color: n.inkSoft, size: 12, bold: false, italic: false, family: "sans" },
        };
    },
    nextShape,
    relayout: (page, added) => tidyChart(page, [added]),
    afterText,
};

// ---------------------------------------------------------------------------
// Dressing new boxes and arrows
// ---------------------------------------------------------------------------

/**
 * The look every new box and arrow on this document gets: `flowchartLook` on
 * a document worked as a flowchart (`worksAsFlow`), null on a mindmap or a
 * freeform drawing — every caller then does exactly what it did before
 * flowcharts had a look of their own.
 */
export function flowLookOf(doc: MindmapDoc): FlowLook | null {
    return worksAsFlow(doc.settings.kind) ? flowchartLook : null;
}

/**
 * The look a box placed from the library or the rail gets: the flowchart
 * look on a flowchart, and on a mindmap too for a box that is not a topic —
 * a process box or a database looks the same on every board. A mindmap's
 * topics are painted by their branch, and its notes, frames, text and
 * line-drawn marks keep their own presets; a freeform drawing is left as it
 * was. Only how the box is *dressed*: Tab, layout and the rest still ask
 * `flowLookOf`.
 */
export function lookForNewBox(doc: MindmapDoc, shape: ShapeId): FlowLook | null {
    const look = flowLookOf(doc);
    if (look) return look;
    if (doc.settings.kind !== "mindmap") return null;
    const own =
        isTopicShape(shape) ||
        shape === "sticky" ||
        shape === "text" ||
        shapeDef(shape).container === true ||
        drawnInLines(shape);
    return own ? null : flowchartLook;
}

/** The board's lighting, for picking a look's colours. */
export function boardMode(doc: MindmapDoc): ThemeMode {
    return themeMode(doc.settings.paletteId);
}

/**
 * A new box in the look: its colours and type, and its starting size about
 * the same centre unless the caller chose the size (a box drawn by dragging
 * out a rectangle keeps the rectangle).
 */
export function dressBox(
    look: FlowLook,
    node: DiagramNode,
    mode: ThemeMode,
    opts: { keepSize?: boolean } = {}
): DiagramNode {
    const box = look.boxLook(node.shape, mode);
    const size = !opts.keepSize && box.size ? box.size : { w: node.w, h: node.h };
    const cx = node.x + node.w / 2;
    const cy = node.y + node.h / 2;
    return {
        ...node,
        x: cx - size.w / 2,
        y: cy - size.h / 2,
        w: size.w,
        h: size.h,
        style: { ...node.style, ...box.style },
        textStyle: { ...node.textStyle, ...box.text },
    };
}

/** The look's arrow, as `createEdge` options. */
export function edgeOptions(
    look: FlowLook,
    mode: ThemeMode
): Pick<CreateEdgeOptions, "kind" | "style" | "startArrow" | "endArrow" | "textStyle"> {
    const e = look.edgeLook(mode);
    return {
        kind: e.kind,
        style: e.style,
        ...(e.startArrow ? { startArrow: e.startArrow } : {}),
        ...(e.endArrow ? { endArrow: e.endArrow } : {}),
        ...(e.text ? { textStyle: e.text } : {}),
    };
}
