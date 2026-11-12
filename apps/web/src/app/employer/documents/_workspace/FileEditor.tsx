"use client";

/**
 * The in-app editor for a file: Markdown, plain text, Word, or a Google Doc
 * linked to this workspace's Drive.
 *
 * It edits HTML (or plain text for a .txt) and leaves every format to the
 * server, which writes the new version — or pushes the Doc to Google Drive
 * and pulls it back — and answers with the next `base`. A save made from a
 * stale base is refused rather than written over someone else's version, and
 * the editor says so instead of losing either copy.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import {
    AlertTriangle,
    Bold,
    Code2,
    ExternalLink,
    Italic,
    Link2,
    List,
    ListOrdered,
    Loader2,
    Quote,
    Redo2,
    RotateCw,
    Strikethrough,
    Table2,
    Underline as UnderlineIcon,
    Undo2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import { Textarea } from "~/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import { formatKeys } from "~/lib/shortcuts/commands";
import { cn } from "~/lib/utils";

import {
    FileEditingError,
    fetchEditable,
    saveEditable,
    type EditableContent,
    type SavedContent,
} from "./fileEditing";
import "./file-editor.css";

type EditorT = ReturnType<typeof useTranslations<"viewers.fileEditor">>;

type BlockType = "paragraph" | "h1" | "h2" | "h3";

export interface FileEditorProps {
    documentId: number;
    /** Leave the editor. Only called once unsaved edits are saved or let go. */
    onExit: () => void;
    /** A save made a new version: the viewer reloads its versions and preview. */
    onSaved?: (saved: SavedContent) => void;
}

type Load =
    | { phase: "loading" }
    | { phase: "error"; message: string }
    | { phase: "ready"; content: EditableContent };

export function FileEditor({ documentId, onExit, onSaved }: FileEditorProps) {
    const t = useTranslations("viewers.fileEditor");
    const [load, setLoad] = useState<Load>({ phase: "loading" });
    const [loadNonce, setLoadNonce] = useState(0);
    const [base, setBase] = useState<string | null>(null);
    const [text, setText] = useState("");
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    /** The server's sentence when a save was refused for a newer copy. */
    const [conflict, setConflict] = useState<string | null>(null);
    const [confirm, setConfirm] = useState<null | "discard" | "reload">(null);
    /** Bumped on every edit, so a save only clears "unsaved" if nothing changed meanwhile. */
    const editCount = useRef(0);
    const markDirty = useCallback(() => {
        editCount.current += 1;
        setDirty(true);
    }, []);

    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({
                link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
            }),
            Placeholder.configure({ placeholder: t("placeholder") }),
            TableKit.configure({ table: { resizable: false } }),
            // A Word file's pictures arrive as data URIs: dropping them here
            // would delete them from the file on the next save.
            Image.configure({ allowBase64: true, inline: true }),
        ],
        content: "",
        editorProps: {
            attributes: {
                class: "file-editor-doc",
                "aria-label": t("documentLabel"),
            },
        },
        onUpdate: markDirty,
    });

    useEffect(() => {
        const controller = new AbortController();
        setLoad({ phase: "loading" });
        void (async () => {
            try {
                const content = await fetchEditable(documentId, t("loadFailed"), controller.signal);
                if (controller.signal.aborted) return;
                setBase(content.base);
                setText(content.text ?? "");
                setDirty(false);
                setConflict(null);
                editCount.current = 0;
                setLoad({ phase: "ready", content });
            } catch (err) {
                if (controller.signal.aborted) return;
                setLoad({
                    phase: "error",
                    message: err instanceof Error ? err.message : t("loadFailed"),
                });
            }
        })();
        return () => controller.abort();
        // `t` is stable per locale; a language switch need not reload the file.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [documentId, loadNonce]);

    // The loaded HTML goes into the editor once both exist — the editor is
    // made after the first paint, the file may arrive before or after it.
    const content = load.phase === "ready" ? load.content : null;
    useEffect(() => {
        if (!editor || !content || content.mode !== "rich") return;
        editor.commands.setContent(content.html || "", { emitUpdate: false });
        editor.commands.focus("end");
    }, [editor, content]);

    // Leaving the page with unsaved edits asks first.
    useEffect(() => {
        if (!dirty) return;
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, [dirty]);

    const save = useCallback(async () => {
        if (!content || base === null || saving) return;
        if (content.mode === "rich" && !editor) return;
        const startedAt = editCount.current;
        setSaving(true);
        try {
            const body =
                content.mode === "plain"
                    ? { base, text }
                    : { base, html: editor ? editor.getHTML() : "" };
            const saved = await saveEditable(documentId, body, t("saveFailed"));
            setBase(saved.base);
            setConflict(null);
            if (editCount.current === startedAt) setDirty(false);
            toast.success(t("savedVersion", { number: saved.versionNumber }));
            onSaved?.(saved);
        } catch (err) {
            const message = err instanceof Error ? err.message : t("saveFailed");
            if (err instanceof FileEditingError && err.code === "changed_since_opened") {
                setConflict(message);
            } else {
                toast.error(message);
            }
        } finally {
            setSaving(false);
        }
    }, [content, base, saving, editor, text, documentId, t, onSaved]);

    const reload = useCallback(() => {
        setConfirm(null);
        setLoadNonce(n => n + 1);
    }, []);

    const requestReload = () => (dirty ? setConfirm("reload") : reload());
    const requestDone = () => (dirty ? setConfirm("discard") : onExit());

    const status = saving ? t("status.saving") : dirty ? t("status.unsaved") : t("status.saved");
    const saveKeys = formatKeys("Mod+S");

    return (
        <div
            className="bg-surface flex min-h-0 min-w-0 flex-1 flex-col"
            data-testid="file-editor"
            onKeyDownCapture={event => {
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                    event.preventDefault();
                    void save();
                }
            }}
        >
            <TooltipProvider delayDuration={300}>
                <div
                    role="toolbar"
                    aria-label={t("toolbar")}
                    className="border-line bg-panel flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-1.5"
                >
                    {content?.mode === "rich" && editor && (
                        <FormattingTools editor={editor} t={t} />
                    )}
                    <div className="ml-auto flex items-center gap-1.5">
                        <span
                            className={cn(
                                "px-1 text-xs",
                                dirty || saving ? "text-brand-ink" : "text-ink-3"
                            )}
                            aria-live="polite"
                            data-testid="file-editor-status"
                        >
                            {load.phase === "ready" ? status : null}
                        </span>
                        {content?.drive?.url && (
                            <Button variant="ghost" size="sm" asChild>
                                <a href={content.drive.url} target="_blank" rel="noreferrer">
                                    <ExternalLink />
                                    <span className="@max-sm:hidden">{t("openInGoogleDocs")}</span>
                                </a>
                            </Button>
                        )}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    size="sm"
                                    onClick={() => void save()}
                                    disabled={load.phase !== "ready" || saving || !dirty}
                                    data-testid="file-editor-save"
                                >
                                    {saving && <Loader2 className="animate-spin" />}
                                    {t("save")}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                                {t("saveHint", { keys: saveKeys })}
                            </TooltipContent>
                        </Tooltip>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={requestDone}
                            disabled={saving}
                            data-testid="file-editor-done"
                        >
                            {t("done")}
                        </Button>
                    </div>
                </div>
            </TooltipProvider>

            {conflict && (
                <div
                    role="alert"
                    className="border-danger bg-danger-soft text-danger-ink mx-4 mt-3 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm"
                    data-testid="file-editor-conflict"
                >
                    <AlertTriangle className="size-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                        <p className="font-semibold">{t("conflictTitle")}</p>
                        <p>{conflict}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={requestReload}>
                        <RotateCw />
                        {t("reloadLatest")}
                    </Button>
                </div>
            )}

            {content?.notice && (
                <p className="text-ink-3 mx-auto w-full max-w-[760px] px-6 pt-3 text-xs">
                    {content.notice}
                </p>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
                {load.phase === "loading" && (
                    <div className="text-ink-3 flex h-full items-center justify-center gap-2 text-sm">
                        <Loader2 className="text-brand-ink size-4 animate-spin" />
                        {t("loading")}
                    </div>
                )}
                {load.phase === "error" && (
                    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                        <AlertTriangle className="text-danger size-6" />
                        <p className="text-ink text-sm font-medium">{t("loadFailed")}</p>
                        <p className="text-ink-3 max-w-md text-xs">{load.message}</p>
                        <div className="flex gap-2">
                            <Button size="sm" onClick={reload}>
                                <RotateCw />
                                {t("retry")}
                            </Button>
                            <Button size="sm" variant="outline" onClick={onExit}>
                                {t("done")}
                            </Button>
                        </div>
                    </div>
                )}
                {content?.mode === "rich" && (
                    <EditorContent editor={editor} className="file-editor-page" />
                )}
                {content?.mode === "plain" && (
                    <div className="mx-auto w-full max-w-[760px] px-6 py-8 max-sm:px-4">
                        <Textarea
                            value={text}
                            onChange={event => {
                                setText(event.target.value);
                                markDirty();
                            }}
                            aria-label={t("documentLabel")}
                            placeholder={t("placeholder")}
                            className="min-h-[60vh] font-mono text-[13px] leading-relaxed"
                            autoFocus
                            data-testid="file-editor-plain"
                        />
                    </div>
                )}
            </div>

            <ConfirmDialog
                open={confirm !== null}
                onOpenChange={open => {
                    if (!open) setConfirm(null);
                }}
                title={confirm === "reload" ? t("reloadTitle") : t("discardTitle")}
                description={confirm === "reload" ? t("reloadBody") : t("discardBody")}
                confirmLabel={confirm === "reload" ? t("reloadConfirm") : t("discardConfirm")}
                onConfirm={() => {
                    if (confirm === "reload") {
                        reload();
                        return;
                    }
                    setConfirm(null);
                    setDirty(false);
                    onExit();
                }}
            />
        </div>
    );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

/**
 * A toolbar button; a mark or block that applies shows pressed. The kit
 * Button rather than Toggle: Toggle does not take a ref, which the tooltip
 * and the link popover anchor on.
 */
function toolClass(pressed: boolean | undefined): string {
    return cn("size-8", pressed ? "bg-panel-2 text-ink" : "text-ink-2");
}

function ToolButton({
    label,
    pressed,
    disabled,
    onPress,
    children,
}: {
    label: string;
    /** Marks and blocks show whether they apply; actions (undo, table) leave it unset. */
    pressed?: boolean;
    disabled?: boolean;
    onPress: () => void;
    children: React.ReactNode;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={toolClass(pressed)}
                    aria-label={label}
                    aria-pressed={pressed}
                    disabled={disabled}
                    onClick={onPress}
                >
                    {children}
                </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
    );
}

function FormattingTools({ editor, t }: { editor: Editor; t: EditorT }) {
    const state = useEditorState({
        editor,
        selector: ({ editor: e }) => ({
            block: (e.isActive("heading", { level: 1 })
                ? "h1"
                : e.isActive("heading", { level: 2 })
                  ? "h2"
                  : e.isActive("heading", { level: 3 })
                    ? "h3"
                    : "paragraph") as BlockType,
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            strike: e.isActive("strike"),
            bulletList: e.isActive("bulletList"),
            orderedList: e.isActive("orderedList"),
            blockquote: e.isActive("blockquote"),
            codeBlock: e.isActive("codeBlock"),
            link: e.isActive("link"),
            href: (e.getAttributes("link").href as string | undefined) ?? "",
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
        }),
    });

    const setBlock = (value: BlockType) => {
        const chain = editor.chain().focus();
        if (value === "paragraph") chain.setParagraph().run();
        else chain.setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run();
    };

    return (
        <div className="flex flex-wrap items-center gap-0.5">
            <Select value={state.block} onValueChange={value => setBlock(value as BlockType)}>
                <SelectTrigger
                    size="sm"
                    className="text-ink-2 w-[124px] border-transparent"
                    aria-label={t("blockType")}
                >
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="paragraph">{t("paragraph")}</SelectItem>
                    <SelectItem value="h1">{t("heading1")}</SelectItem>
                    <SelectItem value="h2">{t("heading2")}</SelectItem>
                    <SelectItem value="h3">{t("heading3")}</SelectItem>
                </SelectContent>
            </Select>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <ToolButton
                label={t("bold")}
                pressed={state.bold}
                onPress={() => editor.chain().focus().toggleBold().run()}
            >
                <Bold />
            </ToolButton>
            <ToolButton
                label={t("italic")}
                pressed={state.italic}
                onPress={() => editor.chain().focus().toggleItalic().run()}
            >
                <Italic />
            </ToolButton>
            <ToolButton
                label={t("underline")}
                pressed={state.underline}
                onPress={() => editor.chain().focus().toggleUnderline().run()}
            >
                <UnderlineIcon />
            </ToolButton>
            <ToolButton
                label={t("strike")}
                pressed={state.strike}
                onPress={() => editor.chain().focus().toggleStrike().run()}
            >
                <Strikethrough />
            </ToolButton>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <ToolButton
                label={t("bulletList")}
                pressed={state.bulletList}
                onPress={() => editor.chain().focus().toggleBulletList().run()}
            >
                <List />
            </ToolButton>
            <ToolButton
                label={t("orderedList")}
                pressed={state.orderedList}
                onPress={() => editor.chain().focus().toggleOrderedList().run()}
            >
                <ListOrdered />
            </ToolButton>
            <ToolButton
                label={t("quote")}
                pressed={state.blockquote}
                onPress={() => editor.chain().focus().toggleBlockquote().run()}
            >
                <Quote />
            </ToolButton>
            <ToolButton
                label={t("codeBlock")}
                pressed={state.codeBlock}
                onPress={() => editor.chain().focus().toggleCodeBlock().run()}
            >
                <Code2 />
            </ToolButton>
            <LinkTool editor={editor} active={state.link} href={state.href} t={t} />
            <ToolButton
                label={t("table")}
                onPress={() =>
                    editor
                        .chain()
                        .focus()
                        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                        .run()
                }
            >
                <Table2 />
            </ToolButton>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <ToolButton
                label={t("undo")}
                disabled={!state.canUndo}
                onPress={() => editor.chain().focus().undo().run()}
            >
                <Undo2 />
            </ToolButton>
            <ToolButton
                label={t("redo")}
                disabled={!state.canRedo}
                onPress={() => editor.chain().focus().redo().run()}
            >
                <Redo2 />
            </ToolButton>
        </div>
    );
}

/** "example.com" reads as a web address; anything with a scheme is left to the link mark's own check. */
function normalizeHref(raw: string): string {
    const value = raw.trim();
    if (!value) return "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("/") || value.startsWith("#")) {
        return value;
    }
    return `https://${value}`;
}

function LinkTool({
    editor,
    active,
    href,
    t,
}: {
    editor: Editor;
    active: boolean;
    href: string;
    t: EditorT;
}) {
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState("");

    const apply = () => {
        const next = normalizeHref(value);
        const chain = editor.chain().focus().extendMarkRange("link");
        if (next) chain.setLink({ href: next }).run();
        else chain.unsetLink().run();
        setOpen(false);
    };

    return (
        <Popover
            open={open}
            onOpenChange={next => {
                setOpen(next);
                if (next) setValue(href);
            }}
        >
            {/* No kit tooltip here: the kit's PopoverTrigger and
                TooltipTrigger take no ref, so one cannot wrap the other. */}
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={toolClass(active)}
                    aria-label={t("link")}
                    aria-pressed={active}
                    title={t("link")}
                >
                    <Link2 />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-3">
                <form
                    className="flex flex-col gap-2"
                    onSubmit={event => {
                        event.preventDefault();
                        apply();
                    }}
                >
                    <Input
                        value={value}
                        onChange={event => setValue(event.target.value)}
                        placeholder={t("linkPlaceholder")}
                        aria-label={t("link")}
                        autoFocus
                    />
                    <div className="flex justify-end gap-2">
                        {active && (
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                    editor
                                        .chain()
                                        .focus()
                                        .extendMarkRange("link")
                                        .unsetLink()
                                        .run();
                                    setOpen(false);
                                }}
                            >
                                {t("linkRemove")}
                            </Button>
                        )}
                        <Button type="submit" size="sm">
                            {t("linkApply")}
                        </Button>
                    </div>
                </form>
            </PopoverContent>
        </Popover>
    );
}
