/** @jest-environment jsdom */

import { act, renderHook } from "@testing-library/react";

import {
  useAIChat,
  type AIChatResponse,
} from "~/app/employer/documents/hooks/useAIChat";

describe("useAIChat", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("returns the provider error so the workspace can display it", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        success: false,
        message:
          "Invalid or missing OPENROUTER_API_KEY. Please check your API key configuration.",
      }),
    });

    const { result } = renderHook(() => useAIChat());
    let response: AIChatResponse | undefined;

    await act(async () => {
      response = await result.current.sendQuery({
        question: "hi",
        searchScope: "company",
        provider: "openrouter",
        aiModel: "moonshotai/kimi-k3",
      });
    });

    expect(response).toEqual({
      success: false,
      message:
        "Invalid or missing OPENROUTER_API_KEY. Please check your API key configuration.",
    });
    expect(result.current.error).toBe(
      "Invalid or missing OPENROUTER_API_KEY. Please check your API key configuration.",
    );
  });
});
