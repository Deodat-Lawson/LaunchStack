"use client";

/**
 * The editor surface.
 *
 * Owns the Tiptap instance and the chrome that hangs off it: the gutter
 * handle, the selection toolbar, the table controls, and the dialogs the block
 * commands open. Persistence is not its job — it reports changes upward and
 * the page shell decides when to save.
 */

import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useNotionEditor } from "../context";
import type { BlockCommandContext } from "../lib/blocks";
import { EmojiPickerPopover } from "../ui/EmojiPicker";
import { PagePickerDialog } from "../ui/PagePickerDialog";
import { buildExtensions } from "./extensions";
import type { SuggestionRuntime } from "./extensions/suggestions";
import { BlockHandle } from "./menus/BlockHandle";
import { BubbleToolbar } from "./menus/BubbleToolbar";
import { TableToolbar } from "./menus/TableToolbar";

export interface NotionEditorProps {
    /** Re-mounts the editor when it changes — one instance per page. */
    pageId: string;
    initialContent: JSONContent | null;
    editable: boolean;
    font: "default" | "serif" | "mono";
    smallText: boolean;
    fullWidth: boolean;
    onChange: (doc: JSONContent) => void;
    onEditorReady?: (editor: Editor | null) => void;
    /** Opens the comment composer in the page's right rail. */
    onComment: (blockId: string, anchorText: string) => void;
    /** Opens the "Move to" dialog for a block. */
    onMoveBlock?: (blockId: string) => void;
}

export function NotionEditor({
    pageId,
    initialContent,
    editable,
    font,
    smallText,
    fullWidth,
    onChange,
    onEditorReady,
    onComment,
    onMoveBlock,
}: NotionEditorProps) {
    const workspace = useNotionEditor();
    const [pagePicker, setPagePicker] = useState<null | "link" | "child">(null);
    const [emojiAnchor, setEmojiAnchor] = useState(false);

    // The suggestion plugins read this on every keystroke. A ref keeps the
    // extension array stable while the data behind it stays current.
    const runtimeRef = useRef<SuggestionRuntime>({
        ctx: {} as BlockCommandContext,
        pages: [],
        people: [],
    });
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    // Same reason as `runtimeRef`: the decoration plugin outlives any one
    // render, so it reads through a ref rather than closing over a value.
    const commentedRef = useRef(workspace.commentedBlockIds);
    commentedRef.current = workspace.commentedBlockIds;

    const uploadAndInsert = useCallback(
        async (editor: Editor, files: File[], pos: number | null) => {
            for (const file of files) {
                const uploaded = await workspace.uploadFile(file);
                if (!uploaded) continue;

                const type = file.type.startsWith("image/")
                    ? "imageBlock"
                    : file.type.startsWith("video/")
                      ? "videoBlock"
                      : file.type.startsWith("audio/")
                        ? "audioBlock"
                        : "fileBlock";

                const attrs =
                    type === "fileBlock"
                        ? {
                              src: uploaded.url,
                              name: uploaded.name,
                              size: uploaded.size,
                              contentType: uploaded.contentType,
                          }
                        : { src: uploaded.url, alt: uploaded.name };

                const chain = editor.chain().focus();
                if (pos === null) chain.insertContent({ type, attrs }).run();
                else chain.insertContentAt(pos, { type, attrs }).run();
            }
        },
        [workspace]
    );

    const editor = useEditor(
        {
            immediatelyRender: false,
            editable,
            extensions: buildExtensions({
                getRuntime: () => runtimeRef.current,
                getCommentedBlockIds: () => commentedRef.current,
                onFileDrop: (files, pos) => {
                    if (!editorRef.current) return;
                    void uploadAndInsert(editorRef.current, files, pos);
                },
            }),
            content: initialContent ?? { type: "doc", content: [{ type: "paragraph" }] },
            editorProps: {
                attributes: {
                    class: "ntn-prose",
                    spellcheck: "true",
                },
                handleClickOn: (_view, _pos, node, _nodePos, event) => {
                    // Internal links navigate in-app instead of hitting the
                    // network with an unroutable `page://` URL.
                    const target = event.target as HTMLElement;
                    const anchor = target.closest("a");
                    const href = anchor?.getAttribute("href");
                    if (href?.startsWith("page://")) {
                        event.preventDefault();
                        workspace.navigateToPage(href.slice("page://".length));
                        return true;
                    }
                    if (node.type.name === "mention" && node.attrs.kind === "page") {
                        workspace.navigateToPage(String(node.attrs.id));
                        return true;
                    }
                    return false;
                },
            },
            onUpdate: ({ editor: instance }) => {
                onChangeRef.current(instance.getJSON());
            },
        },
        // Rebuilding on `pageId` gives each page its own history stack, which
        // is what stops ⌘Z from undoing edits made on a page you have left.
        [pageId]
    );

    const editorRef = useRef<Editor | null>(null);
    editorRef.current = editor;

    useEffect(() => {
        onEditorReady?.(editor);
        return () => onEditorReady?.(null);
    }, [editor, onEditorReady]);

    useEffect(() => {
        editor?.setEditable(editable);
    }, [editor, editable]);

    /** The commands the slash menu and block menus dispatch. */
    const commandContext = useMemo<BlockCommandContext>(
        () => ({
            createSubPage: async () => {
                const page = await workspace.createChildPage();
                if (!page || !editorRef.current) return;
                editorRef.current
                    .chain()
                    .focus()
                    .setPageLink({ pageId: page.id, title: page.title, icon: page.icon })
                    .run();
            },
            linkToPage: () => setPagePicker("link"),
            insertDatabase: async (view) => {
                const response = await fetch("/api/workspace/databases", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ pageId, viewType: view, isInline: true }),
                });
                if (!response.ok) return;
                const data = (await response.json()) as {
                    database?: { id: string; views: Array<{ id: string }> };
                };
                if (!data.database || !editorRef.current) return;
                editorRef.current
                    .chain()
                    .focus()
                    .setDatabaseBlock({
                        databaseId: data.database.id,
                        viewId: data.database.views[0]?.id ?? null,
                    })
                    .run();
            },
            pickEmoji: () => setEmojiAnchor(true),
            mention: (kind) => {
                // Typing the trigger is what opens the menu, so the command
                // simply inserts it and lets the suggestion plugin take over.
                editorRef.current
                    ?.chain()
                    .focus()
                    .insertContent(kind === "date" ? "@" : "@")
                    .run();
            },
            comment: () => {
                const instance = editorRef.current;
                if (!instance) return;
                const { from, to } = instance.state.selection;
                const blockId =
                    (instance.state.selection.$from.parent.attrs.id as string) ?? "";
                onComment(blockId, instance.state.doc.textBetween(from, to, " "));
            },
        }),
        [onComment, pageId, workspace]
    );

    runtimeRef.current = {
        ctx: commandContext,
        pages: workspace.pages,
        people: [],
    };

    /** Shortcuts Tiptap does not own. */
    useEffect(() => {
        if (!editor) return;
        const onKeyDown = (event: KeyboardEvent) => {
            const mod = event.metaKey || event.ctrlKey;
            if (!mod) return;

            if (event.key.toLowerCase() === "k" && !event.shiftKey) {
                // Only claim ⌘K when there is a selection to link.
                if (editor.state.selection.empty) return;
                event.preventDefault();
                const href = window.prompt("Link URL");
                if (href) {
                    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
                }
            }
            if (event.shiftKey && event.key.toLowerCase() === "m") {
                event.preventDefault();
                commandContext.comment();
            }
            if (event.shiftKey && event.key.toLowerCase() === "e") {
                event.preventDefault();
                const { from, to } = editor.state.selection;
                const latex = editor.state.doc.textBetween(from, to, " ");
                editor.chain().focus().deleteSelection().insertInlineMath({ latex }).run();
            }
            if (event.key.toLowerCase() === "d" && !event.shiftKey) {
                event.preventDefault();
                const { $from } = editor.state.selection;
                const node = $from.parent;
                const json = node.toJSON() as Record<string, unknown>;
                const attrs = { ...((json.attrs as Record<string, unknown>) ?? {}) };
                delete attrs.id;
                editor
                    .chain()
                    .focus()
                    .insertContentAt($from.after(), { ...json, attrs } as never)
                    .run();
            }
        };

        const dom = editor.view.dom;
        dom.addEventListener("keydown", onKeyDown);
        return () => dom.removeEventListener("keydown", onKeyDown);
    }, [editor, commandContext]);

    if (!editor) {
        return <div className="ntn-editor__loading" />;
    }

    return (
        <div
            className="ntn-editor"
            data-font={font}
            data-small={smallText ? "true" : "false"}
            data-full-width={fullWidth ? "true" : "false"}
        >
            <EditorContent editor={editor} />

            {editable && (
                <>
                    <BlockHandle
                        editor={editor}
                        onInsertBelow={(pos) => {
                            editor
                                .chain()
                                .focus()
                                .insertContentAt(pos, { type: "paragraph" })
                                .setTextSelection(pos + 1)
                                .insertContent("/")
                                .run();
                        }}
                        onComment={onComment}
                        onMoveTo={(blockId) => onMoveBlock?.(blockId)}
                    />
                    <BubbleToolbar
                        editor={editor}
                        onComment={(text) => {
                            const blockId =
                                (editor.state.selection.$from.parent.attrs.id as string) ?? "";
                            onComment(blockId, text);
                        }}
                    />
                    <TableToolbar editor={editor} />
                </>
            )}

            {emojiAnchor && (
                <EmojiPickerPopover
                    onSelect={(emoji) => {
                        editor.chain().focus().insertContent(emoji).run();
                        setEmojiAnchor(false);
                    }}
                    onClose={() => setEmojiAnchor(false)}
                />
            )}

            <PagePickerDialog
                open={pagePicker !== null}
                title="Link to page"
                onClose={() => setPagePicker(null)}
                onSelect={(page) => {
                    editor
                        .chain()
                        .focus()
                        .setPageLink({
                            pageId: page.id,
                            title: page.title || "Untitled",
                            icon: page.icon,
                            isLink: true,
                        })
                        .run();
                    setPagePicker(null);
                }}
            />
        </div>
    );
}
