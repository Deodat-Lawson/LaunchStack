"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, AlertTriangle, RotateCw, Download } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";

import { DocxCanvas } from "./docx/DocxCanvas";

interface DocxViewerProps {
    url: string;
    title: string;
}

/**
 * Read-only Word preview: the pages as Word lays them out (docx-preview, the
 * same canvas the full editor uses), shrunk to the pane's width. It used to
 * run the file through mammoth, which keeps the words and drops the fonts,
 * alignment and page geometry — a Doc synced from Google Drive came out as
 * plain prose that looked nothing like the Doc.
 */
export function DocxViewer({ url, title }: DocxViewerProps) {
    const t = useTranslations("viewers.docxPreview");
    const tc = useTranslations("common");
    const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadDocument = useCallback(async () => {
        setLoading(true);
        setError(null);
        setBytes(null);
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(t("fetchFailed", { status: response.status }));
            setBytes(await response.arrayBuffer());
        } catch (err) {
            console.error("[DocxViewer] Error loading document:", err);
            setError(err instanceof Error ? err.message : t("renderFailed"));
        } finally {
            setLoading(false);
        }
    }, [url, t]);

    useEffect(() => {
        void loadDocument();
    }, [loadDocument]);

    if (loading) {
        return (
            <div className="bg-panel-2/30 flex h-full flex-col items-center justify-center gap-3">
                <Loader2 className="text-brand-ink h-8 w-8 animate-spin" />
                <p className="text-ink-3 text-sm font-medium">{t("loading")}</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-panel-2/30 flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
                <div className="bg-danger-soft flex h-14 w-14 items-center justify-center rounded-2xl">
                    <AlertTriangle className="text-danger h-7 w-7" />
                </div>
                <div>
                    <p className="text-ink mb-1 text-sm font-medium">{t("renderFailed")}</p>
                    <p className="text-ink-3 mb-4 text-xs">{error}</p>
                    <div className="flex items-center justify-center gap-3">
                        <Button size="sm" onClick={() => void loadDocument()}>
                            <RotateCw className="h-4 w-4" />
                            {tc("actions.retry")}
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                            <a href={url} download>
                                <Download className="h-4 w-4" />
                                {tc("actions.download")}
                            </a>
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full w-full flex-col overflow-hidden" aria-label={title}>
            <div className="border-line bg-panel-2/30 flex flex-shrink-0 items-center justify-between border-b px-4 py-2">
                <span className="text-ink-3 text-xs font-medium">{t("header")}</span>
                <Button size="sm" variant="ghost" asChild>
                    <a href={url} download>
                        <Download className="h-3.5 w-3.5" />
                        {tc("actions.download")}
                    </a>
                </Button>
            </div>
            <div className="min-h-0 flex-1">
                <DocxCanvas
                    bytes={bytes}
                    zoom="fit"
                    showChanges={false}
                    showComments={false}
                    onRenderError={setError}
                />
            </div>
        </div>
    );
}
