/** @jest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { useChatRuntime } from "../useChatRuntime";
import type { ComposerSend, ThreadMessage, WorkspaceSource } from "../types";
import * as sessions from "../sessionApi";

const mockRequest = jest.fn();
jest.mock("../../hooks/useAIChat", () => ({ useAIChat: () => ({ sendQuery: mockRequest }) }));
jest.mock("../sessionApi", () => ({
    createSession: jest.fn(),
    appendMessages: jest.fn(),
    updateQueue: jest.fn(),
    claimQueuedMessage: jest.fn(),
    truncateMessages: jest.fn(),
    fetchSession: jest.fn(),
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));

const send = (text: string): ComposerSend => ({
    text,
    refs: [],
    attachments: [],
    webSearch: false,
    thinking: false,
    agentKey: null,
});
const answer = (text: string) => ({
    success: true,
    summarizedAnswer: text,
    aiModel: "configured-model",
});
function harness(
    initial: ThreadMessage[] = [],
    sources: WorkspaceSource[] = [],
    options: { continuation?: { title: string; context: string } | null; scopeKey?: string } = {}
) {
    return renderHook(
        ({ scopeKey }) => {
            const [thread, setThread] = useState(initial);
            const [continuation, setContinuation] = useState(options.continuation ?? null);
            const sessionIdRef = useRef<string | null>(null);
            const hydratedSession = useRef<string | null>(null);
            const runtime = useChatRuntime({
                scopeKey,
                thread,
                setThread,
                sessionIdRef,
                hydratedSession,
                setSessionParam: jest.fn(),
                continuation,
                sources,
                agents: [],
                companyId: 1,
                refreshHistory: jest.fn(),
            });
            return { runtime, thread, setContinuation };
        },
        { initialProps: { scopeKey: options.scopeKey } }
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    let id = 0;
    Object.defineProperty(crypto, "randomUUID", {
        configurable: true,
        value: () => `message-${++id}`,
    });
    jest.mocked(sessions.createSession).mockImplementation(
        async () => ({ id: `session-${++id}` }) as unknown as sessions.StoredSession
    );
    jest.mocked(sessions.appendMessages).mockResolvedValue({} as unknown as sessions.StoredSession);
    jest.mocked(sessions.updateQueue).mockImplementation(async (_id, revision, items) => ({
        items,
        revision: revision + 1,
    }));
    jest.mocked(sessions.claimQueuedMessage).mockImplementation(async (_id, revision, id) => {
        const latest = jest.mocked(sessions.updateQueue).mock.calls.at(-1)?.[2] ?? [];
        return {
            revision: revision + 1,
            items: latest.filter(item => item.id !== id),
            claimed: latest.find(item => item.id === id),
        };
    });
    jest.mocked(sessions.truncateMessages).mockResolvedValue();
    mockRequest.mockResolvedValue(answer("The response"));
});

test("normal follow-ups carry real prior turns and use general chat with no readable sources", async () => {
    const { result } = harness();
    await act(async () => {
        await result.current.runtime.submit(send("Remember Paris"));
    });
    await act(async () => {
        await result.current.runtime.submit(send("Which city?"));
    });
    expect(mockRequest.mock.calls[0][0].searchScope).toBe("none");
    expect(mockRequest.mock.calls[0][0]).toMatchObject({
        enableWebSearch: true,
        thinkingMode: "auto",
    });
    expect(result.current.thread[0]?.send).toMatchObject({ webSearch: true, thinking: true });
    expect(mockRequest.mock.calls[1][0].conversationHistory).toContain("User: Remember Paris");
    expect(mockRequest.mock.calls[1][0].conversationHistory).toContain("Assistant: The response");
    expect(result.current.thread).toHaveLength(4);
    expect(sessions.createSession).toHaveBeenCalledTimes(1);
    expect(sessions.appendMessages).toHaveBeenCalledTimes(3);
});

test("stop retains partial response and holds durable queued follow-ups until resume", async () => {
    mockRequest.mockImplementationOnce(
        (_params, options) =>
            new Promise(resolve => {
                options.onEvent({ type: "text", delta: "Partial answer" });
                options.signal.addEventListener(
                    "abort",
                    () => resolve({ success: false, cancelled: true }),
                    { once: true }
                );
            })
    );
    const { result } = harness();
    let running: Promise<unknown>;
    act(() => {
        running = result.current.runtime.submit(send("First"));
    });
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
    await act(async () => {
        await result.current.runtime.submit(send("Next"));
    });
    expect(result.current.runtime.queue.items[0]?.send.text).toBe("Next");
    await act(async () => {
        result.current.runtime.stop();
        await running!;
    });
    expect(result.current.thread.at(-1)).toMatchObject({
        text: "Partial answer",
        status: "stopped",
    });
    expect(result.current.runtime.held).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(1);
    await act(async () => {
        await result.current.runtime.resume();
    });
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(result.current.runtime.queue.items).toEqual([]);
    expect(result.current.thread.at(-1)?.status).toBe("complete");
});

test("a late response and queue dispatch remain in the originating background conversation", async () => {
    let finish: (response: ReturnType<typeof answer>) => void = () => undefined;
    mockRequest.mockImplementationOnce(
        () =>
            new Promise(resolve => {
                finish = resolve;
            })
    );
    const { result } = harness();
    let running: Promise<unknown>;
    act(() => {
        running = result.current.runtime.submit(send("Background"));
    });
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
    act(() => {
        result.current.runtime.newChat();
    });
    await act(async () => {
        await result.current.runtime.submit(send("Foreground"));
    });
    await act(async () => {
        finish(answer("Background result"));
        await running!;
    });
    expect(result.current.thread.map(message => message.text)).toEqual([
        "Foreground",
        "The response",
    ]);
    expect(sessions.appendMessages).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
            messages: [expect.objectContaining({ text: "Background result" })],
        })
    );
});

test("fork saves the full transcript across append batches instead of keeping only its tail", async () => {
    const history = Array.from(
        { length: 14 },
        (_, index): ThreadMessage => ({
            role: index % 2 ? "assistant" : "user",
            text: `Turn ${index}`,
        })
    );
    const { result } = harness(history);
    await act(async () => {
        await result.current.runtime.submit(send("Follow up"));
    });
    const saved = [
        ...jest.mocked(sessions.createSession).mock.calls[0]![0].messages,
        ...jest.mocked(sessions.appendMessages).mock.calls.flatMap(call => call[1].messages),
    ];
    expect(saved.slice(0, 14).map(message => message.text)).toEqual(
        history.map(message => message.text)
    );
    expect(saved).toHaveLength(16);
});

test("rewind removes later provider context and persists a guarded truncation", async () => {
    const { result } = harness();
    await act(async () => {
        await result.current.runtime.submit(send("Original"));
    });
    await act(async () => {
        await result.current.runtime.rewind(0);
        await result.current.runtime.submit(send("Edited"));
    });
    expect(sessions.truncateMessages).toHaveBeenCalledWith(expect.any(String), 0, 2);
    expect(mockRequest.mock.calls[1][0].conversationHistory).toBeUndefined();
    expect(result.current.thread[0]?.text).toBe("Edited");
});

test("retry after delayed truncation stays in its original conversation and preserves its continuation", async () => {
    const originContinuation = {
        title: "Original source",
        context: "Original continuation context",
    };
    const { result } = harness([], [], { continuation: originContinuation });
    const history: sessions.SessionMessagePayload[] = [
        { role: "user", text: "Earlier decision" },
        { role: "assistant", text: "Earlier answer" },
        { role: "user", text: "Retry this question" },
        { role: "assistant", text: "Failed answer" },
    ];
    act(() => {
        result.current.runtime.open("original", {
            id: "original",
            messages: history,
            continuation: originContinuation,
        } as unknown as sessions.StoredSession);
    });
    const originKey = result.current.runtime.key;
    let finishTruncate: () => void = () => undefined;
    jest.mocked(sessions.truncateMessages).mockImplementationOnce(
        () =>
            new Promise<void>(resolve => {
                finishTruncate = resolve;
            })
    );
    let retrying: ReturnType<typeof result.current.runtime.retry>;
    act(() => {
        retrying = result.current.runtime.retry(2, send("Retry this question"));
    });
    await waitFor(() => expect(sessions.truncateMessages).toHaveBeenCalledWith("original", 2, 4));
    act(() => {
        result.current.runtime.newChat();
        result.current.setContinuation({
            title: "Different source",
            context: "Foreground continuation",
        });
    });
    const foregroundKey = result.current.runtime.key;
    expect(foregroundKey).not.toBe(originKey);
    await act(async () => {
        finishTruncate();
        await retrying!;
    });
    expect(result.current.runtime.key).toBe(foregroundKey);
    expect(result.current.thread).toEqual([]);
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest.mock.calls[0]![0]).toMatchObject({ question: "Retry this question" });
    expect(mockRequest.mock.calls[0]![0].conversationHistory).toContain("Earlier decision");
    expect(mockRequest.mock.calls[0]![0].conversationHistory).toContain(
        "Original continuation context"
    );
    expect(mockRequest.mock.calls[0]![0].conversationHistory).not.toContain(
        "Foreground continuation"
    );
    expect(mockRequest.mock.calls[0]![0].conversationHistory).not.toContain("Failed answer");
    expect(sessions.createSession).not.toHaveBeenCalled();
    expect(sessions.appendMessages).toHaveBeenCalledTimes(2);
    expect(jest.mocked(sessions.appendMessages).mock.calls.every(([id]) => id === "original")).toBe(
        true
    );
    expect(jest.mocked(sessions.appendMessages).mock.calls[0]![1].messages[0]?.text).toBe(
        "Retry this question"
    );
    act(() => {
        result.current.runtime.open("original");
    });
    expect(result.current.thread.map(message => message.text)).toEqual([
        "Earlier decision",
        "Earlier answer",
        "Retry this question",
        "The response",
    ]);
});

test("delayed edit rewind returns the originating identity after navigation without changing the new chat", async () => {
    const { result } = harness();
    act(() => {
        result.current.runtime.open("original", {
            id: "original",
            messages: [
                { role: "user", text: "Edit this" },
                { role: "assistant", text: "Old answer" },
            ],
        } as unknown as sessions.StoredSession);
    });
    const originKey = result.current.runtime.key;
    let finishTruncate: () => void = () => undefined;
    jest.mocked(sessions.truncateMessages).mockImplementationOnce(
        () =>
            new Promise<void>(resolve => {
                finishTruncate = resolve;
            })
    );
    let rewinding: ReturnType<typeof result.current.runtime.rewind>;
    act(() => {
        rewinding = result.current.runtime.rewind(0);
    });
    await waitFor(() => expect(sessions.truncateMessages).toHaveBeenCalledTimes(1));
    act(() => {
        result.current.runtime.newChat();
    });
    const foregroundKey = result.current.runtime.key;
    await act(async () => {
        finishTruncate();
        expect(await rewinding!).toBe(originKey);
    });
    expect(result.current.runtime.key).toBe(foregroundKey);
    expect(result.current.thread).toEqual([]);
    expect(mockRequest).not.toHaveBeenCalled();
    expect(sessions.appendMessages).not.toHaveBeenCalled();
    act(() => {
        result.current.runtime.open("original");
    });
    expect(result.current.thread).toEqual([]);
});

test("a delayed retry rejects an origin from a previous auth scope even when the session key is reused", async () => {
    const { result, rerender } = harness([], [], { scopeKey: "first-user:first-company" });
    act(() => {
        result.current.runtime.open("original", {
            id: "original",
            messages: [
                { role: "user", text: "Private old question" },
                { role: "assistant", text: "Private old answer" },
            ],
        } as unknown as sessions.StoredSession);
    });
    let finishTruncate: () => void = () => undefined;
    jest.mocked(sessions.truncateMessages).mockImplementationOnce(
        () =>
            new Promise<void>(resolve => {
                finishTruncate = resolve;
            })
    );
    let retrying: Promise<unknown>;
    act(() => {
        retrying = result.current.runtime.retry(0, send("Private old question")).catch(() => false);
    });
    await waitFor(() => expect(sessions.truncateMessages).toHaveBeenCalledTimes(1));
    rerender({ scopeKey: "second-user:second-company" });
    act(() => {
        result.current.runtime.open("original", {
            id: "original",
            messages: [],
        } as unknown as sessions.StoredSession);
    });
    await act(async () => {
        finishTruncate();
        expect(await retrying!).toBe(false);
    });
    expect(result.current.thread).toEqual([]);
    expect(mockRequest).not.toHaveBeenCalled();
    expect(sessions.appendMessages).not.toHaveBeenCalled();
    expect(sessions.createSession).not.toHaveBeenCalled();
});

test("a concurrent follow-up queues during delayed retry and runs after the retried question with every turn saved", async () => {
    const { result } = harness();
    const persisted: sessions.SessionMessagePayload[] = [
        { role: "user", text: "Original question" },
        { role: "assistant", text: "Old answer" },
    ];
    act(() => {
        result.current.runtime.open("original", {
            id: "original",
            messages: [...persisted],
        } as unknown as sessions.StoredSession);
    });
    let finishTruncate: () => void = () => undefined;
    jest.mocked(sessions.truncateMessages).mockImplementationOnce(
        () =>
            new Promise<void>(resolve => {
                finishTruncate = () => {
                    persisted.splice(0);
                    resolve();
                };
            })
    );
    jest.mocked(sessions.appendMessages).mockImplementation(async (_id, payload) => {
        persisted.push(...payload.messages);
        return {} as unknown as sessions.StoredSession;
    });
    jest.mocked(sessions.claimQueuedMessage).mockImplementation(async (_id, revision, id) => {
        const latest = jest.mocked(sessions.updateQueue).mock.calls.at(-1)?.[2] ?? [];
        const claimed = latest.find(item => item.id === id);
        const claimedMessage = claimed
            ? {
                  role: "user" as const,
                  text: claimed.send.text,
                  metadata: { id: "claimed-follow-up", send: claimed.send },
              }
            : undefined;
        if (claimedMessage) persisted.push(claimedMessage);
        return {
            revision: revision + 1,
            items: latest.filter(item => item.id !== id),
            claimed,
            claimedMessage,
        };
    });
    mockRequest.mockImplementation(async params =>
        answer(params.question === "Original question" ? "Retry answer" : "Follow-up answer")
    );
    let retrying: ReturnType<typeof result.current.runtime.retry>;
    let following: ReturnType<typeof result.current.runtime.submit>;
    act(() => {
        retrying = result.current.runtime.retry(0, send("Original question"));
    });
    await waitFor(() => expect(sessions.truncateMessages).toHaveBeenCalledWith("original", 0, 2));
    expect(result.current.runtime.busy).toBe(true);
    act(() => {
        following = result.current.runtime.submit(send("Concurrent follow-up"));
    });
    expect(mockRequest).not.toHaveBeenCalled();
    await act(async () => {
        finishTruncate();
        await Promise.all([retrying!, following!]);
    });
    expect(mockRequest.mock.calls.map(([params]) => params.question)).toEqual([
        "Original question",
        "Concurrent follow-up",
    ]);
    expect(persisted.map(message => [message.role, message.text])).toEqual([
        ["user", "Original question"],
        ["assistant", "Retry answer"],
        ["user", "Concurrent follow-up"],
        ["assistant", "Follow-up answer"],
    ]);
    expect(jest.mocked(sessions.appendMessages).mock.calls.every(([id]) => id === "original")).toBe(
        true
    );
    expect(sessions.createSession).not.toHaveBeenCalled();
    expect(result.current.thread.map(message => message.text)).toEqual([
        "Original question",
        "Retry answer",
        "Concurrent follow-up",
        "Follow-up answer",
    ]);
    expect(result.current.runtime.queue.items).toEqual([]);
});

test("a deferred queue claim cannot dispatch or overwrite a reused conversation after auth scope changes", async () => {
    const { result, rerender } = harness([], [], { scopeKey: "first-user:first-company" });
    const oldItem = { id: "old-queue", send: send("Private old queued question") };
    act(() => {
        result.current.runtime.open("saved", {
            id: "saved",
            messages: [],
            queuedMessages: [oldItem],
            queueRevision: 0,
        } as unknown as sessions.StoredSession);
    });
    let finishClaim: (value: sessions.QueueState) => void = () => undefined;
    jest.mocked(sessions.claimQueuedMessage).mockImplementationOnce(
        () =>
            new Promise(resolve => {
                finishClaim = resolve;
            })
    );
    let resuming: ReturnType<typeof result.current.runtime.resume>;
    act(() => {
        resuming = result.current.runtime.resume();
    });
    await waitFor(() =>
        expect(sessions.claimQueuedMessage).toHaveBeenCalledWith("saved", 0, "old-queue")
    );
    rerender({ scopeKey: "second-user:second-company" });
    const newItem = { id: "new-queue", send: send("Current workspace queued question") };
    act(() => {
        result.current.runtime.open("saved", {
            id: "saved",
            messages: [{ role: "user", text: "Current workspace message" }],
            queuedMessages: [newItem],
            queueRevision: 9,
        } as unknown as sessions.StoredSession);
    });
    await act(async () => {
        finishClaim({
            items: [],
            revision: 1,
            claimed: oldItem,
            claimedMessage: {
                role: "user",
                text: oldItem.send.text,
                metadata: { id: "old-claimed-turn", send: oldItem.send },
            },
        });
        await resuming!;
    });
    expect(mockRequest).not.toHaveBeenCalled();
    expect(sessions.appendMessages).not.toHaveBeenCalled();
    expect(sessions.createSession).not.toHaveBeenCalled();
    expect(result.current.thread.map(message => message.text)).toEqual([
        "Current workspace message",
    ]);
    expect(result.current.runtime.queue.items).toEqual([newItem]);
    expect(result.current.runtime.queue.revision).toBe(9);
    expect(result.current.runtime.held).toBe(true);
});

test("reopened queue stays held and a revision conflict adopts server state without overwriting it", async () => {
    const { result } = harness();
    act(() => {
        result.current.runtime.open("saved", {
            id: "saved",
            queuedMessages: [{ id: "queued", send: send("Saved queue") }],
            queueRevision: 4,
            messages: [],
        } as unknown as sessions.StoredSession);
    });
    expect(result.current.runtime.held).toBe(true);
    expect(mockRequest).not.toHaveBeenCalled();
    jest.mocked(sessions.updateQueue).mockResolvedValueOnce({
        items: [{ id: "other-tab", send: send("Other tab") }],
        revision: 5,
        conflict: true,
    });
    await act(async () => {
        await result.current.runtime.modifyQueue([]);
    });
    expect(result.current.runtime.queue.items[0]?.id).toBe("other-tab");
    expect(result.current.runtime.held).toBe(true);
});

test("attachment-only chat bypasses unrelated indexed sources", async () => {
    const { result } = harness(
        [],
        [
            {
                id: "d9",
                documentId: 9,
                title: "Unrelated source",
                type: "doc",
                size: "12 B",
                added: "Today",
                folder: "General",
                tags: [],
                domain: "General",
            },
        ]
    );
    const payload = {
        ...send(""),
        attachments: [
            {
                id: "a",
                name: "note.txt",
                mimeType: "text/plain",
                size: 12,
                kind: "text" as const,
                url: "https://uploads.test/a",
            },
        ],
    };
    await act(async () => {
        expect(await result.current.runtime.submit(payload)).toBe(true);
    });
    expect(mockRequest.mock.calls[0][0]).toMatchObject({
        searchScope: "none",
        attachments: [expect.objectContaining({ name: "note.txt" })],
    });
});

test("referenced threads add authorized history and missing threads fail with recovery acknowledgement", async () => {
    jest.mocked(sessions.fetchSession)
        .mockResolvedValueOnce({
            id: "reference",
            title: "Planning",
            messages: [{ role: "user", text: "We chose Boston" }],
        } as unknown as sessions.StoredSession)
        .mockResolvedValueOnce(null);
    const { result } = harness();
    await act(async () => {
        await result.current.runtime.submit({ ...send("Where?"), threadRefs: ["reference"] });
    });
    expect(mockRequest.mock.calls[0][0].conversationHistory).toContain(
        "Referenced conversation: Planning"
    );
    expect(mockRequest.mock.calls[0][0].conversationHistory).toContain("We chose Boston");
    await act(async () => {
        expect(
            await result.current.runtime.submit({
                ...send("Read removed chat"),
                threadRefs: ["removed"],
            })
        ).toBe(false);
    });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(result.current.thread.at(-1)?.status).toBe("error");
});

test("comparison creates separate real requests and persists complete context for each route", async () => {
    const { result } = harness([{ role: "user", text: "Prior decision" }]);
    await act(async () => {
        await result.current.runtime.submit({
            ...send("Compare"),
            modelRoute: "reasoning",
            reasoningEffort: "primary-model-only",
            modelRoutes: ["fast", "reasoning"],
        });
    });
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(new Set(mockRequest.mock.calls.map(call => call[0].modelRoute))).toEqual(
        new Set(["fast", "reasoning"])
    );
    for (const [request] of mockRequest.mock.calls) {
        expect(request.conversationHistory).toContain("Prior decision");
        expect(request).toMatchObject({ enableWebSearch: true, thinkingMode: "auto" });
        expect(request.reasoningEffort).toBe(
            request.modelRoute === "reasoning" ? "primary-model-only" : undefined
        );
    }
    expect(sessions.createSession).toHaveBeenCalledTimes(2);
    expect(result.current.thread).toHaveLength(3);
});

test("failed durable queue edit reports false and send-now does not interrupt on conflict", async () => {
    const { result } = harness();
    act(() => {
        result.current.runtime.open("saved", {
            id: "saved",
            queuedMessages: [{ id: "queued", send: send("Saved") }],
            queueRevision: 4,
            messages: [],
        } as unknown as sessions.StoredSession);
    });
    jest.mocked(sessions.updateQueue).mockResolvedValue({
        items: [{ id: "queued", send: send("Server") }],
        revision: 5,
        conflict: true,
    });
    await act(async () => {
        expect(await result.current.runtime.modifyQueue([])).toBe(false);
        await result.current.runtime.sendNow("queued");
    });
    expect(sessions.claimQueuedMessage).not.toHaveBeenCalled();
    expect(result.current.runtime.queue.items[0]?.send.text).toBe("Server");
});

test("a follow-up saved after active response finishes still dispatches automatically", async () => {
    let finishResponse: (value: ReturnType<typeof answer>) => void = () => undefined;
    let finishQueue: (value: sessions.QueueState) => void = () => undefined;
    mockRequest.mockImplementationOnce(
        () =>
            new Promise(resolve => {
                finishResponse = resolve;
            })
    );
    jest.mocked(sessions.updateQueue).mockImplementationOnce(
        () =>
            new Promise(resolve => {
                finishQueue = resolve;
            })
    );
    const { result } = harness();
    let active: Promise<unknown>;
    let queued: Promise<unknown>;
    act(() => {
        active = result.current.runtime.submit(send("Active"));
    });
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
    act(() => {
        queued = result.current.runtime.submit(send("Follow-up"));
    });
    await waitFor(() => expect(sessions.updateQueue).toHaveBeenCalledTimes(1));
    await act(async () => {
        finishResponse(answer("Done"));
    });
    const items = jest.mocked(sessions.updateQueue).mock.calls[0]![2];
    await act(async () => {
        finishQueue({ items, revision: 1 });
        await active!;
        await queued!;
    });
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(result.current.runtime.queue.items).toEqual([]);
});

test("claim's persisted user turn is not appended again before generation", async () => {
    const { result } = harness();
    const payload = send("Durable question");
    act(() => {
        result.current.runtime.open("saved", {
            id: "saved",
            queuedMessages: [{ id: "q", send: payload }],
            queueRevision: 0,
            messages: [],
        } as unknown as sessions.StoredSession);
    });
    jest.mocked(sessions.claimQueuedMessage).mockResolvedValueOnce({
        items: [],
        revision: 1,
        claimed: { id: "q", send: payload },
        claimedMessage: {
            role: "user",
            text: payload.text,
            createdAt: "2026-10-04T12:00:00Z",
            metadata: { id: "durable-id", send: payload },
        },
    });
    await act(async () => {
        await result.current.runtime.resume();
    });
    expect(result.current.thread[0]).toMatchObject({ id: "durable-id", text: "Durable question" });
    expect(mockRequest.mock.calls[0][0]).toMatchObject({
        enableWebSearch: true,
        thinkingMode: "auto",
    });
    expect(result.current.thread[0]?.send).toMatchObject({ webSearch: true, thinking: true });
    expect(sessions.appendMessages).toHaveBeenCalledTimes(1);
    expect(jest.mocked(sessions.appendMessages).mock.calls[0]![1].messages[0]?.role).toBe(
        "assistant"
    );
});

test("retrying a stored false draft uses automatic defaults and keeps its chosen model", async () => {
    const legacy = { ...send("Legacy question"), modelRoute: "fast" as const };
    const { result } = harness();
    act(() => {
        result.current.runtime.open("saved", {
            id: "saved",
            messages: [
                { role: "user", text: legacy.text, metadata: { send: legacy } },
                { role: "assistant", text: "Old answer" },
            ],
        } as unknown as sessions.StoredSession);
    });
    await act(async () => {
        await result.current.runtime.retry(0, legacy);
    });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest.mock.calls[0][0]).toMatchObject({
        enableWebSearch: true,
        thinkingMode: "auto",
        modelRoute: "fast",
    });
    expect(result.current.thread[0]?.send).toMatchObject({ webSearch: true, thinking: true });
    expect(legacy).toMatchObject({ webSearch: false, thinking: false });
});

test("mixed model comparison reports only failed route selections for restoration", async () => {
    mockRequest.mockImplementation(async params =>
        params.modelRoute === "fast"
            ? answer("Fast result")
            : { success: false, message: "Reasoning provider failed" }
    );
    const { result } = harness();
    await act(async () => {
        expect(
            await result.current.runtime.submit({
                ...send("Compare"),
                modelRoutes: ["fast", "reasoning"],
            })
        ).toEqual({ success: false, failedModelRoutes: ["reasoning"] });
    });
});

test("an overlapping queue edit keeps its captured revision instead of resurrecting a claimed item", async () => {
    const { result } = harness();
    const item = { id: "q", send: send("Claimed question") };
    act(() => {
        result.current.runtime.open("saved", {
            id: "saved",
            queuedMessages: [item],
            queueRevision: 4,
            messages: [],
        } as unknown as sessions.StoredSession);
    });
    let finishClaim: (value: sessions.QueueState) => void = () => undefined;
    jest.mocked(sessions.claimQueuedMessage).mockImplementationOnce(
        () =>
            new Promise(resolve => {
                finishClaim = resolve;
            })
    );
    let resume: Promise<unknown>;
    let edit: Promise<unknown>;
    act(() => {
        resume = result.current.runtime.resume();
    });
    await waitFor(() => expect(sessions.claimQueuedMessage).toHaveBeenCalledTimes(1));
    act(() => {
        edit = result.current.runtime.modifyQueue([{ ...item, send: send("Stale edit") }]);
    });
    jest.mocked(sessions.updateQueue).mockResolvedValueOnce({
        items: [],
        revision: 5,
        conflict: true,
    });
    await act(async () => {
        finishClaim({
            items: [],
            revision: 5,
            claimed: item,
            claimedMessage: {
                role: "user",
                text: item.send.text,
                metadata: { id: "persisted", send: item.send },
            },
        });
        await resume!;
        await edit!;
    });
    expect(sessions.updateQueue).toHaveBeenCalledWith("saved", 4, expect.any(Array));
    expect(result.current.runtime.queue.items).toEqual([]);
});

test("new-chat identity survives reload and a created session reopens under its original draft key", async () => {
    const first = harness();
    const originalKey = first.result.current.runtime.key;
    first.unmount();
    const reloaded = harness();
    expect(reloaded.result.current.runtime.key).toBe(originalKey);
    await act(async () => {
        await reloaded.result.current.runtime.submit(send("Create persistent chat"));
    });
    const id = jest.mocked(sessions.appendMessages).mock.calls[0]![0];
    reloaded.unmount();
    const reopened = harness();
    act(() => {
        reopened.result.current.runtime.open(id, {
            id,
            messages: [],
        } as unknown as sessions.StoredSession);
    });
    expect(reopened.result.current.runtime.key).toBe(originalKey);
    act(() => {
        reopened.result.current.runtime.newChat();
    });
    expect(reopened.result.current.runtime.key).not.toBe(originalKey);
    const nextKey = reopened.result.current.runtime.key;
    reopened.unmount();
    expect(harness().result.current.runtime.key).toBe(nextKey);
});

test("fork persists the entire prefix and parent relationship immediately before any new send", async () => {
    const { result } = harness();
    const prefix = Array.from(
        { length: 14 },
        (_, index): ThreadMessage => ({
            role: index % 2 ? "assistant" : "user",
            text: `Fork turn ${index}`,
            ...(index === 0 ? { forkedFromSessionId: "parent-chat" } : {}),
        })
    );
    await act(async () => {
        expect(await result.current.runtime.fork(prefix)).toBe(true);
    });
    expect(mockRequest).not.toHaveBeenCalled();
    const saved = [
        ...jest.mocked(sessions.createSession).mock.calls[0]![0].messages,
        ...jest.mocked(sessions.appendMessages).mock.calls.flatMap(call => call[1].messages),
    ];
    expect(saved).toHaveLength(14);
    expect(saved[0]?.metadata?.forkedFromSessionId).toBe("parent-chat");
});

test("auth hydration switches from unknown scope to the persisted user's new-chat identity", () => {
    localStorage.setItem(
        "launchstack.chat-identity.user:company",
        JSON.stringify({ activeNew: "new-authenticated", sessions: {} })
    );
    function mount() {
        return renderHook(
            ({ scope }) => {
                const [thread, setThread] = useState<ThreadMessage[]>([]);
                const sessionIdRef = useRef<string | null>(null);
                const hydratedSession = useRef<string | null>(null);
                return useChatRuntime({
                    scopeKey: scope,
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
            },
            { initialProps: { scope: "null:null" } }
        );
    }
    const first = mount();
    first.rerender({ scope: "user:company" });
    expect(first.result.current.key).toBe("new-authenticated");
    first.unmount();
    const second = mount();
    second.rerender({ scope: "user:company" });
    expect(second.result.current.key).toBe("new-authenticated");
});
