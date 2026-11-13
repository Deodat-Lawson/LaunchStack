/**
 * Models a workspace offers in Ask, beside Standard and Fast. What must not
 * regress: names are the admin's and unique, keys survive edits, a picked
 * model answers on the main route while background helpers stay on the
 * workspace's own fast model, the browser never sees a provider id, and a key
 * nobody offers never runs on some other model.
 */

const mockRow = jest.fn();
jest.mock("~/server/workspace-models/store", () => ({
    getWorkspaceEndpointRow: (...args: unknown[]) => mockRow(...args),
    readWorkspaceEndpointKey: () => "sk-workspace-123456",
}));
jest.mock("~/server/deployment", () => ({ isCloudDeployment: () => false }));

import {
    configureChatModels,
    createChatModelsConfig,
    getChatModelsScope,
    resetChatModelsConfig,
    resolveChatModel,
} from "@launchstack/llm";

import {
    buildWorkspaceChatModelsConfig,
    configWithOfferedModel,
    offeredListProblem,
    offeredModelName,
    selectionProblem,
    settledOffered,
    settledSelection,
    workspaceModelsFile,
    type OfferedDraft,
} from "~/server/workspace-models/config";
import {
    loadWorkspaceOfferedModels,
    resetWorkspaceChatModelsCache,
    withOfferedChatModel,
    withWorkspaceChatModels,
} from "~/server/workspace-models/scope";
import type { WorkspaceModelSelection } from "~/server/db/schema/workspace-models";

const offered = (overrides: Partial<OfferedDraft> = {}): OfferedDraft => ({
    id: "acme/writer-large",
    label: "Team writer",
    vision: false,
    reasoning: false,
    ...overrides,
});

const selection: WorkspaceModelSelection = {
    default: { id: "acme/main", vision: false, reasoning: false },
    fast: { id: "acme/quick", vision: false, reasoning: false },
    offered: [
        {
            key: "a1b2c3d4",
            label: "Team writer",
            id: "acme/writer-large",
            vision: false,
            reasoning: true,
        },
        { key: "e5f6a7b8", label: "Eyes", id: "acme/vision-pro", vision: true, reasoning: false },
    ],
};

function row(models: WorkspaceModelSelection | null = selection) {
    return {
        companyId: 5,
        provider: "custom",
        baseUrl: "https://models.example.com/v1",
        apiKeyCiphertext: "sealed",
        apiKeyLast4: "3456",
        encryptionKeyVersion: 1,
        models,
        connectedVia: "key",
        updatedByUserId: 7,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
}

beforeEach(() => {
    resetWorkspaceChatModelsCache();
    mockRow.mockReset();
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

describe("the offered list's checks", () => {
    it("accepts a list of named models", () => {
        expect(
            offeredListProblem([offered(), offered({ id: "acme/b", label: "Other" })])
        ).toBeNull();
    });

    it("refuses two models with the same name, whatever the case", () => {
        expect(
            offeredListProblem([offered(), offered({ id: "acme/b", label: " team WRITER " })])
        ).toBe('Two models are called "team WRITER". Give each its own name.');
    });

    it("refuses a missing name, an over-long one, and a pasted non-id", () => {
        expect(offeredListProblem([offered({ label: "  " })])).toBe(
            'Give "acme/writer-large" a name people will see.'
        );
        expect(offeredListProblem([offered({ label: "x".repeat(61) })])).toBe(
            'Keep the name for "acme/writer-large" to 60 characters.'
        );
        expect(offeredListProblem([offered({ id: "two words" })])).toMatch(
            /doesn't look like a model id/
        );
    });

    it("refuses half a price and more than twenty models", () => {
        expect(offeredListProblem([offered({ pricing: { input: 1 } })])).toBe(
            'Give "acme/writer-large" both an input and an output price, or leave both empty.'
        );
        const many = Array.from({ length: 21 }, (_, n) =>
            offered({ id: `acme/m${n}`, label: `M${n}` })
        );
        expect(offeredListProblem(many)).toBe("Offer at most 20 models in Ask.");
    });

    it("refuses a duplicated or malformed key", () => {
        expect(
            offeredListProblem([offered({ key: "k1" }), offered({ key: "k1", label: "Two" })])
        ).toBe("That isn't a valid model setup.");
        expect(offeredListProblem([offered({ key: "Bad Key" })])).toBe(
            "That isn't a valid model setup."
        );
    });

    it("is part of the whole selection's check", () => {
        expect(
            selectionProblem({
                default: { id: "acme/main", vision: false, reasoning: false },
                offered: [offered(), offered()],
            })
        ).toMatch(/Two models are called/);
    });
});

describe("saving the list", () => {
    it("keeps a saved key, gives a new model one, trims, and drops an empty price", () => {
        const keys = ["fresh001"];
        const settled = settledOffered(
            [
                offered({ key: "a1b2c3d4", label: " Team writer ", id: " acme/writer-large " }),
                offered({ id: "acme/b", label: "Other", pricing: { input: null, output: null } }),
            ],
            () => keys.shift()!
        );
        expect(settled).toEqual([
            {
                key: "a1b2c3d4",
                label: "Team writer",
                id: "acme/writer-large",
                vision: false,
                reasoning: false,
            },
            { key: "fresh001", label: "Other", id: "acme/b", vision: false, reasoning: false },
        ]);
    });

    it("never hands out a key already in the list", () => {
        const settled = settledOffered([offered({ key: "a1b2c3d4" }), offered({ label: "New" })]);
        expect(new Set(settled.map(model => model.key)).size).toBe(2);
        expect(settled[1]!.key).toMatch(/^[0-9a-f]{8}$/);
    });

    it("settles the offered list with the rest of a selection", () => {
        const settled = settledSelection({
            default: { id: "acme/main", vision: false, reasoning: false },
            offered: [offered({ pricing: { input: 1, output: 2 } })],
        });
        expect(settled.offered?.[0]).toMatchObject({
            label: "Team writer",
            pricing: { input: 1, output: 2 },
        });
    });
});

describe("the configuration a pick runs on", () => {
    const config = () =>
        buildWorkspaceChatModelsConfig({
            baseUrl: "https://models.example.com/v1",
            apiKey: "sk",
            selection,
        });

    it("declares each offered model under its own name", () => {
        const file = workspaceModelsFile(selection);
        expect(file.models[offeredModelName("a1b2c3d4")]).toMatchObject({
            id: "acme/writer-large",
        });
        expect(file.routes).toEqual({ default: "default", fast: "fast" });
    });

    it("answers on the main route with the picked model, and keeps helpers on the fast model", () => {
        const picked = configWithOfferedModel(config(), "a1b2c3d4")!;
        expect(resolveChatModel({ config: picked }).modelId).toBe("acme/writer-large");
        expect(resolveChatModel({ config: picked, route: "fast" }).modelId).toBe("acme/quick");
    });

    it("keeps background helpers on the main model when no fast model is set", () => {
        const noFast: WorkspaceModelSelection = { ...selection };
        delete noFast.fast;
        const picked = configWithOfferedModel(
            buildWorkspaceChatModelsConfig({ baseUrl: "https://m.example/v1", selection: noFast }),
            "a1b2c3d4"
        )!;
        expect(resolveChatModel({ config: picked, route: "fast" }).modelId).toBe("acme/main");
    });

    it("sends images to a picked model that reads them", () => {
        const picked = configWithOfferedModel(config(), "e5f6a7b8")!;
        expect(resolveChatModel({ config: picked, route: "vision" }).modelId).toBe(
            "acme/vision-pro"
        );
    });

    it("knows no model by a key nobody offers", () => {
        expect(configWithOfferedModel(config(), "nope0000")).toBeNull();
    });
});

describe("what Ask's model menu is told", () => {
    it("lists names and abilities, never the provider's id", async () => {
        mockRow.mockResolvedValue(row());
        const models = await loadWorkspaceOfferedModels(5);
        expect(models.map(({ key, label }) => ({ key, label }))).toEqual([
            { key: "a1b2c3d4", label: "Team writer" },
            { key: "e5f6a7b8", label: "Eyes" },
        ]);
        expect(models[0]).toMatchObject({ available: true, reasoning: { mode: "always" } });
        expect(models[1]).toMatchObject({ vision: { supported: true } });
        expect(JSON.stringify(models)).not.toMatch(/acme\//);
    });

    it("lists nothing on the deployment's models, or when nothing is chosen", async () => {
        mockRow.mockResolvedValue(null);
        await expect(loadWorkspaceOfferedModels(5)).resolves.toEqual([]);
        resetWorkspaceChatModelsCache();
        mockRow.mockResolvedValue(row(null));
        await expect(loadWorkspaceOfferedModels(5)).resolves.toEqual([]);
        await expect(loadWorkspaceOfferedModels(null)).resolves.toEqual([]);
    });
});

describe("running a turn on a picked model", () => {
    it("runs on the picked model inside the workspace's scope, counter and all", async () => {
        mockRow.mockResolvedValue(row());
        const result = await withWorkspaceChatModels(5, "ask", async () => {
            const outer = getChatModelsScope();
            return withOfferedChatModel("a1b2c3d4", () => ({
                id: resolveChatModel().modelId,
                sameCounter: getChatModelsScope()?.usage === outer?.usage,
                source: getChatModelsScope()?.source,
            }));
        });
        expect(result).toEqual({
            offered: true,
            value: { id: "acme/writer-large", sameCounter: true, source: "workspace" },
        });
    });

    it("refuses a key the workspace doesn't offer without running anything", async () => {
        mockRow.mockResolvedValue(row());
        const fn = jest.fn();
        await expect(
            withWorkspaceChatModels(5, "ask", () => withOfferedChatModel("nope0000", fn))
        ).resolves.toEqual({ offered: false });
        expect(fn).not.toHaveBeenCalled();
    });

    it("refuses any key on the deployment's models", async () => {
        mockRow.mockResolvedValue(null);
        const fn = jest.fn();
        await expect(
            withWorkspaceChatModels(5, "ask", () => withOfferedChatModel("a1b2c3d4", fn))
        ).resolves.toEqual({ offered: false });
        expect(fn).not.toHaveBeenCalled();
    });
});
