"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "~/lib/utils";

import "./docx-canvas.css";

interface DocxCanvasProps {
    bytes: ArrayBuffer | null;
    /**
     * 1 = 100%. Applied as a transform so Word's own page metrics survive.
     * "fit" shrinks the pages to the pane's width (never past 100%), for a
     * preview beside other panels where Word's page would not fit.
     */
    zoom: number | "fit";
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
    const t = useTranslations("viewers.docx");
    // The render effect reads the words through this rather than re-running on them.
    const tRef = useRef(t);
    tRef.current = t;
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const styleRef = useRef<HTMLDivElement | null>(null);
    const [rendering, setRendering] = useState(false);
    const fit = zoom === "fit";
    const pages = useFittedPages(fit, scrollRef, bodyRef);
    const scale = fit ? pages.scale : zoom;

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
                    err instanceof Error ? err.message : tRef.current("renderFailedFallback");
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
        <div ref={scrollRef} className="bg-surface-sunk relative h-full overflow-auto">
            {rendering && (
                <div
                    className="bg-surface-sunk/70 absolute inset-0 z-10 flex items-center justify-center backdrop-blur-sm"
                    role="status"
                    aria-label={t("rendering")}
                >
                    <Loader2 className="text-brand h-6 w-6 animate-spin" aria-hidden="true" />
                </div>
            )}

            {/* docx-preview writes the document's own stylesheet here. It is
                scoped by the .lsdocx class so it cannot leak into app chrome. */}
            <div ref={styleRef} className="hidden" aria-hidden="true" />

            <div className={cn("flex justify-center", fit ? "px-4 py-6" : "px-6 py-8")}>
                {fit ? (
                    // A transform leaves the layout box at full size, so the
                    // scaled pages sit in a box cut to what they now measure.
                    <div
                        className="overflow-hidden"
                        style={{
                            width: pages.width * scale,
                            height: pages.height * scale,
                        }}
                    >
                        <div
                            ref={bodyRef}
                            className="lsdocx-host w-max origin-top-left"
                            style={{ transform: `scale(${scale})` }}
                        />
                    </div>
                ) : (
                    <div
                        ref={bodyRef}
                        className={cn("lsdocx-host origin-top transition-transform duration-150")}
                        style={{ transform: `scale(${scale})` }}
                    />
                )}
            </div>
        </div>
    );
}

/** Horizontal room the fitted pages leave on each side (px-4). */
const FIT_GUTTER_PX = 16;

/**
 * The rendered pages' own size and the scale that fits them across the
 * scrolling pane, kept current as the pane resizes or a render lands.
 */
function useFittedPages(
    enabled: boolean,
    scrollRef: RefObject<HTMLDivElement | null>,
    bodyRef: RefObject<HTMLDivElement | null>
): { width: number; height: number; scale: number } {
    const [size, setSize] = useState({ width: 0, height: 0, room: 0 });

    useLayoutEffect(() => {
        const pane = scrollRef.current;
        const body = bodyRef.current;
        if (!enabled || !pane || !body) return;
        const measure = () =>
            setSize({
                // offset* ignore the transform: these are the pages at 100%.
                width: body.offsetWidth,
                height: body.offsetHeight,
                room: pane.clientWidth - FIT_GUTTER_PX * 2,
            });
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(pane);
        observer.observe(body);
        return () => observer.disconnect();
    }, [enabled, scrollRef, bodyRef]);

    const scale = size.width > 0 && size.room > 0 ? Math.min(1, size.room / size.width) : 1;
    return { width: size.width, height: size.height, scale };
}
