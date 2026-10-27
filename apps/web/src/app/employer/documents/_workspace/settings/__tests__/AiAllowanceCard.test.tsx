/** @jest-environment jsdom */

/**
 * Settings › Account › Your AI allowance this month: used of limit, when it
 * resets, which limit applies and who can change it — or plainly "No limit".
 */

import React from "react";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import { AiAllowanceCard } from "../AiAllowanceCard";
import type { AiAllowance } from "../aiAllowance";

function allowance(over: Partial<AiAllowance> = {}): AiAllowance {
    return {
        start: "2026-10-01",
        resetsAt: "2026-11-01T00:00:00.000Z",
        used: 250_000,
        workspace: { limit: 1_000_000, source: "default" },
        server: null,
        binding: "workspace",
        percent: 25,
        blocked: false,
        ...over,
    };
}

const fetchMock = jest.fn();

function answer(status: number, body: unknown) {
    fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => body });
    global.fetch = fetchMock as unknown as typeof fetch;
}

beforeEach(() => fetchMock.mockReset());

describe("AiAllowanceCard", () => {
    it("shows the workspace default: used of limit, reset date, and who can change it", async () => {
        answer(200, { allowance: allowance() });
        render(<AiAllowanceCard />);

        const summary = await screen.findByTestId("ai-allowance-summary");
        expect(fetchMock).toHaveBeenCalledWith("/api/ai-allowance", expect.anything());
        expect(screen.getByText("Your AI allowance this month")).toBeInTheDocument();
        expect(summary).toHaveTextContent("250,000 of 1,000,000 tokens");
        expect(summary).toHaveTextContent("25% used");
        expect(summary).toHaveTextContent("Resets on November 1, 2026.");
        expect(summary).toHaveTextContent(
            "This is the workspace's limit for everyone. Workspace admins can change it in Workspace › Usage and costs."
        );
        expect(within(summary).getByRole("progressbar")).toHaveAttribute("data-tone", "normal");
    });

    it("reads some use under 1% as <1%, not as unused", async () => {
        answer(200, { allowance: allowance({ used: 9_290, percent: 0.9 }) });
        render(<AiAllowanceCard />);
        const summary = await screen.findByTestId("ai-allowance-summary");
        expect(summary).toHaveTextContent("<1% used");
    });

    it("says an admin set your own limit, warns from 80% and mentions the server's cap too", async () => {
        answer(200, {
            allowance: allowance({
                used: 900_000,
                workspace: { limit: 1_000_000, source: "member" },
                server: { limit: 5_000_000, used: 1_200_000 },
                percent: 90,
            }),
        });
        render(<AiAllowanceCard />);
        const summary = await screen.findByTestId("ai-allowance-summary");
        expect(summary).toHaveTextContent("A workspace admin set this limit for you.");
        expect(summary).toHaveTextContent(
            "The server also caps you at 5,000,000 tokens a month across all your workspaces (1,200,000 used)."
        );
        expect(within(summary).getByRole("progressbar")).toHaveAttribute("data-tone", "warn");
    });

    it("names the server as the limit and whoever runs it, once that binds and is reached", async () => {
        answer(200, {
            allowance: allowance({
                used: 300_000,
                workspace: { limit: null, source: "default" },
                server: { limit: 2_000_000, used: 2_000_000 },
                binding: "server",
                percent: 100,
                blocked: true,
            }),
        });
        render(<AiAllowanceCard />);
        const summary = await screen.findByTestId("ai-allowance-summary");
        expect(summary).toHaveTextContent("2,000,000 of 2,000,000 tokens");
        expect(summary).toHaveTextContent(
            "This is the server's limit, counted across all your workspaces. Whoever runs this server can change it."
        );
        expect(summary).toHaveTextContent("300,000 of it in this workspace.");
        expect(summary).toHaveTextContent("You've reached this limit.");
        expect(within(summary).getByRole("progressbar")).toHaveAttribute("data-tone", "danger");
    });

    it("says No limit plainly, with what was used", async () => {
        answer(200, {
            allowance: allowance({
                used: 12_345,
                workspace: { limit: null, source: "default" },
                binding: null,
                percent: null,
            }),
        });
        render(<AiAllowanceCard />);
        const summary = await screen.findByTestId("ai-allowance-summary");
        expect(summary).toHaveTextContent("No limit");
        expect(summary).toHaveTextContent(
            "No limit applies to you in this workspace. You've used 12,345 tokens this month."
        );
        expect(within(summary).queryByRole("progressbar")).not.toBeInTheDocument();
    });

    it("says when the allowance could not be read", async () => {
        answer(500, { error: "Something broke on our side." });
        render(<AiAllowanceCard />);
        expect(await screen.findByText("Something broke on our side.")).toBeInTheDocument();
    });
});
