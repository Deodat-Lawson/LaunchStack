"use client";

import {
    memo,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslations } from "next-intl";
import { Document, Page, pdfjs } from "react-pdf";
import {
    ChevronDown,
    ChevronUp,
    Download,
    Minus,
    MoveHorizontal,
    PanelLeft,
    Plus,
    Search,
    Trash2,
    X,
} from "lucide-react";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "~/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import {
    citationNeedles,
    countTextMatches,
    findAllTextRanges,
    findTextRange,
    textContainsNeedle,
    type ViewerHighlight,
} from "~/lib/find-text-range";
import { cn } from "~/lib/utils";
import { HIGHLIGHT_COLORS, HIGHLIGHT_FILL, type HighlightColor } from "./_shared/highlight";
import {
    loadPdfOutline,
    pageFromLabel,
    pageLabelFor,
    type PdfOutlineNode,
} from "./_shared/pdfOutline";
import { createSelectionCommitter } from "./_shared/selectionGesture";
import { PdfContentsPanel, type PdfContentsTab } from "./PdfContentsPanel";

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
const WORKER_URL = process.env.NEXT_PUBLIC_PDF_WORKER_URL ?? "/pdf.worker.min.mjs";

if (typeof window !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerSrc = WORKER_URL;
}

export type PdfQuad = [number, number, number, number];
export interface PdfAnchorCapture {
    page: number;
    quads: PdfQuad[];
    quote: { exact: string; prefix?: string; suffix?: string };
}

/** A selection to mark, and the colour to mark it in. */
export interface PdfHighlightCapture extends PdfAnchorCapture {
    color: HighlightColor;
}

export interface PdfNoteLite {
    id: number;
    title: string | null;
    page?: number | null;
    /**
     * Normalized quads in [0, 1] space matching `PdfAnchorCapture.quads`.
     * Empty when a new version moved the note: rehydration keeps the quote
     * and a page but cannot know the layout, so the viewer finds the quote.
     */
    quads: PdfQuad[];
    quote?: string;
    anchorStatus?: "resolved" | "drifted" | "orphaned" | null;
    /** Set when the note is a highlight: drawn in this colour, with no pin. */
    highlight?: HighlightColor | null;
}

interface Props {
    url: string;
    /**
     * Notes that already exist for the document. Renders a numbered pin +
     * highlight overlay on the appropriate page for each, or just the colour
     * for a highlight. Notes with no page are skipped (shown only in the
     * sidebar list).
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
     * When set, the selection popup offers a highlighter in each colour: the
     * passage is marked and kept, with nothing to write.
     */
    onCreateHighlight?: (highlight: PdfHighlightCapture) => void;
    /** Clicking a highlight offers its colours; this changes it. */
    onRecolorHighlight?: (noteId: number, color: HighlightColor) => void;
    /** …and Remove. */
    onRemoveHighlight?: (noteId: number) => void;
    /**
     * When set, the selection popup offers "Ask AI": the passage and the page
     * it sits on go to the chat, with the document kept in view beside it.
     *
     * This replaced three buttons — Summarize, Action, Decision — that each
     * wrote an AI-generated note. They answered a question the reader had not
     * asked, in a fixed shape, and filed the answer as a note; asking lets the
     * reader say what they actually want to know about the passage.
     */
    onAskAi?: (selection: { text: string; page: number }) => void;
    /** Optional click handler for existing pins. */
    onNotePinClick?: (noteId: number) => void;
    /**
     * The selection the viewer would anchor a note to, refreshed when a
     * selection gesture ends and cleared when it collapses. Lets a parent
     * offer the same anchor from its own controls — a context menu, say.
     */
    onSelectionDraft?: (draft: PdfAnchorCapture | null) => void;
    /**
     * A cited passage to locate in the text layer, scroll to, and highlight.
     * The page hint narrows the search; without one every page is scanned.
     * Located once per `nonce` — a repeat click re-runs the jump.
     */
    citationHighlight?: ViewerHighlight | null;
    /** The file to offer from the toolbar's Download, and the name to save it under. */
    downloadUrl?: string;
    downloadName?: string;
    /**
     * Where the reader was — page, zoom, whether the contents panel was
     * open — is kept per key in this browser, so a long document opens
     * where it was left. One key per document version; none forgets.
     */
    persistKey?: string;
}

/** The floating button row's widest form: + Note, the four highlighters, Ask AI. */
const POPUP_WIDTH_PX = 330;

/**
 * How big the pages are drawn. `auto` fills the column's width but never
 * blows a page up past `MAX_AUTO_SCALE` — the default, and what pdf.js calls
 * automatic. `fit` fills the column's width whatever that takes; `page`
 * shows a whole page at once. A number is a scale the reader chose, 1 being
 * the page's natural size.
 */
type Zoom = "auto" | "fit" | "page" | number;

const MIN_SCALE = 0.2;
const MAX_SCALE = 4;
/** "Automatic" never enlarges a page past this. */
const MAX_AUTO_SCALE = 1.25;
/** Where + and − step to, from wherever the scale is now. */
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
/** The scales the zoom menu names. */
const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
/** Find stops counting after this many matches; the count says "1000+". */
const MAX_FIND_HITS = 1000;
/** Below this viewer width the toolbar drops its secondary buttons. */
const COMPACT_TOOLBAR_PX = 440;
/** Below this viewer width the contents panel floats over the pages instead of beside them. */
const CONTENTS_OVERLAY_BELOW_PX = 700;
/** The contents panel's width when it sits beside the pages. */
const CONTENTS_WIDTH_PX = 208;
/** Space kept either side of a page when it is fitted to a narrow column. */
const PAGE_GUTTER_PX = 16;
/** Space above the first page and below each one (py-5 / mb-4). */
const PAGE_GAP_PX = 16;
/**
 * How far past the visible area pages are drawn, in viewport heights: one
 * behind, one and a half ahead. Everything else is a sized blank, so a
 * 300-page book holds a handful of canvases rather than three hundred.
 */
const DRAW_BEHIND = 1;
const DRAW_AHEAD = 1.5;
/** Letter, as the size of a page not measured yet. */
const DEFAULT_PAGE_SIZE: PageSize = { width: 612, height: 792 };

interface PageSize {
    width: number;
    height: number;
}

/** What the viewer asks of pdf.js's document — narrow enough to fake in a test. */
interface PdfDocumentLike {
    numPages: number;
    getPage: (pageNumber: number) => Promise<PdfPageLike>;
    getPageLabels?: () => Promise<string[] | null>;
}
interface PdfPageLike {
    getViewport: (options: { scale: number }) => { width: number; height: number };
    getTextContent?: () => Promise<{
        items: Array<{ str?: string; hasEOL?: boolean; type?: string }>;
    }>;
}

/** What is remembered per document between visits. */
interface SavedView {
    page?: number;
    zoom?: Zoom;
    contents?: boolean;
    tab?: PdfContentsTab;
}

interface SelectionDraft {
    page: number;
    quads: PdfQuad[];
    quote: string;
    /** Where to anchor the floating action button, in page-container coords. */
    buttonX: number;
    buttonY: number;
}

/** The colour menu opened by clicking a highlight, in page-container coords. */
interface HighlightMenu {
    noteId: number;
    x: number;
    y: number;
}

/** A note where it is drawn: its own quads, or where its quote was found. */
interface PlacedNote {
    note: PdfNoteLite;
    quads: PdfQuad[];
    /** The pin's number; null for a highlight, which has no pin. */
    ordinal: number | null;
}

/** One of Find's matches: the n-th occurrence of the query on a page. */
interface FindHit {
    page: number;
    index: number;
}
/** Find's matches, and the query they are the matches of. */
interface FindResult {
    query: string;
    hits: FindHit[];
    /** False while some pages' text has not arrived yet. */
    complete: boolean;
}
/** Where the query's matches sit on the drawn pages, by page, in reading order. */
interface FindRanges {
    query: string;
    byPage: Map<number, PdfQuad[][]>;
}
const EMPTY_HITS: FindHit[] = [];
const EMPTY_RANGES = new Map<number, PdfQuad[][]>();

/** A point on a page held still while the scale changes around it. */
interface ZoomAnchor {
    page: number;
    fracX: number;
    fracY: number;
    /** Where that point sat in the visible area, in pixels. */
    viewX: number;
    viewY: number;
    at: number;
}

function clampScale(scale: number): number {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function isZoom(value: unknown): value is Zoom {
    return (
        value === "auto" ||
        value === "fit" ||
        value === "page" ||
        (typeof value === "number" && Number.isFinite(value))
    );
}

function readSavedView(key: string | null): SavedView | null {
    if (!key || typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? (parsed as SavedView) : null;
    } catch {
        return null;
    }
}

function writeSavedView(key: string | null, view: SavedView): void {
    if (!key || typeof window === "undefined") return;
    try {
        window.localStorage.setItem(key, JSON.stringify(view));
    } catch {
        // Storage can be full or blocked; the view is a convenience.
    }
}

/**
 * pdf.js page labels, when the document really has its own numbering. A
 * document with none, or with labels that just repeat the page numbers,
 * reports null so the box shows plain numbers.
 */
function usefulLabels(labels: string[] | null | undefined, numPages: number): string[] | null {
    if (!labels || labels.length !== numPages) return null;
    return labels.some((label, i) => label !== String(i + 1)) ? labels : null;
}

/** A page's extracted text as one string; whitespace only has to exist, not match. */
function textOfContent(content: { items: Array<{ str?: string; hasEOL?: boolean }> }): string {
    let out = "";
    for (const item of content.items) {
        if (item.str) out += item.str;
        out += item.hasEOL ? "\n" : " ";
    }
    return out;
}

/** `range`'s boxes as fractions of `pageRect`, which is what every overlay stores. */
function quadsOfRange(range: Range, pageRect: DOMRect): PdfQuad[] {
    if (pageRect.width <= 0 || pageRect.height <= 0) return [];
    return Array.from(range.getClientRects())
        .filter(r => r.width > 0 && r.height > 0)
        .map(r => [
            (r.left - pageRect.left) / pageRect.width,
            (r.top - pageRect.top) / pageRect.height,
            (r.right - pageRect.left) / pageRect.width,
            (r.bottom - pageRect.top) / pageRect.height,
        ]);
}

function textLayerOf(pageEl: HTMLElement): Element | null {
    return pageEl.querySelector(".react-pdf__Page__textContent");
}

/** The pages in order, as [number, element]. */
function orderedPages(pageRefs: Map<number, HTMLDivElement>): Array<[number, HTMLDivElement]> {
    return Array.from(pageRefs.entries()).sort((a, b) => a[0] - b[0]);
}

/** The hinted page first, then every other page in order. */
function pageOrder(numPages: number, hint: number | null | undefined): number[] {
    const order: number[] = [];
    if (hint && hint >= 1 && hint <= numPages) order.push(hint);
    for (let page = 1; page <= numPages; page++) if (page !== hint) order.push(page);
    return order;
}

export function PdfViewerWithNotes({
    url,
    notes,
    scrollToNoteId,
    onCreateAnchoredNote,
    onCreateHighlight,
    onRecolorHighlight,
    onRemoveHighlight,
    onAskAi,
    onNotePinClick,
    onSelectionDraft,
    citationHighlight,
    downloadUrl,
    downloadName,
    persistKey,
}: Props) {
    const t = useTranslations("notes.pdf");
    const [pdfDoc, setPdfDoc] = useState<PdfDocumentLike | null>(null);
    const [numPages, setNumPages] = useState<number | null>(null);
    const [renderedPages, setRenderedPages] = useState<Set<number>>(() => new Set());
    const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
    const [highlightMenu, setHighlightMenu] = useState<HighlightMenu | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    /** Quads for the located citation passage, rendered as a distinct overlay. */
    const [citeOverlay, setCiteOverlay] = useState<{
        page: number;
        quads: PdfQuad[];
    } | null>(null);
    /** Bumped whenever a page's text layer finishes rendering — retriggers the locate effects. */
    const [textLayerVersion, setTextLayerVersion] = useState(0);
    const locatedNonce = useRef<number | null>(null);
    const pagedNonce = useRef<number | null>(null);
    /** The page the extracted text says holds the citation; null once searched and not found. */
    const [citeTarget, setCiteTarget] = useState<{ nonce: number; page: number | null } | null>(
        null
    );

    const rootRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
    const pdfDocRef = useRef<PdfDocumentLike | null>(null);

    const storageKey = persistKey ? `pdf-view:${persistKey}` : null;
    const saved = useMemo(() => readSavedView(storageKey), [storageKey]);

    // Memoize the `file` option so react-pdf doesn't reload on every render.
    const file = useMemo(() => ({ url }), [url]);

    // Everything a page receives is stable across the viewer's own renders,
    // so a change to the selection draft repaints the floating button and
    // nothing else — `PdfPage` is memoised on exactly these props.
    const pageRefCallbacks = useRef<Map<number, (el: HTMLDivElement | null) => void>>(new Map());
    const pageRefFor = useCallback((pageNum: number) => {
        let cb = pageRefCallbacks.current.get(pageNum);
        if (!cb) {
            cb = el => {
                if (el) pageRefs.current.set(pageNum, el);
                else pageRefs.current.delete(pageNum);
            };
            pageRefCallbacks.current.set(pageNum, cb);
        }
        return cb;
    }, []);
    const onTextLayerReady = useCallback(() => setTextLayerVersion(v => v + 1), []);

    // ---------------------------------------------------------------------
    // The document's text, page by page
    // ---------------------------------------------------------------------

    /**
     * Each page's extracted text, fetched from pdf.js once and kept. Find,
     * citation jumps and moved notes all search this to learn *which* page
     * holds a passage, because only the pages in view are drawn and have a
     * text layer to search. Where on the page comes from the text layer once
     * the page is drawn.
     */
    const textCache = useRef<Map<number, string>>(new Map());
    const textPending = useRef<Map<number, Promise<string>>>(new Map());
    /** Bumped per loaded document: text that arrives for an earlier one is dropped. */
    const textGeneration = useRef(0);
    /** Bumped, at most a few times a second, as pages' text arrives. */
    const [textVersion, setTextVersion] = useState(0);
    const textVersionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const bumpTextVersion = useCallback(() => {
        if (textVersionTimer.current) return;
        textVersionTimer.current = setTimeout(() => {
            textVersionTimer.current = null;
            setTextVersion(v => v + 1);
        }, 80);
    }, []);
    useEffect(
        () => () => {
            if (textVersionTimer.current) clearTimeout(textVersionTimer.current);
        },
        []
    );

    const pageText = useCallback(
        (page: number): Promise<string> => {
            const cached = textCache.current.get(page);
            if (cached !== undefined) return Promise.resolve(cached);
            const pending = textPending.current.get(page);
            if (pending) return pending;
            const doc = pdfDocRef.current;
            if (!doc) return Promise.resolve("");
            const generation = textGeneration.current;
            const task = doc
                .getPage(page)
                .then(p => (p.getTextContent ? p.getTextContent() : { items: [] }))
                .then(textOfContent, () => "")
                .then(text => {
                    // Another document has loaded meanwhile: this is its
                    // predecessor's page, not the new document's.
                    if (textGeneration.current !== generation) return text;
                    textCache.current.set(page, text);
                    textPending.current.delete(page);
                    bumpTextVersion();
                    return text;
                });
            textPending.current.set(page, task);
            return task;
        },
        [bumpTextVersion]
    );

    // Warm the text cache in the background, a page at a time and after the
    // first pages have drawn, so Find answers at once on a book.
    useEffect(() => {
        if (!pdfDoc || !numPages) return;
        let cancelled = false;
        const run = async () => {
            await new Promise(resolve => setTimeout(resolve, 800));
            for (let page = 1; page <= numPages && !cancelled; page++) {
                if (textCache.current.has(page)) continue;
                await pageText(page);
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        };
        void run();
        return () => {
            cancelled = true;
        };
    }, [pdfDoc, numPages, pageText]);

    // ---------------------------------------------------------------------
    // Notes a new version moved: find their quote again
    // ---------------------------------------------------------------------

    /**
     * Anchor rehydration keeps a moved note's quote but drops its quads (it
     * runs on the server and cannot see the layout), and its page is only a
     * hint. The page is found in the extracted text — hinted page first,
     * then everywhere — and the quads from the text layer once that page is
     * drawn. 0 marks a note searched for and not found, so it is not
     * searched for again.
     */
    const [notePages, setNotePages] = useState<Map<number, number>>(() => new Map());
    const [relocated, setRelocated] = useState<Map<number, { page: number; quads: PdfQuad[] }>>(
        () => new Map()
    );
    const needsPage = (n: PdfNoteLite) =>
        n.quads.length === 0 && Boolean(n.quote && n.quote.trim().length > 0);
    useEffect(() => {
        if (!numPages) return;
        const missing = notes.filter(n => needsPage(n) && !notePages.has(n.id));
        if (missing.length === 0) return;
        let cancelled = false;
        const run = async () => {
            const found = new Map(notePages);
            for (const note of missing) {
                const quote = note.quote!;
                const needles = [quote.toLowerCase(), ...citationNeedles(quote)];
                let page = 0;
                for (const candidate of pageOrder(numPages, note.page)) {
                    const text = await pageText(candidate);
                    if (cancelled) return;
                    if (textContainsNeedle(text, needles)) {
                        page = candidate;
                        break;
                    }
                }
                found.set(note.id, page);
            }
            if (!cancelled) setNotePages(found);
        };
        void run();
        return () => {
            cancelled = true;
        };
    }, [notes, numPages, notePages, pageText]);

    useEffect(() => {
        const pending = notes.filter(
            n => needsPage(n) && !relocated.has(n.id) && (notePages.get(n.id) ?? 0) > 0
        );
        if (pending.length === 0) return;
        const timer = setTimeout(() => {
            const found = new Map(relocated);
            for (const note of pending) {
                const page = notePages.get(note.id)!;
                const pageEl = pageRefs.current.get(page);
                const layer = pageEl ? textLayerOf(pageEl) : null;
                if (!pageEl || !layer) continue;
                const quote = note.quote!;
                const range = findTextRange(layer, [
                    quote.toLowerCase(),
                    ...citationNeedles(quote),
                ]);
                if (!range) continue;
                const quads = quadsOfRange(range, pageEl.getBoundingClientRect());
                if (quads.length > 0) found.set(note.id, { page, quads });
            }
            if (found.size !== relocated.size) setRelocated(found);
        }, 200);
        return () => clearTimeout(timer);
    }, [notes, notePages, relocated, textLayerVersion]);

    const notesByPage = useMemo(() => {
        const map = new Map<number, PlacedNote[]>();
        for (const note of notes) {
            const placed =
                note.quads.length > 0 && note.page
                    ? { page: note.page, quads: note.quads }
                    : relocated.get(note.id);
            if (!placed || placed.quads.length === 0) continue;
            const list = map.get(placed.page) ?? [];
            list.push({ note, quads: placed.quads, ordinal: null });
            map.set(placed.page, list);
        }
        // Pins are numbered per page; highlights carry no number.
        for (const list of map.values()) {
            let ordinal = 0;
            for (const placed of list) {
                if (!placed.note.highlight) placed.ordinal = ++ordinal;
            }
        }
        return map;
    }, [notes, relocated]);
    const EMPTY_NOTES = useMemo<PlacedNote[]>(() => [], []);
    const EMPTY_QUADS = useMemo<PdfQuad[]>(() => [], []);
    const pinClickRef = useRef(onNotePinClick);
    pinClickRef.current = onNotePinClick;
    const handlePinClick = useCallback((noteId: number) => pinClickRef.current?.(noteId), []);

    const onSelectionDraftRef = useRef(onSelectionDraft);
    onSelectionDraftRef.current = onSelectionDraft;
    useEffect(() => {
        onSelectionDraftRef.current?.(
            selectionDraft
                ? {
                      page: selectionDraft.page,
                      quads: selectionDraft.quads,
                      quote: { exact: selectionDraft.quote },
                  }
                : null
        );
    }, [selectionDraft]);

    // ---------------------------------------------------------------------
    // Scale
    // ---------------------------------------------------------------------

    /**
     * The first page's natural size is read before any page draws, so pages
     * come up at their fitted size instead of drawing wide and then
     * shrinking. One scale for the whole document keeps mixed page sizes in
     * proportion; each page's own size, measured in the background, sizes
     * its box.
     */
    const [naturalSize, setNaturalSize] = useState<PageSize | null>(null);
    const [pageSizes, setPageSizes] = useState<Array<PageSize | undefined>>([]);
    const [sizesComplete, setSizesComplete] = useState(false);
    const [viewerWidth, setViewerWidth] = useState<number | null>(null);
    const [availableWidth, setAvailableWidth] = useState<number | null>(null);
    const [availableHeight, setAvailableHeight] = useState<number | null>(null);
    const [zoom, setZoom] = useState<Zoom>(() => (isZoom(saved?.zoom) ? saved.zoom : "auto"));
    const [contentsOpen, setContentsOpen] = useState<boolean>(() => saved?.contents === true);
    const [contentsTab, setContentsTab] = useState<PdfContentsTab>(() =>
        saved?.tab === "outline" ? "outline" : "thumbnails"
    );
    useEffect(() => {
        const root = rootRef.current;
        const container = containerRef.current;
        if (!root || !container || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(entries => {
            for (const entry of entries) {
                const width = Math.floor(entry.contentRect.width);
                if (entry.target === container) {
                    if (width > 0) setAvailableWidth(width);
                    const height = Math.floor(entry.contentRect.height);
                    if (height > 0) setAvailableHeight(height);
                } else if (width > 0) {
                    setViewerWidth(width);
                }
            }
        });
        observer.observe(root);
        observer.observe(container);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!pdfDoc || !numPages) return;
        let cancelled = false;
        setSizesComplete(false);
        const sizes: Array<PageSize | undefined> = new Array<PageSize | undefined>(numPages);
        const run = async () => {
            const batch = 32;
            for (let start = 1; start <= numPages; start += batch) {
                const end = Math.min(numPages, start + batch - 1);
                await Promise.all(
                    Array.from({ length: end - start + 1 }, (_, i) =>
                        pdfDoc.getPage(start + i).then(
                            page => {
                                const viewport = page.getViewport({ scale: 1 });
                                sizes[start + i - 1] = {
                                    width: viewport.width,
                                    height: viewport.height,
                                };
                            },
                            () => undefined
                        )
                    )
                );
                if (cancelled) return;
                setPageSizes([...sizes]);
            }
            if (!cancelled) setSizesComplete(true);
        };
        void run();
        return () => {
            cancelled = true;
        };
    }, [pdfDoc, numPages]);

    const fitWidthScale =
        naturalSize && availableWidth
            ? (availableWidth - PAGE_GUTTER_PX * 2) / naturalSize.width
            : null;
    const fitPageScale =
        naturalSize && fitWidthScale !== null && availableHeight
            ? Math.min(fitWidthScale, (availableHeight - PAGE_GAP_PX * 2) / naturalSize.height)
            : null;
    /*
     * Pages fill the column they are in by default, up to a quarter larger
     * than life — pdf.js's "automatic". Beside the chat that is simply the
     * column's width; on a wide screen a page stops at 125% rather than
     * ballooning. Zooming past the column is the reader's choice, and then
     * sideways scrolling is what they asked for.
     */
    const pageScale =
        // Hundredths, so a resize drag does not re-render every page for
        // every pixel.
        Math.floor(
            clampScale(
                zoom === "auto"
                    ? Math.min(MAX_AUTO_SCALE, fitWidthScale ?? 1)
                    : zoom === "fit"
                      ? (fitWidthScale ?? 1)
                      : zoom === "page"
                        ? (fitPageScale ?? 1)
                        : zoom
            ) * 100
        ) / 100;
    const pageScaleRef = useRef(pageScale);
    pageScaleRef.current = pageScale;

    // ---------------------------------------------------------------------
    // Which pages are drawn
    // ---------------------------------------------------------------------

    /**
     * Only the pages near the visible area carry a canvas and a text layer;
     * the rest are blanks of the right size, so the scrollbar, page offsets
     * and jumps all behave as if every page were there. Read from the DOM
     * rather than computed, so mixed page sizes and the gaps between pages
     * cost nothing to keep right.
     */
    const [drawn, setDrawn] = useState<[number, number]>([1, 1]);
    const updateDrawn = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;
        const top = container.scrollTop - container.clientHeight * DRAW_BEHIND;
        const bottom = container.scrollTop + container.clientHeight * (1 + DRAW_AHEAD);
        let first = 0;
        let last = 0;
        for (const [pageNumber, pageEl] of orderedPages(pageRefs.current)) {
            const pageTop = pageEl.offsetTop;
            if (pageTop + pageEl.offsetHeight < top) continue;
            if (pageTop > bottom) break;
            if (!first) first = pageNumber;
            last = pageNumber;
        }
        if (!first) {
            first = 1;
            last = 1;
        }
        setDrawn(prev => (prev[0] === first && prev[1] === last ? prev : [first, last]));
    }, []);
    useEffect(() => {
        updateDrawn();
    }, [numPages, pageSizes, availableHeight, availableWidth, updateDrawn]);

    /** The point a zoom keeps still, captured just before the scale changes. */
    const zoomAnchor = useRef<ZoomAnchor | null>(null);
    /**
     * The page at the probe line (a third of the way down the view) and how
     * far down it, kept current on every scroll and jump. A change of scale
     * that is not a zoom — the column resized, the contents panel opened,
     * a page's real size arrived — moves every offset in pixels while the
     * scroll position stays put, which would land the reader on another
     * page; this puts the same page back at the same place instead.
     */
    const viewAnchor = useRef<{ page: number; frac: number } | null>(null);
    const noteViewAnchor = useCallback((page: number, scrollTop: number) => {
        const container = containerRef.current;
        const pageEl = pageRefs.current.get(page);
        if (!container || !pageEl) return;
        const probe = scrollTop + container.clientHeight / 3;
        viewAnchor.current = {
            page,
            frac: pageEl.offsetHeight > 0 ? (probe - pageEl.offsetTop) / pageEl.offsetHeight : 0,
        };
    }, []);

    const applyZoom = useCallback((next: Zoom, at?: { x: number; y: number }) => {
        const container = containerRef.current;
        if (container) {
            const box = container.getBoundingClientRect();
            const x = at?.x ?? box.left + container.clientWidth / 2;
            const y = at?.y ?? box.top + container.clientHeight / 3;
            const pages = orderedPages(pageRefs.current);
            // The page under the point, or the last one that starts above it.
            let chosen: [number, HTMLDivElement] | undefined;
            for (const entry of pages) {
                if (entry[1].getBoundingClientRect().top <= y) chosen = entry;
                else break;
            }
            chosen ??= pages[0];
            if (chosen) {
                const rect = chosen[1].getBoundingClientRect();
                zoomAnchor.current = {
                    page: chosen[0],
                    fracX: rect.width > 0 ? (x - rect.left) / rect.width : 0,
                    fracY: rect.height > 0 ? (y - rect.top) / rect.height : 0,
                    viewX: x - box.left,
                    viewY: y - box.top,
                    at: Date.now(),
                };
            }
        }
        // Positions captured at the old scale mean nothing at the new one.
        setSelectionDraft(null);
        setHighlightMenu(null);
        setZoom(next);
    }, []);
    const applyZoomRef = useRef(applyZoom);
    applyZoomRef.current = applyZoom;

    // Put the anchored point back where it was. Every page's box is sized
    // from the new scale and sizes in the same render, so the offsets read
    // below are the new ones; then the pages near the restored position are
    // drawn. A zoom keeps the point under the pointer still; any other
    // change keeps the current page where it was.
    //
    // A layout effect, not a passive one: when the pages shrink, the browser
    // clamps the scroll position to the new, shorter range and fires a
    // scroll event for it. Run after paint, this restore could lose that
    // race — the clamped position would be noted as the reader's place and
    // "restored" to the end of the book. Before paint, the restore comes
    // first and the clamp's scroll event sees the restored position.
    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const anchor = zoomAnchor.current;
        zoomAnchor.current = null;
        const zoomedPage = anchor ? pageRefs.current.get(anchor.page) : null;
        if (anchor && zoomedPage && Date.now() - anchor.at <= 1500) {
            container.scrollTop =
                zoomedPage.offsetTop + anchor.fracY * zoomedPage.offsetHeight - anchor.viewY;
            container.scrollLeft =
                zoomedPage.offsetLeft + anchor.fracX * zoomedPage.offsetWidth - anchor.viewX;
            noteViewAnchor(anchor.page, container.scrollTop);
        } else if (viewAnchor.current) {
            const { page, frac } = viewAnchor.current;
            const pageEl = pageRefs.current.get(page);
            if (pageEl) {
                const top = Math.max(
                    0,
                    pageEl.offsetTop + frac * pageEl.offsetHeight - container.clientHeight / 3
                );
                if (Math.abs(container.scrollTop - top) > 1) container.scrollTop = top;
            }
        }
        updateDrawn();
    }, [pageScale, pageSizes, updateDrawn, noteViewAnchor]);

    const zoomIn = useCallback(() => {
        const current = pageScaleRef.current;
        const next = ZOOM_STEPS.find(step => step > current + 0.005);
        if (next !== undefined) applyZoom(next);
    }, [applyZoom]);
    const zoomOut = useCallback(() => {
        const current = pageScaleRef.current;
        const next = [...ZOOM_STEPS].reverse().find(step => step < current - 0.005);
        if (next !== undefined) applyZoom(next);
    }, [applyZoom]);

    // Pinch on a trackpad, or ⌘/Ctrl + scroll wheel. Both arrive as wheel
    // events with ctrlKey set; the browser would zoom the whole app. A burst
    // of events is gathered into one scale change, since each one redraws
    // the pages in view.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        let factor = 1;
        let point = { x: 0, y: 0 };
        let timer: ReturnType<typeof setTimeout> | null = null;
        const onWheel = (event: WheelEvent) => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            const delta = Math.max(-100, Math.min(100, event.deltaY));
            factor *= Math.exp(-delta * 0.0025);
            point = { x: event.clientX, y: event.clientY };
            if (timer) return;
            timer = setTimeout(() => {
                timer = null;
                const next = Math.round(clampScale(pageScaleRef.current * factor) * 100) / 100;
                factor = 1;
                if (next !== pageScaleRef.current) applyZoomRef.current(next, point);
            }, 90);
        };
        container.addEventListener("wheel", onWheel, { passive: false });
        return () => {
            container.removeEventListener("wheel", onWheel);
            if (timer) clearTimeout(timer);
        };
    }, []);

    // ---------------------------------------------------------------------
    // Loading
    // ---------------------------------------------------------------------

    const [pageLabels, setPageLabels] = useState<string[] | null>(null);
    const [outline, setOutline] = useState<PdfOutlineNode[] | null>(null);

    const onDocumentLoadSuccess = useCallback((pdf: PdfDocumentLike) => {
        setLoadError(null);
        pdfDocRef.current = pdf;
        textGeneration.current += 1;
        textCache.current.clear();
        textPending.current.clear();
        setNotePages(new Map());
        setRelocated(new Map());
        setRenderedPages(new Set());
        // A citation still in hand is for this file now: searched afresh,
        // not painted onto the same page number of the new one.
        setCiteTarget(null);
        setCiteOverlay(null);
        pagedNonce.current = null;
        locatedNonce.current = null;
        void pdf
            .getPage(1)
            .then(
                page => {
                    const viewport = page.getViewport({ scale: 1 });
                    setNaturalSize({ width: viewport.width, height: viewport.height });
                },
                () => setNaturalSize(null)
            )
            .finally(() => {
                setPdfDoc(pdf);
                setNumPages(pdf.numPages);
            });
        void Promise.resolve(pdf.getPageLabels ? pdf.getPageLabels() : null).then(
            labels => setPageLabels(usefulLabels(labels, pdf.numPages)),
            () => setPageLabels(null)
        );
        setOutline(null);
        void loadPdfOutline(pdf as unknown as Parameters<typeof loadPdfOutline>[0]).then(
            setOutline,
            () => setOutline([])
        );
    }, []);
    const onDocumentLoadError = useCallback(
        (err: Error) => {
            setLoadError(err.message || t("loadFailedFallback"));
        },
        [t]
    );

    const onPageRenderSuccess = useCallback((pageNumber: number) => {
        setRenderedPages(prev => {
            if (prev.has(pageNumber)) return prev;
            const next = new Set(prev);
            next.add(pageNumber);
            return next;
        });
    }, []);
    const onPageUndrawn = useCallback((pageNumber: number) => {
        setRenderedPages(prev => {
            if (!prev.has(pageNumber)) return prev;
            const next = new Set(prev);
            next.delete(pageNumber);
            return next;
        });
    }, []);

    // ---------------------------------------------------------------------
    // Where the reader is, and getting somewhere
    // ---------------------------------------------------------------------

    const [currentPage, setCurrentPage] = useState(1);
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        let frame = 0;
        const onScroll = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                // The page holding the line a third of the way down.
                const probe = container.scrollTop + container.clientHeight / 3;
                let page = 1;
                for (const [pageNumber, pageEl] of orderedPages(pageRefs.current)) {
                    if (pageEl.offsetTop <= probe) page = pageNumber;
                    else break;
                }
                setCurrentPage(page);
                noteViewAnchor(page, container.scrollTop);
                updateDrawn();
            });
        };
        container.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            container.removeEventListener("scroll", onScroll);
            cancelAnimationFrame(frame);
        };
    }, [updateDrawn, noteViewAnchor]);

    const goToPage = useCallback(
        (page: number) => {
            const container = containerRef.current;
            const pageEl = pageRefs.current.get(page);
            if (!container || !pageEl) return;
            container.scrollTo({ top: pageEl.offsetTop - 12 });
            setCurrentPage(page);
            noteViewAnchor(page, Math.max(0, pageEl.offsetTop - 12));
            updateDrawn();
        },
        [updateDrawn, noteViewAnchor]
    );

    /** Bring a box on a page into view, a third of the way down. */
    const scrollToQuad = useCallback(
        (page: number, quad: PdfQuad | undefined) => {
            const container = containerRef.current;
            const pageEl = pageRefs.current.get(page);
            if (!container || !pageEl) return;
            if (!quad) {
                container.scrollTo({ top: pageEl.offsetTop - 12 });
                noteViewAnchor(page, Math.max(0, pageEl.offsetTop - 12));
                updateDrawn();
                return;
            }
            const left = pageEl.offsetLeft + quad[0] * pageEl.offsetWidth;
            const right = pageEl.offsetLeft + quad[2] * pageEl.offsetWidth;
            // Instant, not smooth — the passage can be many pages away.
            container.scrollTo({
                top: pageEl.offsetTop + quad[1] * pageEl.offsetHeight - container.clientHeight / 3,
                // Sideways only when the box is out of view, as at a high zoom.
                left:
                    left < container.scrollLeft ||
                    right > container.scrollLeft + container.clientWidth
                        ? left - 24
                        : container.scrollLeft,
            });
            viewAnchor.current = { page, frac: quad[1] };
            updateDrawn();
        },
        [updateDrawn, noteViewAnchor]
    );

    // Scroll to a pinned note when the parent requests it.
    useEffect(() => {
        if (!scrollToNoteId) return;
        const note = notes.find(x => x.id === scrollToNoteId);
        if (!note) return;
        const placed =
            note.quads.length > 0 && note.page
                ? { page: note.page, quads: note.quads }
                : relocated.get(note.id);
        if (placed) scrollToQuad(placed.page, placed.quads[0]);
        else {
            // 0 means searched for and not found; the hint is all that is left.
            const found = notePages.get(note.id);
            const page = found && found > 0 ? found : note.page;
            if (page) scrollToQuad(page, undefined);
        }
        // Only a new request scrolls; the note being found later does not.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scrollToNoteId, notes, scrollToQuad]);

    // Pick up where the reader left off, once the pages have their sizes so
    // the offsets are right. A reader who has already scrolled is not
    // interrupted.
    const resumed = useRef(false);
    useEffect(() => {
        resumed.current = false;
    }, [url]);
    // The key can change after mount — the host learns the document's
    // version a moment after it opens — and the state initialisers above ran
    // for the first key only. The view saved under the new key is applied
    // in full here, and the page below, before anything is written to it.
    const appliedKey = useRef(storageKey);
    useEffect(() => {
        if (appliedKey.current === storageKey) return;
        appliedKey.current = storageKey;
        resumed.current = false;
        if (!saved) return;
        if (isZoom(saved.zoom)) setZoom(saved.zoom);
        setContentsOpen(saved.contents === true);
        setContentsTab(saved.tab === "outline" ? "outline" : "thumbnails");
    }, [storageKey, saved]);
    useEffect(() => {
        if (resumed.current || !numPages || !sizesComplete) return;
        resumed.current = true;
        const page = saved?.page;
        const container = containerRef.current;
        if (page && page > 1 && container && container.scrollTop === 0) {
            goToPage(Math.min(numPages, Math.floor(page)));
        }
    }, [numPages, sizesComplete, saved, goToPage]);

    // ---------------------------------------------------------------------
    // Contents: thumbnails and the outline
    // ---------------------------------------------------------------------

    const panelOverlays = viewerWidth !== null && viewerWidth < CONTENTS_OVERLAY_BELOW_PX;
    const panelOverlaysRef = useRef(panelOverlays);
    panelOverlaysRef.current = panelOverlays;
    const panelWidth = panelOverlays
        ? Math.max(160, Math.min(CONTENTS_WIDTH_PX + 40, (viewerWidth ?? 320) - 48))
        : CONTENTS_WIDTH_PX;
    const goFromContents = useCallback(
        (page: number) => {
            goToPage(page);
            // Floating over the pages, the panel hides what it just found.
            if (panelOverlaysRef.current) setContentsOpen(false);
            containerRef.current?.focus({ preventScroll: true });
        },
        [goToPage]
    );

    useEffect(() => {
        if (!storageKey || !resumed.current) return;
        const timer = setTimeout(
            () =>
                writeSavedView(storageKey, {
                    page: currentPage,
                    zoom,
                    contents: contentsOpen,
                    tab: contentsTab,
                }),
            300
        );
        return () => clearTimeout(timer);
    }, [storageKey, currentPage, zoom, contentsOpen, contentsTab]);

    // ---------------------------------------------------------------------
    // Citations: locate a cited passage
    // ---------------------------------------------------------------------

    // Where on the page: searched in the text layer of the page the
    // extracted text points to, once it has, and re-run as layers render
    // until the passage is found. Not on the page the citation names before
    // then: that is a hint (chat citations name page 1 when the index kept
    // no page), and a loose window of the snippet there would move the
    // reader on its word. Never in whatever page happens to be drawn
    // either, for the same reason. Only when no page holds the passage are
    // the drawn pages tried.
    useEffect(() => {
        if (!citationHighlight) {
            setCiteOverlay(null);
            locatedNonce.current = null;
            pagedNonce.current = null;
            return;
        }
        const { nonce } = citationHighlight;
        const target = citeTarget?.nonce === nonce ? citeTarget : null;
        const targetPage = target?.page ?? null;
        // Located already — unless the text has since named another page.
        if (
            locatedNonce.current === nonce &&
            (targetPage === null || citeOverlay?.page === targetPage)
        ) {
            return;
        }

        const needles = citationNeedles(citationHighlight.text, citationHighlight.matchText);
        const candidatePages = target
            ? target.page !== null
                ? [target.page]
                : Array.from(renderedPages).sort((a, b) => a - b)
            : [];
        for (const pageNumber of candidatePages) {
            if (!renderedPages.has(pageNumber)) continue;
            const pageEl = pageRefs.current.get(pageNumber);
            if (!pageEl) continue;
            const textLayer = textLayerOf(pageEl);
            if (!textLayer) continue;

            const range = findTextRange(textLayer, needles);
            if (!range) continue;

            const quads = quadsOfRange(range, pageEl.getBoundingClientRect());
            if (quads.length === 0) continue;

            locatedNonce.current = nonce;
            setCiteOverlay({ page: pageNumber, quads });
            // Jump the first highlight rect into the upper third.
            scrollToQuad(pageNumber, quads[0]);
            return;
        }
    }, [
        citationHighlight,
        citeTarget,
        citeOverlay,
        pdfDoc,
        renderedPages,
        textLayerVersion,
        scrollToQuad,
    ]);

    // Which page: the one whose extracted text holds the passage, searched
    // from the page the citation names, and gone to only once found. The
    // named page is a hint, not a fact — a chat citation names page 1 when
    // the index kept no page — so moving there first took a reader ten
    // pages in back to the start while the text was read, and left them
    // there when no page held the passage. Not found, the reader stays put,
    // unless the named page has no text at all (a scan): then nothing can
    // contradict the hint, and it is all there is to go on.
    // The strongest needle is tried on every page before a weaker one on
    // any, so a loose window of the snippet on an earlier page never beats
    // the whole snippet further on.
    useEffect(() => {
        if (!citationHighlight || !numPages) return;
        if (pagedNonce.current === citationHighlight.nonce) return;
        pagedNonce.current = citationHighlight.nonce;
        const { nonce } = citationHighlight;
        const hintedPage = citationHighlight.page ?? null;
        setCiteTarget(null);
        const needles = citationNeedles(citationHighlight.text, citationHighlight.matchText);
        const order = pageOrder(numPages, hintedPage);
        const run = async () => {
            for (const needle of needles) {
                for (const page of order) {
                    const text = await pageText(page);
                    // A newer citation ends the search.
                    if (pagedNonce.current !== nonce) return;
                    if (textContainsNeedle(text, [needle])) {
                        setCiteTarget({ nonce, page });
                        goToPage(page);
                        return;
                    }
                }
            }
            if (pagedNonce.current !== nonce) return;
            setCiteTarget({ nonce, page: null });
            if (hintedPage && hintedPage <= numPages) {
                const hinted = await pageText(hintedPage);
                if (pagedNonce.current === nonce && hinted.trim() === "") goToPage(hintedPage);
            }
        };
        void run();
    }, [citationHighlight, numPages, pdfDoc, goToPage, pageText]);

    // ---------------------------------------------------------------------
    // Find
    // ---------------------------------------------------------------------

    const [findOpen, setFindOpen] = useState(false);
    const [findQuery, setFindQuery] = useState("");
    /**
     * Results carry the query they answer: the count and the positions are
     * worked out a beat after a keystroke, and until they are, the last
     * query's are not the new one's — scrolling to one of them under the
     * new query's name would record the jump as done and leave the real
     * match unseen.
     */
    const [findResult, setFindResult] = useState<FindResult>(() => ({
        query: "",
        hits: [],
        complete: true,
    }));
    const [findIndex, setFindIndex] = useState(0);
    /** Find's matches on each drawn page, as quads, in reading order. */
    const [findRanges, setFindRanges] = useState<FindRanges>(() => ({
        query: "",
        byPage: new Map(),
    }));
    const findResultRef = useRef(findResult);
    findResultRef.current = findResult;
    const query = findQuery.trim();
    const findHits = findResult.query === query ? findResult.hits : EMPTY_HITS;
    const findComplete = findResult.query === query ? findResult.complete : false;
    const rangesByPage = findRanges.query === query ? findRanges.byPage : EMPTY_RANGES;
    const findInputRef = useRef<HTMLInputElement>(null);
    /** The query and match last scrolled to, so a re-search does not jump. */
    const findScrolledTo = useRef("");

    const openFind = useCallback(() => {
        setFindOpen(true);
        // After the bar mounts.
        requestAnimationFrame(() => {
            findInputRef.current?.focus();
            findInputRef.current?.select();
        });
    }, []);
    const closeFind = useCallback(() => {
        setFindOpen(false);
        setFindResult({ query: "", hits: [], complete: true });
        setFindRanges({ query: "", byPage: new Map() });
        findScrolledTo.current = "";
        containerRef.current?.focus({ preventScroll: true });
    }, []);

    useEffect(() => {
        setFindIndex(0);
    }, [findQuery]);

    // Count the matches on every page from its extracted text — the pages
    // whose text has not arrived yet are asked for, and the count grows as
    // they answer. Counted afresh for a new document, whose text is new.
    useEffect(() => {
        if (!findOpen || query.length < 2 || !numPages || !pdfDoc) {
            setFindResult({ query: "", hits: [], complete: true });
            return;
        }
        const timer = setTimeout(() => {
            const hits: FindHit[] = [];
            let complete = true;
            for (let page = 1; page <= numPages; page++) {
                const text = textCache.current.get(page);
                if (text === undefined) {
                    complete = false;
                    void pageText(page);
                    continue;
                }
                const count = countTextMatches(text, query, MAX_FIND_HITS - hits.length);
                for (let index = 0; index < count; index++) hits.push({ page, index });
                if (hits.length >= MAX_FIND_HITS) break;
            }
            // Pages answer out of order, so a recount can put new matches
            // before the one the reader is on: keep them on that one.
            const previous = findResultRef.current;
            setFindResult({ query, hits, complete });
            setFindIndex(index => {
                const current = previous.query === query ? previous.hits[index] : undefined;
                const kept = current
                    ? hits.findIndex(h => h.page === current.page && h.index === current.index)
                    : -1;
                return kept >= 0 ? kept : Math.min(index, Math.max(0, hits.length - 1));
            });
        }, 120);
        return () => clearTimeout(timer);
    }, [findOpen, query, numPages, pdfDoc, textVersion, pageText]);

    // Where each match sits on the drawn pages, from their text layers. Re-run
    // as pages draw, and at a new scale (the text layer is redrawn).
    useEffect(() => {
        if (!findOpen || query.length < 2) {
            setFindRanges({ query: "", byPage: new Map() });
            return;
        }
        const timer = setTimeout(() => {
            const map = new Map<number, PdfQuad[][]>();
            for (const [pageNumber, pageEl] of orderedPages(pageRefs.current)) {
                if (pageNumber < drawn[0] || pageNumber > drawn[1]) continue;
                const layer = textLayerOf(pageEl);
                if (!layer) continue;
                const pageRect = pageEl.getBoundingClientRect();
                map.set(
                    pageNumber,
                    findAllTextRanges(layer, query, MAX_FIND_HITS).map(range =>
                        quadsOfRange(range, pageRect)
                    )
                );
            }
            setFindRanges({ query, byPage: map });
        }, 100);
        return () => clearTimeout(timer);
    }, [findOpen, query, textLayerVersion, pageScale, drawn]);

    // Go to the current match: to its page first, which draws it, then to
    // the match itself once the page's text layer has placed it.
    useEffect(() => {
        const hit = findHits[findIndex];
        if (!hit) return;
        const ranges = rangesByPage.get(hit.page);
        const quads = ranges?.[Math.min(hit.index, ranges.length - 1)];
        const key = `${query}\u0000${findIndex}`;
        if (quads && quads.length > 0) {
            if (findScrolledTo.current === `${key}\u0000fine`) return;
            findScrolledTo.current = `${key}\u0000fine`;
            scrollToQuad(hit.page, quads[0]);
        } else if (!findScrolledTo.current.startsWith(key)) {
            findScrolledTo.current = `${key}\u0000page`;
            goToPage(hit.page);
        }
    }, [findHits, findIndex, query, rangesByPage, scrollToQuad, goToPage]);

    const stepFind = useCallback(
        (step: 1 | -1) => {
            if (findHits.length === 0) return;
            setFindIndex(index => (index + step + findHits.length) % findHits.length);
        },
        [findHits.length]
    );

    const findByPage = useMemo(() => {
        const map = new Map<number, { all: PdfQuad[]; current: PdfQuad[] }>();
        const current = findHits[findIndex];
        for (const [page, ranges] of rangesByPage) {
            const entry = { all: [] as PdfQuad[], current: [] as PdfQuad[] };
            const currentIndex =
                current?.page === page ? Math.min(current.index, ranges.length - 1) : -1;
            ranges.forEach((quads, index) => {
                if (index === currentIndex) entry.current.push(...quads);
                else entry.all.push(...quads);
            });
            map.set(page, entry);
        }
        return map;
    }, [rangesByPage, findHits, findIndex]);

    // ---------------------------------------------------------------------
    // Selection → note, highlight, or a question
    // ---------------------------------------------------------------------

    // Capture text selections as anchor candidates. A selection is valid when
    // it falls entirely within one rendered page and has at least one rect
    // with non-zero area. The capture runs once per gesture — see
    // `createSelectionCommitter` for why not on every `selectionchange`.
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
            if (!renderedPages.has(pageNumber)) return;

            const rects = Array.from(range.getClientRects()).filter(
                r => r.width > 0 && r.height > 0
            );
            const quads = quadsOfRange(range, pageEl.getBoundingClientRect());
            if (rects.length === 0 || quads.length === 0) {
                setSelectionDraft(null);
                return;
            }

            // Anchor the floating action button just below the last selection
            // rect, in page-container (the scrollable wrapper) coordinates —
            // kept far enough from the edges that its centred body stays
            // inside the container when a drag ends near the margin.
            const containerRect = container.getBoundingClientRect();
            const lastRect = rects[rects.length - 1]!;
            const halfPopup = POPUP_WIDTH_PX / 2 + 8;
            const buttonX = Math.min(
                Math.max(lastRect.right - containerRect.left + container.scrollLeft, halfPopup),
                container.scrollLeft + container.clientWidth - halfPopup
            );
            const buttonY = lastRect.bottom - containerRect.top + container.scrollTop + 6;

            setHighlightMenu(null);
            setSelectionDraft({
                page: pageNumber,
                quads,
                quote: text,
                buttonX,
                buttonY,
            });
        };

        const committer = createSelectionCommitter(handler);
        const onPointerDown = (e: PointerEvent) => {
            if (!container.contains(e.target as Node)) return;
            committer.pointerDown(e.button === 0 && e.isPrimary);
        };
        const onPointerUp = () => committer.pointerUp();
        const onSelectionChange = () => committer.selectionChanged();
        container.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("pointerup", onPointerUp);
        document.addEventListener("pointercancel", onPointerUp);
        document.addEventListener("selectionchange", onSelectionChange);
        return () => {
            committer.dispose();
            container.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("pointerup", onPointerUp);
            document.removeEventListener("pointercancel", onPointerUp);
            document.removeEventListener("selectionchange", onSelectionChange);
        };
    }, [renderedPages]);

    // Clear the selection draft when the user clicks elsewhere (outside the
    // floating button). Without this, the button lingers after the user's
    // selection collapses programmatically in some browsers. A secondary
    // button is left alone: a right-click on the selection opens a menu
    // that acts on it, and must find it still there.
    useEffect(() => {
        const onPointerDown = (e: PointerEvent) => {
            if (e.button !== 0) return;
            const target = e.target as HTMLElement | null;
            if (target?.closest("[data-note-anchor-btn]")) return;
            setHighlightMenu(null);
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

    const handleHighlight = (color: HighlightColor) => {
        if (!selectionDraft || !onCreateHighlight) return;
        onCreateHighlight({
            page: selectionDraft.page,
            quads: selectionDraft.quads,
            quote: { exact: selectionDraft.quote },
            color,
        });
        window.getSelection()?.removeAllRanges();
        setSelectionDraft(null);
    };

    const handleAskAi = () => {
        if (!selectionDraft || !onAskAi) return;
        onAskAi({ text: selectionDraft.quote, page: selectionDraft.page });
        window.getSelection()?.removeAllRanges();
        setSelectionDraft(null);
    };

    /**
     * A click on a highlight opens its colours. The overlays let pointer
     * events through (the text under them has to stay selectable), so the
     * page works out which highlight, if any, is under the click.
     */
    const highlightsEditable = Boolean(onRecolorHighlight ?? onRemoveHighlight);
    const notesByPageRef = useRef(notesByPage);
    notesByPageRef.current = notesByPage;
    const handlePageClick = useCallback(
        (pageNumber: number, event: ReactMouseEvent<HTMLDivElement>) => {
            if (!highlightsEditable) return;
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed) return;
            const container = containerRef.current;
            const pageEl = pageRefs.current.get(pageNumber);
            if (!container || !pageEl) return;
            const rect = pageEl.getBoundingClientRect();
            const x = (event.clientX - rect.left) / rect.width;
            const y = (event.clientY - rect.top) / rect.height;
            const hit = (notesByPageRef.current.get(pageNumber) ?? []).find(
                placed =>
                    placed.note.highlight &&
                    placed.quads.some(
                        ([x1, y1, x2, y2]) => x >= x1 && x <= x2 && y >= y1 && y <= y2
                    )
            );
            if (!hit) return;
            const box = container.getBoundingClientRect();
            const half = HIGHLIGHT_MENU_WIDTH_PX / 2 + 8;
            setSelectionDraft(null);
            setHighlightMenu({
                noteId: hit.note.id,
                x: Math.min(
                    Math.max(event.clientX - box.left + container.scrollLeft, half),
                    container.scrollLeft + container.clientWidth - half
                ),
                y: event.clientY - box.top + container.scrollTop + 10,
            });
        },
        [highlightsEditable]
    );
    const menuNote = highlightMenu ? notes.find(n => n.id === highlightMenu.noteId) : undefined;

    // ---------------------------------------------------------------------
    // Keys
    // ---------------------------------------------------------------------

    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const mod = event.metaKey || event.ctrlKey;
        const container = containerRef.current;
        if (mod && (event.key === "=" || event.key === "+")) {
            event.preventDefault();
            zoomIn();
        } else if (mod && event.key === "-") {
            event.preventDefault();
            zoomOut();
        } else if (mod && event.key === "0") {
            event.preventDefault();
            applyZoom("auto");
        } else if (mod && event.key.toLowerCase() === "f") {
            event.preventDefault();
            openFind();
        } else if (event.key === "Escape" && (highlightMenu || selectionDraft)) {
            event.stopPropagation();
            setHighlightMenu(null);
            setSelectionDraft(null);
        } else if (event.key === "Escape" && contentsOpen && panelOverlays) {
            event.stopPropagation();
            setContentsOpen(false);
        } else if (
            (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
            !mod &&
            event.target === container &&
            container &&
            container.scrollWidth <= container.clientWidth &&
            numPages
        ) {
            // Page keys when there is nothing to scroll sideways, as in
            // pdf.js; PageUp/PageDown, Home and End are the browser's own.
            event.preventDefault();
            goToPage(
                Math.min(numPages, Math.max(1, currentPage + (event.key === "ArrowRight" ? 1 : -1)))
            );
        }
    };

    const compact = viewerWidth !== null && viewerWidth < COMPACT_TOOLBAR_PX;
    const zoomLabel = `${Math.round(pageScale * 100)}%`;
    const [pageDraft, setPageDraft] = useState<string | null>(null);
    const commitPageDraft = () => {
        if (pageDraft === null) return;
        const page = numPages ? pageFromLabel(pageLabels, pageDraft, numPages) : null;
        setPageDraft(null);
        if (page) goToPage(page);
    };

    return (
        <div ref={rootRef} className="flex min-h-0 min-w-0 flex-1 flex-col" onKeyDown={onKeyDown}>
            {!loadError && numPages !== null && (
                <div
                    role="toolbar"
                    aria-label={t("toolbar")}
                    data-testid="pdf-toolbar"
                    className="border-line bg-panel text-ink-2 flex h-10 shrink-0 items-center gap-0.5 border-b px-2 text-xs"
                >
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn("size-7", contentsOpen && "bg-brand-soft text-brand-ink")}
                        aria-label={contentsOpen ? t("hideContents") : t("showContents")}
                        title={contentsOpen ? t("hideContents") : t("showContents")}
                        aria-pressed={contentsOpen}
                        onClick={() => setContentsOpen(open => !open)}
                        data-testid="pdf-contents-toggle"
                    >
                        <PanelLeft />
                    </Button>

                    <div className="bg-line mx-1.5 h-5 w-px shrink-0" aria-hidden />

                    {!compact && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={t("previousPage")}
                            title={t("previousPage")}
                            disabled={currentPage <= 1}
                            onClick={() => goToPage(currentPage - 1)}
                        >
                            <ChevronUp />
                        </Button>
                    )}
                    <Input
                        value={pageDraft ?? pageLabelFor(pageLabels, currentPage)}
                        inputMode={pageLabels ? "text" : "numeric"}
                        aria-label={t("pageNumber")}
                        className={cn("h-7 px-1 text-center", pageLabels ? "w-14" : "w-11")}
                        onFocus={e => e.currentTarget.select()}
                        onChange={e =>
                            setPageDraft(
                                pageLabels ? e.target.value : e.target.value.replace(/\D/g, "")
                            )
                        }
                        onBlur={commitPageDraft}
                        onKeyDown={e => {
                            if (e.key === "Enter") commitPageDraft();
                            if (e.key === "Escape") setPageDraft(null);
                        }}
                    />
                    <span
                        className="text-ink-3 whitespace-nowrap px-1"
                        data-testid="pdf-page-count"
                    >
                        {pageLabels
                            ? t("pageOfLabelled", { page: currentPage, count: numPages })
                            : t("ofPages", { count: numPages })}
                    </span>
                    {!compact && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={t("nextPage")}
                            title={t("nextPage")}
                            disabled={currentPage >= numPages}
                            onClick={() => goToPage(currentPage + 1)}
                        >
                            <ChevronDown />
                        </Button>
                    )}

                    <div className="bg-line mx-1.5 h-5 w-px shrink-0" aria-hidden />

                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={t("zoomOut")}
                        title={t("zoomOutShortcut")}
                        disabled={pageScale <= ZOOM_STEPS[0]!}
                        onClick={zoomOut}
                        data-testid="pdf-zoom-out"
                    >
                        <Minus />
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 min-w-[64px] gap-1 px-2 text-xs tabular-nums"
                                aria-label={t("zoomLevel", { level: zoomLabel })}
                                data-testid="pdf-zoom-level"
                            >
                                {zoomLabel}
                                <ChevronDown className="size-3" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="center" className="min-w-[150px]">
                            <DropdownMenuItem onSelect={() => applyZoom("auto")}>
                                {t("zoomAuto")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => applyZoom("fit")}>
                                {t("fitWidth")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => applyZoom("page")}>
                                {t("fitPage")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => applyZoom(1)}>
                                {t("actualSize")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {ZOOM_PRESETS.map(level => (
                                <DropdownMenuItem
                                    key={level}
                                    onSelect={() => applyZoom(level)}
                                    className="tabular-nums"
                                >
                                    {`${Math.round(level * 100)}%`}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={t("zoomIn")}
                        title={t("zoomInShortcut")}
                        disabled={pageScale >= ZOOM_STEPS[ZOOM_STEPS.length - 1]!}
                        onClick={zoomIn}
                        data-testid="pdf-zoom-in"
                    >
                        <Plus />
                    </Button>
                    {!compact && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                                "size-7",
                                zoom === "fit" && "bg-brand-soft text-brand-ink"
                            )}
                            aria-label={t("fitWidth")}
                            title={t("fitWidth")}
                            aria-pressed={zoom === "fit"}
                            onClick={() => applyZoom(zoom === "fit" ? "auto" : "fit")}
                            data-testid="pdf-fit-width"
                        >
                            <MoveHorizontal />
                        </Button>
                    )}

                    <div className="ml-auto flex items-center gap-0.5">
                        <Button
                            variant="ghost"
                            size="icon"
                            className={cn("size-7", findOpen && "bg-brand-soft text-brand-ink")}
                            aria-label={t("find")}
                            title={t("findShortcut")}
                            aria-pressed={findOpen}
                            onClick={() => (findOpen ? closeFind() : openFind())}
                            data-testid="pdf-find-toggle"
                        >
                            <Search />
                        </Button>
                        {downloadUrl && (
                            <Button
                                asChild
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                title={t("download")}
                            >
                                <a
                                    href={downloadUrl}
                                    download={downloadName ?? true}
                                    aria-label={t("download")}
                                >
                                    <Download />
                                </a>
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {findOpen && (
                <div
                    role="search"
                    className="border-line bg-panel flex h-10 shrink-0 items-center gap-1 border-b px-2"
                >
                    <Input
                        ref={findInputRef}
                        value={findQuery}
                        placeholder={t("findPlaceholder")}
                        aria-label={t("find")}
                        className="h-7 min-w-0 flex-1"
                        data-testid="pdf-find-input"
                        onChange={e => setFindQuery(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                stepFind(e.shiftKey ? -1 : 1);
                            } else if (e.key === "Escape") {
                                e.preventDefault();
                                e.stopPropagation();
                                closeFind();
                            }
                        }}
                    />
                    <span
                        className="text-ink-3 min-w-[64px] whitespace-nowrap text-center text-xs tabular-nums"
                        aria-live="polite"
                        data-testid="pdf-find-count"
                    >
                        {findQuery.trim().length < 2
                            ? ""
                            : findHits.length === 0
                              ? findComplete
                                  ? t("findNone")
                                  : t("findSearching")
                              : t("findCount", {
                                    current: findIndex + 1,
                                    total:
                                        findHits.length >= MAX_FIND_HITS
                                            ? `${MAX_FIND_HITS}+`
                                            : `${findHits.length}${findComplete ? "" : "…"}`,
                                })}
                    </span>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={t("findPrevious")}
                        title={t("findPrevious")}
                        disabled={findHits.length === 0}
                        onClick={() => stepFind(-1)}
                    >
                        <ChevronUp />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={t("findNext")}
                        title={t("findNext")}
                        disabled={findHits.length === 0}
                        onClick={() => stepFind(1)}
                    >
                        <ChevronDown />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={t("findClose")}
                        title={t("findClose")}
                        onClick={closeFind}
                    >
                        <X />
                    </Button>
                </div>
            )}

            <div className="relative flex min-h-0 min-w-0 flex-1">
                {contentsOpen && !loadError && pdfDoc && numPages !== null && (
                    <div
                        data-testid="pdf-contents-dock"
                        data-overlay={panelOverlays ? "true" : undefined}
                        className={cn(
                            "flex min-h-0 shrink-0",
                            // Floating over the pages where there is no room beside them.
                            panelOverlays &&
                                "absolute inset-y-0 left-0 z-30 shadow-[var(--shadow-3)]"
                        )}
                    >
                        <PdfContentsPanel
                            pdf={pdfDoc}
                            numPages={numPages}
                            currentPage={currentPage}
                            pageLabels={pageLabels}
                            outline={outline}
                            tab={contentsTab}
                            onTabChange={setContentsTab}
                            onGoToPage={goFromContents}
                            onClose={() => setContentsOpen(false)}
                            width={panelWidth}
                        />
                    </div>
                )}

                <div
                    ref={containerRef}
                    // Focusable, so the zoom, find and page keys reach it after a
                    // click on the page — page text itself takes no focus.
                    tabIndex={0}
                    data-testid="pdf-scroll"
                    className="bg-surface-2 relative min-h-0 min-w-0 flex-1 overflow-auto py-5 outline-none"
                >
                    {loadError ? (
                        <div
                            // The message carries the file's URL, one unbroken
                            // word that pushed a narrow column into scrolling
                            // sideways.
                            className="text-ink-3 p-10 text-center [overflow-wrap:anywhere]"
                        >
                            {t("loadError", { error: loadError })}
                        </div>
                    ) : (
                        // At least as wide as the column, so a page narrower than
                        // it is centred, and as wide as the widest page, so a
                        // zoomed-in one scrolls sideways instead of being cut.
                        <div className="w-max min-w-full">
                            <Document
                                file={file}
                                onLoadSuccess={onDocumentLoadSuccess}
                                onLoadError={onDocumentLoadError}
                                loading={<LoadingPlaceholder />}
                                error={<LoadingPlaceholder text={t("failedToLoad")} />}
                            >
                                {numPages !== null &&
                                    Array.from({ length: numPages }, (_, i) => i + 1).map(
                                        pageNum => {
                                            const size =
                                                pageSizes[pageNum - 1] ??
                                                naturalSize ??
                                                DEFAULT_PAGE_SIZE;
                                            const found = findByPage.get(pageNum);
                                            return (
                                                <PdfPage
                                                    key={pageNum}
                                                    pageNum={pageNum}
                                                    scale={pageScale}
                                                    width={Math.floor(size.width * pageScale)}
                                                    height={Math.floor(size.height * pageScale)}
                                                    drawn={
                                                        pageNum >= drawn[0] && pageNum <= drawn[1]
                                                    }
                                                    pageRef={pageRefFor(pageNum)}
                                                    onRenderSuccess={onPageRenderSuccess}
                                                    onUndrawn={onPageUndrawn}
                                                    onTextLayerReady={onTextLayerReady}
                                                    errorLabel={t("failedToLoad")}
                                                    notesOnPage={
                                                        notesByPage.get(pageNum) ?? EMPTY_NOTES
                                                    }
                                                    highlightedNoteId={scrollToNoteId ?? null}
                                                    onNotePinClick={handlePinClick}
                                                    onPageClick={handlePageClick}
                                                    citeQuads={
                                                        citeOverlay?.page === pageNum
                                                            ? citeOverlay.quads
                                                            : null
                                                    }
                                                    findQuads={found?.all ?? EMPTY_QUADS}
                                                    currentFindQuads={found?.current ?? EMPTY_QUADS}
                                                />
                                            );
                                        }
                                    )}
                            </Document>
                        </div>
                    )}

                    {selectionDraft && (
                        <div
                            data-note-anchor-btn
                            // w-max: near the column's right edge the box would
                            // otherwise shrink to fit and wrap "+ Note" in two.
                            className="border-line bg-panel absolute z-20 flex w-max -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-[9px] border p-[3px] shadow-[0_6px_18px_oklch(0_0_0/0.18)]"
                            style={{ left: selectionDraft.buttonX, top: selectionDraft.buttonY }}
                        >
                            <button
                                type="button"
                                onClick={handleCreateFromSelection}
                                className="bg-brand text-brand-fg rounded-md px-2.5 py-[5px] text-xs font-semibold"
                            >
                                {t("addNote")}
                            </button>
                            {onCreateHighlight && (
                                <div
                                    role="group"
                                    aria-label={t("highlight")}
                                    className="border-line-2 flex items-center gap-1 border-x px-1.5"
                                >
                                    {HIGHLIGHT_COLORS.map(color => (
                                        <ColorSwatch
                                            key={color}
                                            color={color}
                                            label={t("highlightIn", {
                                                color: t(`colors.${color}`),
                                            })}
                                            onClick={() => handleHighlight(color)}
                                        />
                                    ))}
                                </div>
                            )}
                            {onAskAi && (
                                <button
                                    type="button"
                                    onClick={handleAskAi}
                                    title={t("askAiTitle")}
                                    className="border-line-2 bg-panel-2 text-ink-2 rounded-md border px-2 py-[5px] text-[11px] font-semibold"
                                >
                                    {t("askAi")}
                                </button>
                            )}
                        </div>
                    )}

                    {highlightMenu && menuNote?.highlight && (
                        <div
                            data-note-anchor-btn
                            role="menu"
                            aria-label={t("highlightMenu")}
                            data-testid="pdf-highlight-menu"
                            className="border-line bg-panel absolute z-20 flex w-max -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-[9px] border p-1 shadow-[0_6px_18px_oklch(0_0_0/0.18)]"
                            style={{ left: highlightMenu.x, top: highlightMenu.y }}
                        >
                            {onRecolorHighlight &&
                                HIGHLIGHT_COLORS.map(color => (
                                    <ColorSwatch
                                        key={color}
                                        color={color}
                                        label={t("highlightIn", { color: t(`colors.${color}`) })}
                                        selected={menuNote.highlight === color}
                                        onClick={() => {
                                            if (color !== menuNote.highlight) {
                                                onRecolorHighlight(menuNote.id, color);
                                            }
                                            setHighlightMenu(null);
                                        }}
                                    />
                                ))}
                            {onRemoveHighlight && (
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                        onRemoveHighlight(menuNote.id);
                                        setHighlightMenu(null);
                                    }}
                                    className="text-danger-ink hover:bg-danger-soft ml-1 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
                                >
                                    <Trash2 className="size-3.5" />
                                    {t("removeHighlight")}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/** The highlight menu's width: four swatches and Remove. */
const HIGHLIGHT_MENU_WIDTH_PX = 210;

function ColorSwatch({
    color,
    label,
    selected = false,
    onClick,
}: {
    color: HighlightColor;
    label: string;
    selected?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={selected}
            data-highlight-color={color}
            onClick={onClick}
            // The ink as it lands on the page: the translucent fill over
            // white paper, so on a dark panel it shows the colour the
            // reader will get rather than a muddy see-through one.
            className={cn(
                "border-line size-5 shrink-0 rounded-full border bg-[var(--paper-panel)] transition-transform hover:scale-110",
                selected && "ring-brand ring-2 ring-offset-1 ring-offset-[var(--panel)]"
            )}
            style={{
                backgroundImage: `linear-gradient(${HIGHLIGHT_FILL[color]}, ${HIGHLIGHT_FILL[color]})`,
            }}
        />
    );
}

function LoadingPlaceholder({ text }: { text?: string }) {
    const t = useTranslations("notes.pdf");
    return <div className="text-ink-3 p-10 text-center text-[13px]">{text ?? t("loading")}</div>;
}

interface PdfPageProps {
    pageNum: number;
    scale: number;
    /** The page's box, from its own size and the scale — the same whether or not it is drawn. */
    width: number;
    height: number;
    /** Whether the page carries a canvas and text layer, or is a blank of its size. */
    drawn: boolean;
    pageRef: (el: HTMLDivElement | null) => void;
    onRenderSuccess: (pageNumber: number) => void;
    /** Fires when a drawn page becomes a blank again. */
    onUndrawn: (pageNumber: number) => void;
    errorLabel: string;
    notesOnPage: PlacedNote[];
    highlightedNoteId: number | null;
    onNotePinClick?: (noteId: number) => void;
    onPageClick: (pageNumber: number, event: ReactMouseEvent<HTMLDivElement>) => void;
    /** Fires when this page's text layer has rendered and is searchable. */
    onTextLayerReady: () => void;
    /** Located citation quads to paint on this page, if any. */
    citeQuads: PdfQuad[] | null;
    /** Find's matches on this page, and the one the reader is on. */
    findQuads: PdfQuad[];
    currentFindQuads: PdfQuad[];
}

/**
 * Overlays are placed in percentages of the page, not pixels: the page box
 * changes size the moment the scale does, and a percentage moves with it,
 * where pixels would sit at the old size until the canvas finished redrawing.
 */
function quadStyle([x1, y1, x2, y2]: PdfQuad) {
    return {
        left: `${x1 * 100}%`,
        top: `${y1 * 100}%`,
        width: `${(x2 - x1) * 100}%`,
        height: `${(y2 - y1) * 100}%`,
    };
}

const PdfPage = memo(function PdfPage({
    pageNum,
    scale,
    width,
    height,
    drawn,
    pageRef,
    onRenderSuccess,
    onUndrawn,
    errorLabel,
    notesOnPage,
    highlightedNoteId,
    onNotePinClick,
    onPageClick,
    onTextLayerReady,
    citeQuads,
    findQuads,
    currentFindQuads,
}: PdfPageProps) {
    const [rendered, setRendered] = useState(false);
    useEffect(() => {
        if (drawn) return;
        setRendered(false);
        onUndrawn(pageNum);
    }, [drawn, pageNum, onUndrawn]);
    const showOverlays = drawn && rendered;

    return (
        <div
            ref={pageRef}
            data-pdf-page={pageNum}
            data-drawn={drawn ? "true" : undefined}
            onClick={event => onPageClick(pageNum, event)}
            // The page is paper: white in both themes. Its box is sized
            // here, so a blank and a drawn page take the same room and the
            // scroll position never jumps as pages draw.
            className="relative mx-auto mb-4 overflow-hidden rounded bg-[var(--paper-panel)] shadow-[0_4px_18px_oklch(0_0_0/0.08),0_1px_3px_oklch(0_0_0/0.06)]"
            style={{ width, height }}
        >
            {drawn && (
                <Page
                    pageNumber={pageNum}
                    scale={scale}
                    renderTextLayer
                    renderAnnotationLayer={false}
                    loading=""
                    error={errorLabel}
                    onRenderSuccess={() => {
                        setRendered(true);
                        onRenderSuccess(pageNum);
                    }}
                    onRenderTextLayerSuccess={onTextLayerReady}
                />
            )}
            {showOverlays &&
                notesOnPage.map(placed => (
                    <NoteOverlay
                        key={placed.note.id}
                        placed={placed}
                        highlighted={placed.note.id === highlightedNoteId}
                        onClick={() => onNotePinClick?.(placed.note.id)}
                    />
                ))}
            {showOverlays &&
                citeQuads?.map((q, i) => (
                    <div
                        key={`cite-${i}`}
                        aria-hidden
                        className="pointer-events-none absolute rounded-sm mix-blend-multiply outline outline-[1.5px] outline-[oklch(0.7_0.13_95)]"
                        style={{ ...quadStyle(q), background: "var(--paper-hl-find)" }}
                    />
                ))}
            {showOverlays &&
                findQuads.map((q, i) => (
                    <div
                        key={`find-${i}`}
                        aria-hidden
                        data-find-hit
                        className="pointer-events-none absolute rounded-sm mix-blend-multiply"
                        style={{ ...quadStyle(q), background: "var(--paper-hl-find)" }}
                    />
                ))}
            {showOverlays &&
                currentFindQuads.map((q, i) => (
                    <div
                        key={`find-current-${i}`}
                        aria-hidden
                        data-find-hit="current"
                        className="pointer-events-none absolute rounded-sm mix-blend-multiply"
                        style={{ ...quadStyle(q), background: "var(--paper-hl-find-current)" }}
                    />
                ))}
        </div>
    );
});

function NoteOverlay({
    placed,
    highlighted,
    onClick,
}: {
    placed: PlacedNote;
    highlighted: boolean;
    onClick: () => void;
}) {
    const t = useTranslations("notes.pdf");
    const { note, quads, ordinal } = placed;
    const firstQuad = quads[0];
    if (!firstQuad) return null;

    if (note.highlight) {
        return (
            <>
                {quads.map((q, i) => (
                    <div
                        key={i}
                        aria-hidden
                        data-highlight={note.highlight ?? undefined}
                        data-note-id={note.id}
                        className={cn(
                            "pointer-events-none absolute rounded-[2px] mix-blend-multiply",
                            highlighted && "outline-brand outline outline-[1.5px]"
                        )}
                        style={{ ...quadStyle(q), background: HIGHLIGHT_FILL[note.highlight!] }}
                    />
                ))}
            </>
        );
    }

    const status = note.anchorStatus ?? "resolved";
    const fillColor =
        status === "orphaned"
            ? "oklch(0.6 0.18 25 / 0.18)"
            : status === "drifted"
              ? "oklch(0.7 0.14 70 / 0.22)"
              : // In sRGB, like every fill blended by multiply — see the
                // --paper-hl-* tokens.
                "oklch(0.72 0.15 285 / 0.18)";
    const borderColor =
        status === "orphaned"
            ? "oklch(0.5 0.2 25)"
            : status === "drifted"
              ? "oklch(0.5 0.18 70)"
              : "var(--accent)";

    return (
        <>
            {quads.map((q, i) => (
                <div
                    key={i}
                    style={{
                        position: "absolute",
                        ...quadStyle(q),
                        background: fillColor,
                        border: highlighted ? `1.5px solid ${borderColor}` : "none",
                        borderRadius: 2,
                        pointerEvents: "none",
                        mixBlendMode: "multiply",
                        transition: "background .2s, border .2s",
                    }}
                />
            ))}
            <button
                type="button"
                onClick={event => {
                    // Not the page's click: that would look for a highlight.
                    event.stopPropagation();
                    onClick();
                }}
                title={note.title ?? t("pinTitle", { ordinal: ordinal ?? 0 })}
                style={{
                    position: "absolute",
                    // First quad's top-left is where the pin goes.
                    left: `calc(${firstQuad[0] * 100}% - 12px)`,
                    top: `calc(${firstQuad[1] * 100}% - 12px)`,
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
    pageRefs: Map<number, HTMLDivElement>
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
