import { addNextStep, insertShape } from "../model/commands";
import { activePage, nodeById } from "../model/doc";
import { nodeCenter } from "../model/geometry";
import { contrastRatio, neutralsFor, type ThemeMode } from "../model/palette";
import { EditorStore } from "../model/store";
import { buildTemplate } from "../model/templates";
import type { DiagramNode, ShapeId } from "../model/types";
import { KINDS, lookC, TEXT_SIZE } from "../variants/c-drop-pick/look";
import {
    closeMenu,
    menuOf,
    menuPicks,
    openAt,
    openFromDrop,
    pick,
    setActive,
} from "../variants/c-drop-pick/menu";
import {
    ALIGN_SNAP,
    alignToSource,
    boxCentre,
    menuSide,
    MIN_GAP,
    PICKS,
    picksFor,
    type PickId,
} from "../variants/c-drop-pick/place";

/**
 * Direction C, "Drop and pick", without a canvas: its look, where a picked
 * box lands, and what a pick (or a dismissal) does to the document. The
 * gestures that open the menu are in `variant-c.render.test.tsx`.
 */

function flowStore(mode: ThemeMode = "light"): EditorStore {
    const store = new EditorStore(buildTemplate("blank", "Flow", mode));
    store.setFlowVariant("c");
    store.setViewport({ x: 0, y: 0, zoom: 1 });
    return store;
}

const page = (store: EditorStore) => activePage(store.getState().doc);
const choice = (id: PickId) => PICKS.find(p => p.id === id)!;

/** A step at the origin: 168 × 64, centre (84, 32). */
function withStep(store: EditorStore): DiagramNode {
    const id = insertShape(store, "process", { x: 84, y: 32 });
    store.setEditing(null);
    return nodeById(page(store), id)!;
}

const KIND_SHAPES = Object.keys(KINDS) as ShapeId[];

describe("variant C: the look", () => {
    it.each(["light", "dark"] as const)(
        "sets every kind's label in its own ink, readable on its fill (%s board)",
        mode => {
            for (const shape of KIND_SHAPES) {
                const look = lookC.boxLook(shape, mode);
                expect(look.text.size).toBe(TEXT_SIZE);
                expect(look.text.bold).toBe(false);
                expect(look.style.stroke).toBe("none");
                expect(look.style.shadow).toBe(true);
                expect(contrastRatio(look.text.color!, look.style.fill!)).toBeGreaterThanOrEqual(
                    4.5
                );
            }
        }
    );

    it("tells the kinds apart by colour", () => {
        const fills = KIND_SHAPES.map(s => lookC.boxLook(s, "light").style.fill);
        expect(new Set(fills).size).toBe(KIND_SHAPES.length);
    });

    it.each(["light", "dark"] as const)("draws arrows the paper can see (%s board)", mode => {
        const edge = lookC.edgeLook(mode);
        expect(edge).toMatchObject({ kind: "curved", endArrow: "arrow" });
        expect(edge.style.strokeWidth).toBe(2);
        expect(contrastRatio(edge.style.stroke!, neutralsFor(mode).paper)).toBeGreaterThanOrEqual(
            3
        );
    });

    it("leaves frames alone but sets their type like every box", () => {
        const look = lookC.boxLook("frame", "light");
        expect(look.style).toEqual({});
        expect(look.text).toEqual({ size: TEXT_SIZE, bold: false });
    });

    it("gives every path the same type: first step, Tab, the menu", () => {
        const store = flowStore();
        const first = withStep(store);
        const tabbedId = addNextStep(store, first.id)!;
        const tabbed = nodeById(page(store), tabbedId)!;
        store.setEditing(null);
        openFromDrop(store, {
            sourceId: first.id,
            port: "s",
            world: { x: 84, y: 300 },
            screen: { x: 84, y: 300 },
        });
        pick(store, choice("decision"));
        const picked = nodeById(page(store), store.selectedNodeIds()[0]!)!;
        for (const box of [first, tabbed, picked]) {
            expect(box.textStyle.size).toBe(TEXT_SIZE);
            expect(box.textStyle.bold).toBe(false);
        }
    });

    it("keeps a box's kind and colour when Tab adds the next one", () => {
        const store = flowStore();
        const data = insertShape(store, "data", { x: 0, y: 0 });
        store.setEditing(null);
        const nextId = addNextStep(store, data)!;
        const next = nodeById(page(store), nextId)!;
        expect(next.shape).toBe("data");
        expect(next.style.fill).toBe(lookC.boxLook("data", "light").style.fill);
    });

    it.each(["rectangle", "rounded-rectangle", "mind-branch"] as const)(
        "gives a plain %s box (rail tool, library) a step's size and colour",
        shape => {
            const store = flowStore();
            const id = insertShape(store, shape, { x: 0, y: 0 });
            const box = nodeById(page(store), id)!;
            expect({ w: box.w, h: box.h }).toEqual(KINDS.process!.size);
            expect(box.style.fill).toBe(lookC.boxLook("process", "light").style.fill);
        }
    );

    it.each(["terminator", "decision"] as const)(
        "makes a Step when Tab follows a %s, not another one",
        shape => {
            const store = flowStore();
            const source = insertShape(store, shape, { x: 0, y: 0 });
            store.setEditing(null);
            const nextId = addNextStep(store, source)!;
            const next = nodeById(page(store), nextId)!;
            expect(next.shape).toBe("process");
            expect(next.style.fill).toBe(lookC.boxLook("process", "light").style.fill);
        }
    );
});

describe("variant C: where a picked box lands (C3)", () => {
    const source = { x: 0, y: 0, w: 168, h: 64, rotation: 0 } as DiagramNode;
    const c = { x: 84, y: 32 };

    it("snaps onto the source's horizontal centre line within 24 screen px", () => {
        expect(alignToSource(source, { x: 400, y: c.y + 18 }, 1)).toEqual({
            x: 400,
            y: c.y,
        });
        expect(alignToSource(source, { x: 400, y: c.y - 24 }, 1).y).toBe(c.y);
    });

    it("snaps onto its vertical centre line too", () => {
        expect(alignToSource(source, { x: c.x - 20, y: 300 }, 1)).toEqual({
            x: c.x,
            y: 300,
        });
    });

    it("leaves a drop further than that where it was let go", () => {
        const at = { x: 400, y: c.y + ALIGN_SNAP + 4 };
        expect(alignToSource(source, at, 1)).toEqual(at);
    });

    it("measures the reach on screen, so zooming in narrows it on the board", () => {
        // 13 board px at 2× is 26 screen px: out of reach.
        expect(alignToSource(source, { x: 400, y: c.y + 13 }, 2).y).toBe(c.y + 13);
        // 8 board px at 2× is 16 screen px: snapped.
        expect(alignToSource(source, { x: 400, y: c.y + 8 }, 2).y).toBe(c.y);
    });

    it("centres the box on the drop point when it is clear of the source", () => {
        const at = { x: 400, y: 32 };
        expect(boxCentre(source, at, { w: 168, h: 64 })).toEqual(at);
    });

    it("slides a box dropped against the source out along the arrow", () => {
        const at = boxCentre(source, { x: 200, y: 32 }, { w: 168, h: 64 });
        expect(at).toEqual({ x: 168 + MIN_GAP + 84, y: 32 });
        const below = boxCentre(source, { x: 84, y: 90 }, { w: 168, h: 104 });
        expect(below).toEqual({ x: 84, y: 64 + MIN_GAP + 52 });
    });
});

describe("variant C: where the menu opens", () => {
    const stage = { w: 1200, h: 700 };
    const size = { w: 300, h: 190 };
    const reach = () => 100;
    const side = (from: { x: number; y: number } | null, at: { x: number; y: number }) =>
        menuSide({ from, at, point: at, stage, size, reach });

    it("opens on past the end of the arrow, clear of it and of the new box", () => {
        expect(side({ x: 100, y: 300 }, { x: 400, y: 300 })).toBe("right");
        expect(side({ x: 600, y: 100 }, { x: 600, y: 300 })).toBe("bottom");
        expect(side({ x: 800, y: 300 }, { x: 500, y: 300 })).toBe("left");
    });

    it("goes beside the new box, not back over the arrow, when there is no room ahead", () => {
        // An arrow pulled up to near the top of the stage.
        expect(side({ x: 600, y: 400 }, { x: 600, y: 150 })).toBe("right");
        // An arrow pulled right to near the right-hand edge.
        expect(side({ x: 500, y: 300 }, { x: 1000, y: 300 })).toBe("bottom");
    });

    it("opens below a double-click, above it near the bottom", () => {
        expect(side(null, { x: 600, y: 200 })).toBe("bottom");
        expect(side(null, { x: 600, y: 600 })).toBe("top");
    });
});

describe("variant C: picking from an arrow let go in space (C1)", () => {
    function dropFrom(store: EditorStore, first: DiagramNode, world = { x: 420, y: 44 }) {
        expect(openFromDrop(store, { sourceId: first.id, port: "e", world, screen: world })).toBe(
            true
        );
    }

    it("offers the five kinds and the arrow on its own", () => {
        const store = flowStore();
        dropFrom(store, withStep(store));
        expect(menuPicks(menuOf(store)!).map(p => p.id)).toEqual([
            "step",
            "decision",
            "terminal",
            "data",
            "note",
            "arrow",
        ]);
    });

    it("puts nothing on the page while the menu is open", () => {
        const store = flowStore();
        const first = withStep(store);
        const before = page(store);
        dropFrom(store, first);
        expect(page(store)).toBe(before);
    });

    it("makes the box, joins it, opens its label — and one undo takes both back", () => {
        const store = flowStore();
        const first = withStep(store);
        const nodesBefore = page(store).nodes.length;
        dropFrom(store, first);
        pick(store, choice("decision"));

        expect(menuOf(store)).toBeNull();
        const made = page(store).nodes.at(-1)!;
        expect(made.shape).toBe("decision");
        // Within reach of the step's centre line: lined up with it.
        expect(nodeCenter(made)).toEqual({ x: 420, y: 32 });
        expect(made.style.fill).toBe(lookC.boxLook("decision", "light").style.fill);
        const edge = page(store).edges.find(e => e.to.nodeId === made.id)!;
        expect(edge.from.nodeId).toBe(first.id);
        expect(edge.kind).toBe("curved");
        expect(store.selectedNodeIds()).toEqual([made.id]);
        expect(store.getState().editing).toEqual({ kind: "node", id: made.id });

        store.setEditing(null);
        store.undo();
        expect(page(store).nodes).toHaveLength(nodesBefore);
        expect(page(store).edges).toHaveLength(0);
    });

    it("picks the highlighted option as moved through", () => {
        const store = flowStore();
        dropFrom(store, withStep(store));
        setActive(store, 4);
        const menu = menuOf(store)!;
        pick(store, menuPicks(menu)[menu.active]!);
        expect(page(store).nodes.at(-1)!.shape).toBe("sticky");
    });

    it("'Just the arrow' leaves an arrow ending at the point, in one step", () => {
        const store = flowStore();
        const first = withStep(store);
        dropFrom(store, first, { x: 300, y: 260 });
        pick(store, choice("arrow"));
        expect(page(store).nodes).toHaveLength(1);
        const [edge] = page(store).edges;
        expect(edge!.from.nodeId).toBe(first.id);
        expect(edge!.to).toEqual({ point: { x: 300, y: 260 } });
        expect(store.getState().selection).toEqual([{ kind: "edge", id: edge!.id }]);
        store.undo();
        expect(page(store).edges).toHaveLength(0);
    });

    it("leaves nothing behind when dismissed", () => {
        const store = flowStore();
        const first = withStep(store);
        const before = store.getState().doc;
        const undoable = store.getState().canUndo;
        dropFrom(store, first);
        closeMenu(store);
        expect(menuOf(store)).toBeNull();
        expect(store.getState().doc).toBe(before);
        expect(store.getState().canUndo).toBe(undoable);
    });

    it("adds nothing if its box went while it was open", () => {
        const store = flowStore();
        const first = withStep(store);
        dropFrom(store, first);
        store.undo();
        pick(store, choice("step"));
        expect(page(store).nodes).toHaveLength(0);
        expect(page(store).edges).toHaveLength(0);
    });
});

describe("variant C: a double-click on empty canvas (C2)", () => {
    it("offers the kinds without 'Just the arrow'", () => {
        const store = flowStore();
        openAt(store, { world: { x: 200, y: 200 }, screen: { x: 200, y: 200 } });
        expect(menuPicks(menuOf(store)!).map(p => p.id)).toEqual(picksFor(false).map(p => p.id));
        expect(picksFor(false).some(p => p.id === "arrow")).toBe(false);
    });

    it("places the pick there, label open, joined to nothing", () => {
        const store = flowStore("dark");
        openAt(store, { world: { x: 200, y: 160 }, screen: { x: 200, y: 160 } });
        pick(store, choice("terminal"));
        const [made] = page(store).nodes;
        expect(made!.shape).toBe("terminator");
        expect(nodeCenter(made!)).toEqual({ x: 200, y: 160 });
        expect(made!.style.fill).toBe(lookC.boxLook("terminator", "dark").style.fill);
        expect(page(store).edges).toHaveLength(0);
        expect(store.getState().editing).toEqual({ kind: "node", id: made!.id });
    });
});
