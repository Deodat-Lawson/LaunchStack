/** @jest-environment jsdom */

import { act, renderHook } from "@testing-library/react";

import { initialLayout, reduceLayout, type PaneLayout } from "../paneLayout";
import { useLayoutPersistence } from "../useLayoutPersistence";

/**
 * The layout comes back as it was left — and a window too narrow for panes,
 * which folds them into one, must not save that fold over the arrangement.
 */

const KEY = "workspace.layout.v1:u1:7";
const keep = () => true;

const split = reduceLayout(initialLayout(["chat", "knowledge"]), {
    type: "split",
    id: "knowledge",
});
const folded = reduceLayout(split, { type: "merge" });

function saved(): PaneLayout {
    return JSON.parse(localStorage.getItem(KEY)!) as PaneLayout;
}

describe("useLayoutPersistence", () => {
    beforeEach(() => localStorage.clear());

    it("saves the layout once the workspace is known, and restores it next time", () => {
        const restore = jest.fn();
        const { rerender } = renderHook(props => useLayoutPersistence(props), {
            initialProps: { scope: null as string | null, layout: split, restore, keep },
        });
        expect(localStorage.getItem(KEY)).toBeNull();
        rerender({ scope: "u1:7", layout: split, restore, keep });
        rerender({ scope: "u1:7", layout: { ...split }, restore, keep });
        expect(saved().groups).toHaveLength(2);

        renderHook(() =>
            useLayoutPersistence({ scope: "u1:7", layout: initialLayout(), restore, keep })
        );
        expect(restore).toHaveBeenCalledWith(expect.objectContaining({ groups: saved().groups }));
    });

    it("does not save the fold, and brings the arrangement back when the window widens", () => {
        localStorage.setItem(KEY, JSON.stringify(split));
        const restore = jest.fn();
        const { rerender } = renderHook(props => useLayoutPersistence(props), {
            initialProps: { scope: "u1:7", layout: split, restore, keep, paused: true },
        });
        restore.mockClear();

        // Narrow: the panes fold into one, and nothing is written.
        rerender({ scope: "u1:7", layout: folded, restore, keep, paused: true });
        expect(saved().groups).toHaveLength(2);

        // Wide again: the two-pane arrangement is handed back.
        act(() => rerender({ scope: "u1:7", layout: folded, restore, keep, paused: false }));
        expect(restore).toHaveBeenCalledTimes(1);
        expect((restore.mock.calls[0]![0] as PaneLayout).groups).toHaveLength(2);
    });

    it("leaves out, on widening, a tab closed while the window was narrow", () => {
        localStorage.setItem(KEY, JSON.stringify(split));
        const restore = jest.fn();
        const withoutKnowledge = reduceLayout(folded, {
            type: "close",
            groupId: folded.groups[0]!.id,
            id: "knowledge",
        });
        const { rerender } = renderHook(props => useLayoutPersistence(props), {
            initialProps: { scope: "u1:7", layout: withoutKnowledge, restore, keep, paused: true },
        });
        restore.mockClear();
        act(() =>
            rerender({ scope: "u1:7", layout: withoutKnowledge, restore, keep, paused: false })
        );
        const back = restore.mock.calls[0]![0] as PaneLayout;
        expect(back.groups.flatMap(group => group.tabIds)).toEqual(["chat"]);
    });
});
