/**
 * Where direction B's + arrows sit and where the box one makes goes. Pure:
 * no store, no React — the canvas layer, the commands and the tests share it.
 */

import {
    nodeBounds,
    nodeCenter,
    portNormal,
    portPoint,
    rectsIntersect,
} from "../../model/geometry";
import { sizeForText } from "../../model/grow";
import { isContainer, shapeDef } from "../../model/shapes";
import type { DiagramNode, DiagramPage, Point, ShapeId, Size } from "../../model/types";

/** The four sides a box offers an arrow on. */
export type Side = "n" | "e" | "s" | "w";
export const SIDES: readonly Side[] = ["n", "e", "s", "w"];

export function isSide(port: unknown): port is Side {
    return port === "n" || port === "e" || port === "s" || port === "w";
}

/** Gap between a box and the one its arrow adds — the same as Tab's step. */
export const QUICK_GAP = 64;
/** Gap between boxes fanned out beside one another. */
export const FAN_GAP = 32;

/**
 * How far (screen px) an arrow's centre sits outside its side. Clear of
 * everything the base draws there: the dots a selected box shows 16px out
 * (their hit circles reach 25px), the mid-side resize grips on the outline,
 * and — above the box — the rotate handle 24px up (its hit circle reaches
 * 35px). The arrow is 20px long, so it is drawn 37–57px out, and its 12px
 * hit circle starts at 35px.
 */
export const ARROW_OFFSET = 47;
/** The arrow's hit target, screen px. */
export const ARROW_HIT = 12;

/** Shapes that get arrows: anything you would put in a flow. */
export function offersArrows(nd: DiagramNode): boolean {
    return !nd.locked && !nd.hidden && !isContainer(nd.shape) && nd.shape !== "ink";
}

/** Where an arrow is drawn, world space, at this zoom. */
export function arrowAnchor(nd: DiagramNode, side: Side, zoom: number): Point {
    const on = portPoint(nd, side);
    const out = portNormal(nd, side);
    const d = ARROW_OFFSET / zoom;
    return { x: on.x + out.x * d, y: on.y + out.y * d };
}

/** The way a side faces on the page (a rotated box's sides turn with it). */
export function sideStep(nd: DiagramNode, side: Side): Point {
    const v = portNormal(nd, side);
    if (Math.abs(v.x) >= Math.abs(v.y)) return { x: v.x >= 0 ? 1 : -1, y: 0 };
    return { x: 0, y: v.y >= 0 ? 1 : -1 };
}

/**
 * The size of a copy of `source`: its own, unless it grew to hold its label —
 * a copy starts empty, so it starts at the size an empty box of that shape
 * has (`base`) and grows as it is typed into, like the first one did.
 */
export function copySize(source: DiagramNode, base: Size): Size {
    if (source.text.trim() === "") return { w: source.w, h: source.h };
    const need = sizeForText({ ...source, w: base.w, h: base.h }, source.text);
    const grew = need.w > base.w || need.h > base.h;
    return grew ? { w: base.w, h: base.h } : { w: source.w, h: source.h };
}

/** The shape's own empty size, when no look gives one. */
export function shapeSize(shape: ShapeId): Size {
    return shapeDef(shape).defaultSize;
}

/**
 * The centre of the box an arrow adds on `side` of `source`: one gap out,
 * lined up with the source so the arrow between them is straight. A box
 * already there pushes it aside — below for a sideways arrow, to the right
 * for an up or down one, the way a second Tab fans out — past as many as
 * are in the way.
 */
export function placeBeside(page: DiagramPage, source: DiagramNode, side: Side, size: Size): Point {
    const step = sideStep(source, side);
    const b = nodeBounds(source);
    const c = nodeCenter(source);
    const reach =
        step.x !== 0 ? b.w / 2 + QUICK_GAP + size.w / 2 : b.h / 2 + QUICK_GAP + size.h / 2;
    let at = { x: c.x + step.x * reach, y: c.y + step.y * reach };
    const aside = step.x !== 0 ? { x: 0, y: size.h + FAN_GAP } : { x: size.w + FAN_GAP, y: 0 };
    const pad = 8;
    const occupied = (p: Point) =>
        page.nodes.some(
            nd =>
                !nd.hidden &&
                nd.id !== source.id &&
                !isContainer(nd.shape) &&
                rectsIntersect(
                    {
                        x: p.x - size.w / 2 - pad,
                        y: p.y - size.h / 2 - pad,
                        w: size.w + pad * 2,
                        h: size.h + pad * 2,
                    },
                    nodeBounds(nd)
                )
        );
    for (let i = 0; i < 24 && occupied(at); i++) at = { x: at.x + aside.x, y: at.y + aside.y };
    return at;
}

/**
 * Where a box picked for an arrow dropped at `drop` goes: centred on the
 * drop, but pulled onto the source's centre line when it was let go within
 * `snap` of it, so a nearly-straight arrow comes out straight.
 */
export function placeAtDrop(source: DiagramNode | undefined, drop: Point, snap: number): Point {
    if (!source) return drop;
    const c = nodeCenter(source);
    return {
        x: Math.abs(drop.x - c.x) <= snap ? c.x : drop.x,
        y: Math.abs(drop.y - c.y) <= snap ? c.y : drop.y,
    };
}
