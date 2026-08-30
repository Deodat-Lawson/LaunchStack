"use client";

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
    citationNeedles,
    findTextRange,
    type ViewerHighlight,
} from "~/lib/find-text-range";

/**
 * react-pdf ships `pdfjs-dist` as a transitive dep but expects the host app to
 * configure the worker.
 *
 * Served from public/, copied there at build time by
 * scripts/copy-pdf-worker.mjs from the exact pdfjs-dist that react-pdf
 * resolves — so bumping react-pdf moves the worker in lockstep, same guarantee
 * the old `pdfjs.version` interpolation gave.
 *
 * Local rather than a CDN because the default has to work on an air-gapped
 * instance. NEXT_PUBLIC_PDF_WORKER_URL still overrides it, but note that being
 * a NEXT_PUBLIC_ value it is baked in at build time — it is an option when you
 * build your own image, not something a prebuilt image can be pointed at.
 */
const WORKER_URL =
    process.env.NEXT_PUBLIC_PDF_WORKER_URL ?? "/pdf.worker.min.mjs";

if (typeof window !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerSrc = WORKER_URL;
}

export type PdfQuad = [number, number, number, number];
export interface PdfAnchorCapture {
    page: number;
    quads: PdfQuad[];
    quote: { exact: string; prefix?: string; suffix?: string };
}

export interface PdfNoteLite {
    id: number;
    title: string | null;
    page?: number | null;
    /** Normalized quads in [0, 1] space matching `PdfAnchorCapture.quads`. */
    quads: PdfQuad[];
    quote?: string;
    anchorStatus?: "resolved" | "drifted" | "orphaned" | null;
}

interface Props {
    url: string;
    /**
     * Notes that already exist for the document. Renders a numbered pin +
     * highlight overlay on the appropriate page for each. Notes with no
     * `page` / empty quads are skipped (shown only in the sidebar list).
     */
    notes: PdfNoteLite[];
    /**
     * When the parent wants the viewer to scroll to a given note (e.g. the
     * user clicked a note card in the sidebar), set this. Setting the same
     * id twice in a row still triggers a scroll — use a {noteId, nonce}
     * object from the parent if re-triggering the same jump is desired.
     */
    scrollToNoteId?: number | null;
    /**
     * Fires when the user highlights text and clicks the floating
     * "Add note here" button. Parent is expected to open the note editor
     * with the anchor pre-filled.
     */
    onCreateAnchoredNote: (anchor: PdfAnchorCapture) => void;
    /**
     * When set, the selection popup also shows three AI-capture buttons.
     * `intent` selects the prompt the server uses. Parent should call
     * `/api/notes/ai-capture` with the selection + the requested intent.
     */
    onAiCapture?: (
      anchor: PdfAnchorCapture,
      intent: "summary" | "action" | "decision",
    ) => void;
    /** Optional click handler for existing pins. */
    onNotePinClick?: (noteId: number) => void;
    /**
     * A cited passage to locate in the text layer, scroll to, and highlight.
     * The page hint narrows the search; without one every page is scanned.
     * Located once per `nonce` — a repeat click re-runs the jump.
     */
    citationHighlight?: ViewerHighlight | null;
}

interface SelectionDraft {
    page: number;
    quads: PdfQuad[];
    quote: string;
    /** Where to anchor the floating action button, in page-container coords. */
    buttonX: number;
    buttonY: number;
}

interface PageGeometry {
    /** Display width in CSS pixels (what we render at). */
    width: number;
    height: number;
}

export function PdfViewerWithNotes({
    url,
    notes,
    scrollToNoteId,
    onCreateAnchoredNote,
    onAiCapture,
    onNotePinClick,
    citationHighlight,
}: Props) {
    const [numPages, setNumPages] = useState<number | null>(null);
    const [pageGeometry, setPageGeometry] = useState<Map<number, PageGeometry>>(
        () => new Map(),
    );
    const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(
        null,
    );
    const [loadError, setLoadError] = useState<string | null>(null);
    /** Quads for the located citation passage, rendered as a distinct overlay. */
    const [citeOverlay, setCiteOverlay] = useState<{
        page: number;
        quads: PdfQuad[];
    } | null>(null);
    /** Bumped whenever a page's text layer finishes rendering — retriggers the locate effect. */
    const [textLayerVersion, setTextLayerVersion] = useState(0);
    const locatedNonce = useRef<number | null>(null);
    const scrolledNonce = useRef<number | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);
    const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

    // Memoize the `file` option so react-pdf doesn't reload on every render.
    const file = useMemo(() => ({ url }), [url]);

    const onDocumentLoadSuccess = useCallback(
        ({ numPages: n }: { numPages: number }) => {
            setNumPages(n);
            setLoadError(null);
        },
        [],
    );
    const onDocumentLoadError = useCallback((err: Error) => {
        setLoadError(err.message || "Failed to load PDF");
    }, []);

    const onPageRenderSuccess = useCallback(
        (page: { pageNumber: number; width: number; height: number }) => {
            setPageGeometry((prev) => {
                const next = new Map(prev);
                next.set(page.pageNumber, {
                    width: page.width,
                    height: page.height,
                });
                return next;
            });
        },
        [],
    );

    // Scroll to a pinned note when the parent requests it.
    useEffect(() => {
        if (!scrollToNoteId) return;
        const n = notes.find((x) => x.id === scrollToNoteId);
        if (!n?.page) return;
        const el = pageRefs.current.get(n.page);
        if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }, [scrollToNoteId, notes]);

    // Locate a cited passage. Text layers render asynchronously page by page,
    // so this effect re-runs on every textLayerVersion bump until the passage
    // is found (or the citation changes). The page hint is searched first and
    // scrolled to immediately so the user sees movement while layers render.
    useEffect(() => {
        if (!citationHighlight) {
            setCiteOverlay(null);
            locatedNonce.current = null;
            scrolledNonce.current = null;
            return;
        }
        if (locatedNonce.current === citationHighlight.nonce) return;

        // Provisional scroll to the hinted page, once per citation.
        const hintedPage = citationHighlight.page ?? null;
        if (hintedPage && scrolledNonce.current !== citationHighlight.nonce) {
            const el = pageRefs.current.get(hintedPage);
            if (el) {
                el.scrollIntoView({ block: "start" });
                scrolledNonce.current = citationHighlight.nonce;
            }
        }

        const needles = citationNeedles(
            citationHighlight.text,
            citationHighlight.matchText,
        );
        const candidatePages: number[] = hintedPage
            ? [
                  hintedPage,
                  ...Array.from(pageRefs.current.keys()).filter(
                      (p) => p !== hintedPage,
                  ),
              ]
            : Array.from(pageRefs.current.keys()).sort((a, b) => a - b);

        for (const pageNumber of candidatePages) {
            const pageEl = pageRefs.current.get(pageNumber);
            const geom = pageGeometry.get(pageNumber);
            if (!pageEl || !geom) continue;
            const textLayer = pageEl.querySelector(
                ".react-pdf__Page__textContent",
            );
            if (!textLayer) continue;

            const range = findTextRange(textLayer, needles);
            if (!range) continue;

            const pageRect = pageEl.getBoundingClientRect();
            const rects = Array.from(range.getClientRects()).filter(
                (r) => r.width > 0 && r.height > 0,
            );
            if (rects.length === 0) continue;

            const quads: PdfQuad[] = rects.map((r) => [
                (r.left - pageRect.left) / geom.width,
                (r.top - pageRect.top) / geom.height,
                (r.right - pageRect.left) / geom.width,
                (r.bottom - pageRect.top) / geom.height,
            ]);

            locatedNonce.current = citationHighlight.nonce;
            setCiteOverlay({ page: pageNumber, quads });

            // Jump the first highlight rect into the upper third. Instant,
            // not smooth — the passage can be many pages away.
            const container = containerRef.current;
            const firstQuad = quads[0];
            if (container && firstQuad) {
                container.scrollTo({
                    top:
                        pageEl.offsetTop +
                        firstQuad[1] * geom.height -
                        container.clientHeight / 3,
                });
            }
            return;
        }
    }, [citationHighlight, pageGeometry, textLayerVersion]);

    // Capture text selections as anchor candidates. A selection is valid when
    // it falls entirely within one rendered page and has at least one rect
    // with non-zero area.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handler = () => {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
                setSelectionDraft(null);
                return;
            }
            const text = sel.toString().trim();
            if (text.length < 3) {
                // Too short to make a useful anchor — skip without clearing an
                // existing draft, so single clicks don't kill the button.
                return;
            }

            const range = sel.getRangeAt(0);
            const pageEntry = findContainingPage(range, pageRefs.current);
            if (!pageEntry) {
                setSelectionDraft(null);
                return;
            }
            const { pageNumber, pageEl } = pageEntry;

            const geom = pageGeometry.get(pageNumber);
            if (!geom) return;
            const pageRect = pageEl.getBoundingClientRect();

            const rects = Array.from(range.getClientRects()).filter(
                (r) => r.width > 0 && r.height > 0,
            );
            if (rects.length === 0) {
                setSelectionDraft(null);
                return;
            }

            const quads: PdfQuad[] = rects.map((r) => [
                (r.left - pageRect.left) / geom.width,
                (r.top - pageRect.top) / geom.height,
                (r.right - pageRect.left) / geom.width,
                (r.bottom - pageRect.top) / geom.height,
            ]);

            // Anchor the floating action button just below the last selection
            // rect, in page-container (the scrollable wrapper) coordinates.
            const containerRect = container.getBoundingClientRect();
            const lastRect = rects[rects.length - 1]!;
            const buttonX = lastRect.right - containerRect.left + container.scrollLeft;
            const buttonY = lastRect.bottom - containerRect.top + container.scrollTop + 6;

            setSelectionDraft({
                page: pageNumber,
                quads,
                quote: text,
                buttonX,
                buttonY,
            });
        };

        document.addEventListener("selectionchange", handler);
        return () => document.removeEventListener("selectionchange", handler);
    }, [pageGeometry]);

    // Clear the selection draft when the user clicks elsewhere (outside the
    // floating button). Without this, the button lingers after the user's
    // selection collapses programmatically in some browsers.
    useEffect(() => {
        const onPointerDown = (e: PointerEvent) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest("[data-note-anchor-btn]")) return;
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed) {
                setSelectionDraft(null);
            }
        };
        document.addEventListener("pointerdown", onPointerDown);
        return () => document.removeEventListener("pointerdown", onPointerDown);
    }, []);

    const handleCreateFromSelection = () => {
        if (!selectionDraft) return;
        onCreateAnchoredNote({
            page: selectionDraft.page,
            quads: selectionDraft.quads,
            quote: { exact: selectionDraft.quote },
        });
        window.getSelection()?.removeAllRanges();
        setSelectionDraft(null);
    };

    const handleAiCapture = (intent: "summary" | "action" | "decision") => {
        if (!selectionDraft || !onAiCapture) return;
        onAiCapture(
            {
                page: selectionDraft.page,
                quads: selectionDraft.quads,
                quote: { exact: selectionDraft.quote },
            },
            intent,
        );
        window.getSelection()?.removeAllRanges();
        setSelectionDraft(null);
    };

    return (
        <div
            ref={containerRef}
            style={{
                position: "relative",
                flex: 1,
                overflow: "auto",
                background: "var(--bg-2)",
                padding: "20px 0",
            }}
        >
            {loadError ? (
                <div
                    style={{
                        textAlign: "center",
                        color: "var(--ink-3)",
                        padding: 40,
                    }}
                >
                    Couldn&rsquo;t load PDF: {loadError}
                </div>
            ) : (
                <Document
                    file={file}
                    onLoadSuccess={onDocumentLoadSuccess}
                    onLoadError={onDocumentLoadError}
                    loading={<LoadingPlaceholder />}
                    error={<LoadingPlaceholder text="Failed to load" />}
                >
                    {numPages !== null &&
                        Array.from({ length: numPages }, (_, i) => i + 1).map(
                            (pageNum) => (
                                <PdfPage
                                    key={pageNum}
                                    pageNum={pageNum}
                                    pageRef={(el) => {
                                        if (el) pageRefs.current.set(pageNum, el);
                                        else pageRefs.current.delete(pageNum);
                                    }}
                                    onRenderSuccess={onPageRenderSuccess}
                                    onTextLayerReady={() =>
                                        setTextLayerVersion((v) => v + 1)
                                    }
                                    notesOnPage={notes.filter(
                                        (n) => n.page === pageNum && n.quads.length > 0,
                                    )}
                                    highlightedNoteId={scrollToNoteId ?? null}
                                    onNotePinClick={onNotePinClick}
                                    citeQuads={
                                        citeOverlay?.page === pageNum
                                            ? citeOverlay.quads
                                            : null
                                    }
                                />
                            ),
                        )}
                </Document>
            )}

            {selectionDraft && (
                <div
                    data-note-anchor-btn
                    style={{
                        position: "absolute",
                        left: selectionDraft.buttonX,
                        top: selectionDraft.buttonY,
                        transform: "translate(-50%, 0)",
                        display: "flex",
                        gap: 4,
                        padding: 3,
                        borderRadius: 9,
                        background: "var(--panel)",
                        border: "1px solid var(--line)",
                        boxShadow: "0 6px 18px oklch(0 0 0 / 0.18)",
                        zIndex: 20,
                    }}
                >
                    <button
                        type="button"
                        onClick={handleCreateFromSelection}
                        style={{
                            padding: "5px 10px",
                            borderRadius: 6,
                            background: "var(--accent)",
                            color: "white",
                            fontSize: 12,
                            fontWeight: 600,
                            border: "none",
                            cursor: "pointer",
                        }}
                    >
                        + Note
                    </button>
                    {onAiCapture && (
                        <>
                            <button
                                type="button"
                                onClick={() => handleAiCapture("summary")}
                                title="Summarize as note"
                                style={aiBtnStyle}
                            >
                                ✦ Summarize
                            </button>
                            <button
                                type="button"
                                onClick={() => handleAiCapture("action")}
                                title="Extract action item"
                                style={aiBtnStyle}
                            >
                                ✦ Action
                            </button>
                            <button
                                type="button"
                                onClick={() => handleAiCapture("decision")}
                                title="Extract decision"
                                style={aiBtnStyle}
                            >
                                ✦ Decision
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

const aiBtnStyle: React.CSSProperties = {
    padding: "5px 8px",
    borderRadius: 6,
    background: "var(--panel-2)",
    color: "var(--ink-2)",
    fontSize: 11,
    fontWeight: 600,
    border: "1px solid var(--line-2)",
    cursor: "pointer",
};

function LoadingPlaceholder({ text = "Loading PDF…" }: { text?: string }) {
    return (
        <div
            style={{
                padding: 40,
                textAlign: "center",
                color: "var(--ink-3)",
                fontSize: 13,
            }}
        >
            {text}
        </div>
    );
}

interface PdfPageProps {
    pageNum: number;
    pageRef: (el: HTMLDivElement | null) => void;
    onRenderSuccess: (page: {
        pageNumber: number;
        width: number;
        height: number;
    }) => void;
    notesOnPage: PdfNoteLite[];
    highlightedNoteId: number | null;
    onNotePinClick?: (noteId: number) => void;
    /** Fires when this page's text layer has rendered and is searchable. */
    onTextLayerReady: () => void;
    /** Located citation quads to paint on this page, if any. */
    citeQuads: PdfQuad[] | null;
}

function PdfPage({
    pageNum,
    pageRef,
    onRenderSuccess,
    notesOnPage,
    highlightedNoteId,
    onNotePinClick,
    onTextLayerReady,
    citeQuads,
}: PdfPageProps) {
    const [size, setSize] = useState<{ w: number; h: number } | null>(null);

    return (
        <div
            ref={pageRef}
            data-pdf-page={pageNum}
            style={{
                position: "relative",
                margin: "0 auto 16px",
                width: "fit-content",
                boxShadow:
                    "0 4px 18px oklch(0 0 0 / 0.08), 0 1px 3px oklch(0 0 0 / 0.06)",
                background: "#fff",
                borderRadius: 4,
            }}
        >
            <Page
                pageNumber={pageNum}
                renderTextLayer
                renderAnnotationLayer={false}
                onRenderSuccess={(page) => {
                    setSize({ w: page.width, h: page.height });
                    onRenderSuccess({
                        pageNumber: pageNum,
                        width: page.width,
                        height: page.height,
                    });
                }}
                onRenderTextLayerSuccess={onTextLayerReady}
            />
            {size &&
                notesOnPage.map((note, idx) => (
                    <NoteOverlay
                        key={note.id}
                        note={note}
                        ordinal={idx + 1}
                        pageW={size.w}
                        pageH={size.h}
                        highlighted={note.id === highlightedNoteId}
                        onClick={() => onNotePinClick?.(note.id)}
                    />
                ))}
            {size &&
                citeQuads?.map((q, i) => {
                    const [x1, y1, x2, y2] = q;
                    return (
                        <div
                            key={`cite-${i}`}
                            style={{
                                position: "absolute",
                                left: x1 * size.w,
                                top: y1 * size.h,
                                width: (x2 - x1) * size.w,
                                height: (y2 - y1) * size.h,
                                background: "oklch(0.85 0.16 95 / 0.4)",
                                outline: "1.5px solid oklch(0.7 0.15 95)",
                                borderRadius: 2,
                                pointerEvents: "none",
                                mixBlendMode: "multiply",
                            }}
                        />
                    );
                })}
        </div>
    );
}

function NoteOverlay({
    note,
    ordinal,
    pageW,
    pageH,
    highlighted,
    onClick,
}: {
    note: PdfNoteLite;
    ordinal: number;
    pageW: number;
    pageH: number;
    highlighted: boolean;
    onClick: () => void;
}) {
    // First quad's top-left is where the pin goes.
    const firstQuad = note.quads[0];
    if (!firstQuad) return null;
    const [x1, y1] = firstQuad;
    const pinLeft = x1 * pageW;
    const pinTop = y1 * pageH;

    const status = note.anchorStatus ?? "resolved";
    const fillColor =
        status === "orphaned"
            ? "oklch(0.6 0.18 25 / 0.18)"
            : status === "drifted"
              ? "oklch(0.7 0.18 70 / 0.22)"
              : "oklch(0.72 0.19 285 / 0.18)";
    const borderColor =
        status === "orphaned"
            ? "oklch(0.5 0.2 25)"
            : status === "drifted"
              ? "oklch(0.5 0.18 70)"
              : "var(--accent)";

    return (
        <>
            {note.quads.map((q, i) => {
                const [qx1, qy1, qx2, qy2] = q;
                return (
                    <div
                        key={i}
                        style={{
                            position: "absolute",
                            left: qx1 * pageW,
                            top: qy1 * pageH,
                            width: (qx2 - qx1) * pageW,
                            height: (qy2 - qy1) * pageH,
                            background: fillColor,
                            border: highlighted
                                ? `1.5px solid ${borderColor}`
                                : "none",
                            borderRadius: 2,
                            pointerEvents: "none",
                            mixBlendMode: "multiply",
                            transition: "background .2s, border .2s",
                        }}
                    />
                );
            })}
            <button
                type="button"
                onClick={onClick}
                title={note.title ?? `Note ${ordinal}`}
                style={{
                    position: "absolute",
                    left: pinLeft - 12,
                    top: pinTop - 12,
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: borderColor,
                    color: "white",
                    fontSize: 11,
                    fontWeight: 700,
                    border: highlighted ? "2px solid white" : "none",
                    boxShadow: highlighted
                        ? `0 0 0 2px ${borderColor}, 0 4px 12px oklch(0 0 0 / 0.25)`
                        : "0 2px 6px oklch(0 0 0 / 0.18)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    zIndex: 10,
                    padding: 0,
                }}
            >
                {ordinal}
            </button>
        </>
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findContainingPage(
    range: Range,
    pageRefs: Map<number, HTMLDivElement>,
): { pageNumber: number; pageEl: HTMLDivElement } | null {
    const container =
        range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
            ? (range.commonAncestorContainer as HTMLElement)
            : range.commonAncestorContainer.parentElement;
    if (!container) return null;

    for (const [pageNumber, pageEl] of pageRefs) {
        if (pageEl.contains(container)) {
            return { pageNumber, pageEl };
        }
    }
    return null;
}
