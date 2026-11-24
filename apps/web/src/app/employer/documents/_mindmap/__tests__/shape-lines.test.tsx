/** @jest-environment jsdom */

import React from "react";
import { render } from "@testing-library/react";

import { applySwatch, insertShape } from "../model/commands";
import { activePage, nodeById } from "../model/doc";
import { drawnInLines, KINDS, kindColours } from "../model/flowchart/look";
import { swatchFor, SWATCH_BY_ID } from "../model/palette";
import { SHAPES, shapeGeometry } from "../model/shapes";
import { EditorStore } from "../model/store";
import { buildTemplate } from "../model/templates";
import type { DiagramKind, DiagramNode, ShapeId } from "../model/types";
import { ShapeView } from "../ui/ShapeView";

/**
 * Every shape in the library, on every kind of board, in both lightings,
 * draws all of its own lines from the moment it is placed — and picking the
 * colour it already has changes nothing at all.
 *
 * Until 2026-11-23 a flowchart box (no outline) drew its inner lines — a
 * database's lid, a class's dividers, an "Or" junction's cross — in its own
 * fill colour, so they vanished, and appeared only once someone picked a
 * colour; a document stack's sheets merged into one blob; and shapes that
 * are their lines (a rule, brackets, a stick figure, a subtopic's underline)
 * were filled as boxes and showed nothing.
 */

const BOARDS: readonly DiagramKind[] = ["flowchart", "board", "mindmap", "freeform"];
const MODES = ["light", "dark"] as const;
/**
 * Placed by clicking a tile, a pen stroke has no points: there is nothing to
 * draw. A group is made from a selection, never placed on its own.
 */
const SKIP: ReadonlySet<ShapeId> = new Set<ShapeId>(["ink", "group"]);
const LIBRARY = SHAPES.filter(s => !SKIP.has(s.id));

function place(kind: DiagramKind, shape: ShapeId, mode: "light" | "dark") {
    const store = new EditorStore(
        buildTemplate(kind === "mindmap" ? "mindmap" : "blank", "D", mode)
    );
    store.update(d => ({ ...d, settings: { ...d.settings, kind } }), { transient: true });
    const id = insertShape(store, shape, { x: 5000, y: 5000 });
    return { store, id };
}

const nodeIn = (store: EditorStore, id: string): DiagramNode =>
    nodeById(activePage(store.getState().doc), id)!;

interface Drawn {
    role: "backing" | "body" | "line";
    fill: string | null;
    stroke: string | null;
    width: number;
}

/** The shape as the canvas draws it: its back sheets, its body, its own lines. */
function draw(node: DiagramNode): { markup: string; paths: Drawn[] } {
    const { container, unmount } = render(
        <svg>
            <ShapeView node={node} idScope="t" />
        </svg>
    );
    const g = container.querySelector("svg > g")!;
    const els = [...g.querySelectorAll(":scope > path")];
    const geo = shapeGeometry(node.shape, node.w, node.h, node.style.radius);
    const backing = geo.backing?.length ?? 0;
    const lines = geo.decorations?.length ?? 0;
    const roleOf = (i: number): Drawn["role"] =>
        i < backing ? "backing" : i >= els.length - lines ? "line" : "body";
    const paths = els.map((p, i) => ({
        role: roleOf(i),
        fill: p.getAttribute("fill"),
        stroke: p.getAttribute("stroke"),
        width: Number(p.getAttribute("stroke-width") ?? 0),
    }));
    const markup = g.outerHTML;
    unmount();
    return { markup, paths };
}

/** Seen against the shape's own fill, at a real width. */
const shows = (p: Drawn, fill: string) =>
    p.stroke !== null && p.stroke !== "none" && p.stroke !== fill && p.width > 0;

function expectEveryLineShows(node: DiagramNode, where: string) {
    const { paths } = draw(node);
    const outlined = paths.some(p => p.role === "body" && shows(p, "none"));
    for (const p of paths) {
        if (p.role === "line") {
            expect([where, "inner line", shows(p, node.style.fill)]).toEqual([
                where,
                "inner line",
                true,
            ]);
        }
        if (p.role === "backing" && !outlined) {
            expect([where, "back sheet", shows(p, node.style.fill)]).toEqual([
                where,
                "back sheet",
                true,
            ]);
        }
    }
}

/** The swatch a freshly placed shape is already painted in, if it is one. */
function ownSwatch(node: DiagramNode, mode: "light" | "dark"): string | null {
    const kinded =
        node.style.strokeWidth === 0 && node.style.fill === kindColours(node.shape, mode).fill;
    if (kinded)
        return KINDS[node.shape]?.hue === "sticky" ? null : (KINDS[node.shape]?.hue ?? "blue");
    for (const id of Object.keys(SWATCH_BY_ID)) {
        const sw = swatchFor(id, mode);
        if (
            node.style.fill === sw.fill &&
            node.style.stroke === sw.stroke &&
            node.textStyle.color === sw.ink
        ) {
            return id;
        }
    }
    return null;
}

describe.each(BOARDS)("every library shape on a %s", kind => {
    describe.each(MODES)("on a %s board", mode => {
        it.each(LIBRARY.map(s => s.id))("%s draws all its lines as placed", shape => {
            const { store, id } = place(kind, shape, mode);
            expectEveryLineShows(nodeIn(store, id), `${kind}/${mode}/${shape} as placed`);
        });

        it.each(LIBRARY.map(s => s.id))(
            "%s: picking the colour it already has changes nothing; another changes only colour",
            shape => {
                const { store, id } = place(kind, shape, mode);
                const made = nodeIn(store, id);
                // A mindmap's topics are painted by their branch, not by a swatch.
                if (kind === "mindmap" && made.shape.startsWith("mind-")) return;
                const own = ownSwatch(made, mode);
                if (own) {
                    store.selectNodes([id]);
                    applySwatch(store, own);
                    expect(draw(nodeIn(store, id)).markup).toBe(draw(made).markup);
                }
                store.selectNodes([id]);
                applySwatch(store, "pink");
                const pink = nodeIn(store, id);
                expectEveryLineShows(pink, `${kind}/${mode}/${shape} recoloured`);
                // Whether it has an outline, and whether it has a fill, are not colours.
                expect(pink.style.strokeWidth).toBe(made.style.strokeWidth);
                expect(pink.style.fill === "none").toBe(made.style.fill === "none");
            }
        );
    });
});

describe("shapes drawn in lines keep their own drawing", () => {
    it.each(["line", "bracket-pair", "uml-actor", "mind-leaf"] as const)(
        "a %s on a flowchart is not dressed as a filled box",
        shape => {
            expect(drawnInLines(shape)).toBe(true);
            const { store, id } = place("flowchart", shape, "light");
            const nd = nodeIn(store, id);
            expect(nd.style.strokeWidth).toBeGreaterThan(0);
            expect(nd.style.fill).not.toBe(kindColours(shape, "light").fill);
        }
    );
});

describe("a box saved before 2026-11-23", () => {
    it.each(["database", "uml-class", "or-junction", "multi-document"] as const)(
        "a %s stored with no outline as stroke none still draws its lines",
        shape => {
            const { store, id } = place("flowchart", shape, "light");
            const stored = nodeIn(store, id);
            // What the 22 Nov look wrote: no outline spelled `stroke: "none"`.
            const old: DiagramNode = {
                ...stored,
                style: { ...stored.style, stroke: "none", strokeWidth: 0 },
            };
            expectEveryLineShows(old, `${shape} stored with stroke none`);
            const lines = draw(old).paths.filter(p => p.role !== "body");
            for (const p of lines) expect(p.stroke).toBe(swatchFor("blue", "light").stroke);
        }
    );
});
