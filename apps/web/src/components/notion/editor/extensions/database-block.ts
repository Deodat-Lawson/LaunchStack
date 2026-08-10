/**
 * The inline database block.
 *
 * The block itself holds only a reference: the schema, the views and the rows
 * live in `workspace_databases` / `workspace_pages`, because a database is
 * shared state that outlives the document it happens to be embedded in.
 */

import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { DatabaseBlockView } from "../nodeviews/DatabaseBlockView";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        databaseBlock: {
            setDatabaseBlock: (attrs: {
                databaseId: string;
                viewId?: string | null;
            }) => ReturnType;
        };
    }
}

export const DatabaseBlock = Node.create({
    name: "databaseBlock",
    group: "block",
    atom: true,
    draggable: true,

    addAttributes() {
        return {
            databaseId: { default: null },
            /** Which saved view this embed opens on. */
            viewId: { default: null },
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-type="database-block"]' }];
    },

    renderHTML({ HTMLAttributes, node }) {
        return [
            "div",
            mergeAttributes(HTMLAttributes, {
                "data-type": "database-block",
                "data-database-id": String(node.attrs.databaseId ?? ""),
            }),
        ];
    },

    addNodeView() {
        return ReactNodeViewRenderer(DatabaseBlockView);
    },

    addCommands() {
        return {
            setDatabaseBlock:
                (attrs) =>
                ({ commands }) =>
                    commands.insertContent({ type: this.name, attrs }),
        };
    },
});
