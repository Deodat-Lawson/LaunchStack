/** @jest-environment jsdom */

/**
 * The real Proposals tab — frame, screen tabs and the real screens — over the
 * harness's simulator of `/api/proposals/*`. What it pins is that the tab
 * never leaves the page: screen tabs, the todo links the server builds as old
 * page URLs, and Back all move inside the tab, while a site link (Investor
 * relations, Ask in chat) is handed to the workspace.
 */

import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import { resetProposalsSim, simulateProposals } from "~/app/dev/proposals/simulator";
import { ProposalsTool } from "~/app/employer/tools/proposals/ProposalsTool";
import type { ToolHost } from "~/components/tool-app/nav";

/** jsdom has no fetch `Response`; the simulator and `api.ts` need this much of one. */
class ShimResponse {
    readonly status: number;
    readonly ok: boolean;
    private readonly body: string;
    constructor(body?: unknown, init?: { status?: number }) {
        this.body = typeof body === "string" ? body : "";
        this.status = init?.status ?? 200;
        this.ok = this.status >= 200 && this.status < 300;
    }
    text() {
        return Promise.resolve(this.body);
    }
    json(): Promise<unknown> {
        return Promise.resolve(JSON.parse(this.body));
    }
}

class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

beforeAll(() => {
    if (typeof globalThis.Response === "undefined") {
        Object.assign(globalThis, { Response: ShimResponse });
    }
    if (typeof globalThis.ResizeObserver === "undefined") {
        Object.assign(globalThis, { ResizeObserver: NoopResizeObserver });
    }
    Object.assign(globalThis, {
        fetch: async (input: string | URL | Request, init?: RequestInit) => {
            const url =
                typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            const response = await simulateProposals(
                new URL(url, "http://proposals.local"),
                init,
                Date.now()
            );
            if (!response) throw new Error(`not simulated: ${url}`);
            return response;
        },
    });
});

beforeEach(() => resetProposalsSim());

function mount(at: string) {
    const openHref = jest.fn();
    const openTool = jest.fn();
    const host: ToolHost = { active: true, request: { at, nonce: 1 }, openHref, openTool };
    render(<ProposalsTool host={host} />);
    return { openHref, openTool };
}

const tabs = () => screen.getByRole("navigation", { name: "Proposals screens" });

describe("the Proposals tab", () => {
    it("opens on Home and moves to a screen from the tabs without leaving the page", async () => {
        mount("/");
        expect(await screen.findByRole("heading", { name: /your proposals/i })).toBeVisible();

        const funders = within(tabs()).getByRole("link", { name: /funders/i });
        expect(funders).toHaveAttribute(
            "href",
            "/employer/documents?feature=proposals&at=%2Ffunders"
        );
        fireEvent.click(funders);
        expect(await screen.findByRole("heading", { name: /funders that/i })).toBeVisible();
        expect(funders).toHaveAttribute("aria-current", "page");
    });

    it("follows a todo link the server built as an old page URL into the proposal, and back", async () => {
        const { openHref } = mount("/");
        await screen.findByRole("heading", { name: /your proposals/i });

        const draft = (await screen.findAllByRole("link", { name: "Draft" }))[0]!;
        expect(draft.getAttribute("href")).toMatch(
            /^\/employer\/documents\?feature=proposals&at=%2Fwrite%2F/
        );
        fireEvent.click(draft);
        expect(
            await screen.findByRole("heading", {
                level: 1,
                name: "Meyer Memorial Trust — Community Grants 2026",
            })
        ).toBeVisible();

        // Ask in chat is a site link: the workspace opens it, the tab stays.
        const ask = (await screen.findAllByRole("link", { name: /ask in chat/i }))[0]!;
        fireEvent.click(ask);
        expect(openHref).toHaveBeenCalledWith(
            expect.stringMatching(/^\/employer\/documents\?ask=/)
        );
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Meyer Memorial");

        fireEvent.click(screen.getAllByRole("button", { name: "Back" })[0]!);
        expect(await screen.findByRole("heading", { name: /your proposals/i })).toBeVisible();
    });

    it("says so for a path it has no screen for, and goes home from there", async () => {
        mount("/write/12/nope");
        expect(screen.getByText("This screen does not exist")).toBeVisible();
        fireEvent.click(screen.getByRole("button", { name: "Go to Proposals home" }));
        expect(await screen.findByRole("heading", { name: /your proposals/i })).toBeVisible();
    });

    it("hands a site link to the workspace instead of navigating", async () => {
        const { openHref } = mount("/funders");
        await screen.findByRole("heading", { name: /funders that/i });
        fireEvent.click(screen.getByRole("link", { name: "Investor relations" }));
        expect(openHref).toHaveBeenCalledWith("/employer/documents?feature=investors");
        expect(screen.getByRole("heading", { name: /funders that/i })).toBeVisible();
    });
});
