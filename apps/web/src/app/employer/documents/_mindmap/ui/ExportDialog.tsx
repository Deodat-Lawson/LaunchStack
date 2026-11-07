"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
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

import { copyPageAsImage, ExportError, runExport, type ExportFormat } from "../lib/export";
import { activePage, pageBounds, selectionBounds } from "../model/doc";
import { toMarkdownOutline, toMermaid } from "../model/serialize";
import type { EditorState } from "../model/store";
import { Segmented } from "./controls";
import { useCommittedDoc, useEditor, useStore } from "./EditorContext";

/**
 * Export.
 *
 * PNG and SVG go through the live canvas element, so they always match the
 * screen. JSON is the lossless format that re-imports; Markdown and Mermaid
 * are the lossy-but-useful text formats people paste into docs and READMEs.
 */

/** Format names are the formats' own; the hint is `mindmap.export.hints.<id>`. */
const FORMATS: {
    id: ExportFormat;
    label: string;
    Icon: typeof ImageIcon;
}[] = [
    { id: "png", label: "PNG", Icon: ImageIcon },
    { id: "svg", label: "SVG", Icon: FileCode },
    { id: "pdf", label: "PDF", Icon: FileText },
    { id: "json", label: "JSON", Icon: FileJson },
    { id: "markdown", label: "Markdown", Icon: FileText },
    { id: "mermaid", label: "Mermaid", Icon: FileCode },
];

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
    const t = useTranslations("mindmap");
    const tc = useTranslations("common");
    const doc = useCommittedDoc();
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
            toast.success(t("export.exported", { format: format.toUpperCase() }));
            onOpenChange(false);
        } catch (error) {
            if (error instanceof ExportError) toast.error(t(`errors.${error.code}`));
            else
                toast.error(t("export.failed"), {
                    description: error instanceof Error ? error.message : undefined,
                });
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
            toast.success(t("export.copied"));
        } catch {
            toast.error(t("export.clipboardDenied"));
        }
    };

    const copyImage = async () => {
        const el = getSvgElement();
        if (!el) return;
        try {
            await copyPageAsImage(el, page);
            toast.success(t("export.copiedImage"));
        } catch (error) {
            if (error instanceof ExportError) toast.error(t(`errors.${error.code}`));
            else
                toast.error(t("export.copyFailed"), {
                    description: error instanceof Error ? error.message : undefined,
                });
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[520px]">
                <DialogHeader>
                    <DialogTitle>{t("export.title", { title: doc.title })}</DialogTitle>
                    <DialogDescription>{t("export.description")}</DialogDescription>
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
                                <span className="text-ink-3 block text-[12px]">
                                    {t(`export.hints.${option.id}`)}
                                </span>
                            </span>
                        </button>
                    ))}
                </div>

                {isImage && (
                    <div className="border-line space-y-2.5 rounded-lg border p-3">
                        {(format === "png" || format === "pdf") && (
                            <div className="flex items-center gap-3">
                                <span className="text-ink-2 w-24 text-[12px]">
                                    {t("export.resolution")}
                                </span>
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
                            <span className="text-ink-2 w-24 text-[12px]">
                                {t("export.transparent")}
                            </span>
                            <Switch
                                checked={transparent}
                                onCheckedChange={setTransparent}
                                aria-label={t("export.transparentLabel")}
                            />
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-ink-2 w-24 text-[12px]">
                                {t("export.selectionOnly")}
                            </span>
                            <Switch
                                checked={selectionOnly}
                                disabled={!hasSelection}
                                onCheckedChange={setSelectionOnly}
                                aria-label={t("export.selectionOnlyLabel")}
                            />
                            {!hasSelection && (
                                <span className="text-ink-3 text-[11px]">
                                    {t("export.nothingSelected")}
                                </span>
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
                        {isImage ? t("export.copyImage") : t("export.copyText")}
                    </Button>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            {tc("actions.cancel")}
                        </Button>
                        <Button onClick={() => void run()} disabled={busy}>
                            {busy ? (
                                <Loader2 className="size-4 animate-spin" />
                            ) : (
                                <Download className="size-4" />
                            )}
                            {tc("actions.download")}
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
    const t = useTranslations("mindmap.import");
    const tm = useTranslations("mindmap");
    const tc = useTranslations("common");
    const store = useStore();
    const [text, setText] = useState("");
    const [mode, setMode] = useState<"outline" | "mermaid" | "json" | "csv">("outline");

    const runImport = async () => {
        const { fromEdgeList, fromMarkdownOutline, fromMermaid, parseDoc } = await import(
            "../model/serialize"
        );
        const { applyThemeToDoc } = await import("../model/theme");
        const { title, settings } = store.getState().doc;
        const pageName = tm("pages.numbered", { number: 1 });
        try {
            const parsed =
                mode === "json"
                    ? parseDoc(JSON.parse(text) as unknown, title)
                    : mode === "mermaid"
                      ? fromMermaid(text, title, pageName)
                      : mode === "csv"
                        ? fromEdgeList(text, title, pageName)
                        : fromMarkdownOutline(text, title, pageName);
            // A text format carries no colours of its own, so it lands in
            // this board's theme — pasting an outline onto a dark board must
            // not hand back a white one. A JSON document brings its own.
            const next =
                mode === "json" ? parsed : applyThemeToDoc(parsed, settings.paletteId ?? "default");
            // Keep the current title: the user named this document already.
            store.replaceDoc({ ...next, title }, { label: "Import" });
            toast.success(t("imported"));
            setText("");
            onOpenChange(false);
        } catch {
            toast.error(t("parseFailed"));
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle>{tc("actions.import")}</DialogTitle>
                    <DialogDescription>{t("description")}</DialogDescription>
                </DialogHeader>

                <Segmented
                    value={mode}
                    onChange={setMode}
                    options={[
                        { value: "outline" as const, label: t("outline") },
                        { value: "mermaid" as const, label: "Mermaid" },
                        { value: "csv" as const, label: "CSV" },
                        { value: "json" as const, label: "JSON" },
                    ]}
                />

                <textarea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    placeholder={mode === "json" ? JSON_PLACEHOLDER : t(`placeholders.${mode}`)}
                    spellCheck={false}
                    className="border-line bg-panel text-ink focus:border-brand h-56 w-full resize-none rounded-lg border p-3 font-mono text-[12px] leading-relaxed outline-none"
                />

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {tc("actions.cancel")}
                    </Button>
                    <Button onClick={() => void runImport()} disabled={!text.trim()}>
                        {tc("actions.import")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/**
 * The JSON example is code with nothing to translate; the outline, Mermaid
 * and CSV examples are `mindmap.import.placeholders.<mode>`.
 */
const JSON_PLACEHOLDER = '{"schemaVersion":1,"title":"…","pages":[…]}';
