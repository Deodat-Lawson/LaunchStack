import { createDoc, createNode, createPage } from "../model/factory";
import { EditorStore } from "../model/store";
import type { MindmapDoc } from "../model/types";

function docWithNode(): MindmapDoc {
    const node = createNode({ shape: "rectangle", x: 0, y: 0, w: 100, h: 60 });
    return createDoc("Test", [{ ...createPage(), nodes: [node], edges: [] }]);
}

function newStore(): EditorStore {
    return new EditorStore(docWithNode());
}

function firstNodeId(store: EditorStore): string {
    return store.getState().doc.pages[0]!.nodes[0]!.id;
}

describe("subscription", () => {
    it("notifies subscribers on change and stops after unsubscribe", () => {
        const store = newStore();
        let calls = 0;
        const off = store.subscribe(() => {
            calls += 1;
        });
        store.setTool("hand");
        expect(calls).toBe(1);
        off();
        store.setTool("select");
        expect(calls).toBe(1);
    });

    it("hands out a new state object per change, for identity comparison", () => {
        const store = newStore();
        const before = store.getState();
        store.setTool("hand");
        expect(store.getState()).not.toBe(before);
    });
});

describe("commitId", () => {
    const commit = (store: EditorStore) => store.getState().commitId;

    it("ticks once for an ordinary committed edit", () => {
        const store = newStore();
        const before = commit(store);
        store.update(doc => ({ ...doc, title: "Renamed" }));
        expect(commit(store)).toBe(before + 1);
    });

    it("stays put through the preview frames of a gesture", () => {
        const store = newStore();
        const id = firstNodeId(store);
        store.beginInteraction("Move");
        const before = commit(store);

        // Sixty frames of a drag: the panels must sleep through all of them.
        for (let i = 1; i <= 60; i++) {
            store.updatePage(
                p => ({
                    ...p,
                    nodes: p.nodes.map(n => (n.id === id ? { ...n, x: i } : n)),
                }),
                { transient: true }
            );
        }

        expect(commit(store)).toBe(before);
    });

    it("ticks once when the gesture commits, so the panels catch up", () => {
        const store = newStore();
        const id = firstNodeId(store);
        store.beginInteraction("Move");
        const before = commit(store);

        store.updatePage(
            p => ({ ...p, nodes: p.nodes.map(n => (n.id === id ? { ...n, x: 999 } : n)) }),
            { transient: true }
        );
        store.endInteraction();

        // Without this the outline and the inspector would show the shape at
        // its pre-drag position for the rest of the session.
        expect(commit(store)).toBe(before + 1);
        expect(store.getState().doc.pages[0]!.nodes[0]!.x).toBe(999);
    });

    it("does not tick when a gesture changed nothing", () => {
        const store = newStore();
        store.beginInteraction("Move");
        const before = commit(store);
        store.endInteraction();
        expect(commit(store)).toBe(before);
    });

    it("ticks for a transient write made outside a gesture", () => {
        // `transient` means "no undo entry", and switching page uses it. That
        // is not a preview frame — nothing will commit behind it — so it has
        // to commit immediately or the page tabs never update.
        const store = newStore();
        const before = commit(store);

        store.update(doc => ({ ...doc, title: "Settings changed" }), { transient: true });

        expect(commit(store)).toBe(before + 1);
    });

    it("ticks when a cancelled gesture restores the document", () => {
        const store = newStore();
        const id = firstNodeId(store);
        store.beginInteraction("Move");
        store.updatePage(
            p => ({ ...p, nodes: p.nodes.map(n => (n.id === id ? { ...n, x: 500 } : n)) }),
            { transient: true }
        );
        const during = commit(store);

        store.cancelInteraction();

        expect(commit(store)).toBe(during + 1);
        expect(store.getState().doc.pages[0]!.nodes[0]!.x).toBe(0);
    });

    it("ticks on undo and on redo", () => {
        const store = newStore();
        store.update(doc => ({ ...doc, title: "Renamed" }));

        const afterEdit = commit(store);
        store.undo();
        expect(commit(store)).toBe(afterEdit + 1);

        const afterUndo = commit(store);
        store.redo();
        expect(commit(store)).toBe(afterUndo + 1);
    });

    it("ticks when the whole document is replaced", () => {
        const store = newStore();
        const before = commit(store);
        store.replaceDoc(docWithNode());
        expect(commit(store)).toBe(before + 1);
    });

    it("does not tick for a write that changed nothing", () => {
        const store = newStore();
        const before = commit(store);
        store.update(doc => doc);
        expect(commit(store)).toBe(before);
    });
});

describe("batch", () => {
    it("notifies once however many writes it contains", () => {
        const store = newStore();
        let calls = 0;
        store.subscribe(() => {
            calls += 1;
        });

        store.batch(() => {
            store.setTool("hand");
            store.setGuides([{ axis: "v", pos: 10, from: 0, to: 50, kind: "align" }]);
            store.update(doc => ({ ...doc, title: "Batched" }), { transient: true });
        });

        expect(calls).toBe(1);
    });

    it("applies every write in the batch", () => {
        const store = newStore();
        store.batch(() => {
            store.setTool("hand");
            store.update(doc => ({ ...doc, title: "Batched" }), { transient: true });
        });

        expect(store.getState().tool).toBe("hand");
        expect(store.getState().doc.title).toBe("Batched");
    });

    it("stays silent when the batch wrote nothing", () => {
        const store = newStore();
        let calls = 0;
        store.subscribe(() => {
            calls += 1;
        });

        store.batch(() => {
            // A no-op update: the store must not invent a notification.
            store.update(doc => doc);
        });

        expect(calls).toBe(0);
    });

    it("notifies once for nested batches, at the outermost exit", () => {
        const store = newStore();
        const seen: string[] = [];
        store.subscribe(() => {
            seen.push(store.getState().doc.title);
        });

        store.batch(() => {
            store.update(doc => ({ ...doc, title: "outer" }), { transient: true });
            store.batch(() => {
                store.update(doc => ({ ...doc, title: "inner" }), { transient: true });
            });
            expect(seen).toEqual([]); // nothing delivered yet
        });

        expect(seen).toEqual(["inner"]);
    });

    it("still delivers the notification when the batch throws", () => {
        const store = newStore();
        let calls = 0;
        store.subscribe(() => {
            calls += 1;
        });

        expect(() =>
            store.batch(() => {
                store.setTool("hand");
                throw new Error("boom");
            })
        ).toThrow("boom");

        // The write already happened, so suppressing its notification would
        // leave every subscriber displaying stale state indefinitely.
        expect(calls).toBe(1);
        expect(store.getState().tool).toBe("hand");
    });

    it("is not left suspended after a throw", () => {
        const store = newStore();
        let calls = 0;

        expect(() =>
            store.batch(() => {
                throw new Error("boom");
            })
        ).toThrow();

        store.subscribe(() => {
            calls += 1;
        });
        store.setTool("hand");

        expect(calls).toBe(1);
    });

    it("reports its subscriber count", () => {
        const store = newStore();
        expect(store.listenerCount()).toBe(0);
        const off = store.subscribe(() => undefined);
        expect(store.listenerCount()).toBe(1);
        off();
        expect(store.listenerCount()).toBe(0);
    });
});

describe("update", () => {
    it("ignores an updater that returns the same document", () => {
        const store = newStore();
        const before = store.getState();
        store.update(doc => doc);
        expect(store.getState()).toBe(before);
    });

    it("ignores an updater that returns null", () => {
        const store = newStore();
        const before = store.getState();
        store.update(() => null);
        expect(store.getState()).toBe(before);
    });

    it("marks the document dirty", () => {
        const store = newStore();
        expect(store.getState().dirty).toBe(false);
        store.update(doc => ({ ...doc, title: "Changed" }));
        expect(store.getState().dirty).toBe(true);
    });

    it("edits the active page through updatePage", () => {
        const store = newStore();
        store.updatePage(page => ({ ...page, name: "Renamed" }));
        expect(store.getState().doc.pages[0]!.name).toBe("Renamed");
    });
});

describe("history", () => {
    it("undoes and redoes a change", () => {
        const store = newStore();
        store.update(doc => ({ ...doc, title: "One" }), { label: "Rename" });
        store.update(doc => ({ ...doc, title: "Two" }), { label: "Rename" });
        expect(store.getState().doc.title).toBe("Two");

        store.undo();
        expect(store.getState().doc.title).toBe("One");
        store.undo();
        expect(store.getState().doc.title).toBe("Test");

        store.redo();
        expect(store.getState().doc.title).toBe("One");
    });

    it("reports what can be undone", () => {
        const store = newStore();
        expect(store.getState().canUndo).toBe(false);
        store.update(doc => ({ ...doc, title: "One" }), { label: "Rename" });
        expect(store.getState().canUndo).toBe(true);
        expect(store.historyLabels().undo).toBe("Rename");
        store.undo();
        expect(store.getState().canRedo).toBe(true);
    });

    it("does nothing when there is nothing to undo", () => {
        const store = newStore();
        const before = store.getState().doc;
        store.undo();
        store.redo();
        expect(store.getState().doc).toBe(before);
    });

    it("clears the redo stack once a new edit lands", () => {
        const store = newStore();
        store.update(doc => ({ ...doc, title: "One" }), { label: "a" });
        store.undo();
        expect(store.getState().canRedo).toBe(true);
        store.update(doc => ({ ...doc, title: "Other" }), { label: "b" });
        expect(store.getState().canRedo).toBe(false);
    });

    it("collapses rapid edits that share a coalesce key", () => {
        const store = newStore();
        for (const title of ["a", "ab", "abc"]) {
            store.update(doc => ({ ...doc, title }), { label: "Type", coalesceKey: "title" });
        }
        store.undo();
        // One undo returns to the original, not to "ab".
        expect(store.getState().doc.title).toBe("Test");
    });

    it("does not collapse edits with different keys", () => {
        const store = newStore();
        store.update(doc => ({ ...doc, title: "a" }), { coalesceKey: "one" });
        store.update(doc => ({ ...doc, title: "b" }), { coalesceKey: "two" });
        store.undo();
        expect(store.getState().doc.title).toBe("a");
    });

    it("skips history for transient updates", () => {
        const store = newStore();
        store.update(doc => ({ ...doc, title: "Ghost" }), { transient: true });
        expect(store.getState().canUndo).toBe(false);
    });
});

describe("interactions", () => {
    it("turns a multi-frame gesture into one undo entry", () => {
        const store = newStore();
        const id = firstNodeId(store);
        store.beginInteraction("Move");
        for (const x of [10, 20, 30]) {
            store.updatePage(
                page => ({
                    ...page,
                    nodes: page.nodes.map(n => (n.id === id ? { ...n, x } : n)),
                }),
                { transient: true }
            );
        }
        store.endInteraction();
        expect(store.getState().doc.pages[0]!.nodes[0]!.x).toBe(30);

        store.undo();
        expect(store.getState().doc.pages[0]!.nodes[0]!.x).toBe(0);
    });

    it("records nothing when a gesture changed nothing", () => {
        const store = newStore();
        store.beginInteraction("Move");
        store.endInteraction();
        expect(store.getState().canUndo).toBe(false);
    });

    it("restores the pre-gesture document on cancel", () => {
        const store = newStore();
        const id = firstNodeId(store);
        store.beginInteraction("Move");
        store.updatePage(
            page => ({ ...page, nodes: page.nodes.map(n => (n.id === id ? { ...n, x: 99 } : n)) }),
            { transient: true }
        );
        store.cancelInteraction();
        expect(store.getState().doc.pages[0]!.nodes[0]!.x).toBe(0);
        expect(store.getState().canUndo).toBe(false);
    });
});

describe("selection", () => {
    it("selects, toggles and clears", () => {
        const store = newStore();
        store.selectNodes(["a", "b"]);
        expect(store.selectedNodeIds()).toEqual(["a", "b"]);
        expect(store.isSelected("node", "a")).toBe(true);

        store.toggleSelection({ kind: "node", id: "a" });
        expect(store.selectedNodeIds()).toEqual(["b"]);
        store.toggleSelection({ kind: "node", id: "a" });
        expect(store.selectedNodeIds()).toEqual(["b", "a"]);

        store.clearSelection();
        expect(store.getState().selection).toEqual([]);
    });

    it("does not add the same ref twice", () => {
        const store = newStore();
        store.addToSelection({ kind: "node", id: "a" });
        store.addToSelection({ kind: "node", id: "a" });
        expect(store.selectedNodeIds()).toEqual(["a"]);
    });

    it("separates node and edge selections", () => {
        const store = newStore();
        store.setSelection([
            { kind: "node", id: "n" },
            { kind: "edge", id: "e" },
        ]);
        expect(store.selectedNodeIds()).toEqual(["n"]);
        expect(store.selectedEdgeIds()).toEqual(["e"]);
    });

    it("restores the selection that was live when an edit was made", () => {
        const store = newStore();
        store.selectNodes(["a"]);
        store.update(doc => ({ ...doc, title: "One" }), { label: "x" });
        store.selectNodes(["b"]);
        store.undo();
        expect(store.selectedNodeIds()).toEqual(["a"]);
    });
});

describe("viewport", () => {
    it("clamps zoom into range", () => {
        const store = newStore();
        store.setViewport({ zoom: 500 });
        expect(store.getState().viewport.zoom).toBeLessThanOrEqual(8);
        store.setViewport({ zoom: 0 });
        expect(store.getState().viewport.zoom).toBeGreaterThan(0);
    });

    it("pans in screen pixels, scaled by zoom", () => {
        const store = newStore();
        store.setViewport({ x: 0, y: 0, zoom: 2 });
        store.panBy(100, 50);
        expect(store.getState().viewport).toEqual({ x: 50, y: 25, zoom: 2 });
    });
});

describe("save state", () => {
    it("clears dirty on save and reports the time", () => {
        const store = newStore();
        store.update(doc => ({ ...doc, title: "Edited" }));
        expect(store.getState().dirty).toBe(true);
        store.markSaved(1234);
        expect(store.getState().dirty).toBe(false);
        expect(store.getState().savedAt).toBe(1234);
    });

    it("replaces the whole document and drops the selection", () => {
        const store = newStore();
        store.selectNodes(["a"]);
        store.replaceDoc(createDoc("Fresh"));
        expect(store.getState().doc.title).toBe("Fresh");
        expect(store.getState().selection).toEqual([]);
        // Replacing is undoable.
        expect(store.getState().canUndo).toBe(true);
    });
});

describe("presentation mode", () => {
    it("clears the selection on entry", () => {
        const store = newStore();
        store.selectNodes(["a"]);
        store.setPresenting(true);
        expect(store.getState().presenting).toBe(true);
        expect(store.getState().selection).toEqual([]);
    });
});
