/**
 * Cross-cutting block attributes.
 *
 * Notion colours a whole block, not a text run: "Blue background" on a
 * paragraph tints the paragraph even where there is no text. That is a node
 * attribute rather than a mark, and it has to exist on every block type the
 * colour menu can reach — hence one extension that adds it globally instead of
 * an override per node.
 */

import { Extension } from "@tiptap/core";

import { backgroundColorValue, textColorValue } from "../../lib/colors";

/** Block types the colour menu and the block menu apply to. */
export const COLORABLE_BLOCKS = [
    "paragraph",
    "heading",
    "blockquote",
    "bulletList",
    "orderedList",
    "taskList",
    "listItem",
    "taskItem",
    "codeBlock",
    "details",
    "imageBlock",
    "pageLink",
] as const;

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        blockAttributes: {
            /** Set the text colour of every block in the selection. */
            setBlockColor: (color: string) => ReturnType;
            /** Set the background tint of every block in the selection. */
            setBlockBackground: (color: string) => ReturnType;
            /** Clear both. */
            clearBlockColor: () => ReturnType;
        };
    }
}

export const BlockAttributes = Extension.create({
    name: "blockAttributes",

    addGlobalAttributes() {
        return [
            {
                types: [...COLORABLE_BLOCKS],
                attributes: {
                    blockColor: {
                        default: null,
                        parseHTML: (element) => element.getAttribute("data-block-color"),
                        renderHTML: (attributes) => {
                            const color = textColorValue(attributes.blockColor as string);
                            if (!color) return {};
                            return {
                                "data-block-color": attributes.blockColor as string,
                                style: `color:${color}`,
                            };
                        },
                    },
                    blockBackground: {
                        default: null,
                        parseHTML: (element) => element.getAttribute("data-block-background"),
                        renderHTML: (attributes) => {
                            const background = backgroundColorValue(
                                attributes.blockBackground as string
                            );
                            if (!background) return {};
                            return {
                                "data-block-background": attributes.blockBackground as string,
                                style: `background:${background}`,
                            };
                        },
                    },
                },
            },
        ];
    },

    addCommands() {
        // Each command walks the selected range rather than calling
        // `updateAttributes`, so selecting three paragraphs colours all three
        // instead of only the one holding the anchor.
        return {
            setBlockColor:
                (color) =>
                ({ state, tr, dispatch }) => {
                    const { from, to } = state.selection;
                    let touched = false;
                    state.doc.nodesBetween(from, to, (node, pos) => {
                        if (!node.type.isBlock) return;
                        if (!("blockColor" in node.attrs)) return;
                        tr.setNodeMarkup(pos, undefined, {
                            ...node.attrs,
                            blockColor: color === "default" ? null : color,
                        });
                        touched = true;
                    });
                    if (touched && dispatch) dispatch(tr);
                    return touched;
                },

            setBlockBackground:
                (color) =>
                ({ state, tr, dispatch }) => {
                    const { from, to } = state.selection;
                    let touched = false;
                    state.doc.nodesBetween(from, to, (node, pos) => {
                        if (!node.type.isBlock) return;
                        if (!("blockBackground" in node.attrs)) return;
                        tr.setNodeMarkup(pos, undefined, {
                            ...node.attrs,
                            blockBackground:
                                color === "default" || color === "default_background"
                                    ? null
                                    : color.replace(/_background$/, ""),
                        });
                        touched = true;
                    });
                    if (touched && dispatch) dispatch(tr);
                    return touched;
                },

            clearBlockColor:
                () =>
                ({ state, tr, dispatch }) => {
                    const { from, to } = state.selection;
                    let touched = false;
                    state.doc.nodesBetween(from, to, (node, pos) => {
                        if (!node.type.isBlock) return;
                        if (!("blockColor" in node.attrs)) return;
                        tr.setNodeMarkup(pos, undefined, {
                            ...node.attrs,
                            blockColor: null,
                            blockBackground: null,
                        });
                        touched = true;
                    });
                    if (touched && dispatch) dispatch(tr);
                    return touched;
                },
        };
    },
});
