"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "~/lib/utils";

import "./docx-canvas.css";

interface DocxCanvasProps {
    bytes: ArrayBuffer | null;
    /** 1 = 100%. Applied as a transform so Word's own page metrics survive. */
    zoom: number;
    showChanges: boolean;
    showComments: boolean;
    onRenderError?: (message: string) => void;
}

/**
 * Renders a Word document as Word lays it out.
 *
 * The previous viewer ran the file through mammoth, which converts to semantic
 * HTML and deliberately discards fonts, sizes, alignment, page geometry,
 * headers, and numbering — so a contract rendered as unstyled prose that
 * looked nothing like the file the user uploaded. docx-preview reads the
 * OOXML directly and reproduces the real page boxes and run formatting, which
 * is the difference between previewing a document and reading it.
 *
 * It also renders tracked changes and comment anchors natively, so the review
 * pane and the page agree about what is being reviewed.
 */
export function DocxCanvas({
    bytes,
    zoom,
    showChanges,
    showComments,
    onRenderError,
}: DocxCanvasProps) {
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const styleRef = useRef<HTMLDivElement | null>(null);
    const [rendering, setRendering] = useState(false);

    useEffect(() => {
        const body = bodyRef.current;
        const styles = styleRef.current;
        if (!bytes || !body || !styles) return;

        let cancelled = false;
        setRendering(true);

        void (async () => {
            try {
                const { renderAsync } = await import("docx-preview");
                if (cancelled) return;

                body.innerHTML = "";
                styles.innerHTML = "";

                await renderAsync(new Blob([bytes]), body, styles, {
                    className: "lsdocx",
                    inWrapper: true,
                    // Word's own page size and margins are the point of a
                    // faithful render; overriding them would reproduce the
                    // approximation this replaces.
                    ignoreWidth: false,
                    ignoreHeight: false,
                    ignoreFonts: false,
                    breakPages: true,
                    renderHeaders: true,
                    renderFooters: true,
                    renderFootnotes: true,
                    renderEndnotes: true,
                    renderChanges: showChanges,
                    renderComments: showComments,
                    useBase64URL: true,
                    experimental: true,
                });
            } catch (err) {
                if (cancelled) return;
                const message =
                    err instanceof Error ? err.message : "This document could not be rendered.";
                console.error("[DocxCanvas] render failed", err);
                onRenderError?.(message);
            } finally {
                if (!cancelled) setRendering(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [bytes, showChanges, showComments, onRenderError]);

    return (
        <div className="bg-surface-sunk relative h-full overflow-auto">
            {rendering && (
                <div
                    className="bg-surface-sunk/70 absolute inset-0 z-10 flex items-center justify-center backdrop-blur-sm"
                    role="status"
                    aria-label="Rendering document"
                >
                    <Loader2 className="text-brand h-6 w-6 animate-spin" aria-hidden="true" />
                </div>
            )}

            {/* docx-preview writes the document's own stylesheet here. It is
                scoped by the .lsdocx class so it cannot leak into app chrome. */}
            <div ref={styleRef} className="hidden" aria-hidden="true" />

            <div className="flex justify-center px-6 py-8">
                <div
                    ref={bodyRef}
                    className={cn("lsdocx-host origin-top transition-transform duration-150")}
                    style={{ transform: `scale(${zoom})` }}
                />
            </div>
        </div>
    );
}
