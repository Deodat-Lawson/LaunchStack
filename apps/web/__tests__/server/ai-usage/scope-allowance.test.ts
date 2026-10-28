/**
 * The allowance inside withWorkspaceChatModels: work for a person at a limit
 * gets a scope whose every model resolution throws, background work is
 * counted but never refused, and the recorder knows whose calls these are.
 */

jest.mock("~/server/deployment", () => ({ isCloudDeployment: () => false }));
jest.mock("~/server/workspace-models/store", () => ({
    getWorkspaceEndpointRow: jest.fn(async () => null),
    readWorkspaceEndpointKey: jest.fn(),
}));

const mockGetAllowance = jest.fn();
jest.mock("~/server/ai-usage/quota", () => ({
    getAiAllowance: (...args: unknown[]) => mockGetAllowance(...args),
}));

const mockRecorder = jest.fn((..._args: unknown[]) => ({ record: jest.fn() }));
jest.mock("~/server/ai-usage/record", () => ({
    aiUsageRecorder: (...args: unknown[]) => mockRecorder(...args),
}));

import {
    configureChatModels,
    createChatModelsConfig,
    getChatModelsScope,
    resetChatModelsConfig,
    resolveChatModel,
} from "@launchstack/llm";

import { AiAllowanceExceededError } from "~/server/ai-usage/errors";
import type { AiAllowance } from "~/server/ai-usage/quota";
import { describeChatResolutionFailure } from "~/lib/models";
import {
    resetWorkspaceChatModelsCache,
    withWorkspaceChatModels,
} from "~/server/workspace-models/scope";

function allowance(overrides: Partial<AiAllowance> = {}): AiAllowance {
    return {
        start: "2026-10-01",
        resetsAt: "2026-11-01T00:00:00.000Z",
        used: 1_200_000,
        workspace: { limit: 1_000_000, source: "default" },
        server: null,
        binding: "workspace",
        percent: 120,
        blocked: true,
        ...overrides,
    };
}

beforeEach(() => {
    resetWorkspaceChatModelsCache();
    mockGetAllowance.mockReset();
    mockRecorder.mockClear();
    configureChatModels(
        createChatModelsConfig({
            yaml: `
version: 1
models:
  primary:
    id: deployment-model
    preset: generic/openai-compatible-text
routes:
  default: primary
`,
            endpoint: { baseUrl: "https://deployment.example/v1", apiKey: "k" },
        })
    );
});
afterEach(() => resetChatModelsConfig());

it("refuses every model resolution for a person at their limit", async () => {
    mockGetAllowance.mockResolvedValue(allowance());
    const thrown = await withWorkspaceChatModels(5n, { feature: "ask", userId: "user-1" }, () => {
        try {
            resolveChatModel({ route: "default" });
            return null;
        } catch (error) {
            return error;
        }
    });
    expect(thrown).toBeInstanceOf(AiAllowanceExceededError);
    expect((thrown as AiAllowanceExceededError).status).toBe(429);
    expect(mockGetAllowance).toHaveBeenCalledWith(5n, "user-1", { serverCapApplies: true });
});

it("words the refusal for the screen, in the reader's language", () => {
    const error = new AiAllowanceExceededError(allowance());
    const en = describeChatResolutionFailure(error, "en");
    expect(en.status).toBe(429);
    expect(en.message).toContain("1,200,000 of 1,000,000 tokens");
    expect(en.message).toContain("November 1, 2026");
    expect(en.message).toContain("A workspace admin can raise it");

    const server = describeChatResolutionFailure(
        new AiAllowanceExceededError(
            allowance({ binding: "server", server: { limit: 2_000_000, used: 2_000_000 } })
        ),
        "zh-CN"
    );
    expect(server.message).toContain("服务器");
    expect(server.message).toContain("2,000,000");
});

it("lets the work run below the limit", async () => {
    mockGetAllowance.mockResolvedValue(allowance({ blocked: false, used: 10, percent: 0 }));
    const error = await withWorkspaceChatModels(
        5n,
        { feature: "ask", userId: "user-1" },
        () => getChatModelsScope()?.error
    );
    expect(error).toBeUndefined();
});

it("counts background work without reading the allowance or refusing it", async () => {
    const error = await withWorkspaceChatModels(
        5n,
        { feature: "scenarios", userId: "user-1", enforce: false },
        () => getChatModelsScope()?.error
    );
    expect(error).toBeUndefined();
    expect(mockGetAllowance).not.toHaveBeenCalled();
    expect(mockRecorder).toHaveBeenCalledWith(5n, "scenarios", "user-1");
});

it("counts work no one person started to no one", async () => {
    await withWorkspaceChatModels(5n, "ingestion", () => undefined);
    expect(mockGetAllowance).not.toHaveBeenCalled();
    expect(mockRecorder).toHaveBeenCalledWith(5n, "ingestion", undefined);
});

it("lets the work run when the allowance can't be read", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    mockGetAllowance.mockRejectedValue(new Error("connection reset"));
    const error = await withWorkspaceChatModels(
        5n,
        { feature: "ask", userId: "user-1" },
        () => getChatModelsScope()?.error
    );
    expect(error).toBeUndefined();
});
