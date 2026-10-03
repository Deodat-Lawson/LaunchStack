/** @jest-environment jsdom */

/**
 * Growth is a tab of the workspace, not a route tree. Two things make that
 * true and are worth pinning: every screen the old `/employer/tools/growth`
 * pages served still has a path inside the tab (and nothing else does), and
 * a link on a Growth screen moves inside the tab instead of loading a page.
 */

import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import {
    GROWTH_HOME,
    GROWTH_ROOTS,
    growthScreenFor,
} from "~/app/employer/tools/growth/_lib/screens";
import type * as ProspectsApiModule from "~/app/employer/tools/growth/prospects/api";
import type * as ToolLinkModule from "~/components/tool-app/ToolLink";
import { toolTargetFromHref } from "~/lib/tool-app/locations";

// The screens fetch and render a lot; the frame and the switch are what is
// under test, so each screen is a probe naming itself. Overview carries a
// link the way the real screens do, through ToolLink.
function mockProbe(name: string) {
    function Probe() {
        return <div data-testid="screen">{name}</div>;
    }
    return Probe;
}
jest.mock("~/app/employer/tools/growth/brand/_screens/OverviewScreen", () => {
    const { ToolLink } = jest.requireActual<typeof ToolLinkModule>(
        "~/components/tool-app/ToolLink"
    );
    function OverviewScreen() {
        return (
            <div>
                <div data-testid="screen">brand-overview</div>
                <ToolLink href="/prospects/companies/42?from=overview">Open company 42</ToolLink>
                <ToolLink href="/employer/documents?ask=hello">Ask about it</ToolLink>
            </div>
        );
    }
    return { OverviewScreen };
});
jest.mock("~/app/employer/tools/growth/brand/_screens/ComposeScreen", () => ({
    ComposeScreen: mockProbe("brand-compose"),
}));
jest.mock("~/app/employer/tools/growth/brand/_screens/CalendarScreen", () => ({
    CalendarScreen: mockProbe("brand-calendar"),
}));
jest.mock("~/app/employer/tools/growth/brand/_screens/CampaignsScreen", () => ({
    CampaignsScreen: mockProbe("brand-campaigns"),
}));
jest.mock("~/app/employer/tools/growth/brand/_screens/AccountsScreen", () => ({
    AccountsScreen: mockProbe("brand-accounts"),
}));
jest.mock("~/app/employer/tools/growth/prospects/_screens/HomeScreen", () => ({
    HomeScreen: mockProbe("prospects-home"),
}));
jest.mock("~/app/employer/tools/growth/prospects/_screens/CompaniesScreen", () => ({
    CompaniesScreen: mockProbe("prospects-companies"),
}));
jest.mock("~/app/employer/tools/growth/prospects/_screens/CompanyScreen", () => ({
    CompanyScreen: ({ id }: { id: string }) => (
        <div data-testid="screen">prospects-company:{id}</div>
    ),
}));
jest.mock("~/app/employer/tools/growth/prospects/_screens/PeopleScreen", () => ({
    PeopleScreen: mockProbe("prospects-people"),
}));
jest.mock("~/app/employer/tools/growth/prospects/_screens/DealsScreen", () => ({
    DealsScreen: mockProbe("prospects-deals"),
}));
jest.mock("~/app/employer/tools/growth/prospects/_screens/RunsScreen", () => ({
    RunsScreen: mockProbe("prospects-runs"),
}));
jest.mock("~/app/employer/tools/growth/prospects/_screens/SegmentScreen", () => ({
    SegmentScreen: mockProbe("prospects-segment"),
}));
jest.mock("~/app/employer/tools/growth/prospects/_screens/SourcesScreen", () => ({
    SourcesScreen: mockProbe("prospects-sources"),
}));

// The provider loads segments and looks for a live run; answer both without
// a network so the tabs' counts come from a known segment.
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
                        subtitle: "NL, DE, UK",
                        headline: "Fulfilment operators in NL, DE and the UK",
                        status: "confirmed",
                        counts: { companies: 12, people: 30, deals: 4, sources: 9 },
                    },
                ],
            })),
            runs: jest.fn(async () => ({ runs: [] })),
        },
    };
});

import { GrowthTool } from "~/app/employer/tools/growth/GrowthTool";

describe("growthScreenFor", () => {
    it.each([
        ["/", { key: "brand-overview" }],
        ["/brand", { key: "brand-overview" }],
        ["/brand/", { key: "brand-overview" }],
        ["/brand/compose", { key: "brand-compose" }],
        ["/brand/calendar", { key: "brand-calendar" }],
        ["/brand/campaigns", { key: "brand-campaigns" }],
        ["/brand/campaigns?debug=true", { key: "brand-campaigns" }],
        ["/brand/accounts", { key: "brand-accounts" }],
        ["/prospects", { key: "prospects-home" }],
        ["/prospects/companies", { key: "prospects-companies" }],
        ["/prospects/companies?view=new&sort=name&q=acme", { key: "prospects-companies" }],
        ["/prospects/companies/42", { key: "prospects-company", id: "42" }],
        [
            "/prospects/companies/3f2a9c1e-7b1d-4c8e-9a10-2b5d6e7f8a90",
            { key: "prospects-company", id: "3f2a9c1e-7b1d-4c8e-9a10-2b5d6e7f8a90" },
        ],
        ["/prospects/companies/a%20b", { key: "prospects-company", id: "a b" }],
        ["/prospects/people", { key: "prospects-people" }],
        ["/prospects/deals", { key: "prospects-deals" }],
        ["/prospects/runs", { key: "prospects-runs" }],
        ["/prospects/segment", { key: "prospects-segment" }],
        ["/prospects/sources", { key: "prospects-sources" }],
    ])("%s", (path, expected) => {
        expect(growthScreenFor(path)).toEqual(expected);
    });

    it.each([
        "/nope",
        "/brand/nope",
        "/brand/compose/extra",
        "/prospects/nope",
        "/prospects/people/42",
        "/prospects/companies/42/extra",
        "/brand/constructor",
        "/prospects/toString",
        "/employer/tools/growth/brand",
    ])("%s has no screen", path => {
        expect(growthScreenFor(path)).toEqual({ key: "not-found" });
    });

    it("lands on Brand, and every old Growth URL maps to a screen in the tab", () => {
        expect(growthScreenFor(GROWTH_HOME)).toEqual({ key: "brand-overview" });
        expect([...GROWTH_ROOTS]).toEqual(["brand", "prospects"]);
        for (const old of [
            "/employer/tools/growth",
            "/employer/tools/growth/brand/calendar",
            "/employer/tools/growth/prospects/companies/42",
            "/employer/tools/prospects/deals",
            "/employer/tools/distribution",
            "/employer/tools/marketing-pipeline?debug=true",
        ]) {
            const target = toolTargetFromHref(old);
            expect(target?.toolId).toBe("growth");
            expect(growthScreenFor(target!.at).key).not.toBe("not-found");
        }
    });
});

describe("GrowthTool", () => {
    function currentScreen() {
        return screen.getByTestId("screen").textContent;
    }

    async function mount(at: string) {
        const openHref = jest.fn();
        render(<GrowthTool host={{ active: true, request: { at, nonce: 1 }, openHref }} />);
        // Let the provider's segment load settle so the tabs have their counts.
        await act(async () => {});
        return { openHref };
    }

    it("opens on Brand and moves between screens inside the tab", async () => {
        const startUrl = window.location.href;
        await mount("/");
        expect(currentScreen()).toBe("brand-overview");

        const tabs = screen.getByRole("navigation", { name: "Growth screens" });
        const calendar = within(tabs).getByRole("link", { name: "Calendar" });
        // A real link to share or ⌘-click, pointing at the tab, not an old page.
        expect(calendar).toHaveAttribute(
            "href",
            "/employer/documents?feature=growth&at=%2Fbrand%2Fcalendar"
        );
        fireEvent.click(calendar);
        expect(currentScreen()).toBe("brand-calendar");
        expect(calendar).toHaveAttribute("aria-current", "page");
        expect(window.location.href).toBe(startUrl);

        // The tab's own history.
        fireEvent.click(screen.getAllByRole("button", { name: "Back" })[0]!);
        expect(currentScreen()).toBe("brand-overview");
    });

    it("follows a screen's ToolLink to a company, and hands site links to the workspace", async () => {
        const { openHref } = await mount("/brand");
        fireEvent.click(screen.getByRole("link", { name: "Open company 42" }));
        expect(currentScreen()).toBe("prospects-company:42");

        fireEvent.click(screen.getAllByRole("button", { name: "Back" })[0]!);
        expect(currentScreen()).toBe("brand-overview");
        fireEvent.click(screen.getByRole("link", { name: "Ask about it" }));
        expect(openHref).toHaveBeenCalledWith("/employer/documents?ask=hello");
        expect(currentScreen()).toBe("brand-overview");
    });

    it("shows the segment's counts in the Prospects screen tabs", async () => {
        await mount("/prospects");
        expect(currentScreen()).toBe("prospects-home");
        const tabs = screen.getByRole("navigation", { name: "Growth screens" });
        expect(within(tabs).getByRole("link", { name: /Companies/ })).toHaveTextContent("12");
        expect(within(tabs).getByRole("link", { name: /Sources/ })).toHaveTextContent("9");
        // The segment switcher sits in the bar while Prospects is showing.
        expect(
            screen.getByRole("button", { name: "Segment: Fulfilment operators. Switch segment" })
        ).toHaveTextContent("Fulfilment operators");
    });

    it("says so for a path it has no screen for", async () => {
        await mount("/prospects/nope");
        expect(screen.getByText("This screen does not exist")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Go to Brand overview" }));
        expect(currentScreen()).toBe("brand-overview");
    });
});
