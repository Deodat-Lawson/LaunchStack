"use client";

import { useEditor, EditorContent, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { marked } from "marked";
import TurndownService from "turndown";
import {
    Bold,
    Heading1,
    Heading2,
    Heading3,
    Italic,
    List,
    ListOrdered,
    Quote,
    Redo2,
    Strikethrough,
    Undo2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CallNote } from "@launchstack/features/call-notes";
import styles from "./CallNoteEditor.module.css";

type NoteContent = Pick<CallNote, "contentRich" | "contentMarkdown">;
type ContentResolution =
    | { kind: "rich"; source: unknown; markdown: string }
    | { kind: "legacy-empty"; markdown: string; html: string }
    | { kind: "invalid"; source: unknown; markdown: string; reason: string };

const EMPTY_DOCUMENT: JSONContent = {
    type: "doc",
    content: [{ type: "paragraph" }],
};

const turndown = new TurndownService({ headingStyle: "atx" });
turndown.addRule("gfmStrikethrough", {
    filter: ["del", "s"],
    replacement: content => `~~${content}~~`,
});
// Underline is part of StarterKit in the installed Tiptap v3 build. Markdown has
// no native equivalent, so retain it as inline HTML instead of dropping it.
turndown.keep(["u"]);

function escapeHtml(value: string): string {
    return value.replace(
        /[&<>"']/g,
        character =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[character] ?? character
    );
}

function markdownToHtml(markdown: string): string {
    if (!markdown.trim()) return "<p></p>";
    try {
        return String(marked.parse(markdown, { async: false }));
    } catch {
        // Keep a legacy note editable even if a malformed Markdown extension
        // causes marked to reject it. The raw source is rendered as text.
        return `<p>${escapeHtml(markdown).replace(/\r?\n/g, "<br>")}</p>`;
    }
}

function resolveContent(content: NoteContent): ContentResolution {
    const rich = content.contentRich;
    const markdown = content.contentMarkdown;
    if (
        rich !== null &&
        typeof rich === "object" &&
        !Array.isArray(rich) &&
        Object.keys(rich).length === 0
    ) {
        return { kind: "legacy-empty", markdown, html: markdownToHtml(markdown) };
    }
    if (rich === null || typeof rich !== "object" || Array.isArray(rich)) {
        return {
            kind: "invalid",
            source: rich,
            markdown,
            reason: "contentRich must be a Tiptap document object",
        };
    }
    return { kind: "rich", source: rich, markdown };
}

function validateRichDocument(
    editor: Editor,
    source: unknown
): { document: JSONContent } | { error: string } {
    if (
        source === null ||
        typeof source !== "object" ||
        Array.isArray(source) ||
        !("type" in source) ||
        source.type !== "doc" ||
        !("content" in source) ||
        !Array.isArray(source.content)
    ) {
        return { error: "contentRich must be a Tiptap doc with a content array" };
    }

    try {
        const node = editor.schema.nodeFromJSON(source.content.length ? source : EMPTY_DOCUMENT);
        node.check();
        return { document: node.toJSON() as JSONContent };
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : "Unsupported rich-text content",
        };
    }
}

function serializeEditor(editor: Editor): NoteContent {
    return {
        contentRich: editor.getJSON() as CallNote["contentRich"],
        contentMarkdown: turndown.turndown(editor.getHTML()),
    };
}

function invalidContentEqual(
    previous: Extract<ContentResolution, { kind: "invalid" }> | null,
    next: Extract<ContentResolution, { kind: "invalid" }>
): boolean {
    return (
        previous?.reason === next.reason &&
        previous.markdown === next.markdown &&
        JSON.stringify(previous.source) === JSON.stringify(next.source)
    );
}

export interface CallNoteEditorProps {
    content: NoteContent;
    editable: boolean;
    onChange?: (content: NoteContent) => void;
    onSave?: () => void;
}

export function CallNoteEditor({ content, editable, onChange, onSave }: CallNoteEditorProps) {
    const { contentRich, contentMarkdown } = content;
    const initialResolutionRef = useRef<ContentResolution | undefined>(undefined);
    initialResolutionRef.current ??= resolveContent(content);
    const initialResolution = initialResolutionRef.current;
    const [invalidContent, setInvalidContent] = useState<Extract<
        ContentResolution,
        { kind: "invalid" }
    > | null>(initialResolution.kind === "invalid" ? initialResolution : null);
    const editableRef = useRef(editable);
    // Rich documents are validated against the live ProseMirror schema after
    // the editor exists. Keep the editor inert until that check completes.
    const validationPendingRef = useRef(initialResolution.kind === "rich");
    const invalidRef = useRef(
        initialResolution.kind === "rich" || initialResolution.kind === "invalid"
    );
    const suppressUpdatesRef = useRef(false);
    const lastLegacyMarkdownRef = useRef<string | null>(null);
    const onChangeRef = useRef(onChange);
    const onSaveRef = useRef(onSave);
    editableRef.current = editable;
    invalidRef.current = invalidContent !== null || validationPendingRef.current;
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;

    const editor = useEditor(
        {
            immediatelyRender: false,
            extensions: [
                StarterKit.configure({ trailingNode: false }),
                Placeholder.configure({
                    placeholder: "Write your note…",
                    showOnlyWhenEditable: true,
                }),
            ],
            // Content is installed by the reconciliation effect below. This
            // lets us validate rich JSON before Tiptap can drop bad content.
            content: EMPTY_DOCUMENT,
            editable: editable && initialResolution.kind === "legacy-empty",
            editorProps: {
                attributes: {
                    "aria-label": editable ? "Editable call note" : "Call note",
                    "aria-multiline": "true",
                    role: "textbox",
                },
                handleKeyDown: (_view, event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                        event.preventDefault();
                        if (editableRef.current && !invalidRef.current) onSaveRef.current?.();
                        return true;
                    }
                    return false;
                },
            },
            onUpdate: ({ editor: updatedEditor }) => {
                if (!editableRef.current || invalidRef.current || suppressUpdatesRef.current)
                    return;
                onChangeRef.current?.(serializeEditor(updatedEditor));
            },
        },
        []
    );

    // Re-render the toolbar when a selection/transaction changes so active
    // formatting and undo/redo availability stay accurate without recreating
    // the editor instance.
    const [, setToolbarVersion] = useState(0);
    useEffect(() => {
        if (!editor) return;
        const refreshToolbar = () => setToolbarVersion(version => version + 1);
        editor.on("selectionUpdate", refreshToolbar);
        editor.on("transaction", refreshToolbar);
        return () => {
            editor.off("selectionUpdate", refreshToolbar);
            editor.off("transaction", refreshToolbar);
        };
    }, [editor]);

    useEffect(() => {
        if (!editor) return;
        const next = resolveContent({ contentRich, contentMarkdown });
        if (next.kind === "invalid") {
            validationPendingRef.current = false;
            invalidRef.current = true;
            editor.setEditable(false, false);
            setInvalidContent(previous => (invalidContentEqual(previous, next) ? previous : next));
            return;
        }

        if (next.kind === "rich") {
            lastLegacyMarkdownRef.current = null;
            validationPendingRef.current = true;
            const validation = validateRichDocument(editor, next.source);
            if ("error" in validation) {
                const failed = {
                    kind: "invalid" as const,
                    source: next.source,
                    markdown: next.markdown,
                    reason: validation.error,
                };
                validationPendingRef.current = false;
                invalidRef.current = true;
                editor.setEditable(false, false);
                setInvalidContent(previous =>
                    invalidContentEqual(previous, failed) ? previous : failed
                );
                return;
            }

            validationPendingRef.current = false;
            invalidRef.current = false;
            setInvalidContent(previous => (previous === null ? previous : null));
            editor.setEditable(editable, false);
            const normalized = validation.document;
            if (JSON.stringify(editor.getJSON()) !== JSON.stringify(normalized)) {
                suppressUpdatesRef.current = true;
                try {
                    editor
                        .chain()
                        .setContent(normalized, { emitUpdate: false })
                        .setMeta("addToHistory", false)
                        .run();
                } finally {
                    suppressUpdatesRef.current = false;
                }
            }
            return;
        }

        validationPendingRef.current = false;
        invalidRef.current = false;
        setInvalidContent(previous => (previous === null ? previous : null));
        editor.setEditable(editable, false);

        // Markdown serializers normalize list markers and whitespace. Compare
        // the loaded source, not its projection, to preserve selection on polls.
        if (lastLegacyMarkdownRef.current !== next.markdown) {
            lastLegacyMarkdownRef.current = next.markdown;
            suppressUpdatesRef.current = true;
            try {
                editor
                    .chain()
                    .setContent(next.html, { emitUpdate: false })
                    .setMeta("addToHistory", false)
                    .run();
            } finally {
                suppressUpdatesRef.current = false;
            }
        }
    }, [contentRich, contentMarkdown, editor, editable]);

    if (invalidContent) return <UnsupportedContent content={invalidContent} />;
    if (!editor) {
        return (
            <div className={styles.editorLoading} role="status" aria-label="Loading note editor" />
        );
    }

    return (
        <div className={`${styles.editor} ${editable ? "" : styles.readOnly}`}>
            {editable && <FormattingToolbar editor={editor} />}
            <EditorContent editor={editor} className={styles.editorContent} />
        </div>
    );
}

function FormattingToolbar({ editor }: { editor: Editor }) {
    const activeHeading = editor.isActive("heading")
        ? String(editor.getAttributes("heading").level ?? "")
        : "paragraph";

    return (
        <div className={styles.toolbar} role="toolbar" aria-label="Note formatting">
            <div className={styles.toolbarGroup}>
                <ToolbarButton
                    label="Bold"
                    shortcut="⌘/Ctrl+B"
                    pressed={editor.isActive("bold")}
                    onClick={() => editor.chain().focus().toggleBold().run()}
                >
                    <Bold size={15} strokeWidth={2.2} />
                </ToolbarButton>
                <ToolbarButton
                    label="Italic"
                    shortcut="⌘/Ctrl+I"
                    pressed={editor.isActive("italic")}
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                >
                    <Italic size={15} strokeWidth={2.2} />
                </ToolbarButton>
                <ToolbarButton
                    label="Strikethrough"
                    shortcut="⌘/Ctrl+Shift+X"
                    pressed={editor.isActive("strike")}
                    onClick={() => editor.chain().focus().toggleStrike().run()}
                >
                    <Strikethrough size={15} strokeWidth={2.2} />
                </ToolbarButton>
            </div>

            <span className={styles.separator} role="separator" aria-orientation="vertical" />

            <label className={styles.headingControl}>
                <span className={styles.visuallyHidden}>Block style</span>
                <span aria-hidden="true" className={styles.headingIcon}>
                    {activeHeading === "1" ? (
                        <Heading1 size={15} />
                    ) : activeHeading === "2" ? (
                        <Heading2 size={15} />
                    ) : activeHeading === "3" ? (
                        <Heading3 size={15} />
                    ) : (
                        <span className={styles.headingText}>Text</span>
                    )}
                </span>
                <select
                    aria-label="Block style"
                    value={activeHeading}
                    onChange={event => {
                        const value = event.currentTarget.value;
                        if (value === "paragraph") {
                            editor.chain().focus().setParagraph().run();
                            return;
                        }
                        const level = Number(value);
                        if (
                            level === 1 ||
                            level === 2 ||
                            level === 3 ||
                            level === 4 ||
                            level === 5 ||
                            level === 6
                        ) {
                            if (!editor.isActive("heading", { level })) {
                                editor.chain().focus().toggleHeading({ level }).run();
                            }
                        }
                    }}
                >
                    <option value="paragraph">Paragraph</option>
                    <option value="1">Heading 1</option>
                    <option value="2">Heading 2</option>
                    <option value="3">Heading 3</option>
                    <option value="4">Heading 4</option>
                    <option value="5">Heading 5</option>
                    <option value="6">Heading 6</option>
                </select>
            </label>

            <span className={styles.separator} role="separator" aria-orientation="vertical" />

            <div className={styles.toolbarGroup}>
                <ToolbarButton
                    label="Bulleted list"
                    pressed={editor.isActive("bulletList")}
                    onClick={() => editor.chain().focus().toggleBulletList().run()}
                >
                    <List size={15} />
                </ToolbarButton>
                <ToolbarButton
                    label="Numbered list"
                    pressed={editor.isActive("orderedList")}
                    onClick={() => editor.chain().focus().toggleOrderedList().run()}
                >
                    <ListOrdered size={15} />
                </ToolbarButton>
                <ToolbarButton
                    label="Blockquote"
                    pressed={editor.isActive("blockquote")}
                    onClick={() => editor.chain().focus().toggleBlockquote().run()}
                >
                    <Quote size={15} />
                </ToolbarButton>
            </div>

            <span className={styles.separator} role="separator" aria-orientation="vertical" />

            <div className={styles.toolbarGroup}>
                <ToolbarButton
                    label="Undo"
                    disabled={!editor.can().undo()}
                    onClick={() => editor.chain().focus().undo().run()}
                >
                    <Undo2 size={15} />
                </ToolbarButton>
                <ToolbarButton
                    label="Redo"
                    disabled={!editor.can().redo()}
                    onClick={() => editor.chain().focus().redo().run()}
                >
                    <Redo2 size={15} />
                </ToolbarButton>
            </div>
        </div>
    );
}

function ToolbarButton({
    label,
    shortcut,
    pressed,
    disabled,
    onClick,
    children,
}: {
    label: string;
    shortcut?: string;
    pressed?: boolean;
    disabled?: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            className={styles.toolbarButton}
            aria-label={label}
            aria-pressed={pressed}
            title={shortcut ? `${label} (${shortcut})` : label}
            disabled={disabled}
            onMouseDown={event => event.preventDefault()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function UnsupportedContent({
    content,
}: {
    content: Extract<ContentResolution, { kind: "invalid" }>;
}) {
    let source: string;
    try {
        source = JSON.stringify(content.source, null, 2) ?? String(content.source);
    } catch {
        source = String(content.source);
    }

    return (
        <div className={styles.fallback} role="alert">
            <strong className={styles.fallbackTitle}>This note cannot be edited safely</strong>
            <p className={styles.fallbackMessage}>
                The saved rich-text content is malformed or uses formatting this editor does not
                support. No content was changed.
            </p>
            <p className={styles.fallbackReason}>{content.reason}</p>
            <details className={styles.sourceDetails}>
                <summary>Show original note data</summary>
                <pre className={styles.source}>{source}</pre>
                {content.markdown && (
                    <>
                        <span className={styles.sourceLabel}>Markdown projection</span>
                        <pre className={styles.source}>{content.markdown}</pre>
                    </>
                )}
            </details>
        </div>
    );
}
