"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ExternalLink, Eye, FileText, Globe, Loader2, RotateCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import type { ViewerHighlight } from "~/lib/find-text-range";
import {
    MIN_READABLE_WORDS,
    websiteHost,
    websiteMarkerOf,
    wordCount,
} from "~/lib/website-document";
import type { DocumentType } from "../types/document";
import { MarkdownViewer } from "./MarkdownViewer";

type View = "preview" | "text";

type PageText =
    | { status: "loading" }
    | { status: "failed"; message: string }
    | { status: "loaded"; markdown: string; chunkCount: number };

type PagePicture =
    | { status: "loading" }
    | { status: "ready"; src: string; truncated: boolean }
    /** `unavailable`: this server has no rendering service, so trying again won't help. */
    | { status: "failed"; unavailable: boolean; message: string };

/**
 * A site's decorative images (empty alt text, by the web's own convention:
 * hero gradients, glows, spacers) say nothing and render as blank boxes, so
 * they are left out, and never fetched. Images with alt text stay.
 */
export function withoutDecorativeImages(markdown: string): string {
    return markdown.replace(/!\[\s*\]\([^)]*\)/g, "").replace(/\n{3,}/g, "\n\n");
}

function savedOn(raw: string | null | undefined): Date | null {
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
}

function Notice({
    title,
    children,
    action,
}: {
    title: string;
    children: ReactNode;
    action?: ReactNode;
}) {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-ink text-sm font-medium">{title}</p>
            <p className="text-ink-3 max-w-[52ch] text-sm leading-relaxed">{children}</p>
            {action && <div className="flex flex-wrap justify-center gap-2">{action}</div>}
        </div>
    );
}

/**
 * The picture of the page the server took when it was first opened
 * (`/api/documents/:id/website-preview`), as an object URL. Fetched rather
 * than put straight into an `<img>`, so a failure can say why.
 */
function usePagePicture(documentId: number, attempt: number): PagePicture {
    const [picture, setPicture] = useState<PagePicture>({ status: "loading" });

    useEffect(() => {
        let cancelled = false;
        let objectUrl: string | null = null;
        setPicture({ status: "loading" });

        void (async () => {
            try {
                const response = await fetch(`/api/documents/${documentId}/website-preview`);
                if (!response.ok) {
                    const body = (await response.json().catch(() => ({}))) as {
                        error?: string;
                        message?: string;
                    };
                    if (cancelled) return;
                    setPicture({
                        status: "failed",
                        unavailable: body.error === "service_not_configured",
                        message: body.message ?? "",
                    });
                    return;
                }
                const blob = await response.blob();
                if (cancelled) return;
                objectUrl = URL.createObjectURL(blob);
                setPicture({
                    status: "ready",
                    src: objectUrl,
                    truncated: response.headers.get("x-preview-truncated") === "true",
                });
            } catch (cause) {
                if (cancelled) return;
                setPicture({
                    status: "failed",
                    unavailable: false,
                    message: cause instanceof Error ? cause.message : "",
                });
            }
        })();

        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [documentId, attempt]);

    return picture;
}

/** The page as it looked when it was saved, top to bottom. */
function PreviewPane({
    document,
    host,
    onShowText,
}: {
    document: DocumentType;
    host: string;
    onShowText: () => void;
}) {
    const t = useTranslations("viewers.website");
    const [attempt, setAttempt] = useState(0);
    const picture = usePagePicture(document.id, attempt);

    if (picture.status === "loading") {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
                <p className="text-ink-2 flex items-center gap-2 text-sm">
                    <Loader2
                        className="size-4 animate-spin motion-reduce:animate-none"
                        aria-hidden
                    />
                    {t("previewLoading")}
                </p>
                <p className="text-ink-3 text-xs">{t("previewLoadingHint")}</p>
            </div>
        );
    }

    if (picture.status === "failed") {
        const showText = (
            <Button variant="outline" size="sm" onClick={onShowText}>
                <FileText aria-hidden />
                {t("showText")}
            </Button>
        );
        return (
            <Notice
                title={picture.unavailable ? t("previewUnavailableTitle") : t("previewFailedTitle")}
                action={
                    picture.unavailable ? (
                        showText
                    ) : (
                        <>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setAttempt(n => n + 1)}
                            >
                                <RotateCw aria-hidden />
                                {t("tryAgain")}
                            </Button>
                            {showText}
                        </>
                    )
                }
            >
                {picture.message || t("previewFailedTitle")}
            </Notice>
        );
    }

    return (
        <div
            className="bg-surface-sunk h-full overflow-auto"
            role="region"
            aria-label={t("previewAlt", { host })}
            tabIndex={0}
        >
            <div className="mx-auto w-full max-w-[1280px] p-3 sm:p-5">
                {/* eslint-disable-next-line @next/next/no-img-element -- an object URL of the stored screenshot */}
                <img
                    src={picture.src}
                    alt={t("previewAlt", { host })}
                    className="border-line bg-panel block h-auto w-full rounded-lg border shadow-sm"
                    draggable={false}
                />
                {picture.truncated && (
                    <p className="text-ink-3 mt-3 text-center text-xs">{t("previewTruncated")}</p>
                )}
            </div>
        </div>
    );
}

/**
 * The text ingestion read from the page: what Ask and the company profile
 * quote, and where a citation lands with its passage highlighted.
 */
function PageTextPane({
    document,
    highlight,
}: {
    document: DocumentType;
    highlight: ViewerHighlight | null;
}) {
    const t = useTranslations("viewers.website");
    const [text, setText] = useState<PageText>({ status: "loading" });

    const load = useCallback(async () => {
        setText({ status: "loading" });
        try {
            const response = await fetch(`/api/documents/${document.id}/text?format=markdown`);
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            const body = (await response.json()) as { markdown?: string; chunkCount?: number };
            setText({
                status: "loaded",
                markdown: body.markdown ?? "",
                chunkCount: body.chunkCount ?? 0,
            });
        } catch (cause) {
            setText({
                status: "failed",
                message: cause instanceof Error ? cause.message : "",
            });
        }
    }, [document.id]);

    useEffect(() => {
        void load();
    }, [load]);

    const indexError = document.ocrMetadata?.errorMessage ?? document.ocrMetadata?.error;
    const checkAgain = (
        <Button variant="outline" size="sm" onClick={() => void load()}>
            <RotateCw aria-hidden />
            {t("checkAgain")}
        </Button>
    );

    if (text.status === "loading") {
        return (
            <div className="text-ink-3 flex h-full items-center justify-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
                {t("loading")}
            </div>
        );
    }
    if (text.status === "failed") {
        return (
            <Notice title={t("loadFailed")} action={checkAgain}>
                {text.message || t("loadFailed")}
            </Notice>
        );
    }
    if (text.chunkCount === 0 && indexError) {
        return (
            <Notice title={t("unreadableTitle")}>
                {t("unreadableBody", { error: indexError })}
            </Notice>
        );
    }
    if (text.chunkCount === 0 && !document.ocrProcessed) {
        return (
            <Notice title={t("readingTitle")} action={checkAgain}>
                {t("readingBody")}
            </Notice>
        );
    }
    if (wordCount(text.markdown) < MIN_READABLE_WORDS) {
        return <Notice title={t("thinTitle")}>{t("thinBody")}</Notice>;
    }
    return (
        <div className="flex h-full min-h-0 flex-col">
            <p className="text-ink-3 border-line shrink-0 border-b px-4 py-2 text-xs">
                {t("textNote")}
            </p>
            {/* A site's hero shots run thousands of pixels tall; keep them to a glance. */}
            <div className="min-h-0 flex-1 [&_.md-doc_img]:max-h-64 [&_.md-doc_img]:w-auto [&_.md-doc_img]:object-contain">
                <MarkdownViewer
                    text={withoutDecorativeImages(text.markdown)}
                    title={document.title}
                    highlight={highlight}
                />
            </div>
        </div>
    );
}

/**
 * A saved web page, as a source.
 *
 * It opens as a picture of the page as it was saved, taken by the server
 * (see `server/website-preview.ts`): most company sites refuse to be framed
 * inside another app, and the saved HTML framed in a sandbox renders blank.
 * "Page text" shows what ingestion read from the page, which is what Ask and
 * the company profile quote; a citation opens there with its passage
 * highlighted, since a picture cannot be.
 */
export function WebsiteViewer({
    document,
    highlight = null,
}: {
    document: DocumentType;
    highlight?: ViewerHighlight | null;
}) {
    const t = useTranslations("viewers.website");
    const tc = useTranslations("common");
    const format = useFormatter();
    const marker = websiteMarkerOf(document.ocrMetadata);
    const url = marker?.url ?? null;
    const host = url ? websiteHost(url) : document.title;
    const savedAt = savedOn(marker?.capturedAt ?? document.createdAt);
    const saved = savedAt ? format.dateTime(savedAt, { dateStyle: "medium" }) : null;

    const [view, setView] = useState<View>(highlight ? "text" : "preview");
    // Each pane loads once and is kept, so switching back and forth is instant.
    const [opened, setOpened] = useState<ReadonlySet<View>>(() => new Set([view]));

    const show = useCallback((next: View) => {
        setView(next);
        setOpened(prev => (prev.has(next) ? prev : new Set([...prev, next])));
    }, []);

    // The passage the text pane locates. It changes in the same render that
    // reveals the pane: handed over while the pane is still hidden, the text
    // viewer would measure an invisible range, and revealing it afterwards
    // gives the viewer nothing to re-run on.
    const [textHighlight, setTextHighlight] = useState(highlight);

    // A citation clicked while the site is already open goes to its passage.
    useEffect(() => {
        if (highlight) show("text");
        setTextHighlight(highlight);
    }, [highlight, show]);

    return (
        <div className="bg-surface flex h-full min-h-0 flex-col">
            <div className="border-line bg-panel flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
                <div className="bg-brand-soft text-brand-ink flex size-9 shrink-0 items-center justify-center rounded-lg">
                    <Globe className="size-4" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-ink truncate text-sm font-semibold">{host}</p>
                    <p className="text-ink-3 truncate text-xs">
                        {url ?? t("website")}
                        {saved && <> {t("savedOn", { date: saved })}</>}
                    </p>
                </div>
                <ToggleGroup
                    type="single"
                    size="sm"
                    value={view}
                    onValueChange={value => {
                        if (value === "preview" || value === "text") show(value);
                    }}
                    aria-label={t("viewToggle")}
                >
                    <ToggleGroupItem value="preview" className="gap-1.5 px-2.5 text-xs">
                        <Eye className="size-3.5" aria-hidden />
                        {tc("actions.preview")}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="text" className="gap-1.5 px-2.5 text-xs">
                        <FileText className="size-3.5" aria-hidden />
                        {t("tabText")}
                    </ToggleGroupItem>
                </ToggleGroup>
                {url && (
                    <Button asChild variant="outline" size="sm">
                        <a href={url} target="_blank" rel="noopener noreferrer">
                            {t("openSite")}
                            <ExternalLink aria-hidden />
                        </a>
                    </Button>
                )}
            </div>
            <div className="relative min-h-0 flex-1">
                {opened.has("preview") && (
                    <div className="h-full" hidden={view !== "preview"}>
                        <PreviewPane
                            document={document}
                            host={host}
                            onShowText={() => show("text")}
                        />
                    </div>
                )}
                {opened.has("text") && (
                    <div className="h-full" hidden={view !== "text"}>
                        <PageTextPane document={document} highlight={textHighlight} />
                    </div>
                )}
            </div>
        </div>
    );
}
