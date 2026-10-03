"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { safeChatUri } from "./ChatMarkdown";

// Copied from react-pdf's own pdfjs dependency by scripts/copy-pdf-worker.mjs.
if (typeof window !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerSrc =
        process.env.NEXT_PUBLIC_PDF_WORKER_URL ?? "/pdf.worker.min.mjs";
}

const PDF_OPTIONS = { isEvalSupported: false, enableXfa: false };

export default function PdfAttachmentPreview({ url, name }: { url: string; name: string }) {
    const safeUrl = safeChatUri(url, true);
    const file = useMemo(() => (safeUrl ? { url: safeUrl } : undefined), [safeUrl]);
    const [pages, setPages] = useState(0);
    const [page, setPage] = useState(1);
    const [error, setError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [width, setWidth] = useState(640);
    const container = useRef<HTMLDivElement>(null);
    useEffect(() => {
        setPages(0);
        setPage(1);
        setError(null);
    }, [safeUrl]);
    useEffect(() => {
        const element = container.current;
        if (!element || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(entries => {
            const nextWidth = entries[0]?.contentRect.width;
            if (nextWidth && nextWidth > 32) setWidth(Math.max(160, Math.floor(nextWidth - 16)));
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    const fail = () =>
        setError(
            "The PDF preview could not load. Open the original or download the file to view it."
        );
    const retry = () => {
        setError(null);
        setPages(0);
        setPage(1);
        setAttempt(value => value + 1);
    };
    return (
        <div
            ref={container}
            className="border-line bg-line-2 w-full min-w-0 max-w-full overflow-hidden rounded-md border"
        >
            {error || !safeUrl ? (
                <div className="space-y-2 p-3">
                    <p role="alert" className="text-danger text-sm">
                        {error ??
                            "This PDF URL is unavailable. Attach the file again or remove it."}
                    </p>
                    {safeUrl && (
                        <Button variant="outline" size="sm" onClick={retry}>
                            Retry PDF preview
                        </Button>
                    )}
                </div>
            ) : (
                <>
                    {pages > 0 && (
                        <div className="border-line flex flex-wrap items-center justify-center gap-2 border-b p-2 text-xs">
                            <Button
                                variant="outline"
                                size="sm"
                                aria-label="Previous PDF page"
                                disabled={page <= 1}
                                onClick={() => setPage(value => value - 1)}
                            >
                                Previous
                            </Button>
                            <label className="text-ink-2 flex items-center gap-1">
                                Page{" "}
                                <Input
                                    aria-label="PDF page"
                                    type="number"
                                    min={1}
                                    max={pages}
                                    value={page}
                                    className="h-7 w-16 text-xs"
                                    onChange={event => {
                                        const value = Number(event.target.value);
                                        if (Number.isInteger(value) && value >= 1 && value <= pages)
                                            setPage(value);
                                    }}
                                />{" "}
                                of {pages}
                            </label>
                            <Button
                                variant="outline"
                                size="sm"
                                aria-label="Next PDF page"
                                disabled={page >= pages}
                                onClick={() => setPage(value => value + 1)}
                            >
                                Next
                            </Button>
                        </div>
                    )}
                    <div
                        className="max-h-[55vh] w-full min-w-0 max-w-full overflow-auto p-2"
                        aria-label={`PDF preview ${name}`}
                    >
                        <Document
                            key={`${safeUrl}:${attempt}`}
                            file={file}
                            className="min-w-0 max-w-full"
                            options={PDF_OPTIONS}
                            loading={
                                <p role="status" className="text-ink-3 p-3 text-sm">
                                    Loading PDF…
                                </p>
                            }
                            error={
                                <p role="alert" className="text-danger p-3 text-sm">
                                    The PDF preview could not load. Open the original or download
                                    the file.
                                </p>
                            }
                            onLoadSuccess={pdf => {
                                if (pdf.numPages < 1) fail();
                                else setPages(pdf.numPages);
                            }}
                            onLoadError={fail}
                            onSourceError={fail}
                            onPassword={() =>
                                setError(
                                    "This PDF requires a password. Open the original or download it to enter the password."
                                )
                            }
                        >
                            {pages > 0 && (
                                <Page
                                    pageNumber={page}
                                    width={width}
                                    renderAnnotationLayer={false}
                                    renderTextLayer
                                    onLoadError={fail}
                                    onRenderError={fail}
                                    loading={
                                        <p role="status" className="text-ink-3 p-3 text-sm">
                                            Loading page {page}…
                                        </p>
                                    }
                                    error={
                                        <p role="alert" className="text-danger p-3 text-sm">
                                            This PDF page could not render. Open the original or
                                            download the file.
                                        </p>
                                    }
                                />
                            )}
                        </Document>
                    </div>
                </>
            )}
        </div>
    );
}
