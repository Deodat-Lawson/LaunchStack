/** @jest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { TextDecoder, TextEncoder } from "node:util";
import { ReadableStream } from "node:stream/web";

Object.assign(globalThis, { TextEncoder, TextDecoder, ReadableStream });

import { useAIChat, type AIChatResponse } from "~/app/employer/documents/hooks/useAIChat";

describe("useAIChat", () => {
    const fetchMock = jest.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    it("omits provider and aiModel so the server applies the configured route", async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ success: true, summarizedAnswer: "Done" }),
        });

        const { result } = renderHook(() => useAIChat());

        await act(async () => {
            await result.current.sendQuery({
                question: "Use the configured model",
                searchScope: "company",
            });
        });

        const [, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        const body = JSON.parse(request.body as string) as Record<string, unknown>;
        expect(body).not.toHaveProperty("aiModel");
        expect(body).not.toHaveProperty("provider");
    });

    it("returns the endpoint error so the workspace can display it", async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 401,
            json: async () => ({
                success: false,
                message:
                    "The chat endpoint rejected CHAT_API_KEY. Check the credential configured for CHAT_BASE_URL.",
            }),
        });

        const { result } = renderHook(() => useAIChat());
        let response: AIChatResponse | undefined;

        await act(async () => {
            response = await result.current.sendQuery({
                question: "hi",
                searchScope: "company",
            });
        });

        expect(response).toEqual({
            success: false,
            message:
                "The chat endpoint rejected CHAT_API_KEY. Check the credential configured for CHAT_BASE_URL.",
        });
        expect(result.current.error).toBe(
            "The chat endpoint rejected CHAT_API_KEY. Check the credential configured for CHAT_BASE_URL."
        );
    });
});

function streamingResponse(lines: string[]): Response {
    const encoder = new TextEncoder();
    return {
        ok: true,
        headers: new Headers({ "content-type": "application/x-ndjson" }),
        body: new ReadableStream({
            start(controller) {
                for (const line of lines) controller.enqueue(encoder.encode(line));
                controller.close();
            },
        }),
    } as unknown as Response;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve };
}

describe("useAIChat streaming and cancellation", () => {
    const fetchMock = jest.fn();
    beforeEach(() => {
        fetchMock.mockReset();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    it("requests streaming and emits real events before returning the final metadata", async () => {
        fetchMock.mockResolvedValue(
            streamingResponse([
                '{"type":"status","status":"generating"}\n{"type":"te',
                'xt","delta":"Hello"}\n{"type":"reasoning","delta":"Verified"}\n',
                '{"type":"result","response":{"success":true,"summarizedAnswer":"Hello","tokenUsage":{"inputTokens":1,"outputTokens":2,"totalTokens":3}}}\n',
            ])
        );
        const onEvent = jest.fn();
        const { result } = renderHook(() => useAIChat());
        let response: AIChatResponse | undefined;
        await act(async () => {
            response = await result.current.sendQuery(
                { question: "hi", searchScope: "none", modelRoute: "fast", chatMode: "plan" },
                { stream: true, onEvent }
            );
        });
        expect(response).toMatchObject({
            success: true,
            summarizedAnswer: "Hello",
            tokenUsage: { totalTokens: 3 },
        });
        expect(onEvent).toHaveBeenCalledWith({ type: "text", delta: "Hello" });
        const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(request.headers).toMatchObject({ Accept: "application/x-ndjson" });
        expect(JSON.parse(request.body as string)).toMatchObject({
            stream: true,
            searchScope: "none",
            modelRoute: "fast",
            chatMode: "plan",
        });
        expect(result.current.loading).toBe(false);
    });

    it("accepts a genuine JSON fallback when a model cannot stream", async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => ({ success: true, summarizedAnswer: "Complete" }),
        });
        const { result } = renderHook(() => useAIChat());
        let response: AIChatResponse | undefined;
        await act(async () => {
            response = await result.current.sendQuery(
                { question: "hi", searchScope: "none" },
                { stream: true }
            );
        });
        expect(response).toEqual({ success: true, summarizedAnswer: "Complete" });
    });

    it.each([
        ['{"type":"text","delta":"partial"}\n', "ended before"],
        ["not-json\n", "malformed"],
        ['{"type":"unknown"}\n', "Invalid chat stream"],
        ['{"type":"error","message":"Provider overloaded"}\n', "Provider overloaded"],
    ])("fails honestly for incomplete, malformed and error streams", async (line, message) => {
        fetchMock.mockResolvedValue(streamingResponse([line]));
        const { result } = renderHook(() => useAIChat());
        let response: AIChatResponse | undefined;
        await act(async () => {
            response = await result.current.sendQuery(
                { question: "hi", searchScope: "none" },
                { stream: true }
            );
        });
        expect(response?.success).toBe(false);
        expect(response?.message).toContain(message);
        expect(result.current.error).toContain(message);
    });

    it("stops a pending reader without turning cancellation into an error", async () => {
        const cancelled = jest.fn();
        fetchMock.mockResolvedValue({
            ok: true,
            headers: new Headers({ "content-type": "application/x-ndjson" }),
            body: new ReadableStream({ cancel: cancelled }),
        });
        const { result } = renderHook(() => useAIChat());
        let pending!: Promise<AIChatResponse>;
        await act(async () => {
            pending = result.current.sendQuery(
                { question: "hi", searchScope: "none" },
                { stream: true }
            );
            await Promise.resolve();
        });
        expect(result.current.loading).toBe(true);
        let response: AIChatResponse | undefined;
        await act(async () => {
            result.current.cancelQuery();
            response = await pending;
        });
        expect(response).toMatchObject({ success: false, cancelled: true });
        expect(cancelled).toHaveBeenCalledTimes(1);
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBeNull();
        const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(request.signal?.aborted).toBe(true);
    });

    it("prevents a cancelled old completion and finally from changing a newer request", async () => {
        const old = deferred<unknown>();
        const next = deferred<unknown>();
        fetchMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
        const { result } = renderHook(() => useAIChat());
        let oldPromise!: Promise<AIChatResponse>;
        let nextPromise!: Promise<AIChatResponse>;
        act(() => {
            oldPromise = result.current.sendQuery({ question: "first", searchScope: "none" });
        });
        act(() => {
            nextPromise = result.current.sendQuery({ question: "second", searchScope: "none" });
        });
        await act(async () => {
            old.resolve({
                ok: true,
                json: async () => ({ success: true, summarizedAnswer: "stale" }),
            });
            expect(await oldPromise).toMatchObject({ cancelled: true });
        });
        expect(result.current.loading).toBe(true);
        expect(result.current.error).toBeNull();
        await act(async () => {
            next.resolve({
                ok: true,
                json: async () => ({ success: true, summarizedAnswer: "current" }),
            });
            expect(await nextPromise).toMatchObject({ success: true, summarizedAnswer: "current" });
        });
        expect(result.current.loading).toBe(false);
    });

    it("lets independent background requests finish while loading belongs to the latest", async () => {
        const first = deferred<unknown>();
        const second = deferred<unknown>();
        fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const { result } = renderHook(() => useAIChat());
        let firstPromise!: Promise<AIChatResponse>;
        let secondPromise!: Promise<AIChatResponse>;
        act(() => {
            firstPromise = result.current.sendQuery(
                { question: "first", searchScope: "none" },
                { independent: true }
            );
        });
        act(() => {
            secondPromise = result.current.sendQuery(
                { question: "second", searchScope: "none" },
                { independent: true }
            );
        });
        await act(async () => {
            first.resolve({
                ok: true,
                json: async () => ({ success: true, summarizedAnswer: "background" }),
            });
            expect(await firstPromise).toMatchObject({
                success: true,
                summarizedAnswer: "background",
            });
        });
        expect(result.current.loading).toBe(true);
        await act(async () => {
            second.resolve({
                ok: true,
                json: async () => ({ success: true, summarizedAnswer: "foreground" }),
            });
            await secondPromise;
        });
        expect(result.current.loading).toBe(false);
        const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(request.signal?.aborted).toBe(false);
    });

    it("honors caller cancellation and aborts outstanding requests on unmount", async () => {
        const first = deferred<unknown>();
        const second = deferred<unknown>();
        fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const { result, unmount } = renderHook(() => useAIChat());
        const controller = new AbortController();
        let firstPromise!: Promise<AIChatResponse>;
        let secondPromise!: Promise<AIChatResponse>;
        act(() => {
            firstPromise = result.current.sendQuery(
                { question: "first", searchScope: "none" },
                { independent: true, signal: controller.signal }
            );
            secondPromise = result.current.sendQuery(
                { question: "second", searchScope: "none" },
                { independent: true }
            );
        });
        controller.abort();
        const [, firstRequest] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(firstRequest.signal?.aborted).toBe(true);
        unmount();
        const [, secondRequest] = fetchMock.mock.calls[1] as [string, RequestInit];
        expect(secondRequest.signal?.aborted).toBe(true);
        first.resolve({ ok: true });
        second.resolve({ ok: true });
        expect(await firstPromise).toMatchObject({ cancelled: true });
        expect(await secondPromise).toMatchObject({ cancelled: true });
    });
});
