/**
 * Column layouts.
 *
 * `columns` is a flex row of `column` nodes, each holding ordinary blocks.
 * Widths are stored as a fraction of the row so a resize survives a window
 * resize, and the commands keep the fractions summing to 1.
 */

import { mergeAttributes, Node } from "@tiptap/core";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        columns: {
            /** Replace the current block with an n-column layout. */
            setColumns: (count: number) => ReturnType;
            /** Add a column after the one containing the cursor. */
            addColumnAfter: () => ReturnType;
            /** Remove the column containing the cursor, keeping its blocks. */
            deleteColumn: () => ReturnType;
            /** Unwrap the layout, leaving each column's blocks in order. */
            unsetColumns: () => ReturnType;
        };
    }
}

export const Column = Node.create({
    name: "column",
    content: "block+",
    isolating: true,

    addAttributes() {
        return {
            width: {
                default: null,
                parseHTML: (element) => {
                    const raw = element.getAttribute("data-width");
                    return raw ? Number.parseFloat(raw) : null;
                },
                renderHTML: (attributes) =>
                    attributes.width === null
                        ? {}
                        : {
                              "data-width": String(attributes.width),
                              style: `flex-grow:${Number(attributes.width)}`,
                          },
            },
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-type="column"]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return [
            "div",
            mergeAttributes(HTMLAttributes, { "data-type": "column", class: "ntn-column" }),
            0,
        ];
    },
});

export const Columns = Node.create({
    name: "columns",
    group: "block",
    content: "column{2,}",
    isolating: true,

    parseHTML() {
        return [{ tag: 'div[data-type="columns"]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return [
            "div",
            mergeAttributes(HTMLAttributes, { "data-type": "columns", class: "ntn-columns" }),
            0,
        ];
    },

    addCommands() {
        return {
            setColumns:
                (count) =>
                ({ chain, state }) => {
                    const columns = Math.max(2, Math.min(count, 5));
                    const width = 1 / columns;
                    // Carry the current block into the first column so
                    // "/2 columns" on a line of text does not discard it.
                    const current = state.selection.$from.parent.toJSON() as unknown;

                    return chain()
                        .insertContent({
                            type: this.name,
                            content: Array.from({ length: columns }, (_, index) => ({
                                type: "column",
                                attrs: { width },
                                content: [
                                    index === 0 && current
                                        ? (current as Record<string, unknown>)
                                        : { type: "paragraph" },
                                ],
                            })),
                        })
                        .run();
                },

            addColumnAfter:
                () =>
                ({ state, chain }) => {
                    const { $from } = state.selection;
                    for (let depth = $from.depth; depth > 0; depth -= 1) {
                        if ($from.node(depth).type.name !== "column") continue;
                        const row = $from.node(depth - 1);
                        if (row.type.name !== this.name) return false;
                        if (row.childCount >= 5) return false;

                        const insertAt = $from.after(depth);
                        const width = 1 / (row.childCount + 1);
                        return chain()
                            .insertContentAt(insertAt, {
                                type: "column",
                                attrs: { width },
                                content: [{ type: "paragraph" }],
                            })
                            .command(({ tr, dispatch }) => {
                                // Rebalance so the new column does not squash
                                // its neighbours into nothing.
                                if (!dispatch) return true;
                                const rowPos = $from.before(depth - 1);
                                const node = tr.doc.nodeAt(rowPos);
                                if (!node) return true;
                                let offset = rowPos + 1;
                                node.forEach((child) => {
                                    tr.setNodeMarkup(offset, undefined, {
                                        ...child.attrs,
                                        width,
                                    });
                                    offset += child.nodeSize;
                                });
                                return true;
                            })
                            .run();
                    }
                    return false;
                },

            deleteColumn:
                () =>
                ({ state, chain }) => {
                    const { $from } = state.selection;
                    for (let depth = $from.depth; depth > 0; depth -= 1) {
                        if ($from.node(depth).type.name !== "column") continue;
                        const row = $from.node(depth - 1);
                        if (row.type.name !== this.name) return false;
                        // Below two columns the layout stops being a layout.
                        if (row.childCount <= 2) {
                            return chain().unsetColumns().run();
                        }
                        return chain()
                            .deleteRange({ from: $from.before(depth), to: $from.after(depth) })
                            .run();
                    }
                    return false;
                },

            unsetColumns:
                () =>
                ({ state, chain }) => {
                    const { $from } = state.selection;
                    for (let depth = $from.depth; depth >= 0; depth -= 1) {
                        if ($from.node(depth).type.name !== this.name) continue;
                        const row = $from.node(depth);
                        const from = $from.before(depth);
                        const to = $from.after(depth);
                        const blocks: unknown[] = [];
                        row.forEach((column) => {
                            column.forEach((block) => blocks.push(block.toJSON()));
                        });
                        return chain()
                            .insertContentAt({ from, to }, blocks as never)
                            .run();
                    }
                    return false;
                },
        };
    },
});
