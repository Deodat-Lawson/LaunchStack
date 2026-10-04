"use client";

import React, { Component, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { FileText, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import { useContextTarget } from "~/components/context-menu";
import { buildAttachmentMenuItems } from "./chatContextMenu";
import type { EphemeralAttachment } from "./types";
import { ChatMarkdown, safeChatUri } from "./ChatMarkdown";
import { ChatMediaGallery } from "./ChatMediaGallery";
import { copyText } from "~/lib/context-menu";
import { toast } from "sonner";
import { delimitedPreview, fencedPreview } from "./attachmentPreview";
import type { ComposerAttachmentAvailability } from "./composerState";

const PdfAttachmentPreview = dynamic(() => import("./PdfAttachmentPreview"), {
    ssr: false,
    loading: ({ error }) => (
        <p role={error ? "alert" : "status"} className="text-ink-3 p-3 text-sm">
            {error
                ? "The PDF viewer could not load. Open the original or download the file."
                : "Loading PDF viewer…"}
        </p>
    ),
});

class PdfPreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    override state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    override render() {
        return this.state.failed ? (
            <p role="alert" className="text-danger text-sm">
                The PDF viewer could not load. Open the original or download the file.
            </p>
        ) : (
            this.props.children
        );
    }
}

export function ChatAttachmentChip({
    attachment,
    onRemove,
    galleryItems,
    availability,
    onReattach,
}: {
    attachment: EphemeralAttachment;
    onRemove?: () => void;
    galleryItems?: EphemeralAttachment[];
    availability?: ComposerAttachmentAvailability;
    onReattach?: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [preview, setPreview] = useState<string | null>(null);
    const [error, setError] = useState(false);
    const [raw, setRaw] = useState(false);
    const fullText = useRef<string | null>(null);
    const isImage = attachment.kind === "image";
    const safeUrl = safeChatUri(attachment.url, true);
    const unavailable = !safeUrl || availability === "unavailable";
    const images = (galleryItems ?? [attachment])
        .filter(item => item.kind === "image")
        .flatMap(item => {
            const url = safeChatUri(item.url, true);
            return url ? [{ src: url, name: item.name }] : [];
        });
    const isMarkdown = /\.(md|markdown)$/i.test(attachment.name);
    const isHtml = /\.(html|htm)$/i.test(attachment.name);
    const isPdf = attachment.mimeType === "application/pdf" || /\.pdf$/i.test(attachment.name);
    const extension = attachment.name.split(".").at(-1)?.toLowerCase() ?? "";
    const languages: Record<string, string> = {
        json: "json",
        jsonl: "json",
        yaml: "yaml",
        yml: "yaml",
        xml: "xml",
        js: "javascript",
        jsx: "javascript",
        mjs: "javascript",
        cjs: "javascript",
        ts: "typescript",
        tsx: "typescript",
        py: "python",
        go: "go",
        rs: "rust",
        java: "java",
        kt: "kotlin",
        c: "c",
        h: "c",
        cpp: "cpp",
        hpp: "cpp",
        cs: "csharp",
        sh: "bash",
        bash: "bash",
        sql: "sql",
        css: "css",
        rb: "ruby",
        php: "php",
        swift: "swift",
    };
    const language = languages[extension] ?? "text";
    const canReadText =
        attachment.mimeType.startsWith("text/") ||
        Boolean(languages[extension]) ||
        /\.(txt|md|markdown|csv|tsv|log|html|htm)$/i.test(attachment.name);
    const ctxTarget = useContextTarget({
        kind: "attachment",
        id: attachment.id,
        label: `Actions for ${attachment.name}`,
        data: attachment,
        items: () =>
            buildAttachmentMenuItems(attachment, { onOpen: () => setOpen(true), onRemove }),
    });
    useEffect(() => {
        if (!open || !safeUrl || unavailable || !canReadText || isImage) return;
        const controller = new AbortController();
        setPreview(null);
        fullText.current = null;
        setError(false);
        void fetch(safeUrl, { signal: controller.signal })
            .then(async response => {
                if (!response.ok) throw new Error("Preview unavailable");
                const value = await response.text();
                if (!controller.signal.aborted) {
                    fullText.current = value;
                    setPreview(
                        value.slice(0, 30_000) +
                            (value.length > 30_000
                                ? "\n… Preview limited to 30,000 characters. Save the file to read it in full."
                                : "")
                    );
                }
            })
            .catch(() => {
                if (!controller.signal.aborted) setError(true);
            });
        return () => controller.abort();
    }, [open, safeUrl, unavailable, isImage, canReadText]);
    return (
        <>
            <span
                {...ctxTarget}
                className="border-line bg-line-2 text-ink-2 inline-flex max-w-[260px] items-center gap-1 rounded-lg border border-dashed pr-1 text-xs"
            >
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 min-w-0 justify-start gap-1.5 px-1.5 text-xs"
                    onClick={() => setOpen(true)}
                    aria-label={`Preview ${attachment.name}`}
                >
                    {isImage && safeUrl && !unavailable ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={safeUrl} alt="" className="size-5 rounded object-cover" />
                    ) : (
                        <FileText className="size-3.5" />
                    )}
                    <span className="truncate">{attachment.name}</span>
                    {unavailable && <span className="text-ink-3">Unavailable</span>}
                </Button>
                {unavailable && onReattach && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-1.5 text-xs"
                        aria-label={`Reattach ${attachment.name}`}
                        onClick={onReattach}
                    >
                        Attach again
                    </Button>
                )}
                {onRemove && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        aria-label={`Remove ${attachment.name}`}
                        title="Remove attachment"
                        onClick={onRemove}
                    >
                        <X className="size-3" />
                    </Button>
                )}
            </span>
            {open && isImage && safeUrl && !unavailable && (
                <ChatMediaGallery
                    items={images}
                    initialIndex={Math.max(
                        0,
                        images.findIndex(item => item.src === safeUrl)
                    )}
                    onClose={() => setOpen(false)}
                />
            )}
            <Dialog open={open && (!isImage || unavailable)} onOpenChange={setOpen}>
                <DialogContent className="border-line bg-panel max-h-[85vh] min-w-0 sm:max-w-3xl">
                    <DialogTitle className="text-ink break-all pr-6">{attachment.name}</DialogTitle>
                    <DialogDescription>
                        {(attachment.size / 1024).toFixed(1)} KiB · Attached to this message
                    </DialogDescription>
                    {unavailable || error ? (
                        <p role="alert" className="text-danger text-sm">
                            This file is unavailable. Attach it again or remove it before sending.
                        </p>
                    ) : canReadText ? (
                        <>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setRaw(previous => !previous)}
                                    disabled={!preview}
                                >
                                    {raw ? "Rendered view" : "Raw view"}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={!preview}
                                    onClick={() => {
                                        if (fullText.current !== null)
                                            void copyText(fullText.current).then(ok =>
                                                ok
                                                    ? toast.success("File contents copied")
                                                    : toast.error("Couldn't copy file contents")
                                            );
                                    }}
                                >
                                    Copy contents
                                </Button>
                            </div>
                            <div className="border-line bg-line-2 text-ink-2 max-h-[55vh] overflow-auto rounded-md border p-3 text-xs">
                                {preview === null ? (
                                    "Loading preview…"
                                ) : raw ? (
                                    <pre className="whitespace-pre-wrap break-words">{preview}</pre>
                                ) : isMarkdown || isHtml ? (
                                    <ChatMarkdown text={preview} />
                                ) : /\.(csv|tsv)$/i.test(attachment.name) ? (
                                    <ChatMarkdown
                                        text={delimitedPreview(
                                            preview,
                                            /\.tsv$/i.test(attachment.name) ? "\t" : ","
                                        )}
                                    />
                                ) : (
                                    <ChatMarkdown text={fencedPreview(preview, language)} />
                                )}
                            </div>
                        </>
                    ) : isPdf ? (
                        <PdfPreviewBoundary key={safeUrl}>
                            <PdfAttachmentPreview url={safeUrl} name={attachment.name} />
                        </PdfPreviewBoundary>
                    ) : (
                        <p className="text-ink-3 text-sm">
                            Save this document to open it in your document viewer.
                        </p>
                    )}
                    {safeUrl && (
                        <div className="flex flex-wrap gap-2">
                            {isPdf && (
                                <Button variant="outline" asChild>
                                    <a href={safeUrl} target="_blank" rel="noopener noreferrer">
                                        Open original
                                    </a>
                                </Button>
                            )}
                            <Button variant="outline" asChild className="justify-self-start">
                                <a
                                    href={safeUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    download={attachment.name}
                                >
                                    {isPdf ? "Download PDF" : "Save file"}
                                </a>
                            </Button>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
