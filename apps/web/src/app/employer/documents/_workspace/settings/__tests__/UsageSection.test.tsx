/** @jest-environment jsdom */

/**
 * Workspace › Usage and costs, the AI usage half: everything in chat-token
 * equivalents, split by kind with each kind's own units beside it and the
 * conversion spelled out — so a pile of cheap embeddings reads as the sliver
 * it cost, not as the bulk of the month.
 */

import React from "react";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import { UsageSection } from "../UsageSection";

// Charts need a laid-out DOM; the numbers under test are all outside them.
jest.mock("~/components/ui/chart", () => ({
    ChartContainer: () => <div data-testid="chart" />,
    ChartLegend: () => null,
    ChartLegendContent: () => null,
    ChartTooltip: () => null,
    ChartTooltipContent: () => null,
}));
jest.mock("../MemberAllowancesBlock", () => ({ MemberAllowancesBlock: () => null }));
jest.mock("../SettingRow", () => ({ SectionRows: () => null }));

const totals = (over: Record<string, number> = {}) => ({
    calls: 0,
    weightedTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    costUsd: 0,
    pricedCalls: 0,
    ...over,
});

function overview() {
    const chat = totals({
        calls: 2_000,
        weightedTokens: 16_000_000,
        inputTokens: 14_000_000,
        outputTokens: 2_000_000,
        cachedInputTokens: 3_500_000,
    });
    const embedding = totals({ calls: 1_100, weightedTokens: 1_690_000, inputTokens: 13_000_000 });
    const search = totals({ calls: 384, weightedTokens: 2_198_000 });
    return {
        days: 30,
        balanceTokens: 9_000_000,
        lifetime: { purchased: 0, granted: 10_000_000, used: 1_000_000 },
        daily: [],
        byService: [],
        byRoute: [],
        recent: [],
        pricePerMillionTokens: 0,
        lowBalanceThreshold: 500_000,
        estimatedCost: null,
        models: {
            // Embedded tokens are input too: 14M chat + 13M embedded.
            totals: totals({
                calls: 3_484,
                weightedTokens: 19_888_000,
                inputTokens: 27_000_000,
                cachedInputTokens: 3_500_000,
            }),
            byGroup: [
                { group: "chat", ...chat, searches: 0, pages: 0 },
                { group: "embedding", ...embedding, searches: 0, pages: 0 },
                { group: "search", ...search, searches: 286, pages: 98 },
            ],
            rates: {
                chat: { perMillion: 1, source: "default" },
                embeddingPerMillion: 130_000,
                perSearch: 7_000,
            },
            daily: [],
            byFeature: [
                { feature: "ask", ...totals({ calls: 2_100, weightedTokens: 9_480_213 }) },
                { feature: "ingestion", ...totals({ calls: 900, weightedTokens: 4_893_465 }) },
            ],
            byRoute: [],
            workspaceOwnedCalls: 0,
            estimatedCostUsd: null,
        },
    };
}

beforeEach(() => {
    global.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => overview(),
    })) as unknown as typeof fetch;
});

describe("UsageSection", () => {
    it("leads with AI usage in chat-token equivalents", async () => {
        render(<UsageSection onActions={jest.fn()} />);
        expect(await screen.findByText("19.9M")).toBeInTheDocument();
        expect(screen.getByText("AI usage in the last 30 days")).toBeInTheDocument();
        expect(screen.getByText("chat-token equivalents · 3,484 requests")).toBeInTheDocument();
        // AI usage comes before the balance.
        const headings = screen.getAllByRole("heading").map(h => h.textContent);
        expect(headings.indexOf("AI usage")).toBeLessThan(headings.indexOf("Balance"));
    });

    it("splits usage by kind, each with its own units, so embeddings show as what they cost", async () => {
        render(<UsageSection onActions={jest.fn()} />);
        const card = await screen.findByTestId("usage-by-kind");

        const chat = within(card).getByTestId("usage-kind-chat");
        expect(chat).toHaveTextContent("Chat");
        expect(chat).toHaveTextContent("16.0M80%");
        expect(chat).toHaveTextContent("14.0M in · 2.0M out · 2,000 calls");

        const embedding = within(card).getByTestId("usage-kind-embedding");
        expect(embedding).toHaveTextContent("1.7M8%");
        expect(embedding).toHaveTextContent("13.0M tokens embedded");

        const search = within(card).getByTestId("usage-kind-search");
        expect(search).toHaveTextContent("2.2M11%");
        expect(search).toHaveTextContent("286 searches · 98 pages read");

        expect(card).toHaveTextContent(
            "Converted by price: a million embedded tokens counts as 130K, and one web search as 7,000, against a chat token at $1.00 per 1M."
        );
    });

    it("works out the cache share from chat input alone", async () => {
        render(<UsageSection onActions={jest.fn()} />);
        await screen.findByTestId("usage-by-kind");
        // 3.5M of 14M chat input is 25%; over all 27M input it would read 13%.
        const cached = screen.getByText("Input from cache").nextElementSibling;
        expect(cached).toHaveTextContent("25%");
    });

    it("says so when a kind was not used in the window", async () => {
        const quiet = overview();
        quiet.models.byGroup[2] = { group: "search", ...totals(), searches: 0, pages: 0 };
        global.fetch = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => quiet,
        })) as unknown as typeof fetch;
        render(<UsageSection onActions={jest.fn()} />);
        const search = await screen.findByTestId("usage-kind-search");
        expect(search).toHaveTextContent("None in this window");
    });

    it("ranks features by usage in the common unit", async () => {
        render(<UsageSection onActions={jest.fn()} />);
        await screen.findByTestId("usage-by-kind");
        const table = screen.getByRole("columnheader", { name: "Usage" }).closest("table")!;
        const rows = within(table).getAllByRole("row");
        expect(rows[1]).toHaveTextContent("Ask");
        expect(rows[1]).toHaveTextContent("9,480,213");
        expect(rows[2]).toHaveTextContent("Document processing");
    });
});
