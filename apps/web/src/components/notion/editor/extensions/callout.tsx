"use client";

/**
 * Callout — an icon plus a tinted panel wrapping arbitrary blocks.
 *
 * It holds `block+` rather than inline content so a callout can contain
 * lists, headings, and even nested callouts, which is what Notion allows.
 */

import { mergeAttributes, Node } from "@tiptap/core";
import {
    NodeViewContent,
    NodeViewWrapper,
    ReactNodeViewRenderer,
    type NodeViewProps,
} from "@tiptap/react";
import { useState } from "react";

import { backgroundColorValue, getColor } from "../../lib/colors";
import { EmojiPickerPopover } from "../../ui/EmojiPicker";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        callout: {
            /** Wrap the current block in a callout. */
            setCallout: (attrs?: { emoji?: string; color?: string }) => ReturnType;
            /** Unwrap the callout, keeping its contents. */
            unsetCallout: () => ReturnType;
            /** Change an existing callout's icon or tint. */
            updateCallout: (attrs: { emoji?: string; color?: string }) => ReturnType;
        };
    }
}

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
    const [pickerOpen, setPickerOpen] = useState(false);
    const emoji = (node.attrs.emoji as string) || "💡";
    const colorId = (node.attrs.color as string) || "gray";
    const color = getColor(colorId);

    return (
        <NodeViewWrapper
            className="ntn-callout"
            data-color={colorId}
            style={{
                background: backgroundColorValue(colorId) ?? "var(--panel-2)",
                borderColor: colorId === "default" ? "var(--line)" : color.swatch,
            }}
        >
            <div className="ntn-callout__icon" contentEditable={false}>
                <button
                    type="button"
                    className="ntn-callout__emoji"
                    onClick={() => setPickerOpen((open) => !open)}
                    disabled={!editor.isEditable}
                    aria-label="Change callout icon"
                >
                    {emoji}
                </button>
                {pickerOpen && (
                    <EmojiPickerPopover
                        onSelect={(next) => {
                            updateAttributes({ emoji: next });
                            setPickerOpen(false);
                        }}
                        onClose={() => setPickerOpen(false)}
                    />
                )}
            </div>
            <NodeViewContent className="ntn-callout__body" />
        </NodeViewWrapper>
    );
}

export const Callout = Node.create({
    name: "callout",
    group: "block",
    content: "block+",
    defining: true,

    addAttributes() {
        return {
            emoji: {
                default: "💡",
                parseHTML: (element) => element.getAttribute("data-emoji") ?? "💡",
                renderHTML: (attributes) => ({ "data-emoji": attributes.emoji as string }),
            },
            color: {
                default: "gray",
                parseHTML: (element) => element.getAttribute("data-color") ?? "gray",
                renderHTML: (attributes) => ({ "data-color": attributes.color as string }),
            },
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-type="callout"]' }, { tag: "aside" }];
    },

    renderHTML({ HTMLAttributes }) {
        return [
            "div",
            mergeAttributes(HTMLAttributes, { "data-type": "callout", class: "ntn-callout" }),
            0,
        ];
    },

    addNodeView() {
        return ReactNodeViewRenderer(CalloutView);
    },

    addCommands() {
        return {
            setCallout:
                (attrs) =>
                ({ commands }) =>
                    commands.wrapIn(this.name, attrs ?? {}),
            unsetCallout:
                () =>
                ({ commands }) =>
                    commands.lift(this.name),
            updateCallout:
                (attrs) =>
                ({ commands }) =>
                    commands.updateAttributes(this.name, attrs),
        };
    },

    addKeyboardShortcuts() {
        return {
            // A second Enter on an empty trailing paragraph exits the callout,
            // the same escape hatch blockquotes and lists give you.
            Enter: ({ editor }) => {
                const { $from, empty } = editor.state.selection;
                if (!empty) return false;
                if ($from.parent.type.name !== "paragraph") return false;
                if ($from.parent.content.size !== 0) return false;

                const parent = $from.node(-1);
                if (parent?.type.name !== this.name) return false;
                if ($from.index(-1) !== parent.childCount - 1) return false;

                return editor.chain().liftEmptyBlock().run();
            },
        };
    },
});
