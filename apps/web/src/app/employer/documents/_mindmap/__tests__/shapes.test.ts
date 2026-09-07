import {
    SHAPES,
    SHAPE_BY_ID,
    SHAPE_CATEGORIES,
    isContainer,
    searchShapes,
    shapeDef,
    shapeGeometry,
    shapePorts,
    shapeTextBox,
} from "../model/shapes";
import type { ShapeId } from "../model/types";

/**
 * The registry is the contract between the canvas, the palette and the export
 * path. These tests assert the properties all three rely on rather than the
 * exact path strings, which are allowed to change.
 */

describe("registry integrity", () => {
    it("has unique ids", () => {
        const ids = SHAPES.map(s => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("assigns every shape to a listed category", () => {
        for (const shape of SHAPES) {
            expect(SHAPE_CATEGORIES).toContain(shape.category);
        }
    });

    it("gives every category at least one shape", () => {
        for (const category of SHAPE_CATEGORIES) {
            expect(SHAPES.some(s => s.category === category)).toBe(true);
        }
    });

    it("declares a usable default and minimum size", () => {
        for (const shape of SHAPES) {
            expect(shape.defaultSize.w).toBeGreaterThan(0);
            expect(shape.defaultSize.h).toBeGreaterThan(0);
            expect(shape.minSize.w).toBeGreaterThan(0);
            expect(shape.minSize.h).toBeGreaterThan(0);
            expect(shape.defaultSize.w).toBeGreaterThanOrEqual(shape.minSize.w);
            expect(shape.defaultSize.h).toBeGreaterThanOrEqual(shape.minSize.h);
        }
    });
});

/**
 * `text` and `ink` deliberately generate no outline: the first is pure type,
 * the second draws from its own recorded points. Every other shape must put
 * something on the canvas.
 */
const PATHLESS: readonly ShapeId[] = ["text", "ink"];

describe("geometry generation", () => {
    it("produces finite path data for every shape at several sizes", () => {
        const sizes: [number, number][] = [
            [10, 10],
            [160, 90],
            [640, 480],
        ];
        for (const shape of SHAPES) {
            for (const [w, h] of sizes) {
                const geometry = shapeGeometry(shape.id, w, h, 8);
                const paths = [
                    geometry.path,
                    ...(geometry.backing ?? []),
                    ...(geometry.decorations ?? []),
                ];
                for (const d of paths) {
                    expect(d).not.toMatch(/NaN|Infinity|undefined/);
                }
                const hasInk = paths.some(d => d.length > 0);
                expect({ shape: shape.id, hasInk }).toEqual({
                    shape: shape.id,
                    hasInk: !PATHLESS.includes(shape.id),
                });
            }
        }
    });

    it("never produces a zero-size path even for a degenerate box", () => {
        const geometry = shapeGeometry("rectangle", 0, 0);
        expect(geometry.path).not.toMatch(/NaN/);
    });
});

describe("text boxes", () => {
    it("stays inside the shape for the common shapes", () => {
        const inside: ShapeId[] = [
            "rectangle",
            "rounded-rectangle",
            "process",
            "decision",
            "sticky",
            "mind-branch",
            "uml-class",
        ];
        for (const id of inside) {
            const box = shapeTextBox(id, 200, 120);
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.y).toBeGreaterThanOrEqual(0);
            expect(box.x + box.w).toBeLessThanOrEqual(200);
            expect(box.y + box.h).toBeLessThanOrEqual(120);
        }
    });

    it("puts the actor's label below the figure", () => {
        const box = shapeTextBox("uml-actor", 80, 130);
        expect(box.y).toBeGreaterThanOrEqual(130);
    });

    it("never returns a negative size", () => {
        for (const shape of SHAPES) {
            const box = shapeTextBox(shape.id, 4, 4);
            expect(box.w).toBeGreaterThanOrEqual(0);
            expect(box.h).toBeGreaterThanOrEqual(0);
        }
    });
});

describe("lookups", () => {
    it("degrades an unknown id to a rectangle instead of throwing", () => {
        expect(shapeDef("not-a-shape").id).toBe("rectangle");
        expect(() => shapeGeometry("not-a-shape", 10, 10)).not.toThrow();
    });

    it("indexes every shape by id", () => {
        for (const shape of SHAPES) {
            expect(SHAPE_BY_ID[shape.id]).toBe(shape);
        }
    });

    it("defaults to the four cardinal ports", () => {
        expect(shapePorts("diamond")).toEqual(["n", "e", "s", "w"]);
        expect(shapePorts("rectangle")).toHaveLength(8);
    });

    it("marks containers", () => {
        expect(isContainer("frame")).toBe(true);
        expect(isContainer("group")).toBe(true);
        expect(isContainer("rectangle")).toBe(false);
    });
});

describe("search", () => {
    it("returns every offered shape for an empty query", () => {
        expect(searchShapes("  ")).toHaveLength(SHAPES.filter(s => !s.paletteHidden).length);
    });

    it("matches on keywords, not just names", () => {
        const hits = searchShapes("cylinder").map(s => s.id);
        // The cylinder tile is gone; its name is a keyword on Database.
        expect(hits).toContain("database");
    });

    it("matches case-insensitively", () => {
        expect(searchShapes("DECISION").map(s => s.id)).toContain("diamond");
    });
});

describe("the offered palette", () => {
    const offered = SHAPES.filter(s => !s.paletteHidden);
    const hidden = SHAPES.filter(s => s.paletteHidden);

    it("never offers two tiles with the same silhouette in the Standard group", () => {
        // The regression this guards: "Basic" and "Flowchart" used to offer
        // identical outlines under different names (diamond ≡ decision,
        // cylinder ≡ database), which made the library read as padded.
        const seen = new Map<string, string>();
        for (const shape of offered.filter(s => s.category === "Standard")) {
            const g = shapeGeometry(shape.id, shape.defaultSize.w, shape.defaultSize.h, 0);
            if (!g.path && !g.decorations?.length) continue; // pure text marks
            const signature = [g.path, ...(g.decorations ?? []), ...(g.backing ?? [])].join("|");
            const prior = seen.get(signature);
            expect(prior ? `${prior} ≡ ${shape.id}` : shape.id).toBe(shape.id);
            seen.set(signature, shape.id);
        }
    });

    it("keeps every hidden duplicate reachable by its old name", () => {
        for (const dupe of hidden) {
            // Searching "decision" must offer the diamond, not nothing.
            expect(searchShapes(dupe.name).length).toBeGreaterThan(0);
        }
    });

    it("still resolves hidden ids, so existing documents render unchanged", () => {
        for (const dupe of hidden) {
            expect(shapeDef(dupe.id).id).toBe(dupe.id);
        }
    });
});
