/** @jest-environment jsdom */

/**
 * A tool's screens are tabs across the top of its tab, so the workspace
 * sidebar (Sources, History) stays the only sidebar. A tool with many
 * screens in labelled groups switches groups, and each group comes back to
 * the screen it was last on.
 */

import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import { ToolFrame, type ToolNavGroup } from "~/components/tool-app/ToolFrame";
import { ToolNavProvider, useToolPathname } from "~/components/tool-app/nav";

// Radix measures itself; jsdom has no ResizeObserver.
global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

function Here() {
    return <output data-testid="here">{useToolPathname()}</output>;
}

function mount(groups: ToolNavGroup[], roots: string[], home = "/") {
    return render(
        <ToolNavProvider toolId="example" roots={roots} home={home}>
            <ToolFrame title="Example" mark={<span />} groups={groups}>
                <Here />
            </ToolFrame>
        </ToolNavProvider>
    );
}

const here = () => screen.getByTestId("here").textContent;
const screens = () => screen.getByRole("navigation", { name: "Example screens" });

describe("ToolFrame", () => {
    it("puts a small tool's screens in one row of tabs, with no sidebar of its own", () => {
        mount(
            [
                {
                    id: "week",
                    label: "The week",
                    items: [
                        { to: "/", label: "This week", exact: true },
                        { to: "/agenda", label: "Agenda" },
                    ],
                },
                {
                    id: "capture",
                    label: "Capture",
                    items: [{ to: "/evidence", label: "Evidence" }],
                },
            ],
            ["agenda", "evidence"]
        );
        expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
        const tabs = within(screens())
            .getAllByRole("link")
            .map(a => a.textContent);
        expect(tabs).toEqual(["This week", "Agenda", "Evidence"]);
        expect(screen.queryByRole("radiogroup", { name: "Area" })).not.toBeInTheDocument();

        fireEvent.click(within(screens()).getByRole("link", { name: "Evidence" }));
        expect(here()).toBe("/evidence");
        expect(within(screens()).getByRole("link", { name: "Evidence" })).toHaveAttribute(
            "aria-current",
            "page"
        );
    });

    it("switches between the groups of a big tool, each coming back where it was", () => {
        const brand = ["Overview", "Compose", "Calendar", "Campaigns", "Accounts"];
        const prospects = ["Home", "Companies", "People", "Deals", "Runs"];
        mount(
            [
                {
                    id: "brand",
                    label: "Brand",
                    items: brand.map((label, i) => ({
                        to: i === 0 ? "/brand" : `/brand/${label.toLowerCase()}`,
                        label,
                        exact: i === 0,
                    })),
                },
                {
                    id: "prospects",
                    label: "Prospects",
                    items: prospects.map((label, i) => ({
                        to: i === 0 ? "/prospects" : `/prospects/${label.toLowerCase()}`,
                        label,
                        exact: i === 0,
                    })),
                },
            ],
            ["brand", "prospects"],
            "/brand"
        );
        // Only the active group's screens are tabs.
        expect(
            within(screens())
                .getAllByRole("link")
                .map(a => a.textContent)
        ).toEqual(brand);
        fireEvent.click(within(screens()).getByRole("link", { name: "Calendar" }));
        expect(here()).toBe("/brand/calendar");

        const area = screen.getByRole("radiogroup", { name: "Area" });
        fireEvent.click(within(area).getByRole("radio", { name: "Prospects" }));
        expect(here()).toBe("/prospects");
        expect(
            within(screens())
                .getAllByRole("link")
                .map(a => a.textContent)
        ).toEqual(prospects);
        fireEvent.click(within(screens()).getByRole("link", { name: "Deals" }));

        // Back to Brand lands on Calendar, where Brand was left; and back again.
        fireEvent.click(within(area).getByRole("radio", { name: "Brand" }));
        expect(here()).toBe("/brand/calendar");
        fireEvent.click(within(area).getByRole("radio", { name: "Prospects" }));
        expect(here()).toBe("/prospects/deals");
    });

    it("keeps a tool-wide status (a run) in the bar on every screen, and the bar in reading order", () => {
        const items = (base: string, labels: string[]) =>
            labels.map((label, i) => ({
                to: i === 0 ? base : `${base}/${label.toLowerCase()}`,
                label,
                exact: i === 0,
            }));
        render(
            <ToolNavProvider toolId="example" roots={["brand", "prospects"]} home="/brand">
                <ToolFrame
                    title="Example"
                    mark={<span />}
                    status={<button type="button">Run going</button>}
                    groups={[
                        {
                            id: "brand",
                            label: "Brand",
                            items: items("/brand", [
                                "Overview",
                                "Compose",
                                "Calendar",
                                "Campaigns",
                                "Accounts",
                            ]),
                        },
                        {
                            id: "prospects",
                            label: "Prospects",
                            toolbar: <button type="button">Segment</button>,
                            items: items("/prospects", [
                                "Home",
                                "Companies",
                                "People",
                                "Deals",
                                "Runs",
                            ]),
                        },
                    ]}
                >
                    <Here />
                </ToolFrame>
            </ToolNavProvider>
        );
        // On Brand — where the old rail never showed Prospects' run.
        expect(here()).toBe("/brand");
        expect(screen.getAllByRole("button", { name: "Run going" }).length).toBeGreaterThan(0);

        fireEvent.click(
            within(screen.getByRole("radiogroup", { name: "Area" })).getByRole("radio", {
                name: "Prospects",
            })
        );
        const segment = screen.getByRole("button", { name: "Segment" });
        // The second-row tabs come after the bar's controls in the DOM, so
        // Tab moves through the bar in the order it is read.
        expect(
            segment.compareDocumentPosition(screens()) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
    });
});
