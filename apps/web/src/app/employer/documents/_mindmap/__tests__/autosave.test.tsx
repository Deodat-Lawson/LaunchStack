/** @jest-environment jsdom */

import { act, renderHook } from "@testing-library/react";

import { setTitle } from "../model/commands";
import { createDoc, createPage } from "../model/factory";
import { EditorStore } from "../model/store";
import { useAutosave } from "../ui/useAutosave";

/**
 * `saveNow` is what "save, then leave" waits on. The workspace refreshes its
 * list as the editor goes, so a save that resolves before the change is on
 * the server shows the map under its old name — which is what a rename and
 * Back did while the template's first save was still running.
 */

interface PendingSave {
    body: { doc: { title: string }; baseRevision: number };
    respond: (revision: number) => void;
}

function controlledFetch(): { saves: PendingSave[]; restore: () => void } {
    const saves: PendingSave[] = [];
    const original = global.fetch;
    global.fetch = jest.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
            new Promise<Response>(resolve => {
                saves.push({
                    // useAutosave always sends a JSON string.
                    body: JSON.parse(init?.body as string) as PendingSave["body"],
                    respond: revision =>
                        resolve({
                            ok: true,
                            status: 200,
                            json: async () => ({ mindmap: { revision } }),
                        } as Response),
                });
            })
    ) as typeof fetch;
    return {
        saves,
        restore: () => {
            global.fetch = original;
        },
    };
}

/** Let the save's awaits (thumbnail, fetch, json) run. */
async function settle() {
    await act(async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve();
    });
}

describe("useAutosave saveNow", () => {
    let fetchControl: ReturnType<typeof controlledFetch>;

    beforeEach(() => {
        fetchControl = controlledFetch();
    });

    afterEach(() => {
        fetchControl.restore();
    });

    it("asked while a save is running, resolves only once the follow-up carrying its change has saved", async () => {
        const store = new EditorStore(createDoc("Untitled mindmap", [createPage()]));
        const { result, unmount } = renderHook(() => useAutosave(store, 7, 1, () => null));
        const { saves } = fetchControl;

        // A first save is on the wire — the template's, in the real flow.
        act(() => setTitle(store, "Draft"));
        let firstDone = false;
        void result.current.saveNow().then(() => {
            firstDone = true;
        });
        await settle();
        expect(saves).toHaveLength(1);

        // The rename lands while it runs, and Back asks for a save.
        act(() => setTitle(store, "Launch plan"));
        let leaveDone = false;
        void result.current.saveNow().then(() => {
            leaveDone = true;
        });
        await settle();
        expect(leaveDone).toBe(false);

        // The first save finishing is not the rename being saved.
        saves[0]!.respond(2);
        await settle();
        expect(firstDone).toBe(true);
        expect(saves).toHaveLength(2);
        expect(saves[1]!.body.doc.title).toBe("Launch plan");
        expect(saves[1]!.body.baseRevision).toBe(2);
        expect(leaveDone).toBe(false);

        saves[1]!.respond(3);
        await settle();
        expect(leaveDone).toBe(true);
        expect(store.getState().dirty).toBe(false);

        unmount();
    });

    it("with nothing running, resolves when its own save has", async () => {
        const store = new EditorStore(createDoc("Untitled mindmap", [createPage()]));
        const { result, unmount } = renderHook(() => useAutosave(store, 7, 1, () => null));
        const { saves } = fetchControl;

        act(() => setTitle(store, "Launch plan"));
        let done = false;
        void result.current.saveNow().then(() => {
            done = true;
        });
        await settle();
        expect(saves).toHaveLength(1);
        expect(done).toBe(false);

        saves[0]!.respond(2);
        await settle();
        expect(done).toBe(true);
        expect(saves).toHaveLength(1);

        unmount();
    });
});
