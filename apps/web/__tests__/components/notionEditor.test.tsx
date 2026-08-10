/** @jest-environment jsdom */

/**
 * The editor's schema and input rules.
 *
 * Typechecking proves the extension list compiles; it does not prove the
 * extensions can coexist. Two nodes claiming the same name, a node whose
 * content expression no other node can satisfy, or a duplicated command all
 * fail only when ProseMirror actually builds the schema — which is what
 * mounting the editor here does.
 *
 * The Markdown input rules are asserted alongside because they are the part
 * of the editor a user hits within seconds of typing, and they are silently
 * lost if an extension is dropped from the list.
 */

import React from "react";
import { act, render, screen } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import "@testing-library/jest-dom";

import { NotionEditorProvider, type NotionEditorContextValue } from "~/components/notion/context";
import { NotionEditor } from "~/components/notion/editor/NotionEditor";

// jsdom has no layout engine, and ProseMirror asks for one while positioning
// the caret and the drag handle.
beforeAll(() => {
    Range.prototype.getClientRects = () =>
        Object.assign([] as unknown as DOMRectList, { item: () => null });
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    Element.prototype.scrollIntoView = jest.fn();
    if (!window.matchMedia) {
        Object.defineProperty(window, "matchMedia", {
            value: () => ({
                matches: false,
                addEventListener: jest.fn(),
                removeEventListener: jest.fn(),
            }),
        });
    }
});

const context: NotionEditorContextValue = {
    pageId: "page-1",
    pages: [],
    getPageSummary: () => undefined,
    navigateToPage: jest.fn(),
    createChildPage: jest.fn().mockResolvedValue(null),
    uploadFile: jest.fn().mockResolvedValue(null),
    fetchBookmark: jest.fn().mockResolvedValue(null),
    commentedBlockIds: new Set(),
    breadcrumb: [],
    readOnly: false,
};

/**
 * Insert text the way a keystroke would.
 *
 * `insertContent` goes straight to a transaction and bypasses input rules,
 * which are exactly what the Markdown shorthands are — so the rules have to be
 * offered the text first, as the browser's `beforeinput` would.
 */
function typeText(editor: Editor, text: string): void {
    const { view } = editor;
    const { from, to } = view.state.selection;
    const insert = () => view.state.tr.insertText(text, from, to);
    const handled = view.someProp("handleTextInput", (fn) =>
        fn(view, from, to, text, insert)
    );
    if (!handled) view.dispatch(insert());
}

/** Mount the editor and hand back the instance once it exists. */
async function mountEditor(): Promise<Editor> {
    let editor: Editor | null = null;

    await act(async () => {
        render(
            <NotionEditorProvider value={context}>
                <NotionEditor
                    pageId="page-1"
                    initialContent={null}
                    editable
                    font="default"
                    smallText={false}
                    fullWidth={false}
                    onChange={jest.fn()}
                    onEditorReady={(instance) => {
                        if (instance) editor = instance;
                    }}
                    onComment={jest.fn()}
                />
            </NotionEditorProvider>
        );
    });

    if (!editor) throw new Error("Editor did not initialise");
    return editor;
}

describe("NotionEditor", () => {
    it("builds a schema containing every block type the menus can insert", async () => {
        const editor = await mountEditor();

        // One name per block the catalogue, drag handle, or slash menu targets.
        // A missing entry here means that block silently cannot be created.
        const expected = [
            "doc",
            "paragraph",
            "heading",
            "blockquote",
            "codeBlock",
            "bulletList",
            "orderedList",
            "listItem",
            "taskList",
            "taskItem",
            "horizontalRule",
            "callout",
            "columns",
            "column",
            "details",
            "detailsSummary",
            "detailsContent",
            "table",
            "tableRow",
            "tableCell",
            "tableHeader",
            "imageBlock",
            "videoBlock",
            "audioBlock",
            "fileBlock",
            "bookmark",
            "embedBlock",
            "databaseBlock",
            "pageLink",
            "tableOfContentsBlock",
            "breadcrumbBlock",
            "syncedBlock",
            "templateButton",
            "inlineMath",
            "blockMath",
            "mention",
            "emoji",
        ];

        for (const name of expected) {
            expect(Object.keys(editor.schema.nodes)).toContain(name);
        }
    });

    it("registers every mark the formatting toolbar toggles", async () => {
        const editor = await mountEditor();

        for (const name of [
            "bold",
            "italic",
            "strike",
            "underline",
            "code",
            "link",
            "highlight",
            "textStyle",
            "commentMark",
        ]) {
            expect(Object.keys(editor.schema.marks)).toContain(name);
        }
    });

    it("turns Markdown shorthand into the matching block", async () => {
        const editor = await mountEditor();

        // Every rule fires on the trailing space, so the prefix is inserted
        // normally and only the space goes through the text-input path.
        const cases: Array<[string, string, Record<string, unknown> | undefined]> = [
            ["#", "heading", { level: 1 }],
            ["##", "heading", { level: 2 }],
            ["###", "heading", { level: 3 }],
            ["-", "bulletList", undefined],
            ["1.", "orderedList", undefined],
            [">", "blockquote", undefined],
            ["[]", "taskList", undefined],
        ];

        for (const [prefix, node, attrs] of cases) {
            act(() => {
                editor.commands.clearContent();
                editor.commands.insertContent(prefix);
                typeText(editor, " ");
            });
            expect(
                attrs ? editor.isActive(node, attrs) : editor.isActive(node)
            ).toBe(true);
        }
    });

    it("exposes the commands the block catalogue dispatches", async () => {
        const editor = await mountEditor();

        for (const command of [
            "setCallout",
            "setColumns",
            "setToggle",
            "setPageLink",
            "setTableOfContents",
            "setBreadcrumb",
            "setSyncedBlock",
            "setTemplateButton",
            "setDatabaseBlock",
            "setImageBlock",
            "setBookmark",
            "setEmbedBlock",
            "setBlockColor",
            "setBlockBackground",
            "insertInlineMath",
            "insertTable",
            "toggleTaskList",
        ]) {
            expect(typeof (editor.commands as Record<string, unknown>)[command]).toBe(
                "function"
            );
        }
    });

    it("wraps a paragraph in a callout and keeps its text", async () => {
        const editor = await mountEditor();

        act(() => {
            editor.commands.clearContent();
            editor.commands.insertContent("Heads up");
            editor.commands.setCallout();
        });

        expect(editor.isActive("callout")).toBe(true);
        expect(editor.getText()).toContain("Heads up");
    });

    it("splits the current block into a column layout without losing it", async () => {
        const editor = await mountEditor();

        act(() => {
            editor.commands.clearContent();
            editor.commands.insertContent("Side by side");
            editor.commands.setColumns(3);
        });

        const json = editor.getJSON();
        const columns = json.content?.find((node) => node.type === "columns");
        expect(columns).toBeDefined();
        expect(columns?.content).toHaveLength(3);
        expect(editor.getText()).toContain("Side by side");
    });

    it("gives every block a stable id so comments can anchor to one", async () => {
        const editor = await mountEditor();

        act(() => {
            editor.commands.clearContent();
            editor.commands.insertContent("First");
        });

        const [first] = editor.getJSON().content ?? [];
        expect(first?.attrs?.id).toEqual(expect.any(String));
    });

    it("renders read-only when the page is locked", async () => {
        await act(async () => {
            render(
                <NotionEditorProvider value={context}>
                    <NotionEditor
                        pageId="page-2"
                        initialContent={{
                            type: "doc",
                            content: [
                                { type: "paragraph", content: [{ type: "text", text: "Locked" }] },
                            ],
                        }}
                        editable={false}
                        font="serif"
                        smallText
                        fullWidth
                        onChange={jest.fn()}
                        onComment={jest.fn()}
                    />
                </NotionEditorProvider>
            );
        });

        expect(await screen.findByText("Locked")).toBeInTheDocument();
        // The gutter handle and selection toolbar are editing affordances and
        // must not be mounted on a locked page.
        expect(document.querySelector(".ntn-handle")).toBeNull();
    });
});
