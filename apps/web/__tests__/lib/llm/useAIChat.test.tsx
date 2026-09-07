/** @jest-environment jsdom */

import { act, renderHook } from "@testing-library/react";

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
