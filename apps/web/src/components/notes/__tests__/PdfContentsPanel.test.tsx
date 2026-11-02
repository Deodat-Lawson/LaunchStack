/** @jest-environment jsdom */

import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import { PdfContentsPanel, type PdfContentsPanelProps } from "../PdfContentsPanel";
import type { PdfOutlineNode } from "../_shared/pdfOutline";

/**
 * The Contents strip over a stand-in for react-pdf: a thumbnail is a box
 * that records which page and width it was asked for.
 */

jest.mock("react-pdf", () => ({
    Thumbnail: ({ pageNumber, width }: { pageNumber: number; width: number }) => (
        <div data-mock-thumb data-page={pageNumber} data-width={width} />
    ),
}));

const PDF = { fake: true };

const OUTLINE: PdfOutlineNode[] = [
    {
        id: "0",
        title: "Table of Contents",
        page: 1,
        children: [
            {
                id: "0.0",
                title: "Part I",
                page: 1,
                children: [
                    { id: "0.0.0", title: "Chapter 1", page: 1, children: [] },
                    {
                        id: "0.0.1",
                        title: "Chapter 2",
                        page: 4,
                        children: [{ id: "0.0.1.0", title: "Section 2.1", page: 5, children: [] }],
                    },
                ],
            },
            { id: "0.1", title: "Part II", page: 8, children: [] },
            { id: "0.2", title: "Unplaced", page: null, children: [] },
        ],
    },
];

function renderPanel(props: Partial<PdfContentsPanelProps> = {}) {
    const all: PdfContentsPanelProps = {
        pdf: PDF,
        numPages: 10,
        currentPage: 1,
        pageLabels: null,
        outline: OUTLINE,
        tab: "thumbnails",
        onTabChange: jest.fn(),
        onGoToPage: jest.fn(),
        onClose: jest.fn(),
        width: 200,
        ...props,
    };
    return { ...render(<PdfContentsPanel {...all} />), props: all };
}

const items = () => screen.getAllByTestId("pdf-outline-item");
const titles = () => items().map(row => row.querySelector(".truncate")?.textContent);

describe("PdfContentsPanel thumbnails", () => {
    it("lists every page, marks the current one and goes to a clicked one", () => {
        const { props } = renderPanel({ currentPage: 3, pageLabels: ["i", "ii", "1", "2"] });

        const thumbs = screen.getAllByTestId("pdf-thumb");
        expect(thumbs).toHaveLength(10);
        expect(thumbs[2]).toHaveAttribute("aria-current", "page");
        expect(thumbs[0]).not.toHaveAttribute("aria-current");
        expect(thumbs[0]).toHaveAccessibleName("Page i");
        expect(thumbs[4]).toHaveAccessibleName("Page 5");
        expect(within(thumbs[2]!).getByText("1")).toBeInTheDocument();

        fireEvent.click(thumbs[6]!);
        expect(props.onGoToPage).toHaveBeenCalledWith(7);
    });

    it("draws every page at the strip's width when nothing can observe the viewport", () => {
        renderPanel({ width: 180 });
        const drawn = document.querySelectorAll("[data-mock-thumb]");
        expect(drawn).toHaveLength(10);
        // 180 less the list's and the item's padding.
        expect(drawn[0]).toHaveAttribute("data-width", "156");
    });

    it("draws only the pages near the viewport, and keeps them once drawn", () => {
        const observed: { el: Element; cb: IntersectionObserverCallback }[] = [];
        class FakeIntersectionObserver {
            constructor(private readonly cb: IntersectionObserverCallback) {}
            observe(el: Element) {
                observed.push({ el, cb: this.cb });
            }
            unobserve() {}
            disconnect() {}
        }
        global.IntersectionObserver =
            FakeIntersectionObserver as unknown as typeof IntersectionObserver;
        try {
            renderPanel();
            expect(document.querySelectorAll("[data-mock-thumb]")).toHaveLength(0);
            expect(observed).toHaveLength(10);

            const reveal = (index: number, isIntersecting: boolean) =>
                act(() => {
                    const { el, cb } = observed[index]!;
                    cb(
                        [{ isIntersecting, target: el } as IntersectionObserverEntry],
                        {} as IntersectionObserver
                    );
                });
            reveal(0, true);
            reveal(1, true);
            reveal(2, false);
            const drawn = document.querySelectorAll("[data-mock-thumb]");
            expect(Array.from(drawn, el => el.getAttribute("data-page"))).toEqual(["1", "2"]);

            // Leaving again changes nothing: a drawn page stays drawn.
            reveal(0, false);
            expect(document.querySelectorAll("[data-mock-thumb]")).toHaveLength(2);
        } finally {
            // @ts-expect-error -- jsdom has none; put it back that way.
            delete global.IntersectionObserver;
        }
    });

    it("waits for the document before drawing anything", () => {
        renderPanel({ pdf: null });
        expect(screen.getAllByTestId("pdf-thumb")).toHaveLength(10);
        expect(document.querySelectorAll("[data-mock-thumb]")).toHaveLength(0);
    });
});

describe("PdfContentsPanel outline", () => {
    it("says when the outline is still being read, and when there is none", () => {
        const { rerender, props } = renderPanel({ tab: "outline", outline: null });
        expect(screen.getByTestId("pdf-outline-loading")).toHaveTextContent("Reading the outline…");

        rerender(<PdfContentsPanel {...props} outline={[]} />);
        expect(screen.getByTestId("pdf-outline-empty")).toHaveTextContent(
            "This document has no outline"
        );
        expect(screen.queryAllByTestId("pdf-outline-item")).toHaveLength(0);
    });

    it("drops a lone wrapper node, opens the top level and closes the rest", () => {
        renderPanel({ tab: "outline", currentPage: 1, pageLabels: ["i", "ii", "1", "2", "3"] });

        // "Table of Contents" is gone; Part I is open (top level), Chapter 2 is closed.
        expect(titles()).toEqual(["Part I", "Chapter 1", "Chapter 2", "Part II", "Unplaced"]);
        const partI = items()[0]!;
        expect(partI).toHaveAttribute("aria-expanded", "true");
        expect(items()[2]).toHaveAttribute("aria-expanded", "false");
        expect(items()[1]).not.toHaveAttribute("aria-expanded");

        // Page labels on the right, none for an unplaced node.
        expect(within(items()[2]!).getByText("2")).toHaveClass("tabular-nums");
        expect(items()[4]).not.toHaveAttribute("data-page");
    });

    it("marks the chapter the reader is in and opens the way to it", () => {
        const { rerender, props } = renderPanel({ tab: "outline", currentPage: 3 });
        expect(screen.getByText("Chapter 1").closest('[role="treeitem"]')).toHaveAttribute(
            "aria-current",
            "true"
        );
        expect(screen.queryByText("Section 2.1")).not.toBeInTheDocument();

        rerender(<PdfContentsPanel {...props} currentPage={6} />);
        const section = screen.getByText("Section 2.1").closest('[role="treeitem"]');
        expect(section).toHaveAttribute("aria-current", "true");
        expect(screen.getByText("Chapter 2").closest('[role="treeitem"]')).toHaveAttribute(
            "aria-expanded",
            "true"
        );
        expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
    });

    it("reopens a chapter the reader closed when the current page moves into it", () => {
        const { rerender, props } = renderPanel({ tab: "outline", currentPage: 1 });
        fireEvent.click(within(items()[0]!).getByTestId("pdf-outline-toggle"));
        expect(titles()).toEqual(["Part I", "Part II", "Unplaced"]);

        rerender(<PdfContentsPanel {...props} currentPage={5} />);
        expect(titles()).toEqual([
            "Part I",
            "Chapter 1",
            "Chapter 2",
            "Section 2.1",
            "Part II",
            "Unplaced",
        ]);
    });

    it("navigates on click, Enter and Space, and ignores a node with no page", () => {
        const { props } = renderPanel({ tab: "outline" });

        fireEvent.click(screen.getByText("Part II"));
        expect(props.onGoToPage).toHaveBeenLastCalledWith(8);

        fireEvent.keyDown(items()[2]!, { key: "Enter" });
        expect(props.onGoToPage).toHaveBeenLastCalledWith(4);
        fireEvent.keyDown(items()[1]!, { key: " " });
        expect(props.onGoToPage).toHaveBeenLastCalledWith(1);

        (props.onGoToPage as jest.Mock).mockClear();
        fireEvent.click(screen.getByText("Unplaced"));
        expect(props.onGoToPage).not.toHaveBeenCalled();
    });

    it("opens and closes with the chevron and the arrow keys", () => {
        const { props } = renderPanel({ tab: "outline" });
        const chapter2 = () =>
            screen.getByText("Chapter 2").closest<HTMLElement>('[role="treeitem"]')!;

        const toggle = within(chapter2()).getByRole("button", { name: "Open Chapter 2" });
        fireEvent.click(toggle);
        expect(screen.getByText("Section 2.1")).toBeInTheDocument();
        expect(
            within(chapter2()).getByRole("button", { name: "Close Chapter 2" })
        ).toBeInTheDocument();
        // The chevron does not navigate.
        expect(props.onGoToPage).not.toHaveBeenCalled();

        fireEvent.keyDown(chapter2(), { key: "ArrowLeft" });
        expect(screen.queryByText("Section 2.1")).not.toBeInTheDocument();
        fireEvent.keyDown(chapter2(), { key: "ArrowRight" });
        expect(screen.getByText("Section 2.1")).toBeInTheDocument();
    });

    it("moves focus between visible rows with the arrow keys", () => {
        renderPanel({ tab: "outline" });
        items()[0]!.focus();
        fireEvent.keyDown(items()[0]!, { key: "ArrowDown" });
        expect(items()[1]).toHaveFocus();
        fireEvent.keyDown(items()[1]!, { key: "ArrowUp" });
        expect(items()[0]).toHaveFocus();
    });
});

describe("PdfContentsPanel chrome", () => {
    it("shows which tab is on and asks the viewer to switch", () => {
        const { props } = renderPanel({ tab: "thumbnails" });
        expect(screen.getByTestId("pdf-contents")).toHaveStyle({ width: "200px" });
        expect(screen.getByTestId("pdf-contents-tab-thumbnails")).toHaveAttribute(
            "aria-pressed",
            "true"
        );
        expect(screen.getByTestId("pdf-contents-tab-outline")).toHaveAttribute(
            "aria-pressed",
            "false"
        );

        fireEvent.click(screen.getByTestId("pdf-contents-tab-outline"));
        expect(props.onTabChange).toHaveBeenCalledWith("outline");
        // The viewer owns the tab: nothing moves until it says so.
        expect(screen.getAllByTestId("pdf-thumb")).toHaveLength(10);
    });

    it("hides on the close button", () => {
        const { props } = renderPanel();
        fireEvent.click(screen.getByRole("button", { name: "Hide contents" }));
        expect(props.onClose).toHaveBeenCalledTimes(1);
    });
});
