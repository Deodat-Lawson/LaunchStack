/** @jest-environment jsdom */

/**
 * The Usage tab's By kind panel: chat, embeddings and web search in one unit
 * (chat-token equivalents), each with its share and its own units, and the
 * conversion spelled out — so a document's embeddings show as what they cost.
 */

import React from "react";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import { ByKindPanel } from "~/app/employer/documents/_workspace/usage/ByKindPanel";
import type { UsageCounts, UsageRates } from "~/lib/usage/types";

const RATES: UsageRates = {
    chat: { perMillion: 1, source: "default" },
    embeddingPerMillion: 130_000,
    perSearch: 7_000,
};

function totals(over: Partial<UsageCounts> = {}): UsageCounts {
    return {
        questions: 0,
        filesAdded: 0,
        docsOpened: 0,
        aiCalls: 2_330,
        aiTokens: 19_888_000,
        aiSplit: { chat: 16_000_000, embedding: 1_690_000, search: 2_198_000 },
        chatCalls: 2_000,
        inputTokens: 14_000_000,
        outputTokens: 2_000_000,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        embeddedTokens: 13_000_000,
        searches: 286,
        pages: 98,
        costUsd: null,
        ...over,
    };
}

describe("ByKindPanel", () => {
    it("shows each kind's share in the common unit, with its own units beneath", () => {
        render(<ByKindPanel totals={totals()} rates={RATES} />);
        const panel = screen.getByTestId("usage-by-kind");

        const chat = within(panel).getByTestId("usage-kind-chat");
        expect(chat).toHaveTextContent("Chat");
        expect(chat).toHaveTextContent("16M80%");
        expect(chat).toHaveTextContent("14M in · 2M out · 2,000 calls");

        const embedding = within(panel).getByTestId("usage-kind-embedding");
        expect(embedding).toHaveTextContent("1.7M8%");
        expect(embedding).toHaveTextContent("13M tokens embedded");

        const search = within(panel).getByTestId("usage-kind-search");
        expect(search).toHaveTextContent("2.2M11%");
        expect(search).toHaveTextContent("286 searches · 98 pages read");

        expect(panel).toHaveTextContent(
            "Converted by price: a million embedded tokens counts as 130K, and one web search as 7,000"
        );
    });

    it("says a kind wasn't used, and counts one of each in the singular", () => {
        render(
            <ByKindPanel
                totals={totals({
                    aiTokens: 9_900,
                    aiSplit: { chat: 900, embedding: 0, search: 9_000 },
                    chatCalls: 1,
                    inputTokens: 800,
                    outputTokens: 100,
                    embeddedTokens: 0,
                    searches: 1,
                    pages: 1,
                })}
                rates={RATES}
            />
        );
        expect(screen.getByTestId("usage-kind-embedding")).toHaveTextContent("None in this window");
        expect(screen.getByTestId("usage-kind-chat")).toHaveTextContent(
            "800 in · 100 out · 1 call"
        );
        expect(screen.getByTestId("usage-kind-search")).toHaveTextContent("1 search · 1 page read");
    });
});
