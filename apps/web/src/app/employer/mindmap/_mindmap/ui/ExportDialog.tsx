"use client";

import React, { useState } from "react";
import {
    Copy,
    Download,
    FileCode,
    FileJson,
    FileText,
    Image as ImageIcon,
    Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";

import { copyPageAsImage, runExport, type ExportFormat } from "../lib/export";
import { activePage, pageBounds, selectionBounds } from "../model/doc";
import { toMarkdownOutline, toMermaid } from "../model/serialize";
import type { EditorState } from "../model/store";
import { Segmented } from "./controls";
import { useEditor, useStore } from "./EditorContext";

/**
 * Export.
 *
 * PNG and SVG go through the live canvas element, so they always match the
 * screen. JSON is the lossless format that re-imports; Markdown and Mermaid
 * are the lossy-but-useful text formats people paste into docs and READMEs.
 */

const FORMATS: {
    id: ExportFormat;
    label: string;
    hint: string;
    Icon: typeof ImageIcon;
}[] = [
    { id: "png", label: "PNG", hint: "Raster image for slides and chat", Icon: ImageIcon },
    { id: "svg", label: "SVG", hint: "Vector — scales and stays editable", Icon: FileCode },
    { id: "pdf", label: "PDF", hint: "One page, sized to the diagram", Icon: FileText },
    { id: "json", label: "JSON", hint: "Lossless — re-imports into Mindmap", Icon: FileJson },
    { id: "markdown", label: "Markdown", hint: "Indented outline of every topic", Icon: FileText },
    { id: "mermaid", label: "Mermaid", hint: "Flowchart code for READMEs", Icon: FileCode },
];

const selectDoc = (s: EditorState) => s.doc;
const selectSelection = (s: EditorState) => s.selection;

export function ExportDialog({
    open,
    onOpenChange,
    getSvgElement,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    getSvgElement: () => SVGSVGElement | null;
}) {
    const doc = useEditor(selectDoc);
    const selection = useEditor(selectSelection);
    const [format, setFormat] = useState<ExportFormat>("png");
    const [scale, setScale] = useState<"1" | "2" | "4">("2");
    const [transparent, setTransparent] = useState(false);
    const [selectionOnly, setSelectionOnly] = useState(false);
    const [busy, setBusy] = useState(false);

    const page = activePage(doc);
    // The three formats rendered from the canvas, and so the three that take
    // resolution / background / crop options.
    const isImage = format === "png" || format === "svg" || format === "pdf";
    const hasSelection = selection.length > 0;

    const run = async () => {
        setBusy(true);
        try {
            const bounds =
                selectionOnly && hasSelection
                    ? (selectionBounds(page, selection) ?? undefined)
                    : (pageBounds(page) ?? undefined);
            await runExport({
                format,
                doc,
                page,
                svgElement: getSvgElement(),
                bounds,
                scale: Number(scale),
                transparent,
            });
            toast.success(`Exported as ${format.toUpperCase()}`);
            onOpenChange(false);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Export failed");
        } finally {
            setBusy(false);
        }
    };

    const copyText = async () => {
        const text =
            format === "mermaid"
                ? toMermaid(doc, page.id)
                : format === "markdown"
                  ? toMarkdownOutline(doc)
                  : JSON.stringify(doc, null, 2);
        try {
            await navigator.clipboard.writeText(text);
            toast.success("Copied to clipboard");
        } catch {
            toast.error("Clipboard access was denied");
        }
    };

    const copyImage = async () => {
        const el = getSvgElement();
        if (!el) return;
        try {
            await copyPageAsImage(el, page);
            toast.success("Copied image to clipboard");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Copy failed");
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[520px]">
                <DialogHeader>
                    <DialogTitle>Export “{doc.title}”</DialogTitle>
                    <DialogDescription>
                        Images capture the current page; text formats cover the whole document.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-1 gap-1.5">
                    {FORMATS.map(option => (
                        <button
                            key={option.id}
                            type="button"
                            onClick={() => setFormat(option.id)}
                            className={cn(
                                "flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                                format === option.id
                                    ? "border-brand bg-brand-soft"
                                    : "border-line hover:bg-panel-2"
                            )}
                        >
                            <option.Icon
                                className={cn(
                                    "size-4 shrink-0",
                                    format === option.id ? "text-brand-ink" : "text-ink-3"
                                )}
                            />
                            <span className="flex-1">
                                <span className="text-ink block text-[13px] font-medium">
                                    {option.label}
                                </span>
                                <span className="text-ink-3 block text-[12px]">{option.hint}</span>
                            </span>
                        </button>
                    ))}
                </div>

                {isImage && (
                    <div className="border-line space-y-2.5 rounded-lg border p-3">
                        {(format === "png" || format === "pdf") && (
                            <div className="flex items-center gap-3">
                                <span className="text-ink-2 w-24 text-[12px]">Resolution</span>
                                <Segmented
                                    value={scale}
                                    onChange={setScale}
                                    options={[
                                        { value: "1" as const, label: "1×" },
                                        { value: "2" as const, label: "2×" },
                                        { value: "4" as const, label: "4×" },
                                    ]}
                                />
                            </div>
                        )}
                        <div className="flex items-center gap-3">
                            <span className="text-ink-2 w-24 text-[12px]">Transparent</span>
                            <Switch
                                checked={transparent}
                                onCheckedChange={setTransparent}
                                aria-label="Transparent background"
                            />
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-ink-2 w-24 text-[12px]">Selection only</span>
                            <Switch
                                checked={selectionOnly}
                                disabled={!hasSelection}
                                onCheckedChange={setSelectionOnly}
                                aria-label="Export selection only"
                            />
                            {!hasSelection && (
                                <span className="text-ink-3 text-[11px]">Nothing selected</span>
                            )}
                        </div>
                    </div>
                )}

                <DialogFooter className="sm:justify-between">
                    <Button
                        variant="ghost"
                        onClick={() => void (isImage ? copyImage() : copyText())}
                        disabled={busy}
                    >
                        <Copy className="size-4" />
                        Copy {isImage ? "image" : "text"}
                    </Button>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button onClick={() => void run()} disabled={busy}>
                            {busy ? (
                                <Loader2 className="size-4 animate-spin" />
                            ) : (
                                <Download className="size-4" />
                            )}
                            Download
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/** Kept next to export so the two round-trip formats stay in one place. */
export function ImportDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const store = useStore();
    const [text, setText] = useState("");
    const [mode, setMode] = useState<"outline" | "mermaid" | "json" | "csv">("outline");

    const runImport = async () => {
        const { fromEdgeList, fromMarkdownOutline, fromMermaid, parseDoc } = await import(
            "../model/serialize"
        );
        const title = store.getState().doc.title;
        try {
            const next =
                mode === "json"
                    ? parseDoc(JSON.parse(text) as unknown, title)
                    : mode === "mermaid"
                      ? fromMermaid(text, title)
                      : mode === "csv"
                        ? fromEdgeList(text, title)
                        : fromMarkdownOutline(text, title);
            // Keep the current title: the user named this document already.
            store.replaceDoc({ ...next, title }, { label: "Import" });
            toast.success("Imported");
            setText("");
            onOpenChange(false);
        } catch {
            toast.error("Couldn't parse that — check the format and try again");
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle>Import</DialogTitle>
                    <DialogDescription>
                        Replaces the current document. Undo (⌘Z) brings it back.
                    </DialogDescription>
                </DialogHeader>

                <Segmented
                    value={mode}
                    onChange={setMode}
                    options={[
                        { value: "outline" as const, label: "Outline" },
                        { value: "mermaid" as const, label: "Mermaid" },
                        { value: "csv" as const, label: "CSV" },
                        { value: "json" as const, label: "JSON" },
                    ]}
                />

                <textarea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    placeholder={PLACEHOLDERS[mode]}
                    spellCheck={false}
                    className="border-line bg-panel text-ink focus:border-brand h-56 w-full resize-none rounded-lg border p-3 font-mono text-[12px] leading-relaxed outline-none"
                />

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={() => void runImport()} disabled={!text.trim()}>
                        Import
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

const PLACEHOLDERS: Record<"outline" | "mermaid" | "json" | "csv", string> = {
    outline: "# Product plan\n- Discovery\n  - Interviews\n  - Survey\n- Build\n  - MVP",
    mermaid: 'flowchart LR\n  A["Start"] --> B{"Ready?"}\n  B -->|Yes| C["Ship"]',
    csv: "parent,child\nCEO,Engineering\nCEO,Product\nEngineering,Platform",
    json: '{"schemaVersion":1,"title":"…","pages":[…]}',
};
