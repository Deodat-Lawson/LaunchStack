/** @jest-environment jsdom */

import React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom";

import { createDoc, createNode, createPage } from "../model/factory";
import { EditorStore } from "../model/store";
import { TextEditorOverlay } from "../ui/TextEditorOverlay";
import { EditorProvider } from "../ui/EditorContext";

/**
 * The in-place label editor.
 *
 * The focus assertions here pin the property that failed in the field: a
 * mounted-but-unfocused textarea eats every keystroke silently, because
 * commit rides on blur and a field that never had focus never blurs. jsdom
 * implements focus faithfully enough to assert `document.activeElement`.
 */

function mountWith(nodes: ReturnType<typeof createNode>[]) {
    const doc = createDoc("Test map", [{ ...createPage(), nodes, edges: [] }]);
    const store = new EditorStore(doc);
    const view = render(
        <EditorProvider store={store}>
            <TextEditorOverlay />
        </EditorProvider>
    );
    return { store, view };
}

function field(container: HTMLElement): HTMLTextAreaElement {
    const el = container.querySelector("textarea");
    if (!el) throw new Error("label editor not mounted");
    return el;
}

function pageNodes(store: EditorStore) {
    return store.getState().doc.pages[0]!.nodes;
}

describe("focus", () => {
    it("owns the keyboard the moment editing starts", () => {
        const node = createNode({ shape: "mind-branch", x: 10, y: 10, text: "hello" });
        const { store, view } = mountWith([node]);
        act(() => store.setEditing({ kind: "node", id: node.id }));
        expect(document.activeElement).toBe(field(view.container));
    });

    it("re-takes focus when the field remounts within one session", () => {
        // A gesture can clear `editing` and a dblclick restore it for the same
        // node without the effect deps changing — the remount must focus on
        // its own, not rely on the effect having re-run.
        const node = createNode({ shape: "mind-branch", x: 10, y: 10, text: "hello" });
        const { store, view } = mountWith([node]);
        act(() => store.setEditing({ kind: "node", id: node.id }));
        act(() => store.setEditing(null));
        expect(view.container.querySelector("textarea")).toBeNull();
        act(() => store.setEditing({ kind: "node", id: node.id }));
        expect(document.activeElement).toBe(field(view.container));
    });

    it("moves focus when the edit target changes without a remount", () => {
        const a = createNode({ shape: "mind-branch", x: 10, y: 10, text: "a" });
        const b = createNode({ shape: "mind-branch", x: 300, y: 10, text: "b" });
        const { store, view } = mountWith([a, b]);
        act(() => store.setEditing({ kind: "node", id: a.id }));
        const el = field(view.container);
        el.blur();
        act(() => store.setEditing({ kind: "node", id: b.id }));
        expect(field(view.container).value).toBe("b");
        expect(document.activeElement).toBe(field(view.container));
    });
});

describe("commit", () => {
    it("lands pending text when the session is ended from outside", () => {
        // Clicking the canvas clears `editing` at pointerdown, unmounting the
        // field — and a removed element fires no blur. The typed words must
        // survive that teardown; losing them silently was the bug.
        const node = createNode({ shape: "mind-branch", x: 10, y: 10, text: "old" });
        const { store, view } = mountWith([node]);
        act(() => store.setEditing({ kind: "node", id: node.id }));
        fireEvent.change(field(view.container), { target: { value: "new words" } });
        act(() => store.setEditing(null));
        expect(pageNodes(store).find(n => n.id === node.id)!.text).toBe("new words");
    });

    it("does not re-commit a session that Escape already settled", () => {
        const node = createNode({ shape: "mind-branch", x: 10, y: 10, text: "old" });
        const { store, view } = mountWith([node]);
        act(() => store.setEditing({ kind: "node", id: node.id }));
        fireEvent.change(field(view.container), { target: { value: "discarded" } });
        fireEvent.keyDown(field(view.container), { key: "Escape" });
        expect(pageNodes(store).find(n => n.id === node.id)!.text).toBe("old");
    });
});

describe("text marks", () => {
    it("fits the box to the words on commit", () => {
        const mark = createNode({ shape: "text", x: 10, y: 10, w: 180, h: 44, text: "" });
        const { store, view } = mountWith([mark]);
        act(() => store.setEditing({ kind: "node", id: mark.id }));
        const el = field(view.container);
        fireEvent.change(el, { target: { value: "one\ntwo\nthree\nfour\nfive\nsix" } });
        fireEvent.blur(el);
        const after = pageNodes(store).find(n => n.id === mark.id)!;
        expect(after.text).toBe("one\ntwo\nthree\nfour\nfive\nsix");
        expect(after.h).toBeGreaterThan(44);
    });

    it("does not resize other shapes on commit", () => {
        const box = createNode({ shape: "rectangle", x: 10, y: 10, w: 160, h: 90, text: "" });
        const { store, view } = mountWith([box]);
        act(() => store.setEditing({ kind: "node", id: box.id }));
        const el = field(view.container);
        fireEvent.change(el, { target: { value: "one\ntwo\nthree\nfour\nfive\nsix" } });
        fireEvent.blur(el);
        const after = pageNodes(store).find(n => n.id === box.id)!;
        expect(after.w).toBe(160);
        expect(after.h).toBe(90);
    });

    it("evaporates when committed empty", () => {
        // A bare text mark has no fill and no stroke: an empty one can never
        // be seen or selected again, so nothing may leave one behind.
        const mark = createNode({ shape: "text", x: 10, y: 10, text: "" });
        const { store, view } = mountWith([mark]);
        act(() => store.setEditing({ kind: "node", id: mark.id }));
        fireEvent.blur(field(view.container));
        expect(pageNodes(store).find(n => n.id === mark.id)).toBeUndefined();
    });

    it("evaporates when a fresh one is cancelled", () => {
        const mark = createNode({ shape: "text", x: 10, y: 10, text: "" });
        const { store, view } = mountWith([mark]);
        act(() => store.setEditing({ kind: "node", id: mark.id }));
        fireEvent.keyDown(field(view.container), { key: "Escape" });
        expect(pageNodes(store).find(n => n.id === mark.id)).toBeUndefined();
    });

    it("survives cancel once it has words", () => {
        const mark = createNode({ shape: "text", x: 10, y: 10, text: "keep me" });
        const { store, view } = mountWith([mark]);
        act(() => store.setEditing({ kind: "node", id: mark.id }));
        fireEvent.keyDown(field(view.container), { key: "Escape" });
        const after = pageNodes(store).find(n => n.id === mark.id)!;
        expect(after.text).toBe("keep me");
    });
});
