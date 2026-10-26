"use client";

import React, { useState } from "react";
import { Loader2, AlertTriangle, ExternalLink, Monitor } from "lucide-react";
import { useTranslations } from "next-intl";
import { ViewerNotice } from "./ViewerNotice";
import { Button } from "~/components/ui/button";

interface PptxViewerProps {
    url: string;
    title: string;
}

/**
 * Returns true if the URL is a publicly accessible HTTP(S) URL.
 * Database-stored files (e.g. /api/files/123) are not publicly accessible
 * and cannot be embedded via Office Online.
 */
function isPublicUrl(url: string): boolean {
    try {
        const parsed = new URL(url, window.location.origin);
        return parsed.protocol === "https:" && !parsed.pathname.startsWith("/api/files/");
    } catch {
        return false;
    }
}

/**
 * PPTX viewer that uses Microsoft Office Online viewer for publicly accessible
 * files and shows a download fallback for locally stored files.
 */
export function PptxViewer({ url, title }: PptxViewerProps) {
    const t = useTranslations("viewers.pptx");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    // Build absolute URL for Office Online
    const absoluteUrl = url.startsWith("http") ? url : `${window.location.origin}${url}`;
    const canEmbed = isPublicUrl(absoluteUrl);

    if (!canEmbed) {
        return (
            <ViewerNotice
                tone="warn"
                icon={<Monitor />}
                title={t("needsPublicUrl")}
                detail={t("needsPublicUrlDetail")}
                action={
                    <Button asChild>
                        <a href={url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink />
                            {t("download")}
                        </a>
                    </Button>
                }
            />
        );
    }

    const officeViewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(absoluteUrl)}`;

    return (
        <div className="bg-panel-2/30 relative h-full w-full">
            {/* Loading indicator */}
            {loading && !error && (
                <div className="bg-panel-2/30 absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
                    <Loader2 className="text-brand-ink h-8 w-8 animate-spin" />
                    <p className="text-ink-3 text-sm font-medium">{t("loading")}</p>
                </div>
            )}

            {/* Error state */}
            {error && (
                <ViewerNotice
                    overlay
                    icon={<AlertTriangle />}
                    title={t("loadFailed")}
                    detail={t("loadFailedDetail")}
                    action={
                        <Button asChild>
                            <a href={url} target="_blank" rel="noopener noreferrer">
                                <ExternalLink />
                                {t("download")}
                            </a>
                        </Button>
                    }
                />
            )}

            <iframe
                src={officeViewerUrl}
                className="h-full w-full border-0"
                title={title}
                onLoad={() => setLoading(false)}
                onError={() => {
                    setLoading(false);
                    setError(true);
                }}
                sandbox="allow-scripts allow-same-origin allow-popups"
            />
        </div>
    );
}
