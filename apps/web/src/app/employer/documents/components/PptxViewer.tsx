"use client";

import React, { useState } from "react";
import { Loader2, AlertTriangle, ExternalLink, Monitor } from "lucide-react";

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
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    // Build absolute URL for Office Online
    const absoluteUrl = url.startsWith("http") ? url : `${window.location.origin}${url}`;
    const canEmbed = isPublicUrl(absoluteUrl);

    if (!canEmbed) {
        return (
            <div className="bg-muted/30 flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 dark:bg-orange-900/20">
                    <Monitor className="h-8 w-8 text-orange-500" />
                </div>
                <div>
                    <p className="text-foreground mb-1 text-sm font-medium">
                        PowerPoint preview requires a publicly accessible URL
                    </p>
                    <p className="text-muted-foreground mb-4 text-xs">
                        This file is stored locally and cannot be embedded in the Office Online
                        viewer. You can download it and open it in PowerPoint or Google Slides.
                    </p>
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700"
                    >
                        <ExternalLink className="h-4 w-4" />
                        Download presentation
                    </a>
                </div>
            </div>
        );
    }

    const officeViewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(absoluteUrl)}`;

    return (
        <div className="bg-muted/30 relative h-full w-full">
            {/* Loading indicator */}
            {loading && !error && (
                <div className="bg-muted/30 absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
                    <p className="text-muted-foreground text-sm font-medium">
                        Loading presentation...
                    </p>
                </div>
            )}

            {/* Error state */}
            {error && (
                <div className="bg-muted/30 absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 p-8 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-900/20">
                        <AlertTriangle className="h-7 w-7 text-red-500" />
                    </div>
                    <div>
                        <p className="text-foreground mb-1 text-sm font-medium">
                            Office Online viewer failed to load
                        </p>
                        <p className="text-muted-foreground mb-4 text-xs">
                            The file may not be accessible. Try downloading it instead.
                        </p>
                        <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700"
                        >
                            <ExternalLink className="h-4 w-4" />
                            Download presentation
                        </a>
                    </div>
                </div>
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
