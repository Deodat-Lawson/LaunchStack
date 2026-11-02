"use client";

import {
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    version as reactVersion,
    type KeyboardEvent as ReactKeyboardEvent,
    type ReactElement,
} from "react";
import { useTranslations } from "next-intl";
import { Thumbnail } from "react-pdf";
import { ChevronRight, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import {
    currentOutlineId,
    indexOutline,
    outlineAncestors,
    pageLabelFor,
    visibleOutlineRoots,
    type PdfOutlineNode,
} from "./_shared/pdfOutline";

/**
 * The Contents strip beside the PDF pages: every page as a thumbnail, or the
 * document's outline as a tree, like Preview.app's sidebar. The viewer owns
 * whether the strip is open, how wide it is and which tab shows; this draws
 * the inside and reports clicks.
 */

export type PdfContentsTab = "thumbnails" | "outline";

export interface PdfContentsPanelProps {
    /** The PDFDocumentProxy from `<Document onLoadSuccess>`; null until loaded. */
    pdf: unknown;
    numPages: number;
    /** 1-based. */
    currentPage: number;
    pageLabels: string[] | null;
    /** null while loading; [] when the document has none. */
    outline: PdfOutlineNode[] | null;
    tab: PdfContentsTab;
    onTabChange: (tab: PdfContentsTab) => void;
    onGoToPage: (page: number) => void;
    onClose: () => void;
    /** The strip's width in px, set by the viewer. */
    width: number;
}

type ContentsKey =
    | "title"
    | "thumbnails"
    | "outline"
    | "close"
    | "loadingOutline"
    | "noOutline"
    | "pageTitle"
    | "toggle"
    | "collapse";
type ContentsTranslator = (key: ContentsKey, values?: Record<string, string | number>) => string;

function useContentsTranslations(): ContentsTranslator {
    return useTranslations("notes.pdf.contents");
}

/** A4-ish, until the first thumbnail reports the real page shape. */
const DEFAULT_ASPECT = 1.41;
const LIST_PADDING = 8;
const ITEM_PADDING = 4;
const MIN_THUMB_WIDTH = 48;
const INDENT_PX = 12;

function scrollNearest(el: Element | null | undefined): void {
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
}

/**
 * `inert` keeps react-pdf's own `<a href="#">` around each thumbnail out of
 * the tab order and off the pointer: the row's button is the one control.
 * React 18 only forwards it as a string attribute, React 19 only as a boolean.
 */
const INERT: { inert?: boolean } = {
    inert: (Number(reactVersion.split(".")[0]) >= 19 ? true : "") as unknown as boolean,
};

export function PdfContentsPanel(props: PdfContentsPanelProps): ReactElement {
    const { tab, onTabChange, onClose, width } = props;
    const t = useContentsTranslations();

    return (
        <aside
            data-testid="pdf-contents"
            aria-label={t("title")}
            style={{ width }}
            className="border-line bg-panel flex h-full shrink-0 flex-col border-r"
        >
            <div className="border-line flex items-center gap-1 border-b px-2 py-1.5">
                <div
                    role="group"
                    aria-label={t("title")}
                    className="bg-panel-2 flex flex-1 rounded-md p-0.5"
                >
                    {(["thumbnails", "outline"] as const).map(name => (
                        <Button
                            key={name}
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-pressed={tab === name}
                            onClick={() => onTabChange(name)}
                            data-testid={`pdf-contents-tab-${name}`}
                            className={cn(
                                "hover:text-ink h-6 flex-1 px-2 text-xs hover:bg-transparent",
                                tab === name ? "bg-panel text-ink shadow-1" : "text-ink-2"
                            )}
                        >
                            {t(name)}
                        </Button>
                    ))}
                </div>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={t("close")}
                    title={t("close")}
                    onClick={onClose}
                    data-testid="pdf-contents-close"
                >
                    <X />
                </Button>
            </div>
            {tab === "thumbnails" ? (
                <ThumbnailStrip {...props} t={t} />
            ) : (
                <OutlineTree {...props} t={t} />
            )}
        </aside>
    );
}

type BodyProps = PdfContentsPanelProps & { t: ContentsTranslator };

function ThumbnailStrip({
    pdf,
    numPages,
    currentPage,
    pageLabels,
    onGoToPage,
    width,
    t,
}: BodyProps) {
    const listRef = useRef<HTMLDivElement>(null);
    const [aspect, setAspect] = useState(DEFAULT_ASPECT);
    const measured = useRef(false);
    // The list's inner width, without its scrollbar, so no thumbnail overflows.
    const [listWidth, setListWidth] = useState(width);

    useEffect(() => {
        const el = listRef.current;
        if (!el || typeof ResizeObserver === "undefined") {
            setListWidth(width);
            return;
        }
        const observer = new ResizeObserver(() => setListWidth(el.clientWidth || width));
        observer.observe(el);
        return () => observer.disconnect();
    }, [width]);

    useEffect(() => {
        scrollNearest(listRef.current?.querySelector(`[data-page="${currentPage}"]`));
    }, [currentPage]);

    const onMeasure = useCallback((ratio: number) => {
        if (measured.current || !Number.isFinite(ratio) || ratio <= 0) return;
        measured.current = true;
        setAspect(ratio);
    }, []);

    const thumbWidth = Math.max(MIN_THUMB_WIDTH, listWidth - 2 * LIST_PADDING - 2 * ITEM_PADDING);
    const pages = useMemo(() => Array.from({ length: numPages }, (_, i) => i + 1), [numPages]);

    return (
        <div
            ref={listRef}
            role="list"
            aria-label={t("thumbnails")}
            data-pdf-thumb-list
            className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden"
            style={{ padding: LIST_PADDING }}
        >
            {pages.map(page => {
                const label = pageLabelFor(pageLabels, page);
                return (
                    <ThumbnailItem
                        key={page}
                        pdf={pdf}
                        page={page}
                        label={label}
                        title={t("pageTitle", { label })}
                        current={page === currentPage}
                        width={thumbWidth}
                        aspect={aspect}
                        onMeasure={onMeasure}
                        onGo={onGoToPage}
                    />
                );
            })}
        </div>
    );
}

interface ThumbnailItemProps {
    pdf: unknown;
    page: number;
    label: string;
    title: string;
    current: boolean;
    width: number;
    aspect: number;
    onMeasure: (ratio: number) => void;
    onGo: (page: number) => void;
}

/**
 * One page. The canvas is drawn only once the item has come near the strip's
 * viewport, and stays drawn after that; until then a box of the page's shape
 * keeps the list the right length. Without IntersectionObserver (jsdom) every
 * item draws at once.
 */
const ThumbnailItem = memo(function ThumbnailItem({
    pdf,
    page,
    label,
    title,
    current,
    width,
    aspect,
    onMeasure,
    onGo,
}: ThumbnailItemProps) {
    const boxRef = useRef<HTMLDivElement>(null);
    const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");

    useEffect(() => {
        const el = boxRef.current;
        if (near || !el || typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver(
            entries => {
                if (entries.some(entry => entry.isIntersecting)) {
                    setNear(true);
                    observer.disconnect();
                }
            },
            { root: el.closest("[data-pdf-thumb-list]"), rootMargin: "200% 0px" }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [near]);

    const go = useCallback(() => onGo(page), [onGo, page]);

    return (
        <div role="listitem" className="flex">
            <button
                type="button"
                data-testid="pdf-thumb"
                data-page={page}
                aria-current={current ? "page" : undefined}
                aria-label={title}
                title={title}
                onClick={go}
                style={{ padding: ITEM_PADDING }}
                className={cn(
                    "focus-visible:ring-brand flex w-full flex-col items-center gap-1 rounded-md outline-none focus-visible:ring-2",
                    current ? "bg-brand-soft ring-brand ring-1" : "hover:bg-panel-2"
                )}
            >
                <div
                    ref={boxRef}
                    {...INERT}
                    className="bg-panel-2 shadow-1 pointer-events-none overflow-hidden rounded-sm"
                    style={{ width, height: Math.round(width * aspect) }}
                >
                    {near && pdf ? (
                        <Thumbnail
                            pdf={pdf as never}
                            pageNumber={page}
                            width={width}
                            loading={null}
                            error={null}
                            noData={null}
                            onLoadSuccess={p => onMeasure(p.originalHeight / p.originalWidth)}
                            onItemClick={go}
                        />
                    ) : null}
                </div>
                <span
                    className={cn(
                        "text-xs tabular-nums",
                        current ? "text-brand-ink font-medium" : "text-ink-2"
                    )}
                >
                    {label}
                </span>
            </button>
        </div>
    );
});

function OutlineTree({ outline, currentPage, pageLabels, onGoToPage, t }: BodyProps) {
    const treeRef = useRef<HTMLDivElement>(null);
    // A single wrapper root ("Table of Contents") is dropped: see visibleOutlineRoots.
    const roots = useMemo(() => visibleOutlineRoots(outline ?? []), [outline]);
    const index = useMemo(() => indexOutline(roots), [roots]);
    const currentId = useMemo(() => currentOutlineId(roots, currentPage), [roots, currentPage]);
    const pathToCurrent = useMemo(
        () => outlineAncestors(currentId, index.parents),
        [currentId, index.parents]
    );
    // What the reader opened or closed by hand; everything else follows the
    // defaults (top level open, the path to the current node open).
    const [toggled, setToggled] = useState(() => new Map<string, boolean>());

    // A new current node reopens the way to it, even if the reader had
    // closed a chapter on that path.
    useEffect(() => {
        setToggled(prev => {
            let next: Map<string, boolean> | null = null;
            for (const id of pathToCurrent) {
                if (prev.get(id) === false) {
                    next ??= new Map(prev);
                    next.delete(id);
                }
            }
            return next ?? prev;
        });
    }, [pathToCurrent]);

    // Scroll to the current row once per change, after its ancestors have
    // opened (that can take a render, so this watches every render).
    const scrolledFor = useRef<string | null>(null);
    useEffect(() => {
        if (!currentId || scrolledFor.current === currentId) return;
        const row = treeRef.current?.querySelector('[aria-current="true"]');
        if (!row) return;
        scrolledFor.current = currentId;
        scrollNearest(row);
    });

    const isOpen = (node: PdfOutlineNode) =>
        toggled.get(node.id) ??
        ((index.depths.get(node.id) ?? 0) === 0 || pathToCurrent.has(node.id));
    const setOpen = useCallback((id: string, open: boolean) => {
        setToggled(prev => new Map(prev).set(id, open));
    }, []);
    const moveFocus = useCallback((from: HTMLElement, step: 1 | -1) => {
        const rows = Array.from(
            treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []
        );
        rows[rows.indexOf(from) + step]?.focus();
    }, []);

    const quiet =
        outline === null
            ? (["pdf-outline-loading", t("loadingOutline")] as const)
            : roots.length === 0
              ? (["pdf-outline-empty", t("noOutline")] as const)
              : null;
    if (quiet) {
        return (
            <p data-testid={quiet[0]} className="text-ink-3 px-3 py-4 text-xs">
                {quiet[1]}
            </p>
        );
    }

    const renderLevel = (nodes: PdfOutlineNode[], depth: number) =>
        nodes.map(node => {
            const open = isOpen(node);
            return (
                <OutlineRow
                    key={node.id}
                    node={node}
                    depth={depth}
                    open={open}
                    current={node.id === currentId}
                    label={node.page === null ? "" : pageLabelFor(pageLabels, node.page)}
                    toggleTitle={t(open ? "collapse" : "toggle", { title: node.title })}
                    onGo={onGoToPage}
                    onSetOpen={setOpen}
                    onMoveFocus={moveFocus}
                >
                    {open && node.children.length > 0
                        ? renderLevel(node.children, depth + 1)
                        : null}
                </OutlineRow>
            );
        });

    return (
        <div
            ref={treeRef}
            role="tree"
            aria-label={t("outline")}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1"
        >
            {renderLevel(roots, 0)}
        </div>
    );
}

interface OutlineRowProps {
    node: PdfOutlineNode;
    depth: number;
    open: boolean;
    current: boolean;
    label: string;
    toggleTitle: string;
    onGo: (page: number) => void;
    onSetOpen: (id: string, open: boolean) => void;
    onMoveFocus: (from: HTMLElement, step: 1 | -1) => void;
    children: ReactElement[] | null;
}

function OutlineRow({
    node,
    depth,
    open,
    current,
    label,
    toggleTitle,
    onGo,
    onSetOpen,
    onMoveFocus,
    children,
}: OutlineRowProps) {
    const hasChildren = node.children.length > 0;
    const go = () => {
        if (node.page !== null) onGo(node.page);
    };
    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget) return;
        const { key } = event;
        if (key === "Enter" || key === " ") go();
        else if (key === "ArrowRight" && hasChildren) onSetOpen(node.id, true);
        else if (key === "ArrowLeft" && hasChildren) onSetOpen(node.id, false);
        else if (key === "ArrowDown") onMoveFocus(event.currentTarget, 1);
        else if (key === "ArrowUp") onMoveFocus(event.currentTarget, -1);
        else return;
        event.preventDefault();
    };

    return (
        <>
            <div
                role="treeitem"
                tabIndex={0}
                aria-selected={current}
                aria-expanded={hasChildren ? open : undefined}
                aria-current={current ? "true" : undefined}
                aria-level={depth + 1}
                data-testid="pdf-outline-item"
                data-page={node.page ?? undefined}
                onClick={go}
                onKeyDown={onKeyDown}
                style={{ paddingLeft: LIST_PADDING + depth * INDENT_PX }}
                className={cn(
                    "focus-visible:ring-brand flex cursor-pointer items-center gap-1 py-1 pr-2 text-[13px] leading-5 outline-none ring-inset focus-visible:ring-2",
                    current ? "bg-brand-soft text-brand-ink" : "text-ink hover:bg-panel-2",
                    node.page === null && "cursor-default"
                )}
            >
                {hasChildren ? (
                    <button
                        type="button"
                        tabIndex={-1}
                        aria-label={toggleTitle}
                        aria-expanded={open}
                        data-testid="pdf-outline-toggle"
                        onClick={event => {
                            event.stopPropagation();
                            onSetOpen(node.id, !open);
                        }}
                        className="text-ink-3 hover:text-ink flex size-4 shrink-0 items-center justify-center rounded-sm"
                    >
                        <ChevronRight
                            className={cn("size-3.5 transition-transform", open && "rotate-90")}
                        />
                    </button>
                ) : (
                    <span className="size-4 shrink-0" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate">{node.title}</span>
                {label ? (
                    <span className="text-ink-3 shrink-0 text-xs tabular-nums">{label}</span>
                ) : null}
            </div>
            {children ? <div role="group">{children}</div> : null}
        </>
    );
}
