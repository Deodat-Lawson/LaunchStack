/**
 * Boxes that grow with their text.
 *
 * Typing into a box makes it as big as its words need, the way Whimsical,
 * Lucid and FigJam do: a short label widens the box until it reaches
 * `GROW_MAX_TEXT_WIDTH`, after which the label wraps and the box grows
 * taller. The box never drops below the size it had when typing began, so
 * deleting the words gives back the box that was drawn, not a smaller one.
 *
 * Growth keeps the label where it was anchored: centred text grows on both
 * sides (a box in a flowchart stays on its line), left-aligned text grows to
 * the right, top-aligned text grows down. A rotated box grows about its
 * centre, which is the point it rotates around.
 *
 * Pure: the text editor previews the result while typing and commits it in
 * one undo step with the words (`commitNodeText` in commands.ts).
 */

import { isContainer, shapeDef, shapeTextBox } from "./shapes";
import { layoutText } from "./text";
import type { DiagramNode, Rect } from "./types";

/** Widest a label runs before it wraps, when its box grows to hold it. */
export const GROW_MAX_TEXT_WIDTH = 280;

/** Measurement slack, so a line measured at its exact width never re-wraps. */
const SLACK = 4;

/** Shapes whose size is set by their text rather than only by hand. */
export function growsWithText(nd: DiagramNode): boolean {
    const def = shapeDef(nd.shape);
    if (def.holdsText === false) return false;
    // A frame's or a lane's label is a title over its contents: the contents,
    // not the title, decide its size.
    if (isContainer(nd.shape)) return false;
    return !nd.locked;
}

/**
 * Smallest `v ≥ lo` with `fits(v)`, for a `fits` that only ever turns true
 * as `v` grows. Text boxes are monotone in their shape's size but not
 * always linear in it (a diamond's is half its width), so this searches
 * rather than inverting a formula per shape.
 */
function smallestFitting(lo: number, fits: (v: number) => boolean): number {
    if (fits(lo)) return lo;
    let hi = Math.max(lo * 1.5, lo + 40);
    let guard = 0;
    while (!fits(hi) && guard++ < 24) hi *= 1.6;
    if (!fits(hi)) return hi;
    let low = lo;
    for (let i = 0; i < 24 && hi - low > 0.5; i++) {
        const mid = (low + hi) / 2;
        if (fits(mid)) hi = mid;
        else low = mid;
    }
    return Math.ceil(hi);
}

/**
 * Where a box should be, and how big, to hold `text`: grown from `start` —
 * the box as it was when typing began — and never smaller than it.
 * `keepWidth` gives every box the sticky note's rule: wrap at the width it
 * has and grow down only.
 */
export function sizeForText(
    start: DiagramNode,
    text: string,
    opts: { keepWidth?: boolean } = {}
): Rect {
    const rect = { x: start.x, y: start.y, w: start.w, h: start.h };
    if (!growsWithText(start) || text.length === 0) return rect;

    const startBox = shapeTextBox(start.shape, start.w, start.h);
    // A sticky note is a note: it keeps its width and grows down, as in
    // FigJam. Everything else may widen before it wraps, unless asked not to.
    const cap =
        start.shape === "sticky" || opts.keepWidth
            ? startBox.w
            : Math.max(startBox.w, GROW_MAX_TEXT_WIDTH);
    const unwrapped = layoutText(text, start.textStyle, Math.max(cap, 1));
    // The slack never pushes past the cap: wrapped at the cap, the lines are
    // already the ones measured.
    const needW = Math.max(startBox.w, Math.min(cap, Math.ceil(unwrapped.width) + SLACK));
    const laid = layoutText(text, start.textStyle, needW);
    const needH = Math.max(startBox.h, Math.ceil(laid.height) + SLACK);
    if (needW <= startBox.w && needH <= startBox.h) return rect;

    // The text box of some shapes depends on both sides (a parallelogram's
    // slant follows its height), so settle width and height twice.
    let w = start.w;
    let h = start.h;
    for (let pass = 0; pass < 2; pass++) {
        const hNow = h;
        w = smallestFitting(start.w, v => shapeTextBox(start.shape, v, hNow).w >= needW);
        const wNow = w;
        h = smallestFitting(start.h, v => shapeTextBox(start.shape, wNow, v).h >= needH);
    }
    w = Math.max(start.w, w);
    h = Math.max(start.h, h);

    const dw = w - start.w;
    const dh = h - start.h;
    const turned = Math.abs(start.rotation % 360) > 0.01;
    const { align, valign } = start.textStyle;
    const ax = turned ? 0.5 : align === "left" ? 0 : align === "right" ? 1 : 0.5;
    const ay = turned ? 0.5 : valign === "top" ? 0 : valign === "bottom" ? 1 : 0.5;
    return { x: start.x - dw * ax, y: start.y - dh * ay, w, h };
}
