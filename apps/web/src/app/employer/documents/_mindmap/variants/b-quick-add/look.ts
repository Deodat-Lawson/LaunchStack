import { neutralsFor, swatchFor } from "../../model/palette";
import type { ShapeId } from "../../model/types";
import type { FlowLook } from "../types";

/**
 * B · Quick-add arrows. Lucidchart/draw.io-style: free placement, the
 * classic draw.io box — a light blue tint with a thin blue outline and plain
 * dark type — and + arrows on every side of a box.
 *
 * Every field a box's type can differ in is set, not only the ones that
 * differ from the shape's preset: the complaint this direction answers was
 * new boxes whose labels came out bold or regular depending on how they were
 * made. Nothing here is bold, and every path gets the same type.
 *
 * Every box is 160 wide, so a column of steps lines up on one centre line.
 * Height is 60 — one or two lines of 13px type — except where the shape's
 * text area is a fraction of its height: a diamond keeps half its height for
 * words (90 gives it the same line as a 60 box), and a cylinder spends its
 * top and bottom on the lid (80 keeps the lid an oval rather than a slit).
 */

const WIDTH = 160;
const HEIGHT = 60;
const TALLER: Partial<Record<ShapeId, number>> = { decision: 90, database: 80 };

export const lookB: FlowLook = {
    id: "b",
    chrome: "everything",
    stepShape: "process",
    direction: "right",
    boxLook(shape, mode) {
        const sw = swatchFor("blue", mode);
        return {
            style: {
                fill: sw.fill,
                stroke: sw.stroke,
                strokeWidth: 1,
                strokeStyle: "solid",
                radius: 4,
                shadow: false,
                opacity: 1,
            },
            text: {
                color: neutralsFor(mode).ink,
                size: 13,
                family: "sans",
                bold: false,
                italic: false,
                underline: false,
                strike: false,
                align: "center",
                valign: "middle",
            },
            size: { w: WIDTH, h: TALLER[shape] ?? HEIGHT },
        };
    },
    edgeLook(mode) {
        const n = neutralsFor(mode);
        return {
            kind: "elbow",
            style: { stroke: n.ink, strokeWidth: 1.25, strokeStyle: "solid" },
            startArrow: "none",
            endArrow: "arrow",
            // A line's "Yes" / "No": a step below the boxes' type, and the
            // board's own soft ink, so it reads on dark paper as on light.
            text: { color: n.inkSoft, size: 12, bold: false, italic: false, family: "sans" },
        };
    },
};
