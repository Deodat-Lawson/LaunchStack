/**
 * Inline comment highlight.
 *
 * A comment thread lives in `workspace_comments`; this mark is only the
 * yellow underline that says "there is a thread here". Keeping the thread id
 * on the mark means the highlight survives editing around it, and removing the
 * mark never deletes the conversation.
 */

import { Mark, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        commentMark: {
            /** Mark the selection as belonging to a thread. */
            setCommentMark: (threadId: string) => ReturnType;
            /** Remove the highlight for a thread (used when it is resolved). */
            unsetCommentMark: () => ReturnType;
        };
    }
}

export const CommentMark = Mark.create({
    name: "commentMark",
    // Comments overlap freely — two threads can touch the same words.
    excludes: "",
    inclusive: false,

    addAttributes() {
        return {
            threadId: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-thread-id"),
                renderHTML: (attributes) =>
                    attributes.threadId
                        ? { "data-thread-id": String(attributes.threadId) }
                        : {},
            },
            resolved: {
                default: false,
                parseHTML: (element) => element.getAttribute("data-resolved") === "true",
                renderHTML: (attributes) => ({
                    "data-resolved": attributes.resolved ? "true" : "false",
                }),
            },
        };
    },

    parseHTML() {
        return [{ tag: "span[data-thread-id]" }];
    },

    renderHTML({ HTMLAttributes }) {
        return [
            "span",
            mergeAttributes(HTMLAttributes, { class: "ntn-comment-mark" }),
            0,
        ];
    },

    addCommands() {
        return {
            setCommentMark:
                (threadId) =>
                ({ commands }) =>
                    commands.setMark(this.name, { threadId, resolved: false }),
            unsetCommentMark:
                () =>
                ({ commands }) =>
                    commands.unsetMark(this.name),
        };
    },
});
