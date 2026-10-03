/** @jest-environment jsdom */

/**
 * Investor relations, as someone uses it: it searches on arrival, shows who
 * runs each fund and what it is raising, drafts an intro in chat, saves the
 * list as a source, and says so when SEC is down instead of showing nothing.
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

const mockCopyText = jest.fn(() => Promise.resolve(true));
jest.mock("~/lib/context-menu", () => ({ copyText: () => mockCopyText() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

import { InvestorsPane } from "../investors/InvestorsPane";
import type { InvestorSearchResult } from "../investors/investors";

const RESULT: InvestorSearchResult = {
    funds: [
        {
            cik: "0002083393",
            name: "Overture Climate Fund II LP",
            location: "Santa Monica, CA",
            filedAt: "2026-07-01",
            amendment: false,
            filingUrl: "https://www.sec.gov/overture",
            offeringAmount: 75_000_000,
            amountSold: 0,
            managers: [{ name: "Shomik Dutta", kind: "person", roles: ["Executive Officer"] }],
            detailed: true,
        },
        {
            cik: "0002129288",
            name: "DCVC Energy & Climate II, L.P.",
            location: "Palo Alto, CA",
            filedAt: "2026-05-29",
            amendment: true,
            filingUrl: "https://www.sec.gov/dcvc",
            phone: "415-840-7337",
            offeringAmount: 500_000_000,
            amountSold: 0,
            managers: [
                {
                    name: "Zachary Bogue",
                    kind: "person",
                    roles: ["Executive Officer"],
                    title: "Managing Member of the General Partner",
                },
                { name: "DCVC GP II, LLC", kind: "entity", roles: ["Promoter"] },
            ],
            detailed: true,
        },
    ],
    totalFilings: 82,
    singleDealVehiclesHidden: 3,
    source: "sec-edgar-form-d",
};

const mockFetch = jest.fn();

// Radix's checkbox measures itself; jsdom has no ResizeObserver.
global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(RESULT) });
    global.fetch = mockFetch as unknown as typeof fetch;
});

function lastSearch(): URLSearchParams {
    const url = String(mockFetch.mock.calls.at(-1)![0]);
    return new URL(url, "http://localhost").searchParams;
}

describe("InvestorsPane", () => {
    it("searches the last quarter on arrival and shows each fund, newest first", async () => {
        render(<InvestorsPane onDraftInChat={jest.fn()} onSaveAsSource={jest.fn()} />);
        const cards = await screen.findAllByTestId("investor-fund");
        expect(lastSearch().get("within")).toBe("90");
        expect(lastSearch().has("q")).toBe(false);

        expect(cards[0]).toHaveTextContent("Overture Climate Fund II LP");
        expect(cards[1]).toHaveTextContent("DCVC Energy & Climate II, L.P.");
        expect(cards[1]).toHaveTextContent("Amended");
        expect(cards[1]).toHaveTextContent("Palo Alto, CA · Raising $500M · nothing closed yet");
        expect(cards[1]).toHaveTextContent(
            "Zachary Bogue — Managing Member of the General Partner"
        );
        expect(cards[1]).toHaveTextContent("via DCVC GP II, LLC");
        expect(screen.getByTestId("investors-summary")).toHaveTextContent(
            "2 funds · 82 filings in the window · 3 single-deal vehicles hidden"
        );
    });

    it("sorts by size on request", async () => {
        render(<InvestorsPane />);
        await screen.findAllByTestId("investor-fund");
        expect(screen.getAllByTestId("investor-fund")[0]).toHaveTextContent("Overture");
        fireEvent.click(screen.getByRole("radio", { name: "Largest" }));
        expect(screen.getAllByTestId("investor-fund")[0]).toHaveTextContent("DCVC");
    });

    it("sends what was typed", async () => {
        render(<InvestorsPane />);
        await screen.findAllByTestId("investor-fund");
        fireEvent.change(screen.getByLabelText("Focus: words in the fund's name"), {
            target: { value: "climate, health" },
        });
        fireEvent.click(screen.getByRole("checkbox"));
        fireEvent.click(screen.getByRole("button", { name: "Search" }));
        await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
        expect(lastSearch().get("q")).toBe("climate, health");
        expect(lastSearch().get("spvs")).toBe("1");
    });

    it("drafts an intro to the fund's person in chat", async () => {
        const onDraftInChat = jest.fn();
        render(<InvestorsPane onDraftInChat={onDraftInChat} />);
        const dcvc = (await screen.findAllByTestId("investor-fund")).find(card =>
            card.textContent?.includes("DCVC")
        );
        fireEvent.click(
            Array.from(dcvc!.querySelectorAll("button")).find(b => b.textContent === "Draft intro")!
        );
        expect(onDraftInChat).toHaveBeenCalledTimes(1);
        const prompt = onDraftInChat.mock.calls[0]![0] as string;
        expect(prompt).toContain("Zachary Bogue");
        expect(prompt).toContain("DCVC Energy & Climate II, L.P.");
    });

    it("copies the prompt where there is no chat beside it", async () => {
        render(<InvestorsPane />);
        await screen.findAllByTestId("investor-fund");
        fireEvent.click(screen.getAllByRole("button", { name: "Copy intro prompt" })[0]!);
        await waitFor(() => expect(mockCopyText).toHaveBeenCalled());
    });

    it("saves the list, in the order shown, as a source", async () => {
        const onSaveAsSource = jest.fn();
        render(<InvestorsPane onSaveAsSource={onSaveAsSource} />);
        await screen.findAllByTestId("investor-fund");
        fireEvent.click(screen.getByRole("radio", { name: "Largest" }));
        fireEvent.click(screen.getByRole("button", { name: "Save list as a source" }));
        const md = onSaveAsSource.mock.calls[0]![0] as string;
        expect(md.indexOf("## DCVC")).toBeLessThan(md.indexOf("## Overture"));
        expect(md).toContain("filed in the last 90 days");
    });

    it("links each fund's filing and a web search for its site", async () => {
        render(<InvestorsPane />);
        const dcvc = (await screen.findAllByTestId("investor-fund")).find(card =>
            card.textContent?.includes("DCVC")
        );
        const links = Array.from(dcvc!.querySelectorAll("a")).map(a => a.getAttribute("href"));
        expect(links).toContain("https://www.sec.gov/dcvc");
        expect(links.some(h => h?.startsWith("https://duckduckgo.com/?q="))).toBe(true);
        expect(links).toContain("tel:4158407337");
    });

    it("says SEC did not answer, and tries again", async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 502,
            json: () =>
                Promise.resolve({ error: "SEC EDGAR did not answer. Try again in a moment." }),
        });
        render(<InvestorsPane />);
        expect(
            await screen.findByText("SEC EDGAR did not answer. Try again in a moment.")
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        expect(await screen.findAllByTestId("investor-fund")).toHaveLength(2);
    });

    it("offers the pitch starters in chat", async () => {
        const onDraftInChat = jest.fn();
        render(<InvestorsPane onDraftInChat={onDraftInChat} />);
        await screen.findAllByTestId("investor-fund");
        await userEvent.click(screen.getByRole("tab", { name: "Pitch" }));
        expect(await screen.findByText("Investor one-pager")).toBeInTheDocument();
        await userEvent.click(screen.getAllByRole("button", { name: "Draft in chat" })[0]!);
        expect(onDraftInChat.mock.calls[0]![0]).toMatch(/one-page investor memo/);
    });
});
