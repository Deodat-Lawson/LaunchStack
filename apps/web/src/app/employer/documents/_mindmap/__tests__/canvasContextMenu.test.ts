import { EditorStore } from "../model/store";
import { buildTemplate } from "../model/templates";
import { activePage, graphIndex } from "../model/doc";
import { buildCanvasMenuItems } from "../ui/canvasContextMenu";
import type { ActionMenuItem } from "~/components/ui/action-menu";

/**
 * The right-click menu at both chrome depths. Built as data, so this needs
 * no portal: select a topic, ask for the menu, read the ids.
 */

function ids(items: ActionMenuItem[]): string[] {
    return items.filter(i => i.type !== "separator").map(i => i.id);
}

function submenu(items: ActionMenuItem[], id: string): ActionMenuItem[] {
    const found = items.find(i => i.id === id);
    if (!found || found.type !== "submenu") throw new Error(`no submenu ${id}`);
    return found.items;
}

function storeWithRootSelected(templateId: string) {
    const store = new EditorStore(buildTemplate(templateId, "Menu"));
    const page = activePage(store.getState().doc);
    // The template's first node is its centre / first shape.
    store.selectNodes([page.nodes[0]!.id]);
    return store;
}

describe("canvas context menu", () => {
    test("everything depth is the full menu, unchanged", () => {
        const store = storeWithRootSelected("mindmap");
        store.setChromeDepth("everything");
        const menu = buildCanvasMenuItems(store);
        expect(ids(menu)).toEqual(
            expect.arrayContaining([
                "cut",
                "copy",
                "add-child",
                "colour",
                "shape",
                "order",
                "select-connected",
            ])
        );
        expect(ids(menu)).not.toContain("more");
    });

    test("focus depth on a mindmap leads with the topic verbs and folds the rest", () => {
        const store = storeWithRootSelected("mindmap");
        store.setChromeDepth("focus");
        const menu = buildCanvasMenuItems(store);

        // The centre has no siblings: Enter on it adds a child, so the menu
        // does not offer a sibling it would not make.
        expect(ids(menu)).toEqual([
            "add-child",
            "colour",
            "collapse",
            "duplicate",
            "delete",
            "more",
        ]);
        // Nothing is lost: what left the top level is under More, once.
        const more = ids(submenu(menu, "more"));
        expect(more).toEqual(
            expect.arrayContaining([
                "cut",
                "copy",
                "shape",
                "order",
                "group",
                "lock",
                "select-connected",
            ])
        );
        for (const promoted of ["add-child", "colour", "collapse", "duplicate", "delete"]) {
            expect(more).not.toContain(promoted);
        }
        // "Delete and reconnect" would split the map into one centre per
        // branch, so the centre does not offer it anywhere.
        expect([...ids(menu), ...more]).not.toContain("delete-reconnect");
    });

    test("a branch topic offers a sibling, and every hint names the key that does it", () => {
        const store = new EditorStore(buildTemplate("mindmap", "Menu"));
        const page = activePage(store.getState().doc);
        const branch = graphIndex(page).out.get(page.nodes[0]!.id)![0]!;
        store.selectNodes([branch]);
        store.setChromeDepth("focus");
        const menu = buildCanvasMenuItems(store);
        expect(ids(menu).slice(0, 2)).toEqual(["add-child", "add-sibling"]);

        const shortcut = (items: ActionMenuItem[], id: string) => {
            const item = items.find(i => i.id === id);
            return item?.type === "item" ? item.shortcut : undefined;
        };
        expect(shortcut(menu, "add-child")).toBe("⇥");
        expect(shortcut(menu, "add-sibling")).toBe("↩");
        expect(shortcut(menu, "delete")).toBe("⌫");
        expect(shortcut(menu, "collapse")).toBe("⌘/");
        expect(shortcut(submenu(menu, "more"), "delete-reconnect")).toBe("⌥⌫");
        // Delete on a topic already takes its branch; no second item for it.
        expect(ids(submenu(menu, "more"))).not.toContain("delete-branch");
    });

    test("the menu's Delete is the Delete key: a topic goes with its branch", () => {
        const store = new EditorStore(buildTemplate("mindmap", "Menu"));
        const page = activePage(store.getState().doc);
        const idx = graphIndex(page);
        const branch = idx.out.get(page.nodes[0]!.id)!.find(id => (idx.out.get(id) ?? []).length)!;
        const below = idx.out.get(branch)!;
        store.selectNodes([branch]);
        const del = buildCanvasMenuItems(store).find(i => i.id === "delete");
        if (del?.type === "item") del.onSelect();
        const after = activePage(store.getState().doc);
        for (const id of [branch, ...below]) expect(after.nodes.some(n => n.id === id)).toBe(false);
    });

    test("focus depth on a flowchart leads with shape, not topic", () => {
        const store = storeWithRootSelected("flowchart");
        store.setChromeDepth("focus");
        const menu = buildCanvasMenuItems(store);
        const top = ids(menu);
        expect(top[0]).toBe("shape");
        expect(top).not.toContain("add-sibling");
        const connected = menu.find(i => i.id === "add-child");
        expect(connected?.type === "item" ? connected.label : null).toBe("Add connected shape");
    });

    test("focus depth with nothing selected is the short paste/layout menu", () => {
        const store = new EditorStore(buildTemplate("mindmap", "Menu"));
        store.setChromeDepth("focus");
        expect(ids(buildCanvasMenuItems(store))).toEqual(["paste", "layout"]);
    });

    test("the workspace's Ask verb stays at the top level in focus", () => {
        const store = storeWithRootSelected("mindmap");
        store.setChromeDepth("focus");
        const onAskAboutNode = jest.fn();
        const menu = buildCanvasMenuItems(store, { onAskAboutNode });
        expect(ids(menu)[0]).toBe("ask");
        const ask = menu[0]!;
        if (ask.type === "item") ask.onSelect();
        expect(onAskAboutNode).toHaveBeenCalledWith("Central idea");
    });
});
