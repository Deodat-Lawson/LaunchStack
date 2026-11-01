/** @jest-environment jsdom */

import React, { type ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import { PdfViewerWithNotes, type PdfNoteLite } from "../PdfViewerWithNotes";

/**
 * The viewer's own controls — zoom, page, find, highlights — over a stand-in
 * for react-pdf: three pages whose text layer is plain spans, at whatever
 * scale the viewer asks for. Layout is faked too: jsdom measures nothing, so
 * every box reports a 600×800 page and every text range one small rect.
 */

const mockPageText = "Revenue grew strongly. Net revenue fell in the fourth quarter.";

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
                    numPages: 3,
                    getPage: () =>
                        Promise.resolve({
                            getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale }),
                        }),
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
                <div className="react-pdf__Page" data-scale={scale}>
                    <div className="react-pdf__Page__textContent">
                        <span>{mockPageText}</span>
                    </div>
                </div>
            );
        },
    };
});

/** What the column measures, for "fit to width": 1232px leaves 1200 for a 600pt page. */
let columnWidth = 1232;
class FakeResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() {
        this.callback(
            [{ contentRect: { width: columnWidth } } as ResizeObserverEntry],
            this as unknown as ResizeObserver
        );
    }
    unobserve() {}
    disconnect() {}
}

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

beforeAll(() => {
    global.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    Element.prototype.getBoundingClientRect = () => PAGE_BOX as DOMRect;
    Range.prototype.getClientRects = () =>
        [
            { left: 60, top: 80, right: 300, bottom: 96, width: 240, height: 16 },
        ] as unknown as DOMRectList;
    Element.prototype.scrollIntoView = () => undefined;
    Element.prototype.scrollTo = () => undefined;
});

beforeEach(() => {
    mockPageScales.clear();
    columnWidth = 1232;
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

describe("PdfViewerWithNotes toolbar", () => {
    it("shows where the reader is and how big the pages are drawn", async () => {
        renderViewer();
        const bar = await toolbar();

        expect(bar.getByLabelText("Page number")).toHaveValue("1");
        expect(bar.getByText("of 3")).toBeInTheDocument();
        // Automatic: the page's natural size when the column has room for it.
        expect(bar.getByTestId("pdf-zoom-level")).toHaveTextContent("100%");
        expect(mockPageScales.get(1)).toBe(1);
        expect(bar.getByRole("link", { name: "Download" })).toHaveAttribute(
            "download",
            "Handbook.pdf"
        );
    });

    it("zooms in and out a step at a time, redrawing every page", async () => {
        renderViewer();
        const bar = await toolbar();

        fireEvent.click(bar.getByTestId("pdf-zoom-in"));
        await waitFor(() => expect(bar.getByTestId("pdf-zoom-level")).toHaveTextContent("110%"));
        expect([1, 2, 3].map(p => mockPageScales.get(p))).toEqual([1.1, 1.1, 1.1]);

        fireEvent.click(bar.getByTestId("pdf-zoom-out"));
        fireEvent.click(bar.getByTestId("pdf-zoom-out"));
        await waitFor(() => expect(bar.getByTestId("pdf-zoom-level")).toHaveTextContent("90%"));
    });

    it("fits the column's width on request, and back to automatic", async () => {
        renderViewer();
        const bar = await toolbar();

        fireEvent.click(bar.getByTestId("pdf-fit-width"));
        await waitFor(() => expect(bar.getByTestId("pdf-zoom-level")).toHaveTextContent("200%"));
        expect(bar.getByTestId("pdf-fit-width")).toHaveAttribute("aria-pressed", "true");

        fireEvent.click(bar.getByTestId("pdf-fit-width"));
        await waitFor(() => expect(bar.getByTestId("pdf-zoom-level")).toHaveTextContent("100%"));
    });

    it("never grows a page past its natural size on its own in a narrow column", async () => {
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
        await waitFor(() => expect(bar.getByTestId("pdf-zoom-level")).toHaveTextContent("110%"));
        fireEvent.keyDown(scroll, { key: "=", ctrlKey: true });
        await waitFor(() => expect(bar.getByTestId("pdf-zoom-level")).toHaveTextContent("125%"));
        fireEvent.keyDown(scroll, { key: "0", metaKey: true });
        await waitFor(() => expect(bar.getByTestId("pdf-zoom-level")).toHaveTextContent("100%"));
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
            expect(screen.getByTestId("pdf-zoom-level")).toHaveTextContent("128%");
        } finally {
            jest.useRealTimers();
        }
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
