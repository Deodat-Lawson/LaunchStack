/** @jest-environment jsdom */

import React, { type ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import { PdfViewerWithNotes, type PdfNoteLite } from "../PdfViewerWithNotes";

/**
 * The viewer's own controls — zoom, page, find, contents, highlights — over
 * a stand-in for react-pdf: as many pages as a test asks for, whose text
 * layer is a plain span, at whatever scale the viewer asks for. Layout is
 * faked too: jsdom measures nothing, so every page box reports 600×800 and
 * every text range one small rect, and the pages are laid out one under the
 * other at known offsets so the viewer can tell which are in view.
 */

const mockPageText = "Revenue grew strongly. Net revenue fell in the fourth quarter.";
let mockNumPages = 3;
let mockPageLabels: string[] | null = null;
let mockOutline: Array<{ title: string; dest: unknown; items: unknown[] }> = [];
/** What a page's text says when it is not the stock sentence. */
const mockPageTexts = new Map<number, string>();
const textFor = (page: number) => mockPageTexts.get(page) ?? mockPageText;

interface MockPageProps {
    pageNumber: number;
    scale: number;
    onRenderSuccess: () => void;
    onRenderTextLayerSuccess: () => void;
}
const mockPageScales = new Map<number, number>();

jest.mock("react-pdf", () => {
    const { useEffect } = jest.requireActual<typeof React>("react");
    return {
        pdfjs: { GlobalWorkerOptions: { workerSrc: "" } },
        Document: ({
            children,
            onLoadSuccess,
        }: {
            children: ReactNode;
            onLoadSuccess: (pdf: unknown) => void;
        }) => {
            useEffect(() => {
                onLoadSuccess({
                    numPages: mockNumPages,
                    getPage: (n: number) =>
                        Promise.resolve({
                            getViewport: ({ scale }: { scale: number }) => ({
                                width: 600 * scale,
                                height: 800 * scale,
                            }),
                            getTextContent: () =>
                                Promise.resolve({ items: [{ str: textFor(n), hasEOL: true }] }),
                        }),
                    getPageLabels: () => Promise.resolve(mockPageLabels),
                    getOutline: () => Promise.resolve(mockOutline),
                    getDestination: () => Promise.resolve(null),
                    getPageIndex: (ref: { num: number }) => Promise.resolve(ref.num - 1),
                });
                // eslint-disable-next-line react-hooks/exhaustive-deps
            }, []);
            return <div>{children}</div>;
        },
        Page: ({ pageNumber, scale, onRenderSuccess, onRenderTextLayerSuccess }: MockPageProps) => {
            mockPageScales.set(pageNumber, scale);
            useEffect(() => {
                onRenderSuccess();
                onRenderTextLayerSuccess();
                // eslint-disable-next-line react-hooks/exhaustive-deps
            }, [scale]);
            return (
                <div className="react-pdf__Page" data-page={pageNumber} data-scale={scale}>
                    <div className="react-pdf__Page__textContent">
                        <span>{textFor(pageNumber)}</span>
                    </div>
                </div>
            );
        },
        Thumbnail: ({ pageNumber }: { pageNumber: number }) => <div data-mock-thumb={pageNumber} />,
    };
});

/** What the column measures, for "fit to width": 1232px leaves 1200 for a 600pt page. */
let columnWidth = 1232;
/** How tall the visible area is: a little under one page. */
const VIEW_HEIGHT = 700;
const resizeObservers = new Set<FakeResizeObserver>();
class FakeResizeObserver {
    private readonly targets = new Set<Element>();
    constructor(private readonly callback: ResizeObserverCallback) {
        resizeObservers.add(this);
    }
    observe(target: Element) {
        this.targets.add(target);
        this.fire([target]);
    }
    fire(targets: Element[] = Array.from(this.targets)) {
        this.callback(
            targets.map(
                target =>
                    ({
                        target,
                        contentRect: { width: columnWidth, height: VIEW_HEIGHT },
                    }) as ResizeObserverEntry
            ),
            this as unknown as ResizeObserver
        );
    }
    unobserve() {}
    disconnect() {
        resizeObservers.delete(this);
    }
}

/** The column changes width, as dragging a rail would. */
function resizeColumnTo(width: number) {
    columnWidth = width;
    act(() => {
        for (const observer of resizeObservers) observer.fire();
    });
}

/**
 * Pages sit one under the other: 20px above the first, 800px tall at scale
 * 1, 16px apart. With `layoutRects` on, a page box is as tall as the viewer
 * sized it, so a change of scale moves every page the way it does on screen.
 */
const PAGE_HEIGHT = 800;
const PAGE_GAP = 16;
const FIRST_PAGE_TOP = 20;
const pageTop = (page: number, scale = 1) =>
    FIRST_PAGE_TOP + (page - 1) * (Math.floor(PAGE_HEIGHT * scale) + PAGE_GAP);

const PAGE_BOX = {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 600,
    bottom: 800,
    width: 600,
    height: 800,
    toJSON: () => ({}),
};

/**
 * Whether page boxes report where they really sit (for tests that zoom or
 * scroll, where "the page under the pointer" matters) or all at the origin
 * (for tests that click inside a highlight at fixed coordinates).
 */
let layoutRects = false;

/** The pages that carry a canvas and text layer right now. */
const drawnPages = () =>
    Array.from(document.querySelectorAll(".react-pdf__Page")).map(el =>
        Number(el.getAttribute("data-page"))
    );

beforeAll(() => {
    global.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    Element.prototype.getBoundingClientRect = function (this: Element) {
        const page = Number((this as HTMLElement).dataset?.pdfPage ?? 0);
        if (!page || !layoutRects) return PAGE_BOX as DOMRect;
        const scroll = document.querySelector('[data-testid="pdf-scroll"]');
        const top = pageTop(page) - (scroll?.scrollTop ?? 0);
        return { ...PAGE_BOX, y: top, top, bottom: top + PAGE_HEIGHT } as DOMRect;
    };
    Range.prototype.getClientRects = () =>
        [
            { left: 60, top: 80, right: 300, bottom: 96, width: 240, height: 16 },
        ] as unknown as DOMRectList;
    Element.prototype.scrollIntoView = () => undefined;
    Element.prototype.scrollTo = function (this: Element, options?: ScrollToOptions | number) {
        if (typeof options === "object" && typeof options.top === "number") {
            (this as unknown as { __scrollTop: number }).__scrollTop = Math.max(0, options.top);
        }
    } as Element["scrollTo"];

    const pageOf = (el: HTMLElement) => Number(el.dataset.pdfPage ?? 0);
    const boxHeight = (el: HTMLElement) => {
        const sized = Number.parseFloat(el.style.height);
        return layoutRects && Number.isFinite(sized) && sized > 0 ? sized : PAGE_HEIGHT;
    };
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
        configurable: true,
        get(this: HTMLElement) {
            const page = pageOf(this);
            return page ? FIRST_PAGE_TOP + (page - 1) * (boxHeight(this) + PAGE_GAP) : 0;
        },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get(this: HTMLElement) {
            return pageOf(this) ? boxHeight(this) : 0;
        },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
        configurable: true,
        get(this: HTMLElement) {
            return pageOf(this) ? 600 : 0;
        },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        get(this: HTMLElement) {
            return this.dataset.testid === "pdf-scroll" ? VIEW_HEIGHT : 0;
        },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTop", {
        configurable: true,
        get(this: HTMLElement) {
            return (this as unknown as { __scrollTop?: number }).__scrollTop ?? 0;
        },
        set(this: HTMLElement, value: number) {
            (this as unknown as { __scrollTop: number }).__scrollTop = Math.max(0, value);
        },
    });
});

beforeEach(() => {
    mockPageScales.clear();
    mockPageTexts.clear();
    mockNumPages = 3;
    mockPageLabels = null;
    mockOutline = [];
    columnWidth = 1232;
    layoutRects = false;
    window.localStorage.clear();
});

const NOTE: PdfNoteLite = {
    id: 1,
    title: "Check this",
    page: 1,
    quads: [[0.1, 0.1, 0.5, 0.12]],
    quote: "Revenue grew",
};
const HIGHLIGHT: PdfNoteLite = {
    id: 2,
    title: null,
    page: 2,
    quads: [[0.1, 0.1, 0.5, 0.2]],
    quote: "Net revenue fell",
    highlight: "yellow",
};

function renderViewer(props: Partial<React.ComponentProps<typeof PdfViewerWithNotes>> = {}) {
    return render(
        <PdfViewerWithNotes
            url="/api/files/9"
            notes={[]}
            onCreateAnchoredNote={jest.fn()}
            downloadUrl="/api/files/9"
            downloadName="Handbook.pdf"
            {...props}
        />
    );
}

async function toolbar() {
    return within(await screen.findByTestId("pdf-toolbar"));
}

/** Scroll the pages to `top` the way a wheel would. */
function scrollPagesTo(top: number) {
    const scroll = screen.getByTestId("pdf-scroll");
    scroll.scrollTop = top;
    fireEvent.scroll(scroll);
}

describe("PdfViewerWithNotes toolbar", () => {
    it("shows where the reader is and how big the pages are drawn", async () => {
        renderViewer();
        const bar = await toolbar();

        expect(bar.getByLabelText("Page number")).toHaveValue("1");
        expect(bar.getByText("of 3")).toBeInTheDocument();
        // Automatic: fills the column, but never more than a quarter larger
        // than life — the column has room for 200%.
        expect(bar.getByTestId("pdf-zoom-level")).toHaveTextContent("125%");
        expect(mockPageScales.get(1)).toBe(1.25);
        expect(bar.getByRole("link", { name: "Download" })).toHaveAttribute(
            "download",
            "Handbook.pdf"
        );
    });

    it("zooms in and out a step at a time, redrawing the pages in view", async () => {
        renderViewer();
        const bar = await toolbar();

        fireEvent.click(bar.getByTestId("pdf-zoom-in"));
        await waitFor(() => expect(bar.getByTestId("pdf-zoom-level")).toHaveTextContent("150%"));
        expect([1, 2, 3].map(p => mockPageScales.get(p))).toEqual([1.5, 1.5, 1.5]);

        fireEvent.click(bar.getByTestId("pdf-zoom-out"));
        fireEvent.click(bar.getByTestId("pdf-zoom-out"));
        await waitFor(() => expect(bar.getByTestId("pdf-zoom-level")).toHaveTextContent("110%"));
    });

    it("fits the column's width on request, and back to automatic", async () => {
        renderViewer();
        const bar = await toolbar();

        fireEvent.click(bar.getByTestId("pdf-fit-width"));
        await waitFor(() => expect(bar.getByTestId("pdf-zoom-level")).toHaveTextContent("200%"));
        expect(bar.getByTestId("pdf-fit-width")).toHaveAttribute("aria-pressed", "true");

        fireEvent.click(bar.getByTestId("pdf-fit-width"));
        await waitFor(() => expect(bar.getByTestId("pdf-zoom-level")).toHaveTextContent("125%"));
    });

    it("shrinks a page to a narrow column on its own", async () => {
        columnWidth = 332; // 300px for a 600pt page
        renderViewer();
        const bar = await toolbar();

        await waitFor(() => expect(bar.getByTestId("pdf-zoom-level")).toHaveTextContent("50%"));
        // Too narrow for the secondary buttons.
        expect(bar.queryByTestId("pdf-fit-width")).not.toBeInTheDocument();
    });

    it("takes ⌘+, ⌘− and ⌘0 from the page", async () => {
        renderViewer();
        const bar = await toolbar();
        const scroll = screen.getByTestId("pdf-scroll");

        fireEvent.keyDown(scroll, { key: "=", metaKey: true });
        await waitFor(() => expect(bar.getByTestId("pdf-zoom-level")).toHaveTextContent("150%"));
        fireEvent.keyDown(scroll, { key: "=", ctrlKey: true });
        await waitFor(() => expect(bar.getByTestId("pdf-zoom-level")).toHaveTextContent("175%"));
        fireEvent.keyDown(scroll, { key: "0", metaKey: true });
        await waitFor(() => expect(bar.getByTestId("pdf-zoom-level")).toHaveTextContent("125%"));
    });

    it("zooms on a pinch (a wheel event with ctrlKey) instead of letting the app zoom", async () => {
        jest.useFakeTimers();
        try {
            renderViewer();
            await act(async () => {
                await Promise.resolve();
            });
            const scroll = screen.getByTestId("pdf-scroll");
            const wheel = new WheelEvent("wheel", {
                deltaY: -100,
                ctrlKey: true,
                cancelable: true,
                bubbles: true,
            });
            act(() => {
                scroll.dispatchEvent(wheel);
            });
            expect(wheel.defaultPrevented).toBe(true);
            act(() => {
                jest.advanceTimersByTime(120);
            });
            expect(screen.getByTestId("pdf-zoom-level")).toHaveTextContent("161%");
        } finally {
            jest.useRealTimers();
        }
    });

    it("moves a page with ← and → when the pages fit sideways", async () => {
        renderViewer();
        const bar = await toolbar();
        const scroll = screen.getByTestId("pdf-scroll");

        fireEvent.keyDown(scroll, { key: "ArrowRight" });
        await waitFor(() => expect(bar.getByLabelText("Page number")).toHaveValue("2"));
        expect(scroll.scrollTop).toBe(pageTop(2) - 12);
        fireEvent.keyDown(scroll, { key: "ArrowLeft" });
        await waitFor(() => expect(bar.getByLabelText("Page number")).toHaveValue("1"));
    });

    it("shows the document's own page labels and takes one in the box", async () => {
        mockPageLabels = ["i", "ii", "1"];
        renderViewer();
        const bar = await toolbar();

        await waitFor(() => expect(bar.getByLabelText("Page number")).toHaveValue("i"));
        expect(bar.getByTestId("pdf-page-count")).toHaveTextContent("(1 of 3)");

        const box = bar.getByLabelText("Page number");
        fireEvent.change(box, { target: { value: "1" } });
        fireEvent.keyDown(box, { key: "Enter" });
        await waitFor(() =>
            expect(bar.getByTestId("pdf-page-count")).toHaveTextContent("(3 of 3)")
        );
        expect(box).toHaveValue("1");

        fireEvent.change(box, { target: { value: "ii" } });
        fireEvent.keyDown(box, { key: "Enter" });
        await waitFor(() =>
            expect(bar.getByTestId("pdf-page-count")).toHaveTextContent("(2 of 3)")
        );
    });

    it("picks up where the reader left off, and keeps the place", async () => {
        window.localStorage.setItem(
            "pdf-view:doc-9",
            JSON.stringify({ page: 3, zoom: 0.5, contents: false })
        );
        renderViewer({ persistKey: "doc-9" });
        const bar = await toolbar();

        expect(bar.getByTestId("pdf-zoom-level")).toHaveTextContent("50%");
        await waitFor(() => expect(bar.getByLabelText("Page number")).toHaveValue("3"));
        expect(screen.getByTestId("pdf-scroll").scrollTop).toBe(pageTop(3) - 12);

        fireEvent.click(bar.getByTestId("pdf-zoom-in"));
        await waitFor(() =>
            expect(JSON.parse(window.localStorage.getItem("pdf-view:doc-9")!)).toMatchObject({
                page: 3,
                zoom: 0.67,
            })
        );
    });
});

describe("PdfViewerWithNotes pages in view", () => {
    it("draws only the pages near the view, the rest as blanks of their size", async () => {
        mockNumPages = 30;
        layoutRects = true;
        renderViewer();
        const bar = await toolbar();
        expect(bar.getByText("of 30")).toBeInTheDocument();

        // Every page has a box; only the first screenfuls carry a canvas.
        expect(document.querySelectorAll("[data-pdf-page]")).toHaveLength(30);
        await waitFor(() => expect(drawnPages()).toEqual([1, 2]));
        const blank = document.querySelector<HTMLElement>('[data-pdf-page="20"]')!;
        expect(blank.style.width).toBe("750px");
        expect(blank.style.height).toBe("1000px");

        // Scrolled to page 21: the pages around it are drawn and the first is not.
        scrollPagesTo(pageTop(21, 1.25));
        await waitFor(() => expect(bar.getByLabelText("Page number")).toHaveValue("21"));
        await waitFor(() => expect(drawnPages()).toEqual([20, 21, 22]));
    });

    it("keeps the page in view when the column changes width", async () => {
        mockNumPages = 30;
        layoutRects = true;
        renderViewer();
        const bar = await toolbar();
        scrollPagesTo(pageTop(21, 1.25));
        await waitFor(() => expect(bar.getByLabelText("Page number")).toHaveValue("21"));

        // Narrower: 600px for a 600pt page, so the pages shrink to 100% and
        // every offset moves — the view follows page 21 rather than staying
        // at a pixel that now belongs to page 26.
        resizeColumnTo(632);
        await waitFor(() => expect(bar.getByTestId("pdf-zoom-level")).toHaveTextContent("100%"));
        const scrollTop = screen.getByTestId("pdf-scroll").scrollTop;
        expect(scrollTop).toBeGreaterThanOrEqual(pageTop(21) - VIEW_HEIGHT / 3);
        expect(scrollTop).toBeLessThan(pageTop(22));
        await waitFor(() => expect(drawnPages()).toContain(21));
    });

    it("a zoom step redraws only the pages in view", async () => {
        mockNumPages = 30;
        layoutRects = true;
        renderViewer();
        const bar = await toolbar();
        await waitFor(() => expect(drawnPages()).toEqual([1, 2]));
        mockPageScales.clear();

        fireEvent.click(bar.getByTestId("pdf-zoom-in"));
        await waitFor(() => expect(bar.getByTestId("pdf-zoom-level")).toHaveTextContent("150%"));
        expect(Array.from(mockPageScales.keys()).sort((a, b) => a - b)).toEqual([1, 2]);
        expect(mockPageScales.get(2)).toBe(1.5);
    });
});

describe("PdfViewerWithNotes find", () => {
    it("opens on ⌘F, counts every match, and steps through them", async () => {
        renderViewer();
        await toolbar();

        fireEvent.keyDown(screen.getByTestId("pdf-scroll"), { key: "f", metaKey: true });
        const input = await screen.findByTestId("pdf-find-input");
        fireEvent.change(input, { target: { value: "revenue" } });

        // Two on each of the three pages.
        await waitFor(() =>
            expect(screen.getByTestId("pdf-find-count")).toHaveTextContent("1 of 6")
        );
        await waitFor(() =>
            expect(document.querySelectorAll('[data-find-hit="current"]')).toHaveLength(1)
        );
        expect(document.querySelectorAll("[data-find-hit]")).toHaveLength(6);

        fireEvent.keyDown(input, { key: "Enter" });
        expect(screen.getByTestId("pdf-find-count")).toHaveTextContent("2 of 6");
        fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
        fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
        expect(screen.getByTestId("pdf-find-count")).toHaveTextContent("6 of 6");

        fireEvent.keyDown(input, { key: "Escape" });
        expect(screen.queryByTestId("pdf-find-input")).not.toBeInTheDocument();
        expect(document.querySelectorAll("[data-find-hit]")).toHaveLength(0);
    });

    it("says when there is nothing to find", async () => {
        renderViewer();
        fireEvent.click((await toolbar()).getByTestId("pdf-find-toggle"));
        fireEvent.change(await screen.findByTestId("pdf-find-input"), {
            target: { value: "ebitda" },
        });
        await waitFor(() =>
            expect(screen.getByTestId("pdf-find-count")).toHaveTextContent("No matches")
        );
    });

    it("finds a word on a page that is not drawn, and goes there", async () => {
        mockNumPages = 30;
        mockPageTexts.set(17, "A unicorn appears on this page only.");
        renderViewer();
        await toolbar();
        await waitFor(() => expect(drawnPages()).toEqual([1, 2, 3]));

        fireEvent.click(screen.getByTestId("pdf-find-toggle"));
        fireEvent.change(await screen.findByTestId("pdf-find-input"), {
            target: { value: "unicorn" },
        });
        await waitFor(() =>
            expect(screen.getByTestId("pdf-find-count")).toHaveTextContent("1 of 1")
        );
        // The viewer went to page 17, which drew and marked the match.
        await waitFor(() => expect(drawnPages()).toContain(17));
        await waitFor(() =>
            expect(document.querySelectorAll('[data-find-hit="current"]')).toHaveLength(1)
        );
        const scrollTop = screen.getByTestId("pdf-scroll").scrollTop;
        expect(scrollTop).toBeGreaterThanOrEqual(pageTop(17) - 12 - VIEW_HEIGHT / 3);
        expect(scrollTop).toBeLessThan(pageTop(18));
        expect(screen.getByTestId("pdf-toolbar").querySelector("input")).toHaveValue("17");
    });
});

describe("PdfViewerWithNotes contents", () => {
    it("opens the contents panel from the toolbar and jumps from a thumbnail", async () => {
        renderViewer();
        const bar = await toolbar();
        expect(screen.queryByTestId("pdf-contents")).not.toBeInTheDocument();

        fireEvent.click(bar.getByTestId("pdf-contents-toggle"));
        const panel = within(await screen.findByTestId("pdf-contents"));
        expect(bar.getByTestId("pdf-contents-toggle")).toHaveAttribute("aria-pressed", "true");
        const thumbs = panel.getAllByTestId("pdf-thumb");
        expect(thumbs).toHaveLength(3);
        expect(thumbs[0]).toHaveAttribute("aria-current", "page");

        fireEvent.click(thumbs[2]!);
        await waitFor(() => expect(bar.getByLabelText("Page number")).toHaveValue("3"));
        expect(panel.getAllByTestId("pdf-thumb")[2]).toHaveAttribute("aria-current", "page");
        // Beside the pages in a wide column: still open after the jump.
        expect(screen.getByTestId("pdf-contents")).toBeInTheDocument();

        fireEvent.click(panel.getByTestId("pdf-contents-close"));
        expect(screen.queryByTestId("pdf-contents")).not.toBeInTheDocument();
    });

    it("lists the outline and goes to a chapter", async () => {
        mockOutline = [
            { title: "Chapter 2", dest: [{ num: 2 }], items: [] },
            { title: "Chapter 3", dest: [{ num: 3 }], items: [] },
        ];
        renderViewer();
        const bar = await toolbar();
        fireEvent.click(bar.getByTestId("pdf-contents-toggle"));
        const panel = within(await screen.findByTestId("pdf-contents"));
        fireEvent.click(panel.getByTestId("pdf-contents-tab-outline"));

        const items = await panel.findAllByTestId("pdf-outline-item");
        expect(items.map(el => el.textContent)).toEqual(["Chapter 22", "Chapter 33"]);
        fireEvent.click(panel.getByText("Chapter 3"));
        await waitFor(() => expect(bar.getByLabelText("Page number")).toHaveValue("3"));
        await waitFor(() =>
            expect(panel.getAllByTestId("pdf-outline-item")[1]).toHaveAttribute(
                "aria-current",
                "true"
            )
        );
    });

    it("floats over the pages in a narrow column and closes after a jump", async () => {
        columnWidth = 560;
        renderViewer();
        const bar = await toolbar();
        fireEvent.click(bar.getByTestId("pdf-contents-toggle"));
        const dock = await screen.findByTestId("pdf-contents-dock");
        expect(dock).toHaveAttribute("data-overlay", "true");

        fireEvent.click(within(dock).getAllByTestId("pdf-thumb")[1]!);
        await waitFor(() => expect(bar.getByLabelText("Page number")).toHaveValue("2"));
        expect(screen.queryByTestId("pdf-contents")).not.toBeInTheDocument();
    });
});

describe("PdfViewerWithNotes citations", () => {
    it("goes to the page that holds a cited passage, drawn or not", async () => {
        mockNumPages = 30;
        mockPageTexts.set(12, "The gross margin improved for the third year running.");
        const { rerender } = renderViewer();
        await toolbar();
        await waitFor(() => expect(drawnPages()).toEqual([1, 2, 3]));

        rerender(
            <PdfViewerWithNotes
                url="/api/files/9"
                notes={[]}
                onCreateAnchoredNote={jest.fn()}
                citationHighlight={{
                    text: "gross margin improved for the third year",
                    page: null,
                    nonce: 1,
                }}
            />
        );
        await waitFor(() => expect(drawnPages()).toContain(12));
        await waitFor(() =>
            expect(
                document.querySelector('[data-pdf-page="12"] [class*="outline"]')
            ).toBeInTheDocument()
        );
        expect(screen.getByTestId("pdf-toolbar").querySelector("input")).toHaveValue("12");
    });
});

describe("PdfViewerWithNotes highlights", () => {
    it("draws a highlight in its colour with no pin, and numbers only the notes", async () => {
        renderViewer({ notes: [NOTE, HIGHLIGHT] });

        await waitFor(() =>
            expect(document.querySelector('[data-highlight="yellow"]')).toBeInTheDocument()
        );
        // One pin on the pages — the note's — titled with it and numbered 1.
        const pins = document.querySelectorAll("[data-pdf-page] button");
        expect(pins).toHaveLength(1);
        expect(screen.getByTitle("Check this")).toHaveTextContent("1");
    });

    it("places a note a new version moved by finding its quote", async () => {
        const moved: PdfNoteLite = { ...HIGHLIGHT, id: 3, quads: [], page: 1 };
        renderViewer({ notes: [moved] });

        await waitFor(() =>
            expect(document.querySelector('[data-note-id="3"]')).toBeInTheDocument()
        );
    });

    it("finds a moved note's quote on a page that is not drawn", async () => {
        mockNumPages = 30;
        mockPageTexts.set(25, "Cash runway stands at nineteen months.");
        const moved: PdfNoteLite = {
            id: 4,
            title: null,
            page: 2,
            quads: [],
            quote: "Cash runway stands at nineteen months",
            highlight: "green",
        };
        renderViewer({ notes: [moved], scrollToNoteId: 4 });
        await toolbar();

        // The note is placed once its page is drawn — here, by scrolling to it.
        scrollPagesTo(pageTop(25));
        await waitFor(() =>
            expect(
                document.querySelector('[data-pdf-page="25"] [data-note-id="4"]')
            ).toBeInTheDocument()
        );
    });

    it("offers its colours and Remove when a highlight is clicked", async () => {
        const onRecolorHighlight = jest.fn();
        const onRemoveHighlight = jest.fn();
        renderViewer({ notes: [HIGHLIGHT], onRecolorHighlight, onRemoveHighlight });
        await waitFor(() =>
            expect(document.querySelector('[data-highlight="yellow"]')).toBeInTheDocument()
        );

        const page2 = document.querySelector('[data-pdf-page="2"]')!;
        // Inside the quad: 0.1–0.5 across, 0.1–0.2 down a 600×800 page.
        fireEvent.click(page2, { clientX: 120, clientY: 120 });
        const menu = within(await screen.findByTestId("pdf-highlight-menu"));
        expect(menu.getByRole("button", { name: "Highlight in yellow" })).toHaveAttribute(
            "aria-pressed",
            "true"
        );
        fireEvent.click(menu.getByRole("button", { name: "Highlight in green" }));
        expect(onRecolorHighlight).toHaveBeenCalledWith(2, "green");

        fireEvent.click(page2, { clientX: 120, clientY: 120 });
        fireEvent.click(
            within(await screen.findByTestId("pdf-highlight-menu")).getByRole("menuitem", {
                name: "Remove",
            })
        );
        expect(onRemoveHighlight).toHaveBeenCalledWith(2);
    });

    it("ignores a click on the page away from any highlight", async () => {
        renderViewer({ notes: [HIGHLIGHT], onRemoveHighlight: jest.fn() });
        await waitFor(() =>
            expect(document.querySelector('[data-highlight="yellow"]')).toBeInTheDocument()
        );

        fireEvent.click(document.querySelector('[data-pdf-page="2"]')!, {
            clientX: 500,
            clientY: 700,
        });
        expect(screen.queryByTestId("pdf-highlight-menu")).not.toBeInTheDocument();
    });

    it("marks a selection in the colour picked from the selection popup", async () => {
        const onCreateHighlight = jest.fn();
        renderViewer({ onCreateHighlight });
        await toolbar();

        const span = document.querySelector(
            '[data-pdf-page="1"] .react-pdf__Page__textContent span'
        )!;
        const range = document.createRange();
        range.setStart(span.firstChild!, 0);
        range.setEnd(span.firstChild!, "Revenue grew strongly".length);
        const scroll = screen.getByTestId("pdf-scroll");

        // A drag: press, the selection changes, release.
        act(() => {
            scroll.dispatchEvent(
                Object.assign(new MouseEvent("pointerdown", { bubbles: true, button: 0 }), {
                    isPrimary: true,
                })
            );
            const selection = window.getSelection()!;
            selection.removeAllRanges();
            selection.addRange(range);
            document.dispatchEvent(new Event("selectionchange"));
            document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
        });

        fireEvent.click(await screen.findByRole("button", { name: "Highlight in blue" }));
        expect(onCreateHighlight).toHaveBeenCalledWith({
            page: 1,
            quads: [[0.1, 0.1, 0.5, 0.12]],
            quote: { exact: "Revenue grew strongly" },
            color: "blue",
        });
    });
});
