/** @jest-environment jsdom */

/**
 * The Ask panel and your AI allowance: an amber line above the composer from
 * 80% of the limit, a red one at it — when sending stops — and an answer
 * refused at the limit says why without offering a retry that can't succeed.
 * The allowance is read on mount and again after each answer.
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import { AskPanel, type AskPanelProps } from "../AskPanel";
import type { AiAllowance } from "../settings/aiAllowance";
import type { ThreadMessage } from "../types";

global.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

jest.mock("next-themes", () => ({
    useTheme: () => ({ resolvedTheme: "light", setTheme: jest.fn() }),
}));
jest.mock("../../../_chrome/EmployerWorkspaceSwitcherContext", () => ({
    useEmployerWorkspaceSwitcher: () => ({ name: "Acme" }),
}));
jest.mock("../../hooks/useChatRoutes", () => ({
    useChatRoutes: () => ({ routes: [], loading: false }),
}));
jest.mock("../AskStarters", () => ({ AskStarters: () => null }));

const THREAD: ThreadMessage[] = [
    { id: "q1", role: "user", text: "What changed?", createdAt: "2026-10-04T12:00:00Z" },
    {
        id: "a1",
        role: "assistant",
        text: "A reliable answer.",
        createdAt: "2026-10-04T12:00:01Z",
        status: "complete",
    },
];

function allowance(over: Partial<AiAllowance> = {}): AiAllowance {
    return {
        start: "2026-10-01",
        resetsAt: "2026-11-01T00:00:00.000Z",
        used: 840_000,
        workspace: { limit: 1_000_000, source: "default" },
        server: null,
        binding: "workspace",
        percent: 84,
        blocked: false,
        ...over,
    };
}

const fetchMock = jest.fn();
let current: AiAllowance | null = allowance();

beforeEach(() => {
    localStorage.clear();
    current = allowance();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
        if (url === "/api/ai-allowance") {
            return { ok: true, status: 200, json: async () => ({ allowance: current }) };
        }
        return { ok: false, status: 404, json: async () => ({}) };
    });
    global.fetch = fetchMock as unknown as typeof fetch;
});

function mount(overrides: Partial<AskPanelProps> = {}) {
    const props: AskPanelProps = {
        sources: [],
        selected: [],
        setSelected: jest.fn(),
        thread: THREAD,
        sendMessage: jest.fn(),
        isSending: false,
        onOpenAdd: jest.fn(),
        onNewChat: jest.fn(),
        openPalette: jest.fn(),
        onStudioNavigate: jest.fn(),
        onRetryMessage: jest.fn(),
        ...overrides,
    };
    return { ...render(<AskPanel {...props} />), props };
}

const allowanceCalls = () =>
    fetchMock.mock.calls.filter(([url]) => url === "/api/ai-allowance").length;

describe("AskPanel AI allowance", () => {
    it("says how much is used from 80%, and still sends", async () => {
        const sendMessage = jest.fn();
        mount({ sendMessage });

        const notice = await screen.findByTestId("ai-allowance-notice");
        expect(notice).toHaveAttribute("data-tone", "warn");
        expect(notice).toHaveAttribute("role", "status");
        expect(notice).toHaveTextContent(
            "You've used 84% of your AI allowance this month. It resets on Nov 1."
        );

        const box = screen.getByRole("textbox", { name: "Chat message" });
        fireEvent.change(box, { target: { value: "One more question" } });
        expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
        fireEvent.keyDown(box, { key: "Enter" });
        expect(sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ text: "One more question" })
        );
    });

    it("says nothing below 80% or with no limit", async () => {
        current = allowance({ used: 100, percent: 0 });
        const first = mount();
        await waitFor(() => expect(allowanceCalls()).toBe(1));
        expect(screen.queryByTestId("ai-allowance-notice")).not.toBeInTheDocument();
        first.unmount();

        current = allowance({
            workspace: { limit: null, source: "default" },
            binding: null,
            percent: null,
        });
        mount();
        await waitFor(() => expect(allowanceCalls()).toBe(2));
        expect(screen.queryByTestId("ai-allowance-notice")).not.toBeInTheDocument();
    });

    it("at the limit, says when it resets and who can raise it, and stops sending", async () => {
        current = allowance({ used: 1_000_400, percent: 100, blocked: true });
        const sendMessage = jest.fn();
        const onStudioNavigate = jest.fn();
        mount({ sendMessage, onStudioNavigate });

        const notice = await screen.findByTestId("ai-allowance-notice");
        expect(notice).toHaveAttribute("data-tone", "danger");
        expect(notice).toHaveAttribute("role", "alert");
        expect(notice).toHaveTextContent(
            "You've reached your AI limit in this workspace for this month, so new questions can't be sent. It resets on Nov 1. A workspace admin can raise it in Settings › Usage and costs."
        );

        const box = screen.getByRole("textbox", { name: "Chat message" });
        fireEvent.change(box, { target: { value: "Will this go?" } });
        expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
        fireEvent.keyDown(box, { key: "Enter" });
        expect(sendMessage).not.toHaveBeenCalled();
        // Nothing offers to ask again either.
        expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Your allowance" }));
        expect(onStudioNavigate).toHaveBeenCalledWith("/employer/settings#account");
    });

    it("names the server's cap when that is the limit reached", async () => {
        current = allowance({
            server: { limit: 2_000_000, used: 2_000_000 },
            binding: "server",
            percent: 100,
            blocked: true,
        });
        mount();
        expect(await screen.findByTestId("ai-allowance-notice")).toHaveTextContent(
            "You've reached this server's monthly AI limit, so new questions can't be sent. It resets on Nov 1. Whoever runs this server can raise it."
        );
    });

    it("reads the allowance again when an answer finishes", async () => {
        current = allowance({ used: 100, percent: 10 });
        const { props, rerender } = mount({ isSending: true });
        await waitFor(() => expect(allowanceCalls()).toBe(1));
        expect(screen.queryByTestId("ai-allowance-notice")).not.toBeInTheDocument();

        current = allowance({ used: 1_000_000, percent: 100, blocked: true });
        rerender(<AskPanel {...props} isSending={false} />);
        await waitFor(() => expect(allowanceCalls()).toBe(2));
        expect(await screen.findByTestId("ai-allowance-notice")).toHaveAttribute(
            "data-tone",
            "danger"
        );
    });

    it("shows a refused answer's own sentence and offers no retry", async () => {
        current = allowance({ used: 100, percent: 10 });
        const refusal =
            "You've reached your AI limit in this workspace for this month (1,000,400 of 1,000,000 tokens). It resets on November 1, 2026. A workspace admin can raise it in Settings › Usage and costs.";
        const thread: ThreadMessage[] = [
            { id: "q1", role: "user", text: "Summarise the MSA" },
            {
                id: "a1",
                role: "assistant",
                text: refusal,
                status: "error",
                failureCode: "ai_allowance_reached",
            },
        ];
        mount({ thread });
        await waitFor(() => expect(allowanceCalls()).toBe(1));

        expect(screen.getAllByText(refusal).length).toBeGreaterThan(0);
        expect(
            screen.getByText(
                "You're at your AI limit, so this answer couldn't run. Retrying won't help until the limit resets or is raised."
            )
        ).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    });

    it("still offers a retry for any other failure", async () => {
        current = allowance({ used: 100, percent: 10 });
        const thread: ThreadMessage[] = [
            { id: "q1", role: "user", text: "Summarise the MSA" },
            { id: "a1", role: "assistant", text: "The model timed out.", status: "error" },
        ];
        const onRetryMessage = jest.fn();
        mount({ thread, onRetryMessage });
        await waitFor(() => expect(allowanceCalls()).toBe(1));

        const retries = screen.getAllByRole("button", { name: "Retry" });
        expect(retries.length).toBeGreaterThan(0);
        fireEvent.click(retries[0]!);
        expect(onRetryMessage).toHaveBeenCalledWith(1);
    });
});
