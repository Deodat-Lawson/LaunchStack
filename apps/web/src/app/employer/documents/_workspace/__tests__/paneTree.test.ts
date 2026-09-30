import {
    MAX_GROUPS,
    initialLayout,
    isTabVisible,
    leafIds,
    neighbourOf,
    newGroup,
    reduceLayout,
    rowLayout,
    sanitizeLayout,
    type LayoutNode,
    type PaneAction,
    type PaneLayout,
} from "../paneLayout";

/**
 * The split tree: panes beside and above one another, nested as deep as
 * people split them. The flat-column behaviour is pinned in paneLayout.test;
 * this is what the tree adds — splitting down, dropping a tab on a pane's
 * edge, empty panes, zoom, divider sizes, and coming back to the same layout.
 */

/** "row(g0, column(g1, g2))" — the arrangement, without the tabs. */
function tree(node: LayoutNode): string {
    return node.type === "pane"
        ? node.groupId
        : `${node.axis}(${node.children.map(tree).join(", ")})`;
}

/** "a,[b] | c" — each pane's tabs in reading order, the active one marked. */
function tabs(layout: PaneLayout): string {
    return layout.groups
        .map(group => group.tabIds.map(id => (id === group.activeId ? `[${id}]` : id)).join(","))
        .join(" | ");
}

function run(layout: PaneLayout, ...actions: PaneAction[]): PaneLayout {
    return actions.reduce(reduceLayout, layout);
}

function sizesOf(node: LayoutNode): number[] {
    return node.type === "split" ? node.sizes : [];
}

/** Every structural invariant the renderer relies on. */
function expectConsistent(layout: PaneLayout) {
    expect(leafIds(layout.root)).toEqual(layout.groups.map(group => group.id));
    const all = layout.groups.flatMap(group => group.tabIds);
    expect(new Set(all).size).toBe(all.length);
    expect(layout.groups.some(group => group.id === layout.activeGroupId)).toBe(true);
    const walk = (node: LayoutNode, parentAxis?: string) => {
        if (node.type === "pane") return;
        expect(node.children.length).toBeGreaterThan(1);
        expect(node.axis).not.toBe(parentAxis);
        expect(node.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
        node.children.forEach(child => walk(child, node.axis));
    };
    walk(layout.root);
}

describe("split tree", () => {
    describe("splitting", () => {
        it("stacks a tab below the pane it left when split down", () => {
            const next = run(initialLayout(["chat", "notes"]), {
                type: "split",
                id: "notes",
                side: "down",
            });
            expect(tree(next.root)).toBe("column(g0, g1)");
            expect(tabs(next)).toBe("[chat] | [notes]");
            expect(next.activeGroupId).toBe("g1");
            expectConsistent(next);
        });

        it("nests a column inside a row, and joins a split of the same axis instead of nesting", () => {
            let next = run(
                initialLayout(["a", "b", "c", "d"]),
                { type: "split", id: "b", side: "right" },
                { type: "split", id: "c", side: "down", targetGroupId: "g1" }
            );
            expect(tree(next.root)).toBe("row(g0, column(g1, g2))");
            // Splitting g1 right joins the row rather than making a row in a
            // column in a row.
            next = run(next, { type: "split", id: "d", side: "right", targetGroupId: "g0" });
            expect(tree(next.root)).toBe("row(g0, g3, column(g1, g2))");
            expectConsistent(next);
        });

        it("puts the new pane first when split left or up", () => {
            const next = run(initialLayout(["a", "b"]), { type: "split", id: "b", side: "up" });
            expect(tree(next.root)).toBe("column(g1, g0)");
            expect(tabs(next)).toBe("[b] | [a]");
        });

        it("halves the target's share with the pane it gains", () => {
            const three = run(
                initialLayout(["a", "b", "c"]),
                { type: "split", id: "b" },
                { type: "resize", splitId: "s1", sizes: [0.6, 0.4] },
                { type: "split", id: "c", targetGroupId: "g1" }
            );
            const sizes = sizesOf(three.root);
            expect(sizes[0]).toBeCloseTo(0.6);
            expect(sizes[1]).toBeCloseTo(0.2);
            expect(sizes[2]).toBeCloseTo(0.2);
        });

        it("drops a tab onto another pane's edge, freeing the pane it was alone in", () => {
            const layout = rowLayout([newGroup("g0", ["chat"]), newGroup("g1", ["doc"])], "g0", 2);
            const next = run(layout, {
                type: "split",
                id: "doc",
                side: "down",
                targetGroupId: "g0",
            });
            expect(tree(next.root)).toBe("column(g0, g3)");
            expect(tabs(next)).toBe("[chat] | [doc]");
            expectConsistent(next);
        });

        it("still moves a lone tab to another pane's edge when every pane is taken", () => {
            const full = rowLayout(
                Array.from({ length: MAX_GROUPS }, (_, i) => newGroup(`g${i}`, [`t${i}`])),
                "g0",
                MAX_GROUPS
            );
            const next = run(full, { type: "split", id: "t5", side: "down", targetGroupId: "g0" });
            expect(next.groups).toHaveLength(MAX_GROUPS);
            expect(tree(next.root)).toBe("row(column(g0, g7), g1, g2, g3, g4)");
        });

        it("will not split a pane off itself when the tab is alone in it", () => {
            const layout = initialLayout(["chat"]);
            expect(run(layout, { type: "split", id: "chat", side: "down" })).toBe(layout);
        });
    });

    describe("things not open yet", () => {
        it("opens a dropped source in a pane of its own on the edge it was dropped on", () => {
            const next = run(initialLayout(["chat"]), {
                type: "split",
                id: "source:d1",
                side: "left",
                targetGroupId: "g0",
            });
            expect(tree(next.root)).toBe("row(g1, g0)");
            expect(tabs(next)).toBe("[source:d1] | [chat]");
            expect(next.activeGroupId).toBe("g1");
        });

        it("opens it where it was aimed when there is no room for another pane", () => {
            const full = rowLayout(
                Array.from({ length: MAX_GROUPS }, (_, i) => newGroup(`g${i}`, [`t${i}`])),
                "g0",
                MAX_GROUPS
            );
            const next = run(full, { type: "split", id: "source:d1", targetGroupId: "g3" });
            expect(next.groups).toHaveLength(MAX_GROUPS);
            expect(next.groups[3]!.tabIds).toEqual(["t3", "source:d1"]);
        });

        it("drops it into a strip at the place it landed", () => {
            const next = run(initialLayout(["chat", "notes"]), {
                type: "move",
                id: "source:d1",
                toGroupId: "g0",
                beforeId: "notes",
            });
            expect(tabs(next)).toBe("chat,[source:d1],notes");
        });
    });

    describe("the workspace's own edges", () => {
        // row(g0, column(g1, g2))
        const nested = () =>
            run(
                initialLayout(["a", "b", "c", "d"]),
                { type: "split", id: "b" },
                { type: "split", id: "c", side: "down", targetGroupId: "g1" }
            );

        it("spans the whole height when dropped along the left or right", () => {
            const next = run(nested(), { type: "split", id: "d", side: "right", atRoot: true });
            expect(tree(next.root)).toBe("row(g0, column(g1, g2), g3)");
            const sizes = sizesOf(next.root);
            expect(sizes[2]).toBeCloseTo(1 / 3);
            expect(sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
            expectConsistent(next);
        });

        it("spans the whole width when dropped along the top or bottom", () => {
            const next = run(nested(), {
                type: "split",
                id: "source:d9",
                side: "down",
                atRoot: true,
            });
            expect(tree(next.root)).toBe("column(row(g0, column(g1, g2)), g3)");
            expect(tabs(next)).toContain("[source:d9]");
            expectConsistent(next);
        });

        it("moves a lone tab to the edge and lets its old pane go", () => {
            const next = run(nested(), { type: "split", id: "c", side: "up", atRoot: true });
            expect(tree(next.root)).toBe("column(g3, row(g0, g1))");
            expectConsistent(next);
        });

        it("has no edge to move the only tab of the only pane to", () => {
            const one = initialLayout(["chat"]);
            expect(run(one, { type: "split", id: "chat", side: "left", atRoot: true })).toBe(one);
        });
    });

    describe("empty panes", () => {
        it("opens a new, empty pane beside the focused one and focuses it", () => {
            const next = run(initialLayout(["chat"]), { type: "splitPane", side: "right" });
            expect(tree(next.root)).toBe("row(g0, g1)");
            expect(tabs(next)).toBe("[chat] | ");
            expect(next.activeGroupId).toBe("g1");
        });

        it("keeps an empty pane through unrelated work, and fills it when something opens there", () => {
            let next = run(
                initialLayout(["chat", "notes"]),
                { type: "splitPane", side: "right" },
                { type: "focusGroup", groupId: "g0" },
                { type: "close", groupId: "g0", id: "notes" }
            );
            expect(tabs(next)).toBe("[chat] | ");
            next = run(next, { type: "focusGroup", groupId: "g1" }, { type: "open", id: "draft" });
            expect(tabs(next)).toBe("[chat] | [draft]");
        });

        it("fills the focused empty pane rather than adding another beside it", () => {
            const next = run(
                initialLayout(["chat"]),
                { type: "splitPane", side: "right" },
                { type: "openBeside", id: "source:d1" }
            );
            expect(tabs(next)).toBe("[chat] | [source:d1]");
        });

        it("does not split an empty pane, or past the limit", () => {
            const empty = run(initialLayout(["chat"]), { type: "splitPane", side: "right" });
            expect(run(empty, { type: "splitPane", side: "down" })).toBe(empty);
            const full = rowLayout(
                Array.from({ length: MAX_GROUPS }, (_, i) => newGroup(`g${i}`, [`t${i}`])),
                "g0",
                MAX_GROUPS
            );
            expect(run(full, { type: "splitPane", side: "down" })).toBe(full);
        });

        it("closes a whole pane, and empties the last one instead of removing it", () => {
            const two = run(initialLayout(["chat", "notes"]), {
                type: "split",
                id: "notes",
                side: "down",
            });
            const one = run(two, { type: "closeGroup", groupId: "g1" });
            expect(tabs(one)).toBe("[chat]");
            expect(one.activeGroupId).toBe("g0");
            const none = run(one, { type: "closeGroup", groupId: "g0" });
            expect(tabs(none)).toBe("");
            expect(none.groups).toHaveLength(1);
        });

        it("gives a removed pane's space to the neighbour it shared a divider with", () => {
            const next = run(
                initialLayout(["a", "b", "c"]),
                { type: "split", id: "b" },
                { type: "split", id: "c" },
                // row(g0, g2, g1): c split off g0, so it lands between.
                { type: "resize", splitId: "s1", sizes: [0.5, 0.3, 0.2] },
                { type: "closeGroup", groupId: "g2" }
            );
            expect(tree(next.root)).toBe("row(g0, g1)");
            expect(sizesOf(next.root)[0]).toBeCloseTo(0.8);
        });
    });

    describe("zoom", () => {
        const two = () =>
            run(initialLayout(["chat", "notes"]), { type: "split", id: "notes", side: "right" });

        it("fills the centre with the focused pane and hides the rest", () => {
            const zoomed = run(two(), { type: "toggleZoom" });
            expect(zoomed.zoomedGroupId).toBe("g1");
            expect(isTabVisible(zoomed, "notes")).toBe(true);
            expect(isTabVisible(zoomed, "chat")).toBe(false);
            expect(run(zoomed, { type: "toggleZoom" }).zoomedGroupId).toBeNull();
        });

        it("lets go when the focus moves to another pane or the layout changes", () => {
            const zoomed = run(two(), { type: "toggleZoom" });
            expect(run(zoomed, { type: "focusGroup", groupId: "g0" }).zoomedGroupId).toBeNull();
            expect(run(zoomed, { type: "open", id: "chat" }).zoomedGroupId).toBeNull();
            expect(run(zoomed, { type: "splitPane", side: "down" }).zoomedGroupId).toBeNull();
        });

        it("has nothing to zoom with a single pane", () => {
            const one = initialLayout();
            expect(run(one, { type: "toggleZoom" })).toBe(one);
        });
    });

    describe("neighbours", () => {
        // row(g0, column(g1, g2))
        const layout = run(
            initialLayout(["a", "b", "c"]),
            { type: "split", id: "b" },
            { type: "split", id: "c", side: "down", targetGroupId: "g1" }
        );

        it("finds the pane across the divider in each direction", () => {
            expect(tree(layout.root)).toBe("row(g0, column(g1, g2))");
            expect(neighbourOf(layout.root, "g0", "right")).toBe("g1");
            expect(neighbourOf(layout.root, "g2", "left")).toBe("g0");
            expect(neighbourOf(layout.root, "g1", "down")).toBe("g2");
            expect(neighbourOf(layout.root, "g2", "up")).toBe("g1");
            expect(neighbourOf(layout.root, "g2", "right")).toBeNull();
            expect(neighbourOf(layout.root, "g0", "down")).toBeNull();
        });

        it("opens beside into the pane to the right, not the next one in reading order", () => {
            // row(column(g0, g2), g1): below g0 comes next in reading order,
            // but g1 is the one to its right.
            const stacked = run(
                initialLayout(["a", "b", "c"]),
                { type: "split", id: "c" },
                { type: "split", id: "b", side: "down", targetGroupId: "g0" },
                { type: "focusGroup", groupId: "g0" }
            );
            expect(tree(stacked.root)).toBe("row(column(g0, g2), g1)");
            expect(stacked.groups.map(group => group.id)).toEqual(["g0", "g2", "g1"]);
            const next = run(stacked, { type: "openBeside", id: "doc" });
            expect(next.groups.find(group => group.tabIds.includes("doc"))?.id).toBe("g1");
        });
    });

    describe("resize", () => {
        it("stores new shares for a split, normalised", () => {
            const next = run(
                initialLayout(["a", "b"]),
                { type: "split", id: "b" },
                { type: "resize", splitId: "s1", sizes: [3, 1] }
            );
            expect(sizesOf(next.root)[0]).toBeCloseTo(0.75);
            expect(sizesOf(next.root)[1]).toBeCloseTo(0.25);
        });

        it("ignores sizes that do not fit the split, or a split that is not there", () => {
            const layout = run(initialLayout(["a", "b"]), { type: "split", id: "b" });
            expect(run(layout, { type: "resize", splitId: "s1", sizes: [1] })).toEqual(layout);
            expect(run(layout, { type: "resize", splitId: "nope", sizes: [1, 1] })).toBe(layout);
        });
    });

    describe("coming back", () => {
        const saved = run(
            initialLayout(["chat", "source:d1", "mindmap"]),
            { type: "split", id: "source:d1" },
            { type: "split", id: "mindmap", side: "down" }
        );
        const roundTrip = (layout: PaneLayout) => JSON.parse(JSON.stringify(layout)) as unknown;

        it("restores a saved layout exactly", () => {
            const clean = sanitizeLayout(roundTrip(saved));
            expect(clean).not.toBeNull();
            expect(tree(clean!.root)).toBe(tree(saved.root));
            expect(tabs(clean!)).toBe(tabs(saved));
            expect(clean!.seq).toBeGreaterThanOrEqual(saved.seq);
            expectConsistent(clean!);
        });

        it("drops tabs that cannot come back, and the panes they leave empty", () => {
            const clean = sanitizeLayout(roundTrip(saved), id => id !== "mindmap");
            expect(tree(clean!.root)).toBe("row(g0, g1)");
            expect(tabs(clean!)).toBe("[chat] | [source:d1]");
            expectConsistent(clean!);
        });

        it("refuses storage that does not describe a layout", () => {
            expect(sanitizeLayout(null)).toBeNull();
            expect(sanitizeLayout("chat")).toBeNull();
            expect(
                sanitizeLayout({ groups: [], root: { type: "pane", groupId: "g0" } })
            ).toBeNull();
            // A tree that names a pane twice, or one that is not saved.
            const twice = {
                ...(roundTrip(saved) as object),
                root: {
                    type: "split",
                    id: "s9",
                    axis: "row",
                    children: [
                        { type: "pane", groupId: "g0" },
                        { type: "pane", groupId: "g0" },
                    ],
                    sizes: [0.5, 0.5],
                },
            };
            expect(sanitizeLayout(twice)).toBeNull();
        });

        it("repairs what it can: duplicate tabs, bad sizes, a missing focus", () => {
            const raw = roundTrip(saved) as {
                groups: { tabIds: string[] }[];
                activeGroupId: string;
                root: { sizes: number[] };
            };
            raw.groups[2]!.tabIds.push("chat");
            raw.activeGroupId = "gone";
            raw.root.sizes = [-1, Number.NaN];
            const clean = sanitizeLayout(raw)!;
            expect(
                clean.groups.flatMap(group => group.tabIds).filter(id => id === "chat")
            ).toHaveLength(1);
            expect(clean.activeGroupId).toBe("g0");
            expect(sizesOf(clean.root)).toEqual([0.5, 0.5]);
        });

        it("replaces an untouched workspace, and adds to it what was opened while it loaded", () => {
            const start = initialLayout();
            const clean = sanitizeLayout(roundTrip(saved))!;
            expect(run(start, { type: "restore", layout: clean, since: start })).toBe(clean);

            const linked = run(start, { type: "open", id: "settings" });
            const merged = run(linked, { type: "restore", layout: clean, since: start });
            expect(merged.groups.some(group => group.tabIds.includes("settings"))).toBe(true);
            expect(merged.groups.find(group => group.id === merged.activeGroupId)?.activeId).toBe(
                "settings"
            );
            expectConsistent(merged);
        });
    });

    it("keeps its invariants through a long run of mixed actions", () => {
        const ids = ["chat", "a", "b", "c", "d", "e", "f", "g"];
        const sides = ["left", "right", "up", "down"] as const;
        let layout = initialLayout(["chat"]);
        let seed = 7;
        const random = (n: number) => {
            seed = (seed * 48271) % 2147483647;
            return seed % n;
        };
        for (let step = 0; step < 400; step++) {
            const id = ids[random(ids.length)]!;
            const group = layout.groups[random(layout.groups.length)]!;
            const actions: PaneAction[] = [
                { type: "open", id },
                { type: "openBeside", id },
                { type: "split", id, side: sides[random(4)]!, targetGroupId: group.id },
                { type: "split", id, side: sides[random(4)]!, atRoot: true },
                { type: "splitPane", side: sides[random(4)]!, groupId: group.id },
                { type: "close", groupId: group.id, id: group.activeId },
                { type: "closeGroup", groupId: group.id },
                { type: "move", id, toGroupId: group.id, beforeId: null },
                { type: "toggleZoom", groupId: group.id },
                { type: "focusAdjacentGroup", delta: random(2) ? 1 : -1 },
                { type: "pair", id, anchorId: "chat" },
            ];
            layout = reduceLayout(layout, actions[random(actions.length)]!);
            expectConsistent(layout);
            expect(layout.groups.length).toBeLessThanOrEqual(MAX_GROUPS);
        }
    });
});
