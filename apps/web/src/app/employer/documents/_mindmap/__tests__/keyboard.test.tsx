/** @jest-environment jsdom */

import React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom";

import { activePage, graphIndex, graphRoots, nodeById, topicParent } from "../model/doc";
import { createDoc, createEdge, createNode, createPage } from "../model/factory";
import { EditorStore } from "../model/store";
import { buildTemplate } from "../model/templates";
import type { DiagramNode, MindmapDoc, ShapeId } from "../model/types";
import { EditorProvider } from "../ui/EditorContext";
import { TextEditorOverlay } from "../ui/TextEditorOverlay";
import { useKeyboard, type KeyboardActions } from "../ui/useKeyboard";

/**
 * The keyboard model, driven the way a person drives it: keys go to whatever
 * has focus — the label field while editing, the page otherwise — and the
 * real window listener and the real field answer them together. That pairing
 * is the point: the bug this replaces was one Enter doing two things, one in
 * each of them.
 */

const onFind = jest.fn();

function KeyboardHost({ store }: { store: EditorStore }) {
    const actions: KeyboardActions = {
        isActive: () => true,
        onSave: () => undefined,
        onFind,
        onCommandPalette: () => undefined,
        onExport: () => undefined,
        onTogglePresent: () => undefined,
        onShowShortcuts: () => undefined,
        // As MindmapEditor wires it.
        onEditSelection: () => {
            const state = store.getState();
            const node = state.selection.find(s => s.kind === "node");
            if (node) store.setEditing({ kind: "node", id: node.id });
            else {
                const edge = state.selection.find(s => s.kind === "edge");
                if (edge) store.setEditing({ kind: "edge-label", id: edge.id, index: 0 });
            }
        },
        getViewportSize: () => ({ w: 1200, h: 800 }),
    };
    useKeyboard(store, actions);
    return null;
}

function mount(doc: MindmapDoc) {
    const store = new EditorStore(doc);
    const view = render(
        <EditorProvider store={store}>
            <TextEditorOverlay />
            <KeyboardHost store={store} />
        </EditorProvider>
    );
    return { store, view };
}

/** A key pressed wherever focus is. Returns false when it was default-prevented. */
function press(key: string, init: Partial<KeyboardEventInit> = {}): boolean {
    const target = document.activeElement ?? document.body;
    return fireEvent.keyDown(target, { key, ...init });
}

function field(): HTMLTextAreaElement {
    const el = document.querySelector<HTMLTextAreaElement>("textarea[data-mindmap-editor]");
    if (!el) throw new Error("label editor not mounted");
    return el;
}

function type(text: string) {
    fireEvent.change(field(), { target: { value: text } });
}

const page = (store: EditorStore) => activePage(store.getState().doc);
const count = (store: EditorStore) => page(store).nodes.length;
const children = (store: EditorStore, id: string) => graphIndex(page(store)).out.get(id) ?? [];
const textOf = (store: EditorStore, id: string) => nodeById(page(store), id)!.text;

function topic(id: string, shape: ShapeId, x: number, y: number): DiagramNode {
    return { ...createNode({ shape, x, y, w: 150, h: 48, text: id }), id };
}

/** Centre R with A, B, C to its right; A has A1. Laid out by hand. */
function smallMap(extra: DiagramNode[] = []): MindmapDoc {
    const nodes = [
        { ...topic("R", "mind-root", 0, 0), w: 200, h: 80 },
        topic("A", "mind-branch", 300, -100),
        topic("B", "mind-branch", 300, 16),
        topic("C", "mind-branch", 300, 132),
        topic("A1", "mind-leaf", 520, -100),
        ...extra,
    ];
    const link = (a: string, b: string) => createEdge({ from: { nodeId: a }, to: { nodeId: b } });
    const edges = [link("R", "A"), link("A", "A1"), link("R", "B"), link("R", "C")];
    return createDoc("Map", [{ ...createPage(), nodes, edges }]);
}

afterEach(() => {
    onFind.mockReset();
    // Leave no field focused for the next test's `press`.
    (document.activeElement as HTMLElement | null)?.blur?.();
});

describe("Enter while typing", () => {
    it.each<[string, ShapeId]>([
        ["a topic", "mind-branch"],
        ["the centre", "mind-root"],
        ["a sticky note", "sticky"],
        ["a flowchart box", "rectangle"],
    ])("finishes the label on %s and creates nothing", (_name, shape) => {
        const node = { ...createNode({ shape, x: 0, y: 0, text: "old" }), id: "n" };
        const { store } = mount(createDoc("Map", [{ ...createPage(), nodes: [node] }]));
        act(() => {
            store.selectNodes(["n"]);
            store.setEditing({ kind: "node", id: "n" });
        });
        type("Budget");
        const prevented = !press("Enter");

        expect(prevented).toBe(true);
        expect(count(store)).toBe(1);
        expect(textOf(store, "n")).toBe("Budget");
        expect(store.getState().editing).toBeNull();
        expect(store.selectedNodeIds()).toEqual(["n"]);
    });

    it("then a second Enter adds the sibling right after it, ready to type", () => {
        const { store } = mount(smallMap());
        act(() => {
            store.selectNodes(["A"]);
            store.setEditing({ kind: "node", id: "A" });
        });
        type("Budget");
        press("Enter");
        expect(count(store)).toBe(5);

        press("Enter");
        expect(count(store)).toBe(6);
        const next = store.getState().editing!.id;
        expect(children(store, "R")).toEqual(["A", next, "B", "C"]);
        expect(document.activeElement).toBe(field());

        type("Timeline");
        press("Enter");
        expect(textOf(store, "A")).toBe("Budget");
        expect(textOf(store, next)).toBe("Timeline");
    });

    it("selects the topic it finished, even if something cleared the selection", () => {
        const { store } = mount(smallMap());
        act(() => store.setEditing({ kind: "node", id: "B" }));
        press("Enter");
        expect(store.selectedNodeIds()).toEqual(["B"]);
    });

    it("leaves ⇧Enter to the field as a newline", () => {
        const { store } = mount(smallMap());
        act(() => store.setEditing({ kind: "node", id: "A" }));
        expect(press("Enter", { shiftKey: true })).toBe(true);
        expect(store.getState().editing).not.toBeNull();
        expect(count(store)).toBe(5);
    });

    it("inserts a newline at the caret on ⌥Enter", () => {
        const { store } = mount(smallMap());
        act(() => store.setEditing({ kind: "node", id: "A" }));
        type("onetwo");
        field().setSelectionRange(3, 3);
        expect(press("Enter", { altKey: true })).toBe(false);
        expect(field().value).toBe("one\ntwo");
        expect(field().selectionStart).toBe(4);
        expect(store.getState().editing).not.toBeNull();
    });

    it("lets an IME confirm its word with Enter", () => {
        const { store } = mount(smallMap());
        act(() => store.setEditing({ kind: "node", id: "A" }));
        press("Enter", { isComposing: true });
        expect(store.getState().editing).not.toBeNull();
    });
});

describe("Tab while typing", () => {
    it("commits and adds a child", () => {
        const { store } = mount(smallMap());
        act(() => store.setEditing({ kind: "node", id: "B" }));
        type("Budget");
        press("Tab");
        const child = store.getState().editing!.id;
        expect(textOf(store, "B")).toBe("Budget");
        expect(children(store, "B")).toEqual([child]);
    });

    it("commits and outdents on ⇧Tab", () => {
        const { store } = mount(smallMap());
        act(() => store.setEditing({ kind: "node", id: "A1" }));
        type("Moved");
        press("Tab", { shiftKey: true });
        expect(textOf(store, "A1")).toBe("Moved");
        expect(children(store, "R")).toEqual(["A", "A1", "B", "C"]);
        expect(store.getState().editing).toBeNull();
        expect(store.selectedNodeIds()).toEqual(["A1"]);
    });
});

describe("Enter and Tab on a selection", () => {
    it("Enter on a topic adds a sibling after it; ⇧Enter before it", () => {
        const { store } = mount(smallMap());
        act(() => store.selectNodes(["B"]));
        press("Enter");
        const after = store.getState().editing!.id;
        expect(children(store, "R")).toEqual(["A", "B", after, "C"]);

        press("Escape");
        act(() => store.selectNodes(["B"]));
        press("Enter", { shiftKey: true });
        const before = store.getState().editing!.id;
        expect(children(store, "R")).toEqual(["A", before, "B", after, "C"]);
    });

    it("Enter on the centre adds a child, never a second centre", () => {
        const { store } = mount(smallMap());
        act(() => store.selectNodes(["R"]));
        press("Enter");
        const id = store.getState().editing!.id;
        expect(topicParent(page(store), id)).toBe("R");
        expect(graphRoots(page(store))).toHaveLength(1);
    });

    it("Enter on any other shape opens its text and creates nothing", () => {
        const box = { ...createNode({ shape: "rectangle", x: 0, y: 400 }), id: "box" };
        const { store } = mount(smallMap([box]));
        act(() => store.selectNodes(["box"]));
        press("Enter");
        expect(store.getState().editing).toEqual({ kind: "node", id: "box" });
        expect(count(store)).toBe(6);
    });

    it("⇧Tab outdents a topic, and does nothing to a child of the centre", () => {
        const { store } = mount(smallMap());
        act(() => store.selectNodes(["A1"]));
        press("Tab", { shiftKey: true });
        expect(topicParent(page(store), "A1")).toBe("R");

        const before = page(store);
        act(() => store.selectNodes(["B"]));
        press("Tab", { shiftKey: true });
        expect(page(store)).toBe(before);
        expect(count(store)).toBe(5);
    });

    it("⌘Enter edits the selection", () => {
        const { store } = mount(smallMap());
        act(() => store.selectNodes(["B"]));
        expect(press("Enter", { metaKey: true })).toBe(false);
        expect(store.getState().editing).toEqual({ kind: "node", id: "B" });
        expect(count(store)).toBe(5);
    });
});

describe("arrows", () => {
    it("walk between topics", () => {
        const { store } = mount(smallMap());
        act(() => store.selectNodes(["R"]));
        press("ArrowRight");
        expect(store.selectedNodeIds()).toEqual(["B"]);
        press("ArrowUp");
        expect(store.selectedNodeIds()).toEqual(["A"]);
        press("ArrowRight");
        expect(store.selectedNodeIds()).toEqual(["A1"]);
        // Nothing further right: stay put.
        press("ArrowRight");
        expect(store.selectedNodeIds()).toEqual(["A1"]);
        // And nothing moved.
        expect(nodeById(page(store), "A1")!.x).toBe(520);
    });

    it("nudge a topic with ⌥, five steps with ⇧⌥", () => {
        const { store } = mount(smallMap());
        const grid = store.getState().doc.settings.gridSize;
        act(() => store.selectNodes(["B"]));
        press("ArrowRight", { altKey: true });
        expect(nodeById(page(store), "B")!.x).toBe(300 + grid);
        press("ArrowDown", { altKey: true, shiftKey: true });
        expect(nodeById(page(store), "B")!.y).toBe(16 + grid * 5);
        expect(store.selectedNodeIds()).toEqual(["B"]);
    });

    it("still nudge anything that is not a single topic", () => {
        const box = { ...createNode({ shape: "rectangle", x: 0, y: 400 }), id: "box" };
        const { store } = mount(smallMap([box]));
        const grid = store.getState().doc.settings.gridSize;
        act(() => store.selectNodes(["box"]));
        press("ArrowLeft");
        expect(nodeById(page(store), "box")!.x).toBe(-grid);

        act(() => store.selectNodes(["A", "B"]));
        press("ArrowUp");
        expect(nodeById(page(store), "A")!.y).toBe(-100 - grid);
        expect(nodeById(page(store), "B")!.y).toBe(16 - grid);
    });

    it("⌘↑ / ⌘↓ move a topic among its siblings", () => {
        const { store } = mount(smallMap());
        act(() => store.selectNodes(["C"]));
        press("ArrowUp", { metaKey: true });
        expect(children(store, "R")).toEqual(["A", "C", "B"]);
        press("ArrowDown", { ctrlKey: true });
        expect(children(store, "R")).toEqual(["A", "B", "C"]);
        expect(store.historyLabels().undo).toBe("Reorder topic");
    });
});

describe("folding and finding", () => {
    it("⌘/ folds and unfolds the selected branch; bare / is still Find", () => {
        const { store } = mount(smallMap());
        act(() => store.selectNodes(["A"]));
        press("/", { metaKey: true });
        expect(nodeById(page(store), "A")!.collapsed).toBe(true);
        press("/", { ctrlKey: true });
        expect(nodeById(page(store), "A")!.collapsed).toBe(false);
        expect(onFind).not.toHaveBeenCalled();

        press("/");
        expect(onFind).toHaveBeenCalledTimes(1);
        expect(store.getState().editing).toBeNull();
    });
});

describe("Delete", () => {
    it("takes a topic's branch and selects its parent", () => {
        const { store } = mount(smallMap());
        act(() => store.selectNodes(["A"]));
        press("Delete");
        expect(nodeById(page(store), "A")).toBeUndefined();
        expect(nodeById(page(store), "A1")).toBeUndefined();
        expect(store.selectedNodeIds()).toEqual(["R"]);
        // Keyboard flow carries on from the parent.
        press("Enter");
        expect(topicParent(page(store), store.getState().editing!.id)).toBe("R");
    });

    it("keeps the children with ⌥", () => {
        const { store } = mount(smallMap());
        act(() => store.selectNodes(["A"]));
        press("Backspace", { altKey: true });
        expect(nodeById(page(store), "A")).toBeUndefined();
        expect(children(store, "R")).toEqual(["A1", "B", "C"]);
    });

    it("removes only the selected box from a flowchart", () => {
        const box = (id: string, x: number) => ({
            ...createNode({ shape: "rectangle", x, y: 0 }),
            id,
        });
        const link = (a: string, b: string) =>
            createEdge({ from: { nodeId: a }, to: { nodeId: b } });
        const { store } = mount(
            createDoc("Flow", [
                {
                    ...createPage(),
                    nodes: [box("a", 0), box("b", 200), box("c", 400)],
                    edges: [link("a", "b"), link("b", "c")],
                },
            ])
        );
        act(() => store.selectNodes(["b"]));
        press("Delete");
        expect(page(store).nodes.map(n => n.id)).toEqual(["a", "c"]);
        expect(store.getState().selection).toEqual([]);
    });
});

describe("typing on a selection", () => {
    it("replaces the label with the keystroke, leaving the key to reach the field", async () => {
        const { store } = mount(smallMap());
        act(() => store.selectNodes(["B"]));
        // Not default-prevented: in a browser the character is delivered
        // into the field that mounted and took focus during this keydown.
        expect(press("x")).toBe(true);
        expect(store.getState().editing).toEqual({ kind: "node", id: "B", seed: "x" });
        expect(field().value).toBe("x");
        expect(document.activeElement).toBe(field());
        // The seed is selected, so a delivered "x" replaces it, not doubles it.
        expect([field().selectionStart, field().selectionEnd]).toEqual([0, 1]);

        // Nothing was delivered (jsdom): a frame later the caret moves past
        // the seed, so the next key extends the word.
        await act(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
        expect([field().selectionStart, field().selectionEnd]).toEqual([1, 1]);

        type("xylophone");
        press("Enter");
        expect(textOf(store, "B")).toBe("xylophone");
        expect(count(store)).toBe(5);
    });

    it("works on any shape that holds text", () => {
        const sticky = { ...createNode({ shape: "sticky", x: 0, y: 400, text: "old" }), id: "s" };
        const { store } = mount(smallMap([sticky]));
        act(() => store.selectNodes(["s"]));
        press("Q", { shiftKey: true });
        expect(field().value).toBe("Q");
    });

    it("leaves tool letters alone when no single text shape is selected", () => {
        const image = { ...createNode({ shape: "image", x: 0, y: 400 }), id: "img" };
        const { store } = mount(smallMap([image]));
        press("r");
        expect(store.getState().tool).toBe("shape");
        expect(store.getState().pendingShape).toBe("rectangle");

        act(() => store.selectNodes(["A", "B"]));
        press("v");
        expect(store.getState().tool).toBe("select");
        expect(store.getState().editing).toBeNull();

        act(() => store.selectNodes(["img"]));
        press("t");
        expect(store.getState().tool).toBe("text");
        expect(store.getState().editing).toBeNull();
    });

    it("never starts on Space, a modifier chord, or a locked shape", () => {
        const locked = {
            ...createNode({ shape: "rectangle", x: 0, y: 400 }),
            id: "lk",
            locked: true,
        };
        const { store } = mount(smallMap([locked]));
        act(() => store.selectNodes(["B"]));
        press(" ");
        press("a", { altKey: true });
        expect(store.getState().editing).toBeNull();

        act(() => store.selectNodes(["lk"]));
        press("n");
        expect(store.getState().editing).toBeNull();
        expect(store.getState().tool).toBe("sticky");
    });
});

describe("a label whose field lost focus", () => {
    it("pulls focus back into the field on the next character", () => {
        const { store } = mount(smallMap());
        // The field mounts but never gets focus — the failure this guards.
        const focus = jest
            .spyOn(HTMLElement.prototype, "focus")
            .mockImplementation(() => undefined);
        act(() => store.setEditing({ kind: "node", id: "B" }));
        focus.mockRestore();
        expect(document.activeElement).not.toBe(field());

        const delivered = press("k");
        expect(delivered).toBe(true);
        expect(document.activeElement).toBe(field());
        expect(field().selectionStart).toBe(field().value.length);
        expect(store.getState().editing).toEqual({ kind: "node", id: "B" });
    });

    it("finishes the label on Enter from outside the field", () => {
        const { store } = mount(smallMap());
        const focus = jest
            .spyOn(HTMLElement.prototype, "focus")
            .mockImplementation(() => undefined);
        act(() => store.setEditing({ kind: "node", id: "B" }));
        focus.mockRestore();
        fireEvent.change(field(), { target: { value: "Kept" } });

        act(() => {
            press("Enter");
        });
        expect(store.getState().editing).toBeNull();
        expect(textOf(store, "B")).toBe("Kept");
        expect(count(store)).toBe(5);
    });
});

describe("the demo path", () => {
    it("centre → Tab → Budget, Enter, Enter → Timeline makes two ordered branches", () => {
        const { store } = mount(buildTemplate("blank", "Plan"));
        const root = createNode({ shape: "mind-root", x: 0, y: 0, w: 210, h: 78 });
        act(() => {
            store.updatePage(p => ({ ...p, nodes: [root] }));
            store.selectNodes([root.id]);
        });
        press("Tab");
        type("Budget");
        press("Enter");
        press("Enter");
        type("Timeline");
        press("Escape");

        const kids = children(store, root.id).map(id => textOf(store, id));
        expect(kids).toEqual(["Budget", "Timeline"]);
        expect(count(store)).toBe(3);
    });
});
