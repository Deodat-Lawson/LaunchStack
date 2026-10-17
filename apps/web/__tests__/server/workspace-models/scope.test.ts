/**
 * Loading a workspace's scope: its own endpoint when it chose a model, the
 * deployment's otherwise, and an error — never a fallback — when its own
 * endpoint can't be used. The stored key only ever reaches the stored address.
 */

const mockIsCloud = jest.fn(() => false);
jest.mock("~/server/deployment", () => ({ isCloudDeployment: () => mockIsCloud() }));

const mockRow = jest.fn();
const mockReadKey = jest.fn();
jest.mock("~/server/workspace-models/store", () => ({
    getWorkspaceEndpointRow: (...args: unknown[]) => mockRow(...args),
    readWorkspaceEndpointKey: (...args: unknown[]) => mockReadKey(...args),
}));

import {
    configureChatModels,
    createChatModelsConfig,
    resetChatModelsConfig,
    resolveChatModel,
} from "@launchstack/llm";

import { StoredKeyMismatchError, resolveCandidate } from "~/server/workspace-models/requests";
import {
    invalidateWorkspaceChatModels,
    loadWorkspaceChatModelsScope,
    resetWorkspaceChatModelsCache,
    withWorkspaceChatModels,
} from "~/server/workspace-models/scope";

function row(overrides: Record<string, unknown> = {}) {
    return {
        companyId: 5,
        provider: "custom",
        baseUrl: "https://models.example.com/v1",
        apiKeyCiphertext: "sealed",
        apiKeyLast4: "3456",
        encryptionKeyVersion: 1,
        models: { default: { id: "ws-model", vision: false, reasoning: false } },
        connectedVia: "key",
        updatedByUserId: 7,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

beforeEach(() => {
    resetWorkspaceChatModelsCache();
    mockIsCloud.mockReturnValue(false);
    mockRow.mockReset();
    mockReadKey.mockReset().mockReturnValue("sk-workspace-123456");
    jest.spyOn(console, "error").mockImplementation(() => {});
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
afterEach(() => {
    resetChatModelsConfig();
    jest.restoreAllMocks();
});

describe("loadWorkspaceChatModelsScope", () => {
    it("uses the deployment's models when the workspace brought none", async () => {
        mockRow.mockResolvedValue(null);
        await expect(loadWorkspaceChatModelsScope(BigInt(5))).resolves.toEqual({
            source: "deployment",
        });
    });

    it("does not switch over until a model is chosen", async () => {
        mockRow.mockResolvedValue(row({ models: null }));
        await expect(loadWorkspaceChatModelsScope(5)).resolves.toEqual({ source: "deployment" });
    });

    it("uses the workspace's endpoint, key and model when chosen", async () => {
        mockRow.mockResolvedValue(row());
        const scope = await loadWorkspaceChatModelsScope(5);
        expect(scope.source).toBe("workspace");
        expect(scope.config?.endpoint).toMatchObject({
            baseUrl: "https://models.example.com/v1",
            apiKey: "sk-workspace-123456",
            owner: "workspace",
        });
        const id = await withWorkspaceChatModels(5, () => resolveChatModel().modelId);
        expect(id).toBe("ws-model");
    });

    it("fails closed when the key can't be decrypted", async () => {
        mockRow.mockResolvedValue(row());
        mockReadKey.mockImplementation(() => {
            throw new Error("bad tag");
        });
        const scope = await loadWorkspaceChatModelsScope(5);
        expect(scope.config).toBeUndefined();
        expect(scope.error?.message).toMatch(/can't be read on this server/);
        await expect(withWorkspaceChatModels(5, () => resolveChatModel())).rejects.toThrow(
            /Settings › Models/
        );
    });

    it("fails closed when the hosted service now refuses the address", async () => {
        mockIsCloud.mockReturnValue(true);
        mockRow.mockResolvedValue(row({ baseUrl: "https://10.0.0.8/v1" }));
        const scope = await loadWorkspaceChatModelsScope(5);
        expect(scope.error?.message).toMatch(/private network/);
    });

    it("pins the deployment's models for work with no workspace", async () => {
        await expect(loadWorkspaceChatModelsScope(null)).resolves.toEqual({ source: "deployment" });
        expect(mockRow).not.toHaveBeenCalled();
    });

    it("caches briefly, and forgets on save or disconnect", async () => {
        mockRow.mockResolvedValue(row());
        await loadWorkspaceChatModelsScope(5);
        await loadWorkspaceChatModelsScope(5);
        expect(mockRow).toHaveBeenCalledTimes(1);
        invalidateWorkspaceChatModels(5);
        mockRow.mockResolvedValue(null);
        await expect(loadWorkspaceChatModelsScope(5)).resolves.toEqual({ source: "deployment" });
    });
});

describe("resolveCandidate (test and list before saving)", () => {
    it("prefers a typed key", async () => {
        await expect(
            resolveCandidate(BigInt(5), { baseUrl: "https://new.example/v1", apiKey: " sk-typed " })
        ).resolves.toEqual({ baseUrl: "https://new.example/v1", apiKey: "sk-typed" });
        expect(mockRow).not.toHaveBeenCalled();
    });

    it("reuses the stored key only for the stored address", async () => {
        mockRow.mockResolvedValue(row());
        await expect(
            resolveCandidate(BigInt(5), { baseUrl: "https://models.example.com/v1/" })
        ).resolves.toEqual({
            baseUrl: "https://models.example.com/v1",
            apiKey: "sk-workspace-123456",
        });
        await expect(
            resolveCandidate(BigInt(5), { baseUrl: "https://attacker.example/v1" })
        ).rejects.toThrow(StoredKeyMismatchError);
    });

    it("sends no key when told the endpoint is keyless", async () => {
        await expect(
            resolveCandidate(BigInt(5), { baseUrl: "http://localhost:8000/v1", apiKey: null })
        ).resolves.toEqual({ baseUrl: "http://localhost:8000/v1", apiKey: null });
    });
});
