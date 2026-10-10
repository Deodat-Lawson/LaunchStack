import { addChildTopic, applySwatch, insertShape } from "../model/commands";
import { activePage, nodeById } from "../model/doc";
import { contrastRatio, swatchFor, THEME_BY_ID } from "../model/palette";
import { EditorStore } from "../model/store";
import { buildTemplate } from "../model/templates";
import { restyleMovedTopics } from "../model/topicStyle";

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
