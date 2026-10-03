/** @jest-environment jsdom */

/**
 * Tool tabs are hidden, not unmounted. The Companies screen's triage keys
 * (j/k/x/Enter/o) listen on `window`, so a hidden Growth tab would move its
 * list while the person types in another tab unless the listener checks
 * that its tab is the active one. This mounts the real Companies screen in
 * the real tool and flips the tab between active and hidden.
 */

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import type * as ProspectsApiModule from "~/app/employer/tools/growth/prospects/api";
import type { CompanyRow } from "~/app/employer/tools/growth/prospects/api";

function mockRow(id: string, name: string): CompanyRow {
    return {
        id,
        name,
        domain: `${id}.example`,
        hq: "Rotterdam, NL",
        country: "NL",
        sizeBand: "50-200",
        archetype: "Fulfilment operator",
        why: "Runs three warehouses with manual picking.",
        fit: 80,
        fitThreshold: 60,
        stage: "lead",
        staleDays: null,
        people: 2,
        lastActivityAt: null,
        foundVia: [],
        isNew: false,
        excluded: false,
        excludedReason: null,
    };
}

// Campaigns embeds the marketing generator, which imports a CSS module jest
// cannot parse; it is not on screen here.
jest.mock("~/app/employer/tools/growth/brand/_screens/CampaignsScreen", () => ({
    CampaignsScreen: () => null,
}));

jest.mock("~/app/employer/tools/growth/prospects/api", () => {
    const actual = jest.requireActual<typeof ProspectsApiModule>(
        "~/app/employer/tools/growth/prospects/api"
    );
    return {
        ...actual,
        prospectsApi: {
            ...actual.prospectsApi,
            segments: jest.fn(async () => ({
                segments: [
                    {
                        id: "seg-1",
                        name: "Fulfilment operators",
                        subtitle: "NL",
                        headline: "Fulfilment operators in NL",
                        status: "confirmed",
                        counts: { companies: 2, people: 4, deals: 0, sources: 3 },
                    },
                ],
            })),
            runs: jest.fn(async () => ({ runs: [] })),
            companies: jest.fn(async () => ({
                companies: [mockRow("a", "Alpha Fulfilment"), mockRow("b", "Beta Logistics")],
                counts: { all: 2, new: 0, highfit: 2, uncontacted: 2, excluded: 0 },
            })),
        },
    };
});

import { GrowthTool } from "~/app/employer/tools/growth/GrowthTool";

function focusedRow(): string | null {
    const rows = document.querySelectorAll<HTMLElement>("[data-row-index]");
    for (const row of rows) {
        if (row.className.includes("outline-brand")) return row.dataset.rowIndex ?? null;
    }
    return null;
}

// jsdom has no layout; the screen scrolls the cursor's row into view.
beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
});

describe("Growth keyboard shortcuts in a tab", () => {
    it("move the Companies cursor only while the tab is active", async () => {
        const request = { at: "/prospects/companies", nonce: 1 };
        const { rerender } = render(<GrowthTool host={{ active: true, request }} />);
        // The whole tab mounts here (frame, provider, screen); under a busy
        // full-suite run that takes longer than findBy's 1s default.
        expect(
            await screen.findByText("Alpha Fulfilment", undefined, { timeout: 10_000 })
        ).toBeInTheDocument();

        fireEvent.keyDown(window, { key: "j" });
        expect(focusedRow()).toBe("0");

        // The person switches to another tab: this one stays mounted, hidden.
        rerender(<GrowthTool host={{ active: false, request }} />);
        fireEvent.keyDown(window, { key: "j" });
        expect(focusedRow()).toBe("0");

        rerender(<GrowthTool host={{ active: true, request }} />);
        await act(async () => {});
        fireEvent.keyDown(window, { key: "j" });
        expect(focusedRow()).toBe("1");
    }, 20_000);
});
