/**
 * The shape of a flowchart "look": the box and arrow every creation path
 * makes, which way steps run, and the optional re-layout and label-driven
 * shape change. Pure types — the model, the editor and the server all use
 * them. The look the product ships is `flowchartLook` in `./look.ts`.
 */

import type { ThemeMode } from "../palette";
import type { ChromeDepth } from "../store";
import type {
    ArrowId,
    DiagramNode,
    DiagramPage,
    EdgeKind,
    EdgeStyle,
    NodeStyle,
    ShapeId,
    TextStyle,
} from "../types";

/** What a new box of one shape looks like. */
export interface BoxLook {
    style: Partial<NodeStyle>;
    text: Partial<TextStyle>;
    /** Its starting size. Omitted: the shape's own default. */
    size?: { w: number; h: number };
}

export interface EdgeLook {
    kind: EdgeKind;
    style: Partial<EdgeStyle>;
    startArrow?: ArrowId;
    endArrow?: ArrowId;
    /** The type of its labels. Omitted: the editor's default (12px grey). */
    text?: Partial<TextStyle>;
}

/** How a flowchart makes and dresses its boxes and arrows. Pure. */
export interface FlowLook {
    /** Which look this is (for tests and debugging). */
    id: string;
    /** Chrome the direction opens with (`focus` = Simple, `everything`). */
    chrome: ChromeDepth;
    /** The shape of a first box, a double-clicked box, and a plain step. */
    stepShape: ShapeId;
    /** Which way a step goes when nothing on the page says otherwise. */
    direction: "right" | "down";
    /** Every new box, by every path, is given this. */
    boxLook(shape: ShapeId, mode: ThemeMode): BoxLook;
    /** Every new arrow, by every path, is given this. */
    edgeLook(mode: ThemeMode): EdgeLook;
    /**
     * The shape of the step Tab adds after `source`. Omitted: the same shape
     * (the base behaviour).
     */
    nextShape?(source: DiagramNode): ShapeId;
    /**
     * Re-lay the page after a step is added (`addNextStep`). Pure: given the
     * page with the new box and arrow in, return it arranged. `added` is the
     * new box's id.
     */
    relayout?: (page: DiagramPage, added: string) => DiagramPage;
    /**
     * A box whose label was just committed may change with its words (a label
     * ending in "?" becoming a decision, say). Return the fields to change, or
     * null. Applied in the same undo step as the words.
     */
    afterText?(
        node: DiagramNode,
        text: string,
        mode: ThemeMode
    ): Partial<Pick<DiagramNode, "shape" | "x" | "y" | "w" | "h" | "style" | "textStyle">> | null;
    /**
     * Boxes keep the width they were made with and grow down as their label
     * wraps (a sticky note's rule), instead of widening first. Omitted: false.
     */
    fixedWidth?: boolean;
}
