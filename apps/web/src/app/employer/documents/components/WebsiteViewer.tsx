"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ExternalLink, Globe, Loader2, RotateCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import type { ViewerHighlight } from "~/lib/find-text-range";
import {
    MIN_READABLE_WORDS,
    websiteHost,
    websiteMarkerOf,
    wordCount,
} from "~/lib/website-document";
import type { DocumentType } from "../types/document";
import { MarkdownViewer } from "./MarkdownViewer";

type PageText =
    | { status: "loading" }
    | { status: "failed"; message: string }
    | { status: "loaded"; markdown: string; chunkCount: number };

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
            {action}
        </div>
    );
}

/**
 * A saved web page, as a source.
 *
 * The file behind it is the page's HTML, kept for ingestion. It is not shown:
 * framed with scripts off (it is untrusted code) most company sites render as
 * a white page. What is shown is the site's address, a way to open it, and
 * the text ingestion read from the page, which is what Ask and the company
 * profile quote.
 */
export function WebsiteViewer({
    document,
    highlight = null,
}: {
    document: DocumentType;
    highlight?: ViewerHighlight | null;
}) {
    const t = useTranslations("viewers.website");
    const format = useFormatter();
    const marker = websiteMarkerOf(document.ocrMetadata);
    const url = marker?.url ?? null;
    const host = url ? websiteHost(url) : document.title;
    const savedAt = savedOn(marker?.capturedAt ?? document.createdAt);
    const saved = savedAt ? format.dateTime(savedAt, { dateStyle: "medium" }) : null;
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

    let body: ReactNode;
    let showsText = false;
    if (text.status === "loading") {
        body = (
            <div className="text-ink-3 flex h-full items-center justify-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
                {t("loading")}
            </div>
        );
    } else if (text.status === "failed") {
        body = (
            <Notice title={t("loadFailed")} action={checkAgain}>
                {text.message || t("loadFailed")}
            </Notice>
        );
    } else if (text.chunkCount === 0 && indexError) {
        body = (
            <Notice title={t("unreadableTitle")}>
                {t("unreadableBody", { error: indexError })}
            </Notice>
        );
    } else if (text.chunkCount === 0 && !document.ocrProcessed) {
        body = (
            <Notice title={t("readingTitle")} action={checkAgain}>
                {t("readingBody")}
            </Notice>
        );
    } else if (wordCount(text.markdown) < MIN_READABLE_WORDS) {
        body = <Notice title={t("thinTitle")}>{t("thinBody")}</Notice>;
    } else {
        showsText = true;
        body = (
            <MarkdownViewer
                text={withoutDecorativeImages(text.markdown)}
                title={document.title}
                highlight={highlight}
            />
        );
    }

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
                {url && (
                    <Button asChild variant="outline" size="sm">
                        <a href={url} target="_blank" rel="noopener noreferrer">
                            {t("openSite")}
                            <ExternalLink aria-hidden />
                        </a>
                    </Button>
                )}
                {showsText && <p className="text-ink-3 basis-full text-xs">{t("textNote")}</p>}
            </div>
            {/* A site's hero shots run thousands of pixels tall; keep them to a glance. */}
            <div className="min-h-0 flex-1 [&_.md-doc_img]:max-h-64 [&_.md-doc_img]:w-auto [&_.md-doc_img]:object-contain">
                {body}
            </div>
        </div>
    );
}
