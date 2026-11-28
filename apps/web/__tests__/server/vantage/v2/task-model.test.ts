import { createChatModelsConfig, resolveChatModel, resolveChatRoute } from "@launchstack/llm";
import { resolveConfiguredChatModel, resolveConfiguredChatRoute } from "~/lib/models";
import { createVantageTaskModel } from "~/server/vantage/v2/task-model";

jest.mock("~/lib/models", () => ({
    resolveConfiguredChatModel: jest.fn(),
    resolveConfiguredChatRoute: jest.fn(),
}));
jest.mock("~/server/vantage/v2/model-journal", () => ({ VANTAGE_V2_MODEL_ROUTE: "default" }));

it("sends the Luna tool request with explicit reasoning_effort none", async () => {
    const config = createChatModelsConfig({
        yaml: `
version: 1
models:
  primary:
    id: gpt-6-luna
    preset: openai/gpt-6-luna
routes:
  default: primary
`,
        endpoint: { baseUrl: "http://127.0.0.1:1/v1" },
        sourceLabel: "injected Azure fixture",
    });
    jest.mocked(resolveConfiguredChatRoute).mockImplementation((route = "default") =>
        resolveChatRoute(route, config)
    );
    jest.mocked(resolveConfiguredChatModel).mockImplementation(options =>
        resolveChatModel({ ...options, config })
    );
    const fetch = jest.spyOn(globalThis, "fetch").mockImplementation(async (_url, request) => {
        if (typeof request?.body !== "string") throw new Error("Expected a prepared JSON body");
        expect(JSON.parse(request.body)).toMatchObject({
            model: "gpt-6-luna",
            reasoning_effort: "none",
            tools: [{ function: { name: "submit_result" } }],
        });
        return Response.json({
            id: "task-turn",
            model: "gpt-6-luna",
            choices: [
                {
                    index: 0,
                    message: {
                        role: "assistant",
                        content: null,
                        tool_calls: [
                            {
                                id: "submit",
                                type: "function",
                                function: { name: "submit_result", arguments: "{}" },
                            },
                        ],
                    },
                    finish_reason: "tool_calls",
                },
            ],
        });
    });
    try {
        const deadlineAt = Date.now() + 5000;
        const port = createVantageTaskModel(deadlineAt, {
            deadlineAt,
            beforeAttempt: async () => async () => {},
        });
        const response = await port.respond({
            system: "Read the accepted brief",
            transcript: [{ role: "user", text: "Return an internal draft" }],
            tools: [
                { name: "submit_result", description: "Submit", jsonSchema: { type: "object" } },
            ],
        });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(response.toolCalls).toEqual([
            { id: "submit", name: "submit_result", arguments: {} },
        ]);
    } finally {
        fetch.mockRestore();
    }
});
