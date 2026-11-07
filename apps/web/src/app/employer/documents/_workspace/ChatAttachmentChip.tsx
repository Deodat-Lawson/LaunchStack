"use client";

import React, { Component, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
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

function PdfViewerLoading({ error }: { error?: unknown }) {
    const t = useTranslations("chat.attachmentChip");
    return (
        <p role={error ? "alert" : "status"} className="text-ink-3 p-3 text-sm">
            {error ? t("pdfLoadFailed") : t("pdfLoading")}
        </p>
    );
}

function PdfViewerFailed() {
    const t = useTranslations("chat.attachmentChip");
    return (
        <p role="alert" className="text-danger text-sm">
            {t("pdfLoadFailed")}
        </p>
    );
}

const PdfAttachmentPreview = dynamic(() => import("./PdfAttachmentPreview"), {
    ssr: false,
    loading: ({ error }) => <PdfViewerLoading error={error} />,
});

class PdfPreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    override state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    override render() {
        return this.state.failed ? <PdfViewerFailed /> : this.props.children;
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
    const t = useTranslations("chat.attachmentChip");
    const tMenu = useTranslations("chat.contextMenu");
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
        label: t("actionsFor", { name: attachment.name }),
        data: attachment,
        items: () =>
            buildAttachmentMenuItems(attachment, { onOpen: () => setOpen(true), onRemove }, tMenu),
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
                                ? `\n${t("previewTruncated", { limit: 30_000 })}`
                                : "")
                    );
                }
            })
            .catch(() => {
                if (!controller.signal.aborted) setError(true);
            });
        return () => controller.abort();
    }, [open, safeUrl, unavailable, isImage, canReadText, t]);
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
                    aria-label={t("preview", { name: attachment.name })}
                    data-attachment-preview={attachment.id}
                >
                    {isImage && safeUrl && !unavailable ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={safeUrl} alt="" className="size-5 rounded object-cover" />
                    ) : (
                        <FileText className="size-3.5" />
                    )}
                    <span className="truncate">{attachment.name}</span>
                    {unavailable && <span className="text-ink-3">{t("unavailable")}</span>}
                </Button>
                {unavailable && onReattach && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-1.5 text-xs"
                        aria-label={t("reattach", { name: attachment.name })}
                        onClick={onReattach}
                    >
                        {t("attachAgain")}
                    </Button>
                )}
                {onRemove && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        aria-label={t("remove", { name: attachment.name })}
                        title={t("removeAttachment")}
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
                        {t("description", { size: (attachment.size / 1024).toFixed(1) })}
                    </DialogDescription>
                    {unavailable || error ? (
                        <p role="alert" className="text-danger text-sm">
                            {t("fileUnavailable")}
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
                                    {raw ? t("renderedView") : t("rawView")}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={!preview}
                                    onClick={() => {
                                        if (fullText.current !== null)
                                            void copyText(fullText.current).then(ok =>
                                                ok
                                                    ? toast.success(t("contentsCopied"))
                                                    : toast.error(t("contentsCopyFailed"))
                                            );
                                    }}
                                >
                                    {t("copyContents")}
                                </Button>
                            </div>
                            <div className="border-line bg-line-2 text-ink-2 max-h-[55vh] overflow-auto rounded-md border p-3 text-xs">
                                {preview === null ? (
                                    t("loadingPreview")
                                ) : raw ? (
                                    <pre className="whitespace-pre-wrap break-words">{preview}</pre>
                                ) : isMarkdown || isHtml ? (
                                    <ChatMarkdown text={preview} />
                                ) : /\.(csv|tsv)$/i.test(attachment.name) ? (
                                    <ChatMarkdown
                                        text={delimitedPreview(
                                            preview,
                                            /\.tsv$/i.test(attachment.name) ? "\t" : ",",
                                            100,
                                            {
                                                empty: t("csvEmpty"),
                                                limited: max => t("csvLimited", { max }),
                                            }
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
                        <p className="text-ink-3 text-sm">{t("saveToOpen")}</p>
                    )}
                    {safeUrl && (
                        <div className="flex flex-wrap gap-2">
                            {isPdf && (
                                <Button variant="outline" asChild>
                                    <a href={safeUrl} target="_blank" rel="noopener noreferrer">
                                        {t("openOriginal")}
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
                                    {isPdf ? t("downloadPdf") : t("saveFile")}
                                </a>
                            </Button>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
