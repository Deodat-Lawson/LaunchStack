import {
    MAX_GROUPS,
    groupOf,
    initialLayout,
    isTabVisible,
    newGroup,
    openTabIds,
    reduceLayout,
    type PaneLayout,
} from "../paneLayout";

/**
 * The layout is the whole feature's memory: which apps are open, which column
 * each sits in, and which one you are looking at. Everything a person can do
 * to the workspace centre lands here, so this is where the edges are checked.
 */

/** "a,b | c" — columns separated by a pipe, the active tab in each marked. */
function shape(layout: PaneLayout): string {
    return layout.groups
        .map(group => group.tabIds.map(id => (id === group.activeId ? `[${id}]` : id)).join(","))
        .join(" | ");
}

function layoutOf(columns: string[][], activeIndex = 0): PaneLayout {
    return {
        groups: columns.map((tabIds, i) => newGroup(`g${i}`, tabIds)),
        activeGroupId: `g${activeIndex}`,
        seq: columns.length,
    };
}

describe("paneLayout", () => {
    it("starts with chat alone in one column", () => {
        const layout = initialLayout();
        expect(shape(layout)).toBe("[chat]");
        expect(layout.activeGroupId).toBe("g0");
    });

    describe("open", () => {
        it("appends to the focused column and shows it", () => {
            const layout = reduceLayout(initialLayout(), { type: "open", id: "knowledge" });
            expect(shape(layout)).toBe("chat,[knowledge]");
        });

        it("shows an already-open app where it is instead of opening a second copy", () => {
            const before = layoutOf([["chat"], ["knowledge", "draft"]], 0);
            const after = reduceLayout(before, { type: "open", id: "knowledge" });
            expect(shape(after)).toBe("[chat] | [knowledge],draft");
            // The focus follows it into the other column.
            expect(after.activeGroupId).toBe("g1");
            expect(openTabIds(after).filter(id => id === "knowledge")).toHaveLength(1);
        });

        it("hands an app to another column when that column is named", () => {
            const before = layoutOf([["chat", "draft"], ["knowledge"]], 0);
            const after = reduceLayout(before, { type: "open", id: "draft", groupId: "g1" });
            expect(shape(after)).toBe("[chat] | knowledge,[draft]");
        });

        it("ignores a column that is not there", () => {
            const before = initialLayout();
            expect(reduceLayout(before, { type: "open", id: "draft", groupId: "nope" })).toBe(
                before
            );
        });
    });

    describe("openBeside", () => {
        it("adds a column to the right and shows the app in it", () => {
            const after = reduceLayout(initialLayout(), {
                type: "openBeside",
                id: "source:d12",
            });
            expect(shape(after)).toBe("[chat] | [source:d12]");
            expect(after.activeGroupId).not.toBe("g0");
        });

        it("reuses the column to the right rather than stacking columns", () => {
            const before = layoutOf([["chat"], ["knowledge"]], 0);
            const after = reduceLayout(before, { type: "openBeside", id: "source:d12" });
            expect(shape(after)).toBe("[chat] | knowledge,[source:d12]");
            expect(after.groups).toHaveLength(2);
        });

        it("falls back to the focused column once there is no room for another", () => {
            const full = layoutOf([["chat"], ["knowledge"], ["draft"]], 2);
            const after = reduceLayout(full, { type: "openBeside", id: "notes" });
            expect(after.groups).toHaveLength(MAX_GROUPS);
            expect(shape(after)).toBe("[chat] | [knowledge] | draft,[notes]");
        });
    });

    describe("split", () => {
        it("gives a tab a column of its own, right of the one it left", () => {
            const before = layoutOf([["chat", "knowledge", "draft"]], 0);
            const after = reduceLayout(before, { type: "split", id: "knowledge" });
            expect(shape(after)).toBe("[chat],draft | [knowledge]");
            expect(after.activeGroupId).toBe(after.groups[1]!.id);
        });

        it("does nothing to a tab that is already alone", () => {
            const before = layoutOf([["chat"], ["knowledge"]], 0);
            expect(reduceLayout(before, { type: "split", id: "chat" })).toBe(before);
        });

        it("does nothing once every column is taken", () => {
            const full = layoutOf([["chat", "notes"], ["knowledge"], ["draft"]], 0);
            expect(reduceLayout(full, { type: "split", id: "notes" })).toBe(full);
        });
    });

    describe("close", () => {
        it("shows the tab on the right of the one that closed", () => {
            const before = layoutOf([["chat", "knowledge", "draft"]], 0);
            const showing = {
                ...before,
                groups: [{ ...before.groups[0]!, activeId: "knowledge" }],
            };
            expect(
                shape(reduceLayout(showing, { type: "close", groupId: "g0", id: "knowledge" }))
            ).toBe("chat,[draft]");
        });

        it("removes a column when its last tab closes, and moves the focus left", () => {
            const before = layoutOf([["chat"], ["knowledge"]], 1);
            const after = reduceLayout(before, { type: "close", groupId: "g1", id: "knowledge" });
            expect(shape(after)).toBe("[chat]");
            expect(after.activeGroupId).toBe("g0");
        });

        it("keeps one empty column when the very last tab closes", () => {
            const after = reduceLayout(initialLayout(), {
                type: "close",
                groupId: "g0",
                id: "chat",
            });
            expect(after.groups).toHaveLength(1);
            expect(after.groups[0]!.tabIds).toEqual([]);
            expect(after.groups[0]!.activeId).toBe("");
        });

        it("closes the others, and everything to the right", () => {
            const before = layoutOf([["chat", "knowledge", "draft", "notes"]], 0);
            expect(
                shape(reduceLayout(before, { type: "closeOthers", groupId: "g0", id: "draft" }))
            ).toBe("[draft]");
            expect(
                shape(
                    reduceLayout(before, { type: "closeToRight", groupId: "g0", id: "knowledge" })
                )
            ).toBe("[chat],knowledge");
        });
    });

    describe("move", () => {
        it("reorders inside a column by naming the neighbour to land in front of", () => {
            const before = layoutOf([["chat", "knowledge", "draft"]], 0);
            expect(
                shape(
                    reduceLayout(before, {
                        type: "move",
                        id: "draft",
                        toGroupId: "g0",
                        beforeId: "chat",
                    })
                )
            ).toBe("draft,[chat],knowledge");
        });

        it("moves a tab to the end when no neighbour is named", () => {
            const before = layoutOf([["chat", "knowledge", "draft"]], 0);
            expect(
                shape(
                    reduceLayout(before, {
                        type: "move",
                        id: "chat",
                        toGroupId: "g0",
                        beforeId: null,
                    })
                )
            ).toBe("knowledge,draft,[chat]");
        });

        it("lands right even when the strip is showing fewer tabs than are open", () => {
            // `settings` is open but hidden from this person, so the strip shows
            // [chat, draft] and asks for "draft in front of chat". A move by
            // position would have put it where `settings` is.
            const before = layoutOf([["chat", "settings", "draft"]], 0);
            expect(
                shape(
                    reduceLayout(before, {
                        type: "move",
                        id: "draft",
                        toGroupId: "g0",
                        beforeId: "chat",
                    })
                )
            ).toBe("draft,[chat],settings");
        });

        it("hands a tab to another column and shows it there", () => {
            const before = layoutOf([["chat", "draft"], ["knowledge"]], 0);
            const after = reduceLayout(before, {
                type: "move",
                id: "draft",
                toGroupId: "g1",
                beforeId: "knowledge",
            });
            expect(shape(after)).toBe("[chat] | [draft],knowledge");
            expect(after.activeGroupId).toBe("g1");
        });

        it("removes the column a tab was the last of", () => {
            const before = layoutOf([["chat"], ["knowledge"]], 1);
            const after = reduceLayout(before, {
                type: "move",
                id: "knowledge",
                toGroupId: "g0",
                beforeId: null,
            });
            expect(shape(after)).toBe("chat,[knowledge]");
            expect(after.groups).toHaveLength(1);
        });

        it("ignores a move whose anchor has since gone, or that changes nothing", () => {
            const before = layoutOf([["chat", "knowledge"]], 0);
            expect(
                reduceLayout(before, {
                    type: "move",
                    id: "chat",
                    toGroupId: "g0",
                    beforeId: "gone",
                })
            ).toBe(before);
            expect(
                reduceLayout(before, {
                    type: "move",
                    id: "chat",
                    toGroupId: "g0",
                    beforeId: "chat",
                })
            ).toBe(before);
            expect(
                reduceLayout(before, {
                    type: "move",
                    id: "chat",
                    toGroupId: "g0",
                    beforeId: "knowledge",
                })
            ).toBe(before);
        });
    });

    describe("focus", () => {
        it("moves between columns and stops at the ends", () => {
            const before = layoutOf([["chat"], ["knowledge"]], 0);
            expect(
                reduceLayout(before, { type: "focusAdjacentGroup", delta: 1 }).activeGroupId
            ).toBe("g1");
            expect(reduceLayout(before, { type: "focusAdjacentGroup", delta: -1 })).toBe(before);
            expect(reduceLayout(before, { type: "focusGroup", groupId: "nope" })).toBe(before);
        });
    });

    describe("helpers the host renders from", () => {
        it("answers where a tab lives, what is open, and what is on screen", () => {
            const layout = layoutOf([["chat", "draft"], ["knowledge"]], 0);
            expect(groupOf(layout, "draft")!.id).toBe("g0");
            expect(groupOf(layout, "nope")).toBeUndefined();
            expect(openTabIds(layout)).toEqual(["chat", "draft", "knowledge"]);
            // One visible tab per column, not one in the whole workspace.
            expect(isTabVisible(layout, "chat")).toBe(true);
            expect(isTabVisible(layout, "knowledge")).toBe(true);
            expect(isTabVisible(layout, "draft")).toBe(false);
        });
    });

    /**
     * Asking about a document used to close it: the preview went away and the
     * chat took the screen. `pair` keeps the document in view beside the chat,
     * and the one thing it must never do is leave both in the same column,
     * where focusing the chat hides the document it was meant to keep.
     */
    describe("pair", () => {
        const pair = (layout: PaneLayout) =>
            reduceLayout(layout, { type: "pair", id: "source:d1", anchorId: "chat" });

        it("opens the document in a new column beside the chat and focuses the chat", () => {
            const next = pair(initialLayout());
            expect(shape(next)).toBe("[chat] | [source:d1]");
            expect(next.activeGroupId).toBe("g0");
        });

        it("pulls the document out of the chat's column rather than hiding it", () => {
            const next = pair(layoutOf([["chat", "source:d1"]]));
            expect(shape(next)).toBe("[chat] | [source:d1]");
            expect(isTabVisible(next, "source:d1")).toBe(true);
            expect(isTabVisible(next, "chat")).toBe(true);
        });

        it("leaves a document that already has its own column where it is", () => {
            const next = pair(layoutOf([["chat"], ["knowledge", "source:d1"]]));
            expect(shape(next)).toBe("[chat] | knowledge,[source:d1]");
            expect(next.activeGroupId).toBe("g0");
        });

        it("uses the column to the right of the chat when one exists", () => {
            const next = pair(layoutOf([["chat"], ["knowledge"]]));
            expect(shape(next)).toBe("[chat] | knowledge,[source:d1]");
        });

        it("goes left of the chat when the chat is last and there is no room", () => {
            const full = layoutOf([["a"], ["b"], ["chat"]], 2);
            expect(full.groups).toHaveLength(MAX_GROUPS);
            const next = pair(full);
            expect(shape(next)).toBe("[a] | b,[source:d1] | [chat]");
            expect(groupOf(next, "source:d1")?.id).not.toBe(groupOf(next, "chat")?.id);
        });

        it("reopens a closed chat, still beside the document", () => {
            const next = pair(layoutOf([["source:d1"]]));
            expect(isTabVisible(next, "chat")).toBe(true);
            expect(isTabVisible(next, "source:d1")).toBe(true);
            expect(groupOf(next, "source:d1")?.id).not.toBe(groupOf(next, "chat")?.id);
        });

        it("never leaves both in the same column, whatever the starting layout", () => {
            const starts: string[][][] = [
                [["chat"]],
                [["chat", "source:d1"]],
                [["source:d1", "chat"]],
                [["knowledge"], ["chat", "source:d1"]],
                [["a"], ["b"], ["chat", "source:d1"]],
                [["a", "source:d1"], ["b"], ["chat"]],
                [["source:d1"], ["a"], ["b"]],
            ];
            for (const columns of starts) {
                for (let focus = 0; focus < columns.length; focus++) {
                    const next = pair(layoutOf(columns, focus));
                    expect(isTabVisible(next, "chat")).toBe(true);
                    expect(isTabVisible(next, "source:d1")).toBe(true);
                    expect(groupOf(next, "chat")?.id).not.toBe(groupOf(next, "source:d1")?.id);
                    expect(next.groups.length).toBeLessThanOrEqual(MAX_GROUPS);
                    expect(next.activeGroupId).toBe(groupOf(next, "chat")?.id);
                }
            }
        });
    });
});
