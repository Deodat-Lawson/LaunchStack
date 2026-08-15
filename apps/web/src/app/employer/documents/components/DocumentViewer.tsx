"use client";

import React, { useEffect, useState } from "react";
import {
    FileText,
    FileImage,
    FileSpreadsheet,
    FileCode,
    Loader2,
    AlertTriangle,
    RotateCw,
    Presentation,
    Archive,
    Music,
    History,
} from "lucide-react";
import type { DocumentType } from "../types";
import { getDocumentDisplayType, type DocumentDisplayType } from "../types/document";
import { DocxViewer } from "./DocxViewer";
import { XlsxViewer } from "./XlsxViewer";
import { PptxViewer } from "./PptxViewer";
import { ImageViewer } from "./ImageViewer";
import { CodeViewer } from "./CodeViewer";
import { AudioViewer } from "./AudioViewer";

interface DocumentViewerProps {
    document: DocumentType | null;
    pdfPageNumber?: number;
    setPdfPageNumber?: (page: number) => void;
    hideActions?: boolean;
    minimal?: boolean;
    isCollapsed?: boolean;
    /**
     * Optional callback to open the version history modal for the currently
     * displayed document. When provided, a "Versions" button is rendered in
     * the header toolbar (non-minimal mode only). This is the primary
     * discoverable entry point for the versioning feature — the hidden
     * three-dot menu in the sidebar is the secondary path.
     */
    onOpenVersionHistory?: () => void;
}

export const DISPLAY_TYPE_LABELS: Record<DocumentDisplayType, string> = {
    pdf: "PDF",
    image: "Image",
    docx: "Word",
    xlsx: "Spreadsheet",
    pptx: "Presentation",
    text: "Text / HTML",
    code: "Source Code",
    zip: "Archive",
    audio: "Audio",
    unknown: "File",
};

export const DISPLAY_TYPE_ICONS: Record<DocumentDisplayType, React.ElementType> = {
    pdf: FileText,
    image: FileImage,
    docx: FileText,
    xlsx: FileSpreadsheet,
    pptx: Presentation,
    text: FileCode,
    code: FileCode,
    zip: Archive,
    audio: Music,
    unknown: FileText,
};

/** Wrapper that shows a loading spinner and error state around an iframe */
function IframeWithState({
    src,
    title,
    iframeKey,
}: {
    src: string;
    title: string;
    iframeKey?: string | number;
}) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    // Reset states when src changes
    useEffect(() => {
        setLoading(true);
        setError(false);
    }, [src]);

    return (
        <div className="relative h-full w-full">
            {loading && !error && (
                <div className="bg-muted/30 absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
                    <p className="text-muted-foreground text-sm font-medium">Loading...</p>
                </div>
            )}
            {error && (
                <div className="bg-muted/30 absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 p-8 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-900/20">
                        <AlertTriangle className="h-7 w-7 text-red-500" />
                    </div>
                    <div>
                        <p className="text-foreground mb-1 text-sm font-medium">
                            Failed to load document
                        </p>
                        <p className="text-muted-foreground mb-4 text-xs">
                            The document could not be displayed.
                        </p>
                        <button
                            onClick={() => {
                                setLoading(true);
                                setError(false);
                            }}
                            className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700"
                        >
                            <RotateCw className="h-4 w-4" />
                            Retry
                        </button>
                    </div>
                </div>
            )}
            <iframe
                key={iframeKey}
                src={src}
                className="h-full w-full border-0"
                title={title}
                onLoad={() => setLoading(false)}
                onError={() => {
                    setLoading(false);
                    setError(true);
                }}
            />
        </div>
    );
}

export function DocumentViewer({
    document,
    pdfPageNumber = 1,
    setPdfPageNumber: _setPdfPageNumber,
    hideActions: _hideActions = false,
    minimal = false,
    isCollapsed = false,
    onOpenVersionHistory,
}: DocumentViewerProps) {
    // Track document view
    useEffect(() => {
        if (document?.id && !isCollapsed) {
            const trackView = async () => {
                try {
                    await fetch("/api/documents/track-view", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ documentId: document.id }),
                    });
                } catch (error) {
                    console.error("Failed to track document view:", error);
                }
            };

            void trackView();
        }
    }, [document?.id, isCollapsed]);

    if (isCollapsed) {
        return (
            <div className="bg-muted/20 border-border animate-in fade-in flex h-full flex-col items-center border-l py-4 duration-300">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 shadow-sm dark:bg-purple-900/30">
                    <FileText className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div className="text-muted-foreground flex flex-1 items-center justify-center text-[10px] font-bold uppercase tracking-widest opacity-50 [writing-mode:vertical-rl]">
                    Document Preview
                </div>
            </div>
        );
    }

    if (!document) {
        return (
            <div className="bg-muted/30 animate-in fade-in flex h-full flex-1 flex-col items-center justify-center p-8 text-center duration-500">
                <div className="bg-muted mb-6 flex h-20 w-20 items-center justify-center rounded-3xl shadow-sm">
                    <FileText className="text-muted-foreground/30 h-10 w-10" />
                </div>
                <h3 className="text-foreground mb-2 text-xl font-semibold">No Document Selected</h3>
                <p className="text-muted-foreground max-w-xs text-sm font-medium">
                    Select a document from the sidebar to view its content and start your analysis.
                </p>
            </div>
        );
    }

    const displayType = getDocumentDisplayType(document);
    const DisplayIcon = DISPLAY_TYPE_ICONS[displayType];
    const getPdfSrcWithPage = (url: string, page: number) => `${url}#page=${page}`;

    const renderContent = () => {
        switch (displayType) {
            case "pdf":
                return (
                    <IframeWithState
                        iframeKey={`${document.id}-${pdfPageNumber}`}
                        src={getPdfSrcWithPage(document.url, pdfPageNumber)}
                        title={document.title}
                    />
                );
            case "image":
                return <ImageViewer src={document.url} alt={document.title} minimal={minimal} />;
            case "docx":
                return <DocxViewer url={document.url} title={document.title} />;
            case "xlsx":
                return <XlsxViewer url={document.url} title={document.title} />;
            case "pptx":
                return <PptxViewer url={document.url} title={document.title} />;
            case "code":
                return (
                    <CodeViewer
                        url={document.url}
                        title={document.title}
                        mimeType={document.mimeType}
                    />
                );
            case "audio":
                return <AudioViewer document={document} />;
            case "zip":
            case "text":
                return (
                    <IframeWithState
                        iframeKey={document.id}
                        src={document.url}
                        title={document.title}
                    />
                );
            case "unknown":
            default:
                // Graceful fallback: try iframe (browsers handle PDFs, images, text natively)
                return (
                    <IframeWithState
                        iframeKey={document.id}
                        src={document.url}
                        title={document.title}
                    />
                );
        }
    };

    return (
        <div className="bg-background flex h-full flex-col overflow-hidden transition-all duration-300">
            {/* Document Header - Clean and minimal */}
            {!minimal && (
                <div className="bg-background border-border z-10 flex-shrink-0 border-b px-6 py-3">
                    <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <div className="rounded bg-purple-100 p-1 dark:bg-purple-900/30">
                                    <DisplayIcon className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                                </div>
                                <h1 className="text-foreground truncate text-sm font-semibold leading-none">
                                    {document.title}
                                </h1>
                                <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-medium capitalize">
                                    {document.category}
                                </span>
                                <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-600 dark:bg-purple-900/20 dark:text-purple-400">
                                    {DISPLAY_TYPE_LABELS[displayType]}
                                </span>
                            </div>
                        </div>

                        <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
                            {onOpenVersionHistory && (
                                <button
                                    type="button"
                                    onClick={onOpenVersionHistory}
                                    className="border-border inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold text-purple-600 transition-colors hover:border-purple-300 hover:bg-purple-50 dark:text-purple-400 dark:hover:border-purple-700 dark:hover:bg-purple-900/20"
                                    title="View and manage document versions"
                                >
                                    <History className="h-3.5 w-3.5" />
                                    Versions
                                </button>
                            )}
                            <span>Browser Native Viewer</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Document Content */}
            <div className="bg-muted/30 relative flex-1 overflow-hidden">{renderContent()}</div>
        </div>
    );
}
