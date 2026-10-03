"use client";

import React, {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    EditorContent,
    Extension,
    Node,
    NodeViewWrapper,
    ReactNodeViewRenderer,
    mergeAttributes,
    useEditor,
    type JSONContent,
    type NodeViewProps,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { marked } from "marked";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import { Bold, CheckSquare, Code, Italic, List, Quote, Redo, Undo } from "lucide-react";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { cn } from "~/lib/utils";
import type { EphemeralAttachment } from "./types";

export interface ComposerContext {
    id: string;
    kind: "source" | "attachment" | "quote" | "thread";
    label: string;
    markdown: string;
    quote?: string;
    comment?: string;
    attachment?: EphemeralAttachment;
    unavailable?: boolean;
}
export interface RichChatEditorHandle {
    focus: () => void;
    insertContext: (context: ComposerContext) => void;
    insertText: (value: string) => void;
    getJSON: () => JSONContent | null;
    getContexts: () => ComposerContext[];
    isInList: () => boolean;
    getSelection: () => { start: number; end: number; atStart: boolean; atEnd: boolean };
}
export interface RichChatEditorProps {
    value: string;
    content?: JSONContent | null;
    contexts: ComposerContext[];
    placeholder: string;
    onChange: (markdown: string, content: JSONContent, contexts: ComposerContext[]) => void;
    onKeyDown: (event: KeyboardEvent) => boolean;
    onPaste: (event: ClipboardEvent, selectedLength: number) => boolean;
    onOpenContext: (context: ComposerContext) => void;
}

function ContextNodeView({ node, extension }: NodeViewProps) {
    const context = node.attrs.context as ComposerContext;
    return (
        <NodeViewWrapper
            as="span"
            className="inline"
            contentEditable={false}
            data-drag-handle=""
            data-context-unavailable={context.unavailable ? "true" : undefined}
        >
            <Button
                variant="secondary"
                size="sm"
                className={`border-line mx-0.5 inline-flex h-6 max-w-[240px] border px-1.5 align-baseline text-xs ${context.unavailable ? "text-ink-3 border-dashed" : ""}`}
                title={
                    context.unavailable
                        ? "This context is no longer available. Remove it or restore access before sending."
                        : (context.comment ?? context.quote ?? context.label)
                }
                aria-label={`${context.kind === "quote" ? "Quoted response" : context.kind === "source" ? "Source context" : context.kind === "thread" ? "Conversation context" : "Attached file"}: ${context.label}`}
                onClick={() =>
                    (extension.options as { onOpen: (context: ComposerContext) => void }).onOpen(
                        context
                    )
                }
            >
                {context.kind === "quote" ? <Quote className="size-3" /> : null}
                <span className="truncate">
                    {context.comment ?? context.label}
                    {context.unavailable ? " · unavailable" : ""}
                </span>
            </Button>
        </NodeViewWrapper>
    );
}

const InlineContext = Node.create({
    name: "composerContext",
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    draggable: true,
    addOptions() {
        return { onOpen: (_context: ComposerContext) => undefined };
    },
    addAttributes() {
        return {
            context: {
                default: null,
                parseHTML: element => {
                    try {
                        const value = JSON.parse(
                            element.getAttribute("data-composer-context") ?? "null"
                        ) as Partial<ComposerContext> | null;
                        return value &&
                            typeof value.id === "string" &&
                            typeof value.label === "string" &&
                            typeof value.markdown === "string" &&
                            ["source", "attachment", "quote", "thread"].includes(value.kind ?? "")
                            ? value
                            : null;
                    } catch {
                        return null;
                    }
                },
                renderHTML: attributes => ({
                    "data-composer-context": JSON.stringify(attributes.context),
                }),
            },
        };
    },
    parseHTML() {
        return [
            {
                tag: "span[data-composer-context]",
                getAttrs: element => {
                    try {
                        const value = JSON.parse(
                            element.getAttribute("data-composer-context") ?? "null"
                        ) as Partial<ComposerContext> | null;
                        return value &&
                            typeof value.id === "string" &&
                            typeof value.label === "string" &&
                            typeof value.markdown === "string" &&
                            ["source", "attachment", "quote", "thread"].includes(value.kind ?? "")
                            ? null
                            : false;
                    } catch {
                        return false;
                    }
                },
            },
        ];
    },
    renderHTML({ node, HTMLAttributes }) {
        return [
            "span",
            mergeAttributes(HTMLAttributes, {
                class: "composer-inline-context",
                contenteditable: "false",
            }),
            (node.attrs.context as ComposerContext | null)?.label ?? "Context",
        ];
    },
    addNodeView() {
        return ReactNodeViewRenderer(ContextNodeView);
    },
});

const TaskLists = Extension.create({
    name: "composerTaskLists",
    priority: 1100,
    addGlobalAttributes() {
        return [
            {
                types: ["listItem"],
                attributes: {
                    checked: {
                        default: null,
                        parseHTML: element => {
                            const input =
                                element.querySelector<HTMLInputElement>('input[type="checkbox"]');
                            const saved = element.getAttribute("data-task-checked");
                            return input
                                ? input.checked
                                : saved === "true"
                                  ? true
                                  : saved === "false"
                                    ? false
                                    : null;
                        },
                        renderHTML: attributes =>
                            typeof attributes.checked === "boolean"
                                ? { "data-task-checked": String(attributes.checked) }
                                : {},
                    },
                },
            },
        ];
    },
    addKeyboardShortcuts() {
        return {
            Enter: () =>
                this.editor.isActive("listItem") &&
                typeof this.editor.getAttributes("listItem").checked === "boolean"
                    ? this.editor.commands.splitListItem("listItem", { checked: false })
                    : false,
            "Alt-Enter": () =>
                this.editor.isActive("listItem")
                    ? this.editor.commands.updateAttributes("listItem", {
                          checked: !this.editor.getAttributes("listItem").checked,
                      })
                    : false,
        };
    },
    addProseMirrorPlugins() {
        const editor = this.editor;
        return [
            new Plugin({
                props: {
                    decorations(state) {
                        const widgets: Decoration[] = [];
                        state.doc.descendants((node, position) => {
                            if (
                                node.type.name !== "listItem" ||
                                typeof node.attrs.checked !== "boolean"
                            )
                                return;
                            widgets.push(
                                Decoration.widget(
                                    position + 1,
                                    () => {
                                        const input = document.createElement("input");
                                        input.type = "checkbox";
                                        input.checked = Boolean(node.attrs.checked);
                                        input.className = "mr-1 accent-[var(--accent)]";
                                        input.setAttribute("aria-label", "Complete task");
                                        input.contentEditable = "false";
                                        input.addEventListener("mousedown", event =>
                                            event.preventDefault()
                                        );
                                        input.addEventListener("change", () => {
                                            const current = editor.state.doc.nodeAt(position);
                                            if (current?.type.name === "listItem")
                                                editor.view.dispatch(
                                                    editor.state.tr.setNodeMarkup(
                                                        position,
                                                        undefined,
                                                        { ...current.attrs, checked: input.checked }
                                                    )
                                                );
                                        });
                                        return input;
                                    },
                                    { key: `task-${position}-${String(node.attrs.checked)}` }
                                )
                            );
                        });
                        return DecorationSet.create(state.doc, widgets);
                    },
                },
            }),
        ];
    },
});

function escapeHtml(value: string) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function contextHtml(context: ComposerContext): string {
    return `<span data-composer-context="${escapeHtml(JSON.stringify(context)).replace(/"/g, "&quot;")}">${escapeHtml(context.label)}</span>`;
}

export function validComposerDocument(value: unknown): value is JSONContent {
    let count = 0;
    const valid = (node: unknown, depth: number): boolean => {
        if (!node || typeof node !== "object" || depth > 30 || ++count > 120_000) return false;
        const item = node as JSONContent;
        if (
            ![
                "doc",
                "paragraph",
                "text",
                "hardBreak",
                "heading",
                "codeBlock",
                "blockquote",
                "horizontalRule",
                "bulletList",
                "orderedList",
                "listItem",
                "composerContext",
            ].includes(item.type ?? "")
        )
            return false;
        if (item.text !== undefined && typeof item.text !== "string") return false;
        if (
            item.content !== undefined &&
            (!Array.isArray(item.content) || !item.content.every(child => valid(child, depth + 1)))
        )
            return false;
        if (item.type === "composerContext") {
            const context = item.attrs?.context as Partial<ComposerContext> | undefined;
            if (
                !context ||
                typeof context.id !== "string" ||
                typeof context.label !== "string" ||
                typeof context.markdown !== "string" ||
                !["source", "attachment", "quote", "thread"].includes(context.kind ?? "")
            )
                return false;
            if (
                (context.comment !== undefined && typeof context.comment !== "string") ||
                (context.quote !== undefined && typeof context.quote !== "string")
            )
                return false;
        }
        return (
            item.marks === undefined ||
            (Array.isArray(item.marks) &&
                item.marks.every(mark =>
                    ["bold", "italic", "strike", "code", "link", "underline"].includes(mark.type)
                ))
        );
    };
    return valid(value, 0) && (value as JSONContent).type === "doc";
}

export function markdownToComposerHtml(markdown: string, contexts: ComposerContext[]): string {
    // Tiptap's schema keeps only supported text/formatting. No script, iframe, image or style nodes.
    const document = new DOMParser().parseFromString(
        marked.parse(markdown, { async: false, breaks: true }),
        "text/html"
    );
    document
        .querySelectorAll("script,iframe,object,embed,style")
        .forEach(element => element.remove());
    document.querySelectorAll("a").forEach(element => {
        const context = contexts.find(item => {
            const match = /\]\(([^)]+)\)$/.exec(item.markdown);
            return match?.[1] === element.getAttribute("href");
        });
        if (context) element.outerHTML = contextHtml(context);
        else if (/^(javascript|data|vbscript):/i.test(element.getAttribute("href") ?? ""))
            element.removeAttribute("href");
    });
    document.querySelectorAll("blockquote").forEach((element, index) => {
        const quote = element.textContent?.trim() ?? "";
        const context: ComposerContext = {
            id: `quote-${index}-${quote.length}`,
            kind: "quote",
            quote,
            label: quote.slice(0, 70),
            markdown: quote
                .split("\n")
                .map(line => `> ${line}`)
                .join("\n"),
        };
        element.outerHTML = `<p>${contextHtml(context)}</p>`;
    });
    // Unsupported HTML tables retain readable content rather than silently losing cell text.
    document.querySelectorAll("table").forEach(element => {
        element.outerHTML = `<pre><code>${escapeHtml(
            Array.from(element.querySelectorAll("tr"))
                .map(row =>
                    Array.from(row.querySelectorAll("th,td"))
                        .map(cell => cell.textContent ?? "")
                        .join("\t")
                )
                .join("\n")
        )}</code></pre>`;
    });
    return document.body.innerHTML;
}

export function composerJsonToMarkdown(node: JSONContent, indent = 0): string {
    const content = () =>
        (node.content ?? []).map(child => composerJsonToMarkdown(child, indent)).join("");
    if (node.type === "text") {
        let value = node.text ?? "";
        for (const mark of node.marks ?? []) {
            if (mark.type === "bold") value = `**${value}**`;
            if (mark.type === "italic") value = `*${value}*`;
            if (mark.type === "strike") value = `~~${value}~~`;
            if (mark.type === "code") value = `\`${value}\``;
            if (mark.type === "link") value = `[${value}](${String(mark.attrs?.href ?? "")})`;
        }
        return value;
    }
    if (node.type === "composerContext") {
        const context = node.attrs?.context as ComposerContext | undefined;
        if (!context) return "";
        if (context.kind === "quote")
            return `${(context.quote ?? context.label)
                .split("\n")
                .map(line => `> ${line}`)
                .join("\n")}${context.comment ? `\n> Comment: ${context.comment}` : ""}`;
        return context.markdown;
    }
    if (node.type === "hardBreak") return "\n";
    if (node.type === "doc")
        return content()
            .replace(/\n{3,}/g, "\n\n")
            .trimEnd();
    if (node.type === "paragraph") return `${content()}\n\n`;
    if (node.type === "heading")
        return `${"#".repeat(Number(node.attrs?.level ?? 1))} ${content()}\n\n`;
    if (node.type === "codeBlock")
        return `\`\`\`${String(node.attrs?.language ?? "")}\n${content()}\n\`\`\`\n\n`;
    if (node.type === "blockquote")
        return `${content()
            .trimEnd()
            .split("\n")
            .map(line => `> ${line}`)
            .join("\n")}\n\n`;
    if (node.type === "horizontalRule") return "---\n\n";
    if (node.type === "bulletList" || node.type === "orderedList")
        return `${(node.content ?? [])
            .map(
                (item, index) =>
                    `${"  ".repeat(indent)}${node.type === "orderedList" ? `${index + Number(node.attrs?.start ?? 1)}.` : "-"} ${typeof item.attrs?.checked === "boolean" ? `[${item.attrs.checked ? "x" : " "}] ` : ""}${(
                        item.content ?? []
                    )
                        .map(child => composerJsonToMarkdown(child, indent + 1))
                        .join("")
                        .trimEnd()}`
            )
            .join("\n")}\n\n`;
    return content();
}

export function composerContexts(node: JSONContent): ComposerContext[] {
    const items: ComposerContext[] = [];
    const walk = (value: JSONContent) => {
        if (value.type === "composerContext" && value.attrs?.context)
            items.push(value.attrs.context as ComposerContext);
        value.content?.forEach(walk);
    };
    walk(node);
    return items;
}

const RichChatEditor = forwardRef<RichChatEditorHandle, RichChatEditorProps>(
    function RichChatEditor(props, ref) {
        const callbacks = useRef(props);
        callbacks.current = props;
        const lastValue = useRef(props.value);
        const knownContextIds = useRef(new Set<string>());
        const [quotedContext, setQuotedContext] = useState<ComposerContext | null>(null);
        const [comment, setComment] = useState("");
        const [revision, setRevision] = useState(0);
        const extension = useMemo(
            () =>
                InlineContext.configure({
                    onOpen: (context: ComposerContext) => {
                        if (context.kind === "quote") {
                            setQuotedContext(context);
                            setComment(context.comment ?? "");
                        } else callbacks.current.onOpenContext(context);
                    },
                }),
            []
        );
        const editor = useEditor(
            {
                immediatelyRender: false,
                extensions: [
                    StarterKit.configure({
                        link: {
                            openOnClick: false,
                            protocols: ["http", "https", "mailto"],
                            isAllowedUri: url => /^(https?:|mailto:|\/|#)/i.test(url),
                        },
                    }),
                    TaskLists,
                    extension,
                ],
                content: validComposerDocument(props.content)
                    ? props.content
                    : markdownToComposerHtml(props.value, props.contexts),
                editorProps: {
                    attributes: {
                        role: "textbox",
                        "aria-label": "Rich chat message",
                        "aria-multiline": "true",
                        class: "text-ink min-h-[70px] max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-[15px] leading-6 outline-none [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:bg-line-2 [&_pre]:rounded [&_pre]:p-2",
                        "data-placeholder": props.placeholder,
                    },
                    handleKeyDown: (_view, event) => callbacks.current.onKeyDown(event),
                    handlePaste: (view, event) =>
                        callbacks.current.onPaste(
                            event,
                            view.state.selection.to - view.state.selection.from
                        ),
                },
                onUpdate: ({ editor: current }) => {
                    const json = current.getJSON();
                    const value = composerJsonToMarkdown(json);
                    lastValue.current = value;
                    callbacks.current.onChange(value, json, composerContexts(json));
                    setRevision(value => value + 1);
                },
                onSelectionUpdate: () => setRevision(value => value + 1),
            },
            []
        );
        useEffect(() => {
            if (!editor || props.value === lastValue.current) return;
            lastValue.current = props.value;
            editor.commands.setContent(
                validComposerDocument(props.content)
                    ? props.content
                    : markdownToComposerHtml(props.value, props.contexts),
                { emitUpdate: false }
            );
        }, [editor, props.value, props.content, props.contexts]);
        useEffect(() => {
            if (!editor) return;
            const contexts = composerContexts(editor.getJSON());
            editor.commands.command(({ state, tr }) => {
                let changed = false;
                state.doc.descendants((node, position) => {
                    if (node.type.name !== "composerContext") return;
                    const context = node.attrs.context as ComposerContext;
                    if (context.kind !== "source" && context.kind !== "thread") return;
                    const current = props.contexts.find(
                        item => item.id === context.id && item.kind === context.kind
                    );
                    if (current && Boolean(current.unavailable) !== Boolean(context.unavailable)) {
                        tr.setNodeMarkup(position, undefined, {
                            ...node.attrs,
                            context: { ...context, unavailable: current.unavailable },
                        });
                        changed = true;
                    }
                });
                if (changed) tr.setMeta("addToHistory", false);
                return changed;
            });
            const missing = props.contexts.filter(
                context =>
                    !knownContextIds.current.has(context.id) &&
                    !contexts.some(item => item.id === context.id)
            );
            const removed = contexts.filter(
                context =>
                    context.kind !== "quote" && !props.contexts.some(item => item.id === context.id)
            );
            knownContextIds.current = new Set(props.contexts.map(context => context.id));
            if (removed.length)
                editor.commands.command(({ state, tr }) => {
                    const positions: { from: number; to: number }[] = [];
                    state.doc.descendants((node, position) => {
                        if (
                            node.type.name === "composerContext" &&
                            removed.some(
                                context =>
                                    context.id === (node.attrs.context as ComposerContext)?.id
                            )
                        )
                            positions.push({ from: position, to: position + node.nodeSize });
                    });
                    positions.reverse().forEach(position => tr.delete(position.from, position.to));
                    return true;
                });
            if (missing.length)
                editor.commands.insertContent(
                    missing.flatMap(context => [
                        { type: "composerContext", attrs: { context } },
                        { type: "text", text: " " },
                    ])
                );
        }, [editor, props.contexts]);
        useImperativeHandle(
            ref,
            () => ({
                focus: () => {
                    editor?.commands.focus();
                },
                insertContext: context => {
                    editor
                        ?.chain()
                        .focus()
                        .insertContent([
                            { type: "composerContext", attrs: { context } },
                            { type: "text", text: " " },
                        ])
                        .run();
                },
                insertText: value => {
                    editor?.chain().focus().insertContent({ type: "text", text: value }).run();
                },
                getJSON: () => editor?.getJSON() ?? null,
                getContexts: () => (editor ? composerContexts(editor.getJSON()) : []),
                isInList: () =>
                    Boolean(
                        editor && (editor.isActive("bulletList") || editor.isActive("orderedList"))
                    ),
                getSelection: () =>
                    editor
                        ? {
                              start: composerJsonToMarkdown(
                                  editor.state.doc
                                      .cut(0, editor.state.selection.from)
                                      .toJSON() as JSONContent
                              ).length,
                              end: composerJsonToMarkdown(
                                  editor.state.doc
                                      .cut(0, editor.state.selection.to)
                                      .toJSON() as JSONContent
                              ).length,
                              atStart: editor.state.selection.from <= 1,
                              atEnd: editor.state.selection.to >= editor.state.doc.content.size - 1,
                          }
                        : { start: 0, end: 0, atStart: true, atEnd: true },
            }),
            [editor]
        );
        const updateComment = () => {
            if (!quotedContext || !editor) return;
            editor.commands.command(({ tr, state }) => {
                state.doc.descendants((node, position) => {
                    if (
                        node.type.name === "composerContext" &&
                        (node.attrs.context as ComposerContext)?.id === quotedContext.id
                    )
                        tr.setNodeMarkup(position, undefined, {
                            context: { ...quotedContext, comment },
                        });
                });
                return true;
            });
            setQuotedContext(null);
        };
        return (
            <div data-editor-revision={revision}>
                <div className="mb-1 flex flex-wrap gap-0.5" aria-label="Formatting">
                    {[
                        {
                            name: "Bold",
                            icon: Bold,
                            active: "bold",
                            run: () => editor?.chain().focus().toggleBold().run(),
                        },
                        {
                            name: "Italic",
                            icon: Italic,
                            active: "italic",
                            run: () => editor?.chain().focus().toggleItalic().run(),
                        },
                        {
                            name: "Bullet list",
                            icon: List,
                            active: "bulletList",
                            run: () => editor?.chain().focus().toggleBulletList().run(),
                        },
                        {
                            name: "Code block",
                            icon: Code,
                            active: "codeBlock",
                            run: () => editor?.chain().focus().toggleCodeBlock().run(),
                        },
                        {
                            name: "Task list",
                            icon: CheckSquare,
                            active: "listItem",
                            run: () =>
                                editor
                                    ?.chain()
                                    .focus()
                                    .toggleBulletList()
                                    .updateAttributes("listItem", { checked: false })
                                    .run(),
                        },
                    ].map(option => (
                        <Button
                            key={option.name}
                            variant="ghost"
                            size="icon"
                            className={cn(
                                "size-7",
                                editor?.isActive(option.active) && "bg-brand-soft text-brand-ink"
                            )}
                            aria-label={option.name}
                            aria-pressed={editor?.isActive(option.active) ?? false}
                            onClick={option.run}
                        >
                            <option.icon className="size-3.5" />
                        </Button>
                    ))}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label="Undo"
                        disabled={!editor?.can().undo()}
                        onClick={() => editor?.chain().focus().undo().run()}
                    >
                        <Undo className="size-3.5" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label="Redo"
                        disabled={!editor?.can().redo()}
                        onClick={() => editor?.chain().focus().redo().run()}
                    >
                        <Redo className="size-3.5" />
                    </Button>
                </div>
                <EditorContent editor={editor} />
                <Dialog
                    open={quotedContext !== null}
                    onOpenChange={open => {
                        if (!open) setQuotedContext(null);
                    }}
                >
                    <DialogContent className="border-line bg-panel">
                        <DialogTitle>Quoted response</DialogTitle>
                        <DialogDescription>
                            Add a comment to explain what you want the assistant to focus on.
                        </DialogDescription>
                        <blockquote className="border-brand text-ink-2 max-h-48 overflow-auto border-l-2 pl-3 text-sm">
                            {quotedContext?.quote ?? quotedContext?.label}
                        </blockquote>
                        <label className="text-ink-2 text-xs">
                            Comment
                            <textarea
                                aria-label="Quote comment"
                                className="border-line bg-panel text-ink mt-1 min-h-20 w-full rounded-md border p-2 text-sm"
                                value={comment}
                                onChange={event => setComment(event.target.value)}
                            />
                        </label>
                        <Button onClick={updateComment}>Save comment</Button>
                    </DialogContent>
                </Dialog>
            </div>
        );
    }
);

export default RichChatEditor;
