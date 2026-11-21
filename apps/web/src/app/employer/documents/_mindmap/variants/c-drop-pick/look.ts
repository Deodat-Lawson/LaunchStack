import {
    neutralsFor,
    stickyColors,
    stickyInk,
    swatchFor,
    type ThemeMode,
} from "../../model/palette";
import { shapeDef } from "../../model/shapes";
import type { ShapeId } from "../../model/types";
import type { BoxLook, FlowLook } from "../types";

/**
 * C · Drop and pick. FigJam/Miro-style: pull an arrow out of a box into
 * space and pick what goes at its end; the chart reads by colour.
 *
 * The defaults, decided once so every box agrees with its siblings:
 *
 * | Kind      | Shape      | Size      | Fill          | Outline | Text                       |
 * | --------- | ---------- | --------- | ------------- | ------- | -------------------------- |
 * | Step      | process    | 168 × 64  | blue swatch   | none    | 15px regular, swatch ink   |
 * | Decision  | decision   | 168 × 104 | amber swatch  | none    | 15px regular, swatch ink   |
 * | Start/End | terminator | 152 × 56  | green swatch  | none    | 15px regular, swatch ink   |
 * | Data      | data       | 184 × 64  | violet swatch | none    | 15px regular, swatch ink   |
 * | Note      | sticky     | 168 × 112 | sticky yellow | none    | 15px regular, left and top |
 *
 * Every box: radius 12 where the shape rounds, a soft shadow, no bold
 * anywhere. Arrows: curved, 2px, the paper's soft ink, an arrowhead at the
 * end. Colours come from the swatch tables (`swatchFor`), so a dark board
 * gets the dark tones; each kind's ink clears 4.5:1 on its own fill in both
 * lightings (pinned in `__tests__/variant-c.test.ts`).
 *
 * Widths sit on an 8px rhythm; a decision is tall enough for its diamond to
 * hold a short question on one line; a data box is wider because its slant
 * eats into the room for words. A shape with no kind of its own (a cylinder
 * dropped from the library) is dressed as a step at its own size; frames and
 * other containers keep their own look, with the chart's type.
 */

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

/** A kind's fill and the ink its label is set in, for one lighting. */
export function kindColours(shape: ShapeId, mode: ThemeMode): { fill: string; ink: string } {
    const hue = KINDS[shape]?.hue ?? STEP_HUE;
    if (hue === "sticky") return { fill: stickyColors(mode)[0]!, ink: stickyInk(mode) };
    const sw = swatchFor(hue, mode);
    return { fill: sw.fill, ink: sw.ink };
}

function boxLook(shape: ShapeId, mode: ThemeMode): BoxLook {
    // Frames, lanes and groups are sized by what they hold and painted as
    // paper; a free text mark has no box. Both keep their own colours.
    if (shapeDef(shape).container || shape === "text") {
        return { style: {}, text: { size: TEXT_SIZE, bold: false } };
    }
    const kind = KINDS[shape];
    const { fill, ink } = kindColours(shape, mode);
    const note = shape === "sticky";
    return {
        style: { fill, stroke: "none", strokeWidth: 0, radius: 12, shadow: true },
        text: {
            color: ink,
            size: TEXT_SIZE,
            bold: false,
            italic: false,
            // A note reads like something written on it; a box like a label.
            align: note ? "left" : "center",
            valign: note ? "top" : "middle",
        },
        ...(kind ? { size: kind.size } : {}),
    };
}

export const lookC: FlowLook = {
    id: "c",
    chrome: "focus",
    stepShape: "process",
    direction: "right",
    boxLook,
    // Tab after a Start/End pill or a decision is an action, not another pill
    // or another question: it makes a Step. Every other kind keeps its kind.
    nextShape: source =>
        source.shape === "terminator" || source.shape === "decision" ? "process" : source.shape,
    edgeLook(mode) {
        return {
            kind: "curved",
            style: { stroke: neutralsFor(mode).inkSoft, strokeWidth: 2, strokeStyle: "solid" },
            endArrow: "arrow",
        };
    },
};
