/** @jest-environment jsdom */

/**
 * A tool is a tab with its own history. These checks hold the contract every
 * tool relies on: links stay in the tab, back and forward walk it, the old
 * `/employer/tools/…` URLs come back to the same screen, requests from the
 * workspace are shown once, and the last screen is remembered per workspace.
 */

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import {
    ToolNavProvider,
    useToolNav,
    useToolRouter,
    type ToolHost,
} from "~/components/tool-app/nav";
import { ToolLink } from "~/components/tool-app/ToolLink";
import {
    isToolPath,
    parseToolHref,
    toolTabHref,
    toolTargetFromHref,
} from "~/lib/tool-app/locations";

describe("tool locations", () => {
    it("normalises paths and keeps the query", () => {
        expect(parseToolHref("")).toEqual({ path: "/", search: "" });
        expect(parseToolHref("/write/")).toEqual({ path: "/write", search: "" });
        expect(parseToolHref("/prospects/companies?view=new#x")).toEqual({
            path: "/prospects/companies",
            search: "?view=new",
        });
    });

    it("builds the link that opens a tool's tab at a screen", () => {
        expect(toolTabHref("growth")).toBe("/employer/documents?feature=growth");
        expect(toolTabHref("growth", "/")).toBe("/employer/documents?feature=growth");
        expect(toolTabHref("growth", "/prospects/companies?view=new")).toBe(
            "/employer/documents?feature=growth&at=%2Fprospects%2Fcompanies%3Fview%3Dnew"
        );
    });

    it("reads a tool and screen back out of old pages and tab links alike", () => {
        expect(toolTargetFromHref("/employer/tools/growth")).toEqual({
            toolId: "growth",
            at: "/",
        });
        expect(toolTargetFromHref("/employer/tools/prospects/companies?view=new")).toEqual({
            toolId: "growth",
            at: "/prospects/companies?view=new",
        });
        expect(toolTargetFromHref("/employer/tools/marketing-pipeline?debug=1")).toEqual({
            toolId: "growth",
            at: "/brand/campaigns?debug=1",
        });
        expect(toolTargetFromHref("/employer/tools/distribution")).toEqual({
            toolId: "growth",
            at: "/prospects",
        });
        expect(toolTargetFromHref(toolTabHref("vantage", "/agenda?week=2026-09-28"))).toEqual({
            toolId: "vantage",
            at: "/agenda?week=2026-09-28",
        });
        expect(toolTargetFromHref("/employer/documents?feature=brand")).toEqual({
            toolId: "growth",
            at: "/brand",
        });
        // Not a tool's: a source, a question, settings, a lookalike prefix.
        expect(toolTargetFromHref("/employer/documents?source=d12")).toBeNull();
        expect(toolTargetFromHref("/employer/documents?ask=hello")).toBeNull();
        expect(toolTargetFromHref("/employer/settings#people")).toBeNull();
        expect(toolTargetFromHref("/employer/tools/growthy")).toBeNull();
    });

    it("tells a tool's own screens from site paths", () => {
        const roots = ["write", "funders"];
        expect(isToolPath("", roots)).toBe(true);
        expect(isToolPath("/", roots)).toBe(true);
        expect(isToolPath("?tab=2", roots)).toBe(true);
        expect(isToolPath("/write/3", roots)).toBe(true);
        expect(isToolPath("/employer/documents?ask=x", roots)).toBe(false);
        expect(isToolPath("/writer", roots)).toBe(false);
        expect(isToolPath("https://example.com/write", roots)).toBe(false);
        expect(isToolPath("//example.com/write", roots)).toBe(false);
    });
});

function Probe() {
    const nav = useToolNav();
    const router = useToolRouter();
    return (
        <div>
            <output data-testid="here">{`${nav.path}${nav.search}`}</output>
            <ToolLink href="/things/7">Thing 7</ToolLink>
            <ToolLink href="?view=new">New only</ToolLink>
            <ToolLink href="/employer/documents?source=d12">A source</ToolLink>
            <ToolLink href="/employer/tools/other/screen">Other tool</ToolLink>
            <ToolLink href="/employer/tools/example/things">Old URL of this tool</ToolLink>
            <button onClick={nav.back} disabled={!nav.canBack}>
                Back
            </button>
            <button onClick={nav.forward} disabled={!nav.canForward}>
                Forward
            </button>
            <button onClick={() => router.replace("/settings")}>Replace</button>
        </div>
    );
}

function mount(host?: ToolHost, home = "/things") {
    return render(
        <ToolNavProvider toolId="example" roots={["things", "settings"]} home={home} host={host}>
            <Probe />
        </ToolNavProvider>
    );
}

const here = () => screen.getByTestId("here").textContent;

describe("ToolNavProvider", () => {
    beforeEach(() => window.localStorage.clear());

    it("lands on home for '/', and links move inside the tab with history", () => {
        mount();
        expect(here()).toBe("/things");
        fireEvent.click(screen.getByText("Thing 7"));
        expect(here()).toBe("/things/7");
        fireEvent.click(screen.getByText("New only"));
        expect(here()).toBe("/things/7?view=new");
        fireEvent.click(screen.getByText("Back"));
        expect(here()).toBe("/things/7");
        fireEvent.click(screen.getByText("Back"));
        expect(here()).toBe("/things");
        expect(screen.getByText("Back")).toBeDisabled();
        fireEvent.click(screen.getByText("Forward"));
        expect(here()).toBe("/things/7");
        // Replacing swaps this step and keeps what was ahead, as a browser does…
        fireEvent.click(screen.getByText("Replace"));
        expect(here()).toBe("/settings");
        expect(screen.getByText("Forward")).toBeEnabled();
        // …and a new step from the middle drops it.
        fireEvent.click(screen.getByText("Thing 7"));
        expect(here()).toBe("/things/7");
        expect(screen.getByText("Forward")).toBeDisabled();
        fireEvent.click(screen.getByText("Back"));
        expect(here()).toBe("/settings");
    });

    it("gives every link its shareable URL, so ⌘-click opens the same screen", () => {
        mount();
        expect(screen.getByText("Thing 7")).toHaveAttribute(
            "href",
            "/employer/documents?feature=example&at=%2Fthings%2F7"
        );
        expect(screen.getByText("A source")).toHaveAttribute(
            "href",
            "/employer/documents?source=d12"
        );
        expect(screen.getByText("Other tool")).toHaveAttribute(
            "href",
            "/employer/tools/other/screen"
        );
        // ⌘-click is left to the browser: no move inside the tab.
        fireEvent.click(screen.getByText("Thing 7"), { metaKey: true });
        expect(here()).toBe("/things");
    });

    it("hands site links to the workspace and its own old URLs back to the tab", () => {
        const openHref = jest.fn();
        const openTool = jest.fn();
        mount({ openHref, openTool });
        fireEvent.click(screen.getByText("A source"));
        expect(openHref).toHaveBeenCalledWith("/employer/documents?source=d12");
        fireEvent.click(screen.getByText("Old URL of this tool"));
        expect(here()).toBe("/things");
        expect(openTool).not.toHaveBeenCalled();
    });

    it("opens a request from the workspace once, and tells the workspace it was shown", () => {
        const consumeRequest = jest.fn();
        const { rerender } = mount({ request: { at: "/settings", nonce: 1 }, consumeRequest });
        expect(here()).toBe("/settings");
        expect(consumeRequest).toHaveBeenCalledWith(1);
        rerender(
            <ToolNavProvider
                toolId="example"
                roots={["things", "settings"]}
                home="/things"
                host={{ request: { at: "/things/9", nonce: 2 }, consumeRequest }}
            >
                <Probe />
            </ToolNavProvider>
        );
        expect(here()).toBe("/things/9");
        expect(consumeRequest).toHaveBeenLastCalledWith(2);
        fireEvent.click(screen.getByText("Back"));
        expect(here()).toBe("/settings");
    });

    it("remembers the last screen per workspace, once the workspace is known", () => {
        window.localStorage.setItem("tool.location.v1:u1:c1:example", "/things/3");
        const { rerender } = mount({ storageScope: null });
        expect(here()).toBe("/things");
        act(() => {
            rerender(
                <ToolNavProvider
                    toolId="example"
                    roots={["things", "settings"]}
                    home="/things"
                    host={{ storageScope: "u1:c1" }}
                >
                    <Probe />
                </ToolNavProvider>
            );
        });
        expect(here()).toBe("/things/3");
        fireEvent.click(screen.getByText("Thing 7"));
        expect(window.localStorage.getItem("tool.location.v1:u1:c1:example")).toBe("/things/7");
    });

    it("lets a request win over the remembered screen", () => {
        window.localStorage.setItem("tool.location.v1:u1:c1:example", "/things/3");
        mount({ storageScope: "u1:c1", request: { at: "/settings", nonce: 5 } });
        expect(here()).toBe("/settings");
    });
});
