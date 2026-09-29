/** @jest-environment jsdom */

/**
 * The document header in every width a column can be dragged to.
 *
 * It used to lay everything out regardless of room: at 209px "Ask about this"
 * wrapped to three lines over the save state and the title was 8px wide.
 * These pin the two promises that replaced that — the row never needs more
 * than it has, and nothing is ever lost, only moved into "More".
 */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import {
    DocumentViewerHeader,
    type HeaderAction,
    headerTier,
    headerWidthFor,
    placeHeaderActions,
} from "../DocumentViewerHeader";

/** A fixed glyph width, so the tiers do not depend on the test runner's fonts. */
const measure = (label: string) => label.length * 7;

const noop = () => undefined;

const PDF_ACTIONS: HeaderAction[] = [
    { id: "ask", label: "Ask about this", icon: null, onSelect: noop },
    { id: "restrict", label: "Restrict access", icon: null, onSelect: noop, iconOnly: true },
    {
        id: "delete",
        label: "Delete document",
        icon: null,
        onSelect: noop,
        iconOnly: true,
        tone: "danger",
    },
];

/** The most a header ever carries: a map that can be edited and published. */
const MAP_ACTIONS: HeaderAction[] = [
    { id: "edit", label: "Edit", icon: null, onSelect: noop, tone: "primary" },
    { id: "publish", label: "Update citable copy", icon: null, onSelect: noop },
    ...PDF_ACTIONS,
];

const WIDTHS = Array.from({ length: 200 }, (_, i) => 100 + i * 8);

describe("headerTier", () => {
    it("assumes room before the viewer has been measured", () => {
        expect(headerTier(0, MAP_ACTIONS, true, measure)).toBe("full");
    });

    it.each([
        ["a PDF in a column", PDF_ACTIONS, false],
        ["a PDF in the full-screen preview", PDF_ACTIONS, true],
        ["a map in a column", MAP_ACTIONS, false],
        ["a map in the full-screen preview", MAP_ACTIONS, true],
    ])("never chooses a tier wider than the header, for %s", (_name, actions, hasBack) => {
        for (const width of WIDTHS) {
            const tier = headerTier(width, actions, hasBack, measure);
            // "tiny" is the floor; everything above it must genuinely fit.
            if (tier !== "tiny") {
                expect(headerWidthFor(tier, actions, hasBack, measure)).toBeLessThanOrEqual(width);
            }
        }
    });

    it("only ever steps down as the column narrows", () => {
        const order = ["full", "narrow", "icons", "compact", "tiny"];
        let last = 0;
        for (const width of [...WIDTHS].reverse()) {
            const rank = order.indexOf(headerTier(width, MAP_ACTIONS, false, measure));
            expect(rank).toBeGreaterThanOrEqual(last);
            last = rank;
        }
    });

    it("keeps the labelled Ask on a PDF at a width where a map has to give up its labels", () => {
        // A PDF has one labelled button and a map three, so a fixed width
        // threshold would strip the PDF's label for the map's sake.
        const width = 560;
        expect(headerTier(width, PDF_ACTIONS, false, measure)).toMatch(/full|narrow/);
        expect(headerTier(width, MAP_ACTIONS, false, measure)).toBe("icons");
    });

    it("reaches the floor at the narrowest column the split allows", () => {
        expect(headerTier(130, MAP_ACTIONS, false, measure)).toBe("tiny");
    });
});

describe("placeHeaderActions", () => {
    it.each(["full", "narrow", "icons", "compact", "tiny"] as const)(
        "loses no action at %s — each is in the row or in More",
        tier => {
            const { inline, overflow } = placeHeaderActions(MAP_ACTIONS, tier);
            expect([...inline, ...overflow].map(a => a.id).sort()).toEqual(
                MAP_ACTIONS.map(a => a.id).sort()
            );
        }
    );

    it("keeps the document's main action in the row when compact", () => {
        expect(placeHeaderActions(MAP_ACTIONS, "compact").inline.map(a => a.id)).toEqual(["edit"]);
        expect(placeHeaderActions(PDF_ACTIONS, "compact").inline.map(a => a.id)).toEqual(["ask"]);
    });

    it("moves the versions-and-notes toggle into More only at the floor", () => {
        expect(placeHeaderActions(PDF_ACTIONS, "compact").toggleInline).toBe(true);
        expect(placeHeaderActions(PDF_ACTIONS, "tiny").toggleInline).toBe(false);
    });
});

describe("DocumentViewerHeader", () => {
    function renderAt(width: number, onToggle = jest.fn(), visible = true) {
        render(
            <DocumentViewerHeader
                width={width}
                kindIcon={null}
                kindColor="var(--ink)"
                title={<input aria-label="Title" defaultValue="selection-test.pdf" />}
                meta={<span>File</span>}
                status={{ text: "Saved", color: "var(--ok)" }}
                actions={PDF_ACTIONS}
                details={{ visible, onToggle }}
            />
        );
        return onToggle;
    }

    it("shows the labelled Ask and the kind at full width", () => {
        renderAt(1200);
        expect(screen.getByRole("button", { name: /Ask about this/ })).toHaveTextContent(
            "Ask about this"
        );
        expect(screen.getByText("File")).toBeInTheDocument();
        expect(screen.queryByTestId("viewer-more")).not.toBeInTheDocument();
    });

    it("says what the toggle will do, and reports its state", () => {
        const onToggle = renderAt(1200, jest.fn(), true);
        const toggle = screen.getByTestId("viewer-details-toggle");
        expect(toggle).toHaveAccessibleName("Hide versions and notes");
        expect(toggle).toHaveAttribute("aria-pressed", "true");
        fireEvent.click(toggle);
        expect(onToggle).toHaveBeenCalled();
    });

    it("offers More, not a clipped row, once the column is narrow", () => {
        renderAt(300);
        expect(screen.getByTestId("viewer-more")).toBeInTheDocument();
        // Ask stays; the lock and the bin moved into More.
        expect(screen.getByRole("button", { name: "Ask about this" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Delete document" })).not.toBeInTheDocument();
    });
});
