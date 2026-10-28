/** @jest-environment jsdom */

/**
 * A chat request refused at an AI limit (HTTP 429, `code: "ai_allowance_reached"`)
 * keeps its code from the response to the answer on screen: useAIChat passes
 * it through, and the runtime marks the failed answer so the panel offers no
 * retry. The server's sentence is the answer's text.
 */

import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";

import { useAIChat } from "../../hooks/useAIChat";
import * as sessions from "../sessionApi";
import type { ComposerSend, ThreadMessage } from "../types";
import { useChatRuntime } from "../useChatRuntime";

jest.mock("../sessionApi", () => ({
    createSession: jest.fn(),
    appendMessages: jest.fn(),
    updateQueue: jest.fn(),
    claimQueuedMessage: jest.fn(),
    truncateMessages: jest.fn(),
    fetchSession: jest.fn(),
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));

const REFUSAL =
    "You've reached your AI limit in this workspace for this month (1,000,400 of 1,000,000 tokens). It resets on November 1, 2026. A workspace admin can raise it in Workspace › Usage and costs.";

const fetchMock = jest.fn();

function refuse() {
    fetchMock.mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({
            success: false,
            code: "ai_allowance_reached",
            error: REFUSAL,
            message: REFUSAL,
            allowance: {},
        }),
    });
}

const send = (text: string): ComposerSend => ({
    text,
    refs: [],
    attachments: [],
    webSearch: true,
    thinking: true,
    agentKey: null,
});

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    let id = 0;
    Object.defineProperty(crypto, "randomUUID", {
        configurable: true,
        value: () => `message-${++id}`,
    });
    jest.mocked(sessions.createSession).mockImplementation(
        async () => ({ id: `session-${++id}` }) as unknown as sessions.StoredSession
    );
    jest.mocked(sessions.appendMessages).mockResolvedValue({} as unknown as sessions.StoredSession);
});

test("useAIChat returns the refusal's code and sentence", async () => {
    refuse();
    const { result } = renderHook(() => useAIChat());
    let response: Awaited<ReturnType<typeof result.current.sendQuery>> | undefined;
    await act(async () => {
        response = await result.current.sendQuery(
            { question: "hi", searchScope: "none" },
            { stream: true }
        );
    });
    expect(response).toEqual({ success: false, message: REFUSAL, code: "ai_allowance_reached" });
});

test("useAIChat leaves the code off other failures", async () => {
    fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ success: false, message: "The model timed out." }),
    });
    const { result } = renderHook(() => useAIChat());
    let response: Awaited<ReturnType<typeof result.current.sendQuery>> | undefined;
    await act(async () => {
        response = await result.current.sendQuery({ question: "hi", searchScope: "none" });
    });
    expect(response).toEqual({ success: false, message: "The model timed out." });
});

test("the runtime marks an answer refused at the limit, with the server's sentence", async () => {
    refuse();
    const { result } = renderHook(() => {
        const [thread, setThread] = useState<ThreadMessage[]>([]);
        const sessionIdRef = useRef<string | null>(null);
        const hydratedSession = useRef<string | null>(null);
        const runtime = useChatRuntime({
            thread,
            setThread,
            sessionIdRef,
            hydratedSession,
            setSessionParam: jest.fn(),
            continuation: null,
            sources: [],
            agents: [],
            companyId: 1,
            refreshHistory: jest.fn(),
        });
        return { runtime, thread };
    });

    let sent: unknown;
    await act(async () => {
        sent = await result.current.runtime.submit(send("Summarise the MSA"));
    });

    expect(sent).toBe(false);
    const answer = result.current.thread.at(-1);
    expect(answer).toMatchObject({
        role: "assistant",
        status: "error",
        failureCode: "ai_allowance_reached",
        text: REFUSAL,
    });
});
