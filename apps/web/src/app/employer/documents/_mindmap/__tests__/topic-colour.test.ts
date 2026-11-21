import {
    addChildTopic,
    applySwatch,
    insertShape,
    outdentTopic,
    toggleCollapse,
} from "../model/commands";
import { activePage, nodeById } from "../model/doc";
import { contrastRatio, swatchFor, THEME_BY_ID } from "../model/palette";
import { createNodeAt } from "../model/factory";
import { EditorStore } from "../model/store";
import { buildTemplate } from "../model/templates";
import { paintNewTopics, restyleMovedTopics } from "../model/topicStyle";

/**
 * Colour by branch, at the level of the commands people actually use.
 *
 * `theme.test.ts` pins the palette's contract; these pin that every way of
 * adding or recolouring a topic goes through it — the bug class here was
 * never a bad colour in the table, it was a creation path that ignored the
 * table (a violet first branch under a violet root; a pastel box on a dark
 * board).
 */

function blankStore(themeMode: "light" | "dark" = "light"): EditorStore {
    return new EditorStore(buildTemplate("blank", "Map", themeMode));
}

function page(store: EditorStore) {
    return activePage(store.getState().doc);
}

function startMap(store: EditorStore): string {
    const id = insertShape(store, "mind-root", { x: 0, y: 0 }, { w: 210, h: 78 });
    store.setEditing(null);
    return id;
}

describe("a new central topic", () => {
    it.each([
        "default",
        "ocean",
        "sunset",
        "forest",
        "mono",
        "midnight",
        "abyss",
        "ember",
        "pine",
        "carbon",
    ])("is the %s theme's own centre, and its label is readable", themeId => {
        const base = buildTemplate("blank", "Map");
        const store = new EditorStore({
            ...base,
            settings: { ...base.settings, paletteId: themeId },
        });
        const id = startMap(store);
        const root = nodeById(page(store), id)!;
        const theme = THEME_BY_ID[themeId]!;
        expect(root.style.fill).toBe(swatchFor(theme.root, theme.mode).stroke);
        expect(contrastRatio(root.textStyle.color, root.style.fill)).toBeGreaterThanOrEqual(4.5);
    });
});

describe("Tab under the centre", () => {
    it("gives each new main branch a hue no sibling has, and never the centre's", () => {
        const store = blankStore();
        const root = startMap(store);
        const strokes = [1, 2, 3, 4].map(() => {
            const id = addChildTopic(store, root)!;
            store.setEditing(null);
            return nodeById(page(store), id)!.style.stroke;
        });
        expect(new Set(strokes).size).toBe(4);
        const theme = THEME_BY_ID.default!;
        expect(strokes).not.toContain(swatchFor(theme.root, "light").stroke);
        expect(strokes[0]).toBe(swatchFor(theme.cycle[0]!, "light").stroke);
    });

    it("hands out branch hues in the theme's own order, not the factory's placeholder", () => {
        // Forest's hues include the default theme's blue, which every new
        // topic is born wearing; kept, it put blue first (QA, round 2).
        const base = buildTemplate("blank", "Map");
        const store = new EditorStore({
            ...base,
            settings: { ...base.settings, paletteId: "forest" },
        });
        const root = startMap(store);
        const strokes = [1, 2, 3, 4].map(() => {
            const id = addChildTopic(store, root)!;
            store.setEditing(null);
            return nodeById(page(store), id)!.style.stroke;
        });
        expect(strokes).toEqual(THEME_BY_ID.forest!.cycle.map(h => swatchFor(h, "light").stroke));
    });

    it("hands a subtopic its branch's hue and colours the line into it to match", () => {
        const store = blankStore();
        const root = startMap(store);
        const branch = addChildTopic(store, root)!;
        const detail = addChildTopic(store, branch)!;
        const p = page(store);
        expect(nodeById(p, detail)!.style.stroke).toBe(nodeById(p, branch)!.style.stroke);
        const line = p.edges.find(e => e.to.nodeId === detail)!;
        expect(line.style.stroke).toBe(nodeById(p, branch)!.style.stroke);
    });

    it("follows a branch someone recoloured, rather than the theme", () => {
        const store = blankStore();
        const root = startMap(store);
        const branch = addChildTopic(store, root)!;
        store.setEditing(null);
        store.selectNodes([branch]);
        applySwatch(store, "red");
        const detail = addChildTopic(store, branch)!;
        expect(nodeById(page(store), detail)!.style.stroke).toBe(swatchFor("red", "light").stroke);
    });

    it("is a single undo step", () => {
        const store = blankStore();
        const root = startMap(store);
        const before = page(store).nodes.length;
        addChildTopic(store, root);
        store.setEditing(null);
        store.undo();
        expect(page(store).nodes.length).toBe(before);
    });
});

describe("the colour dots", () => {
    it("paint the dark tone on a dark board, not a pale light-board box", () => {
        const store = blankStore("dark");
        const root = startMap(store);
        const branch = addChildTopic(store, root)!;
        store.setEditing(null);
        store.selectNodes([branch]);
        applySwatch(store, "green");
        const nd = nodeById(page(store), branch)!;
        expect(nd.style.fill).toBe(swatchFor("green", "dark").fill);
        expect(nd.style.stroke).toBe(swatchFor("green", "dark").stroke);
    });

    it("recolour a whole branch — its details and their lines — not one box", () => {
        const store = blankStore();
        const root = startMap(store);
        const branch = addChildTopic(store, root)!;
        const detail = addChildTopic(store, branch)!;
        store.setEditing(null);
        store.selectNodes([branch]);
        applySwatch(store, "orange");
        const orange = swatchFor("orange", "light").stroke;
        const p = page(store);
        expect(nodeById(p, detail)!.style.stroke).toBe(orange);
        expect(p.edges.find(e => e.to.nodeId === detail)!.style.stroke).toBe(orange);
        expect(p.edges.find(e => e.to.nodeId === branch)!.style.stroke).toBe(orange);
    });

    it("on the centre recolour the centre alone, not every branch", () => {
        // Its subtree is the whole map; one hue over everything would erase
        // what colour means (QA, 2026-10-11).
        const store = blankStore("dark");
        const root = startMap(store);
        const a = addChildTopic(store, root)!;
        const b = addChildTopic(store, root)!;
        store.setEditing(null);
        const before = [a, b].map(id => nodeById(page(store), id)!.style.stroke);
        store.selectNodes([root]);
        applySwatch(store, "orange");
        expect(nodeById(page(store), root)!.style.fill).toBe(swatchFor("orange", "dark").stroke);
        expect([a, b].map(id => nodeById(page(store), id)!.style.stroke)).toEqual(before);
    });

    it("keep the centre solid and its label readable", () => {
        const store = blankStore();
        const root = startMap(store);
        store.selectNodes([root]);
        applySwatch(store, "amber");
        const nd = nodeById(page(store), root)!;
        expect(nd.style.fill).toBe(swatchFor("amber", "light").stroke);
        expect(contrastRatio(nd.textStyle.color, nd.style.fill)).toBeGreaterThanOrEqual(4.5);
    });
});

describe("moving and folding", () => {
    it("gives an outdented detail a main branch's type, not just its colour", () => {
        const store = blankStore();
        const root = startMap(store);
        const branch = addChildTopic(store, root)!;
        const detail = addChildTopic(store, branch)!;
        store.setEditing(null);
        expect(nodeById(page(store), detail)!.textStyle).toMatchObject({ size: 13.5, bold: false });
        outdentTopic(store, detail);
        expect(nodeById(page(store), detail)!.textStyle).toMatchObject({ size: 15, bold: true });
    });

    it("opens a folded branch before adding a child to it", () => {
        const store = blankStore();
        const root = startMap(store);
        const branch = addChildTopic(store, root)!;
        addChildTopic(store, branch);
        store.setEditing(null);
        toggleCollapse(store, branch);
        expect(nodeById(page(store), branch)!.collapsed).toBe(true);
        addChildTopic(store, branch);
        expect(nodeById(page(store), branch)!.collapsed).toBe(false);
    });
});

describe("paintNewTopics", () => {
    it("letters a topic floating free as the main branch it is drawn as, not as the centre", () => {
        const store = blankStore();
        const node = createNodeAt("mind-branch", { x: 400, y: 400 }, { mode: "light" });
        store.updatePage(p => ({ ...p, nodes: [...p.nodes, node] }), { label: "Add topic" });
        paintNewTopics(store, [node.id]);
        expect(nodeById(page(store), node.id)!.textStyle).toMatchObject({ size: 15, bold: true });
    });
});

describe("a new box's label", () => {
    /** What a topic's label looks like, apart from its colour. */
    const type = (store: EditorStore, id: string) => {
        const { size, bold, family, italic } = nodeById(page(store), id)!.textStyle;
        return { size, bold, family, italic };
    };

    // The report: boxes that look the same — tinted fill, 2px outline — came
    // out bold or regular depending on how they were made. Every way of
    // making a main-branch box must letter it the same.
    it("is the same whichever way a main-branch box is made", () => {
        const store = blankStore();
        const root = startMap(store);
        const viaTab = addChildTopic(store, root)!;
        store.setEditing(null);

        // Topic tool click and the palette's click-to-place.
        const viaTool = insertShape(store, "mind-branch", { x: 600, y: 600 });
        // Double-click on the canvas, a palette drop, a Topic-tool drag.
        const loose = createNodeAt("mind-branch", { x: 900, y: 900 }, { mode: "light" });
        store.updatePage(p => ({ ...p, nodes: [...p.nodes, loose] }), { label: "Add topic" });
        paintNewTopics(store, [loose.id]);

        const expected = type(store, viaTab);
        expect(expected).toMatchObject({ size: 15, bold: true });
        expect(type(store, viaTool)).toEqual(expected);
        expect(type(store, loose.id)).toEqual(expected);
        // And they sit on the same rung of the ladder (hues differ by branch;
        // the 2px main-branch outline does not), so type and look agree.
        const outline = (id: string) => nodeById(page(store), id)!.style.strokeWidth;
        expect(outline(viaTool)).toBe(outline(viaTab));
        expect(outline(loose.id)).toBe(outline(viaTab));
    });

    it("gives a free topic's first child the same type as its parent, not a bolder one", () => {
        const store = blankStore();
        const loose = insertShape(store, "mind-branch", { x: 0, y: 0 });
        const child = addChildTopic(store, loose)!;
        store.setEditing(null);
        expect(type(store, child)).toEqual(type(store, loose));
    });

    it("keeps the centre at 18px bold and a subtopic at 13.5px regular", () => {
        const store = blankStore();
        const root = startMap(store);
        const branch = addChildTopic(store, root)!;
        const detail = addChildTopic(store, branch)!;
        store.setEditing(null);
        expect(type(store, root)).toMatchObject({ size: 18, bold: true });
        expect(type(store, detail)).toMatchObject({ size: 13.5, bold: false });
    });
});

describe("restyleMovedTopics", () => {
    it("folds into the edit before it, so one undo takes both back", () => {
        const store = blankStore();
        const root = startMap(store);
        const branch = addChildTopic(store, root)!;
        store.setEditing(null);
        const before = page(store);
        store.updatePage(
            p => ({ ...p, nodes: p.nodes.map(n => (n.id === branch ? { ...n, text: "x" } : n)) }),
            {
                label: "Rename",
            }
        );
        restyleMovedTopics(store, [branch]);
        store.undo();
        expect(page(store)).toEqual(before);
    });
});
