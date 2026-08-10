/**
 * Structural blocks: page links, table of contents, breadcrumb, synced
 * blocks, and template buttons.
 */

import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import {
    BreadcrumbView,
    PageLinkView,
    SyncedBlockView,
    TableOfContentsView,
    TemplateButtonView,
} from "../nodeviews/AdvancedViews";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        advancedBlocks: {
            /** Insert a child-page or linked-page reference. */
            setPageLink: (attrs: {
                pageId: string;
                title?: string;
                icon?: unknown;
                isLink?: boolean;
            }) => ReturnType;
            setTableOfContents: () => ReturnType;
            setBreadcrumb: () => ReturnType;
            setSyncedBlock: (attrs?: { sourcePageId?: string | null }) => ReturnType;
            setTemplateButton: (attrs?: { label?: string }) => ReturnType;
        };
    }
}

export const PageLink = Node.create({
    name: "pageLink",
    group: "block",
    atom: true,
    draggable: true,
    selectable: true,

    addAttributes() {
        return {
            pageId: { default: null },
            /** Cached at insert time so a deleted page still shows a name. */
            title: { default: "Untitled" },
            icon: { default: null },
            /** True for "Link to page", false for a child page. */
            isLink: { default: false },
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-type="page-link"]' }];
    },

    renderHTML({ HTMLAttributes, node }) {
        return [
            "div",
            mergeAttributes(HTMLAttributes, {
                "data-type": "page-link",
                "data-page-id": String(node.attrs.pageId ?? ""),
            }),
            String(node.attrs.title ?? "Untitled"),
        ];
    },

    addNodeView() {
        return ReactNodeViewRenderer(PageLinkView);
    },

    addCommands() {
        return {
            setPageLink:
                (attrs) =>
                ({ commands }) =>
                    commands.insertContent({ type: this.name, attrs }),
        };
    },
});

export const TableOfContentsBlock = Node.create({
    name: "tableOfContentsBlock",
    group: "block",
    atom: true,
    draggable: true,

    parseHTML() {
        return [{ tag: 'div[data-type="table-of-contents"]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return [
            "div",
            mergeAttributes(HTMLAttributes, { "data-type": "table-of-contents" }),
        ];
    },

    addNodeView() {
        return ReactNodeViewRenderer(TableOfContentsView);
    },

    addCommands() {
        return {
            setTableOfContents:
                () =>
                ({ commands }) =>
                    commands.insertContent({ type: this.name }),
        };
    },
});

export const BreadcrumbBlock = Node.create({
    name: "breadcrumbBlock",
    group: "block",
    atom: true,
    draggable: true,

    parseHTML() {
        return [{ tag: 'div[data-type="breadcrumb"]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return ["div", mergeAttributes(HTMLAttributes, { "data-type": "breadcrumb" })];
    },

    addNodeView() {
        return ReactNodeViewRenderer(BreadcrumbView);
    },

    addCommands() {
        return {
            setBreadcrumb:
                () =>
                ({ commands }) =>
                    commands.insertContent({ type: this.name }),
        };
    },
});

export const SyncedBlock = Node.create({
    name: "syncedBlock",
    group: "block",
    atom: true,
    draggable: true,

    addAttributes() {
        return {
            sourcePageId: { default: null },
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-type="synced-block"]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return ["div", mergeAttributes(HTMLAttributes, { "data-type": "synced-block" })];
    },

    addNodeView() {
        return ReactNodeViewRenderer(SyncedBlockView);
    },

    addCommands() {
        return {
            setSyncedBlock:
                (attrs) =>
                ({ commands }) =>
                    commands.insertContent({ type: this.name, attrs: attrs ?? {} }),
        };
    },
});

export const TemplateButton = Node.create({
    name: "templateButton",
    group: "block",
    content: "block+",
    draggable: true,
    isolating: true,

    addAttributes() {
        return {
            label: { default: "New item" },
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-type="template-button"]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return [
            "div",
            mergeAttributes(HTMLAttributes, { "data-type": "template-button" }),
            0,
        ];
    },

    addNodeView() {
        return ReactNodeViewRenderer(TemplateButtonView);
    },

    addCommands() {
        return {
            setTemplateButton:
                (attrs) =>
                ({ commands }) =>
                    commands.insertContent({
                        type: this.name,
                        attrs: attrs ?? {},
                        content: [{ type: "paragraph" }],
                    }),
        };
    },
});
