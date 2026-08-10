"use client";

/**
 * Gutter markers for blocks that carry an unresolved comment thread.
 *
 * The threads live in the database, not the document, so this cannot be a
 * node attribute — it would go stale the moment someone resolved a thread.
 * Instead a decoration reads the current id set on every render, which keeps
 * the marker and the comments rail in agreement without touching the doc.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const commentMarkersKey = new PluginKey("commentMarkers");

export interface CommentMarkersOptions {
    /** Read at decoration time so a resolve updates without a doc change. */
    getCommentedBlockIds: () => Set<string>;
}

export function createCommentMarkers(
    getCommentedBlockIds: () => Set<string>
): Extension<CommentMarkersOptions> {
    return Extension.create<CommentMarkersOptions>({
        name: "commentMarkers",

        addOptions() {
            return { getCommentedBlockIds };
        },

        addProseMirrorPlugins() {
            const read = this.options.getCommentedBlockIds;

            return [
                new Plugin({
                    key: commentMarkersKey,
                    props: {
                        decorations(state) {
                            const ids = read();
                            if (ids.size === 0) return DecorationSet.empty;

                            const decorations: Decoration[] = [];
                            state.doc.descendants((node, pos) => {
                                const id = node.attrs.id as string | undefined;
                                if (!id || !ids.has(id)) return;
                                decorations.push(
                                    Decoration.node(pos, pos + node.nodeSize, {
                                        class: "ntn-has-comment",
                                    })
                                );
                            });

                            return DecorationSet.create(state.doc, decorations);
                        },
                    },
                }),
            ];
        },
    });
}
