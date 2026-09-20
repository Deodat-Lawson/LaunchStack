"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { useEffect } from "react";
import type { JSONContent } from "@tiptap/react";
import { Bold, Code, Italic, Link as LinkIcon, List, ListOrdered, Quote } from "lucide-react";

/**
 * Rich note editor — Tiptap wrapper used inside the per-document notes
 * panel. Emits both the Tiptap JSON tree (source of truth for rendering
 * later) and a plaintext projection used by the server to build the
 * embedding text. The plaintext path is deliberately lossy — it strips
 * marks/formatting so embeddings ride on content, not style.
 */

interface StickyNoteEditorProps {
    /** Initial Tiptap JSON; pass `null` for an empty editor. */
    initialContent: JSONContent | null;
    placeholder?: string;
    /** Fires on every keystroke with the current JSON + plaintext. */
    onChange: (payload: { json: JSONContent; text: string }) => void;
    /** Optional ref-like callback so callers can drive focus. */
    onReady?: (editor: Editor) => void;
    autofocus?: boolean;
    minHeight?: number;
}

export function StickyNoteEditor({
    initialContent,
    placeholder = "Write a note…",
    onChange,
    onReady,
    autofocus = false,
    minHeight = 120,
}: StickyNoteEditorProps) {
    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [2, 3] },
            }),
            Placeholder.configure({ placeholder }),
            Link.configure({
                openOnClick: false,
                autolink: true,
                HTMLAttributes: { rel: "noopener noreferrer nofollow" },
            }),
        ],
        content: initialContent ?? undefined,
        autofocus: autofocus ? "end" : false,
        // Tiptap v2+ requires this to avoid SSR hydration mismatches.
        immediatelyRender: false,
        editorProps: {
            attributes: {
                class: "sticky-note-editor-content",
            },
        },
        onUpdate: ({ editor: e }) => {
            onChange({ json: e.getJSON(), text: e.getText() });
        },
    });

    useEffect(() => {
        if (editor && onReady) onReady(editor);
    }, [editor, onReady]);

    // Swap content if the controlled `initialContent` identity changes
    // (e.g. user picks a different note to edit). Intentional reference check,
    // not a deep diff.
    useEffect(() => {
        if (!editor) return;
        editor.commands.setContent(initialContent ?? "", { emitUpdate: false });
    }, [editor, initialContent]);

    if (!editor) {
        return (
            <div
                style={{
                    minHeight,
                    padding: 10,
                    borderRadius: 8,
                    background: "var(--panel-2)",
                    border: "1px solid var(--line-2)",
                    color: "var(--ink-3)",
                    fontSize: 13,
                }}
            >
                Loading editor…
            </div>
        );
    }

    return (
        <div
            style={{
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--panel)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
            }}
        >
            <EditorToolbar editor={editor} />
            <div style={{ padding: "10px 12px", minHeight }}>
                <EditorContent editor={editor} />
            </div>
            <style jsx global>{`
                .sticky-note-editor-content {
                    min-height: 80px;
                    outline: none;
                    font-size: 13px;
                    line-height: 1.55;
                    color: var(--ink);
                }
                .sticky-note-editor-content p {
                    margin: 0 0 6px;
                }
                .sticky-note-editor-content p:last-child {
                    margin-bottom: 0;
                }
                .sticky-note-editor-content h2 {
                    font-size: 15px;
                    font-weight: 600;
                    margin: 10px 0 4px;
                    color: var(--ink);
                }
                .sticky-note-editor-content h3 {
                    font-size: 13px;
                    font-weight: 600;
                    margin: 8px 0 4px;
                    color: var(--ink);
                }
                .sticky-note-editor-content ul,
                .sticky-note-editor-content ol {
                    padding-left: 20px;
                    margin: 4px 0;
                }
                .sticky-note-editor-content li p {
                    margin: 0;
                }
                .sticky-note-editor-content blockquote {
                    border-left: 2px solid var(--accent);
                    padding: 2px 0 2px 10px;
                    margin: 6px 0;
                    color: var(--ink-2);
                    font-style: italic;
                }
                .sticky-note-editor-content code {
                    background: var(--panel-2);
                    border: 1px solid var(--line-2);
                    border-radius: 4px;
                    padding: 0 4px;
                    font-size: 12px;
                    font-family: var(--font-jetbrains-mono, monospace);
                }
                .sticky-note-editor-content pre {
                    background: var(--panel-2);
                    border: 1px solid var(--line-2);
                    border-radius: 6px;
                    padding: 8px 10px;
                    overflow-x: auto;
                    font-size: 12px;
                    font-family: var(--font-jetbrains-mono, monospace);
                    margin: 6px 0;
                }
                .sticky-note-editor-content pre code {
                    background: transparent;
                    border: none;
                    padding: 0;
                }
                .sticky-note-editor-content a {
                    color: var(--accent);
                    text-decoration: underline;
                }
                .sticky-note-editor-content p.is-editor-empty:first-child::before {
                    content: attr(data-placeholder);
                    float: left;
                    color: var(--ink-4);
                    pointer-events: none;
                    height: 0;
                }
            `}</style>
        </div>
    );
}

function EditorToolbar({ editor }: { editor: Editor }) {
    const buttons: Array<{
        label: string;
        icon: React.ReactNode;
        isActive: boolean;
        onClick: () => void;
    }> = [
        {
            label: "Bold",
            icon: <Bold size={13} />,
            isActive: editor.isActive("bold"),
            onClick: () => editor.chain().focus().toggleBold().run(),
        },
        {
            label: "Italic",
            icon: <Italic size={13} />,
            isActive: editor.isActive("italic"),
            onClick: () => editor.chain().focus().toggleItalic().run(),
        },
        {
            label: "Bullet list",
            icon: <List size={13} />,
            isActive: editor.isActive("bulletList"),
            onClick: () => editor.chain().focus().toggleBulletList().run(),
        },
        {
            label: "Ordered list",
            icon: <ListOrdered size={13} />,
            isActive: editor.isActive("orderedList"),
            onClick: () => editor.chain().focus().toggleOrderedList().run(),
        },
        {
            label: "Quote",
            icon: <Quote size={13} />,
            isActive: editor.isActive("blockquote"),
            onClick: () => editor.chain().focus().toggleBlockquote().run(),
        },
        {
            label: "Code",
            icon: <Code size={13} />,
            isActive: editor.isActive("code"),
            onClick: () => editor.chain().focus().toggleCode().run(),
        },
        {
            label: "Link",
            icon: <LinkIcon size={13} />,
            isActive: editor.isActive("link"),
            onClick: () => {
                const prev = (editor.getAttributes("link").href as string | undefined) ?? "";
                const url = window.prompt("Link URL", prev);
                if (url === null) return;
                if (url === "") {
                    editor.chain().focus().extendMarkRange("link").unsetLink().run();
                    return;
                }
                editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
            },
        },
    ];

    return (
        <div
            style={{
                display: "flex",
                gap: 2,
                padding: "4px 6px",
                borderBottom: "1px solid var(--line-2)",
                background: "var(--panel-2)",
            }}
        >
            {buttons.map(b => (
                <button
                    key={b.label}
                    type="button"
                    onClick={b.onClick}
                    title={b.label}
                    style={{
                        width: 26,
                        height: 26,
                        borderRadius: 5,
                        border: "none",
                        background: b.isActive ? "var(--accent-soft)" : "transparent",
                        color: b.isActive ? "var(--accent-ink)" : "var(--ink-2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                    }}
                >
                    {b.icon}
                </button>
            ))}
        </div>
    );
}

/**
 * Convert a Tiptap JSON document to a plain-ish markdown string for embedding.
 * Intentionally minimal — a full `tiptap-markdown` round-trip would be
 * overkill for the embedding path, which just wants readable tokens.
 */
export function tiptapJsonToMarkdown(doc: JSONContent | null | undefined): string {
    if (!doc) return "";
    const out: string[] = [];

    const walk = (node: JSONContent, depth: number): string => {
        if (!node) return "";
        const type = node.type ?? "text";
        const children = (node.content ?? []).map(c => walk(c, depth + 1)).join("");
        switch (type) {
            case "doc":
                return (node.content ?? [])
                    .map(c => walk(c, 0))
                    .filter(Boolean)
                    .join("\n\n");
            case "paragraph":
                return children;
            case "heading": {
                const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 2)));
                return `${"#".repeat(level)} ${children}`;
            }
            case "bulletList":
                return (node.content ?? []).map(c => "- " + walk(c, depth + 1).trim()).join("\n");
            case "orderedList":
                return (node.content ?? [])
                    .map((c, i) => `${i + 1}. ${walk(c, depth + 1).trim()}`)
                    .join("\n");
            case "listItem":
                return children;
            case "blockquote":
                return children
                    .split("\n")
                    .map(l => `> ${l}`)
                    .join("\n");
            case "codeBlock":
                return "```\n" + children + "\n```";
            case "hardBreak":
                return "\n";
            case "text": {
                let text = node.text ?? "";
                const marks = node.marks ?? [];
                for (const m of marks) {
                    if (m.type === "bold") text = `**${text}**`;
                    else if (m.type === "italic") text = `*${text}*`;
                    else if (m.type === "code") text = `\`${text}\``;
                    else if (m.type === "link" && m.attrs?.href)
                        text = `[${text}](${m.attrs.href})`;
                }
                return text;
            }
            default:
                return children;
        }
    };

    out.push(walk(doc, 0));
    return out.filter(Boolean).join("").trim();
}

/**
 * Parse the inline span of one block into Tiptap text nodes, honouring the
 * four marks the serializer above emits: bold, italic, code and link.
 *
 * Scanning for the earliest opener rather than running four passes is what
 * keeps `**bold with `code` inside**` from being mangled — the outer mark
 * wins and the inner one is parsed from its content.
 */
function inlineNodes(input: string, marks: JSONContent["marks"] = []): JSONContent[] {
    if (!input) return [];

    const patterns: Array<{
        re: RegExp;
        mark: (m: RegExpExecArray) => NonNullable<JSONContent["marks"]>[number];
        body: (m: RegExpExecArray) => string;
    }> = [
        // Code first: its content is literal, so nothing inside it is a mark.
        { re: /`([^`]+)`/, mark: () => ({ type: "code" }), body: m => m[1] ?? "" },
        {
            re: /\[([^\]]+)\]\(([^)\s]+)\)/,
            mark: m => ({ type: "link", attrs: { href: m[2] ?? "" } }),
            body: m => m[1] ?? "",
        },
        { re: /\*\*([^*]+)\*\*/, mark: () => ({ type: "bold" }), body: m => m[1] ?? "" },
        { re: /(?<!\*)\*([^*]+)\*(?!\*)/, mark: () => ({ type: "italic" }), body: m => m[1] ?? "" },
        { re: /_([^_]+)_/, mark: () => ({ type: "italic" }), body: m => m[1] ?? "" },
    ];

    let earliest: {
        index: number;
        match: RegExpExecArray;
        spec: (typeof patterns)[number];
    } | null = null;
    for (const spec of patterns) {
        const match = spec.re.exec(input);
        if (match && (earliest === null || match.index < earliest.index)) {
            earliest = { index: match.index, match, spec };
        }
    }

    const textNode = (text: string): JSONContent[] =>
        text ? [{ type: "text", text, ...(marks.length ? { marks } : {}) }] : [];

    if (!earliest) return textNode(input);

    const { index, match, spec } = earliest;
    const inner = spec.body(match);
    // A mark that already applies is not added twice; Tiptap tolerates it,
    // but a duplicate makes the JSON harder to read in the database.
    const nextMarks = [...(marks ?? [])];
    const added = spec.mark(match);
    if (!nextMarks.some(m => m.type === added.type)) nextMarks.push(added);

    return [
        ...textNode(input.slice(0, index)),
        ...inlineNodes(inner, nextMarks),
        ...inlineNodes(input.slice(index + match[0].length), marks),
    ];
}

/**
 * Convert markdown into Tiptap JSON — the inverse of
 * `tiptapJsonToMarkdown`, and deliberately the same small grammar.
 *
 * This exists because notes the agent captures store only markdown:
 * `content_rich` is null for every one of them. The editor is fed Tiptap
 * JSON, so opening such a note for editing showed the title with an empty
 * body, and saving from there wrote that emptiness back — the note's text
 * was destroyed by the act of looking at it. Parsing the markdown on the way
 * in keeps those notes editable.
 *
 * Anything outside the grammar the serializer emits stays literal text,
 * which is the safe direction to fail: a stray asterisk survives the round
 * trip, a dropped paragraph does not.
 */
export function markdownToTiptapJson(markdown: string | null | undefined): JSONContent | null {
    const src = (markdown ?? "").replace(/\r\n?/g, "\n");
    if (!src.trim()) return null;

    const lines = src.split("\n");
    const blocks: JSONContent[] = [];
    let i = 0;

    const paragraphOf = (text: string): JSONContent => {
        const content = inlineNodes(text.trim());
        return content.length ? { type: "paragraph", content } : { type: "paragraph" };
    };

    while (i < lines.length) {
        const line = lines[i] ?? "";

        if (!line.trim()) {
            i++;
            continue;
        }

        // Fenced code. Everything to the closing fence is literal, and an
        // unclosed fence runs to the end rather than swallowing the parse.
        if (line.startsWith("```")) {
            i++;
            const body: string[] = [];
            while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) {
                body.push(lines[i] ?? "");
                i++;
            }
            i++;
            const text = body.join("\n");
            blocks.push({
                type: "codeBlock",
                ...(text ? { content: [{ type: "text", text }] } : {}),
            });
            continue;
        }

        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (heading) {
            // The editor only registers levels 2 and 3; anything else would
            // be dropped by the schema, so it is clamped instead.
            const level = Math.min(3, Math.max(2, (heading[1] ?? "##").length));
            blocks.push({
                type: "heading",
                attrs: { level },
                content: inlineNodes((heading[2] ?? "").trim()),
            });
            i++;
            continue;
        }

        if (/^>\s?/.test(line)) {
            const quoted: string[] = [];
            while (i < lines.length && /^>\s?/.test(lines[i] ?? "")) {
                quoted.push((lines[i] ?? "").replace(/^>\s?/, ""));
                i++;
            }
            blocks.push({
                type: "blockquote",
                content: [paragraphOf(quoted.join("\n"))],
            });
            continue;
        }

        const bullet = /^\s*[-*+]\s+/;
        if (bullet.test(line)) {
            const items: JSONContent[] = [];
            while (i < lines.length && bullet.test(lines[i] ?? "")) {
                items.push({
                    type: "listItem",
                    content: [paragraphOf((lines[i] ?? "").replace(bullet, ""))],
                });
                i++;
            }
            blocks.push({ type: "bulletList", content: items });
            continue;
        }

        const ordered = /^\s*\d+[.)]\s+/;
        if (ordered.test(line)) {
            const items: JSONContent[] = [];
            while (i < lines.length && ordered.test(lines[i] ?? "")) {
                items.push({
                    type: "listItem",
                    content: [paragraphOf((lines[i] ?? "").replace(ordered, ""))],
                });
                i++;
            }
            blocks.push({ type: "orderedList", attrs: { start: 1 }, content: items });
            continue;
        }

        // A run of plain lines is one paragraph. The serializer joins blocks
        // with a blank line, so a single newline inside a block was a soft
        // break and is restored as one.
        const para: string[] = [];
        while (i < lines.length) {
            const next = lines[i] ?? "";
            if (
                !next.trim() ||
                next.startsWith("```") ||
                /^(#{1,6})\s+/.test(next) ||
                /^>\s?/.test(next) ||
                bullet.test(next) ||
                ordered.test(next)
            ) {
                break;
            }
            para.push(next);
            i++;
        }
        blocks.push(paragraphOf(para.join("\n")));
    }

    if (blocks.length === 0) return null;
    return { type: "doc", content: blocks };
}
