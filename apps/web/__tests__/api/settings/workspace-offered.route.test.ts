/**
 * Models & usage › Models: saving the models offered in Ask. What must not
 * regress: only `models.manage` saves, a bad list is refused in words, a
 * workspace with no main model has nothing to offer models beside, new
 * models get keys while saved ones keep theirs — and saving API keys never
 * wipes the list.
 */

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";
import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);
jest.mock("~/server/deployment", () => ({ isCloudDeployment: () => false }));
jest.mock("~/env", () => ({ env: { server: { EMBEDDING_SECRETS_KEY: "sealed" } } }));
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/server/engine", () => ({ getEngine: () => undefined }));

const mockStore = {
    row: jest.fn(),
    view: jest.fn(),
    save: jest.fn(),
    saveOffered: jest.fn(),
};
jest.mock("~/server/workspace-models/store", () => ({
    KeyNeededForNewAddressError: class extends Error {},
    NO_SECRETS_KEY_MESSAGE: "no key",
    getWorkspaceEndpointRow: (...args: unknown[]) => mockStore.row(...args),
    getWorkspaceEndpointView: (...args: unknown[]) => mockStore.view(...args),
    saveWorkspaceEndpoint: (...args: unknown[]) => mockStore.save(...args),
    saveOfferedModels: (...args: unknown[]) => mockStore.saveOffered(...args),
    deleteWorkspaceEndpoint: jest.fn(),
    readWorkspaceEndpointKey: jest.fn(),
}));
const mockInvalidate = jest.fn();
jest.mock("~/server/workspace-models/scope", () => ({
    invalidateWorkspaceChatModels: (...args: unknown[]) => mockInvalidate(...args),
}));

import { PUT as saveOffered } from "~/app/api/settings/models/workspace/offered/route";
import { PUT as saveEndpoint } from "~/app/api/settings/models/workspace/route";

const admin = { success: true, data: makeWorkspaceContext({ role: "admin" }) };
const member = { success: true, data: makeWorkspaceContext({ role: "member" }) };
/** A custom role given only the new permission. */
const modelsKeeper = {
    success: true,
    data: makeWorkspaceContext({ role: "models-keeper", permissions: ["models.manage"] }),
};

const put = (body: unknown) =>
    new Request("http://localhost/api/settings/models/workspace/offered", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });

const writer = { label: "Team writer", id: "acme/writer", vision: false, reasoning: true };

beforeEach(() => {
    jest.resetAllMocks();
    mockRequireWorkspaceContext.mockResolvedValue(admin);
    mockStore.saveOffered.mockResolvedValue(true);
    mockStore.view.mockResolvedValue({ provider: "custom", models: {} });
    jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("PUT /api/settings/models/workspace/offered", () => {
    it("refuses someone without models.manage", async () => {
        mockRequireWorkspaceContext.mockResolvedValue(member);
        const response = await saveOffered(put({ offered: [writer] }));
        expect(response.status).toBe(403);
        expect(mockStore.saveOffered).not.toHaveBeenCalled();
    });

    it("lets a custom role holding only models.manage save", async () => {
        mockRequireWorkspaceContext.mockResolvedValue(modelsKeeper);
        const response = await saveOffered(put({ offered: [writer] }));
        expect(response.status).toBe(200);
    });

    it("keeps saved keys, gives new models one, and forgets the cached scope", async () => {
        const response = await saveOffered(
            put({
                offered: [
                    { ...writer, key: "a1b2c3d4" },
                    { ...writer, id: "acme/b", label: "B" },
                ],
            })
        );
        expect(response.status).toBe(200);
        const [{ offered }] = mockStore.saveOffered.mock.calls[0] as [
            { offered: { key: string; label: string }[] },
        ];
        expect(offered[0]).toMatchObject({ key: "a1b2c3d4", label: "Team writer" });
        expect(offered[1]!.key).toMatch(/^[0-9a-f]{8}$/);
        expect(mockInvalidate).toHaveBeenCalledWith(BigInt(5));
    });

    it("refuses two models with one name, in words", async () => {
        const response = await saveOffered(put({ offered: [writer, { ...writer, id: "acme/b" }] }));
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            error: 'Two models are called "Team writer". Give each its own name.',
        });
        expect(mockStore.saveOffered).not.toHaveBeenCalled();
    });

    it("refuses a body that isn't a list of models", async () => {
        for (const body of [
            null,
            { offered: "x" },
            { offered: [{ id: "a" }] },
            { offered: [], extra: 1 },
        ]) {
            const response = await saveOffered(put(body));
            expect(response.status).toBe(400);
        }
    });

    it("says to choose a main model first when there is none", async () => {
        mockStore.saveOffered.mockResolvedValue(false);
        const response = await saveOffered(put({ offered: [writer] }));
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({
            error: "Choose the main model in API keys before offering models in Ask.",
        });
    });
});

describe("saving API keys keeps what Models offers", () => {
    const keysBody = (models: Record<string, unknown>) =>
        new Request("http://localhost/api/settings/models/workspace", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                provider: "openai",
                baseUrl: "https://api.openai.com/v1",
                models,
            }),
        });
    const stored = { key: "a1b2c3d4", ...writer };

    it("carries the stored list over when the save doesn't name it", async () => {
        mockStore.row.mockResolvedValue({ models: { default: { id: "x" }, offered: [stored] } });
        const response = await saveEndpoint(
            keysBody({ default: { id: "acme/main", vision: false, reasoning: false } })
        );
        expect(response.status).toBe(200);
        const [{ models }] = mockStore.save.mock.calls[0] as [{ models: { offered?: unknown[] } }];
        expect(models.offered).toEqual([stored]);
    });

    it("replaces it when the save does name it", async () => {
        mockStore.row.mockResolvedValue({ models: { default: { id: "x" }, offered: [stored] } });
        await saveEndpoint(
            keysBody({ default: { id: "acme/main", vision: false, reasoning: false }, offered: [] })
        );
        const [{ models }] = mockStore.save.mock.calls[0] as [{ models: { offered?: unknown[] } }];
        expect(models.offered).toBeUndefined();
    });
});
