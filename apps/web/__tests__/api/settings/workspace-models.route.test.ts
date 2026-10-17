/**
 * Settings › Models › Your own model. What must not regress: only
 * `settings.manage` reaches any of it, the key goes in and never comes back
 * out, a stored key is never re-aimed at a new address, and the OpenRouter
 * return leg refuses anything but the flow it started.
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

jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/server/engine", () => ({ getEngine: () => undefined }));

class MockKeyNeededError extends Error {}
const mockStore = {
    row: jest.fn(),
    view: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    readKey: jest.fn(),
};
jest.mock("~/server/workspace-models/store", () => ({
    // The pure projection is under test; everything that touches the database is stubbed.
    toEndpointView: jest.requireActual<typeof import("~/server/workspace-models/store")>(
        "~/server/workspace-models/store"
    ).toEndpointView,
    get KeyNeededForNewAddressError() {
        return MockKeyNeededError;
    },
    getWorkspaceEndpointRow: (...args: unknown[]) => mockStore.row(...args),
    getWorkspaceEndpointView: (...args: unknown[]) => mockStore.view(...args),
    saveWorkspaceEndpoint: (...args: unknown[]) => mockStore.save(...args),
    deleteWorkspaceEndpoint: (...args: unknown[]) => mockStore.remove(...args),
    readWorkspaceEndpointKey: (...args: unknown[]) => mockStore.readKey(...args),
}));

const mockInvalidate = jest.fn();
jest.mock("~/server/workspace-models/scope", () => ({
    invalidateWorkspaceChatModels: (...args: unknown[]) => mockInvalidate(...args),
}));

const mockProbe = { list: jest.fn(), test: jest.fn() };
jest.mock("~/server/workspace-models/probe", () => ({
    EndpointProbeError: class extends Error {
        status = 502;
    },
    listEndpointModels: (...args: unknown[]) => mockProbe.list(...args),
    testEndpoint: (...args: unknown[]) => mockProbe.test(...args),
}));

import { createHash } from "node:crypto";

import { DELETE, GET, PUT } from "~/app/api/settings/models/workspace/route";
import { POST as listModels } from "~/app/api/settings/models/workspace/models/route";
import { POST as testModels } from "~/app/api/settings/models/workspace/test/route";
import { GET as startOpenRouter } from "~/app/api/settings/models/workspace/openrouter/route";
import { GET as openRouterCallback } from "~/app/api/settings/models/workspace/openrouter/callback/route";
import { toEndpointView } from "~/server/workspace-models/store";
import {
    OPENROUTER_COOKIE,
    decodeFlowCookie,
    encodeFlowCookie,
    exchangeOpenRouterCode,
} from "~/server/workspace-models/openrouter";

const admin = { success: true, data: makeWorkspaceContext({ role: "admin" }) };
const member = { success: true, data: makeWorkspaceContext({ role: "member" }) };

const selection = { default: { id: "acme/chat", vision: false, reasoning: false } };

function json(body: unknown, method = "POST") {
    return new Request("http://localhost/api/settings/models/workspace", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    jest.resetAllMocks();
    mockRequireWorkspaceContext.mockResolvedValue(admin);
    mockStore.view.mockResolvedValue(null);
    jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("permission gate", () => {
    it.each([
        ["GET", () => GET()],
        [
            "PUT",
            () =>
                PUT(
                    json(
                        { provider: "openai", baseUrl: "https://a.b/v1", models: selection },
                        "PUT"
                    )
                ),
        ],
        ["DELETE", () => DELETE()],
        ["models", () => listModels(json({ provider: "openai", baseUrl: "https://a.b/v1" }))],
        [
            "test",
            () =>
                testModels(
                    json({ provider: "openai", baseUrl: "https://a.b/v1", models: selection })
                ),
        ],
        ["openrouter", () => startOpenRouter(new Request("http://localhost/x"))],
    ])("%s refuses a member", async (_name, call) => {
        mockRequireWorkspaceContext.mockResolvedValue(member);
        const response = await call();
        expect(response.status).toBe(403);
        expect(mockStore.save).not.toHaveBeenCalled();
        expect(mockStore.remove).not.toHaveBeenCalled();
    });
});

describe("the key never comes back out", () => {
    it("the view carries the last four characters and nothing else of the key", () => {
        const view = toEndpointView(
            {
                companyId: 5,
                provider: "openai",
                baseUrl: "https://api.openai.com/v1",
                apiKeyCiphertext: "c2VhbGVkLWNpcGhlcnRleHQ=",
                apiKeyLast4: "9xyz",
                encryptionKeyVersion: 1,
                models: selection,
                connectedVia: "key",
                updatedByUserId: 7,
                createdAt: new Date("2026-10-17T00:00:00Z"),
                updatedAt: new Date("2026-10-17T00:00:00Z"),
            },
            "Ada"
        );
        expect(view).toMatchObject({
            hasKey: true,
            keyLast4: "9xyz",
            active: true,
            updatedBy: "Ada",
        });
        expect(JSON.stringify(view)).not.toContain("c2VhbGVk");
    });
});

describe("PUT", () => {
    it("saves, then forgets the cached scope", async () => {
        const response = await PUT(
            json(
                {
                    provider: "openai",
                    baseUrl: "https://api.openai.com/v1/",
                    apiKey: "sk-live-abcdefgh",
                    models: selection,
                },
                "PUT"
            )
        );
        expect(response.status).toBe(200);
        expect(mockStore.save).toHaveBeenCalledWith(
            expect.objectContaining({
                companyId: BigInt(5),
                baseUrl: "https://api.openai.com/v1",
                apiKey: "sk-live-abcdefgh",
                models: selection,
                connectedVia: "key",
            })
        );
        expect(mockInvalidate).toHaveBeenCalledWith(BigInt(5));
    });

    it("refuses a bad address and a selection that can't work", async () => {
        const bad = await PUT(
            json({ provider: "custom", baseUrl: "not a url", models: selection }, "PUT")
        );
        expect(bad.status).toBe(400);
        const noVision = await PUT(
            json(
                {
                    provider: "custom",
                    baseUrl: "https://a.b/v1",
                    models: { ...selection, vision: { id: "x", vision: false, reasoning: false } },
                },
                "PUT"
            )
        );
        expect(noVision.status).toBe(400);
        expect(mockStore.save).not.toHaveBeenCalled();
    });

    it("passes the store's refusal to re-aim a saved key", async () => {
        mockStore.save.mockRejectedValue(new MockKeyNeededError("enter the key"));
        const response = await PUT(
            json(
                { provider: "custom", baseUrl: "https://other.example/v1", models: selection },
                "PUT"
            )
        );
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: "enter the key" });
    });
});

describe("DELETE", () => {
    it("disconnects and forgets the cached scope", async () => {
        const response = await DELETE();
        expect(response.status).toBe(200);
        expect(mockStore.remove).toHaveBeenCalledWith(BigInt(5));
        expect(mockInvalidate).toHaveBeenCalledWith(BigInt(5));
    });
});

describe("test and list", () => {
    it("won't send the stored key to an address it wasn't saved for", async () => {
        mockStore.row.mockResolvedValue({
            baseUrl: "https://saved.example/v1",
            apiKeyCiphertext: "c",
        });
        const response = await listModels(
            json({ provider: "custom", baseUrl: "https://elsewhere.example/v1" })
        );
        expect(response.status).toBe(400);
        expect(mockStore.readKey).not.toHaveBeenCalled();
        expect(mockProbe.list).not.toHaveBeenCalled();
    });

    it("tests with a typed key", async () => {
        mockProbe.test.mockResolvedValue([
            { route: "default", modelId: "acme/chat", ok: true, latencyMs: 12 },
        ]);
        const response = await testModels(
            json({
                provider: "custom",
                baseUrl: "https://a.b/v1",
                apiKey: "sk-typed-1234",
                models: selection,
            })
        );
        await expect(response.json()).resolves.toMatchObject({ ok: true });
        expect(mockProbe.test).toHaveBeenCalledWith(
            { baseUrl: "https://a.b/v1", apiKey: "sk-typed-1234" },
            selection
        );
    });
});

describe("Connect OpenRouter", () => {
    it("sends the admin to OpenRouter with an S256 challenge and remembers the flow", async () => {
        const response = await startOpenRouter(new Request("http://localhost:3000/api/x"));
        expect(response.status).toBe(307);
        const target = new URL(response.headers.get("location")!);
        expect(target.origin + target.pathname).toBe("https://openrouter.ai/auth");
        expect(target.searchParams.get("code_challenge_method")).toBe("S256");
        expect(target.searchParams.get("callback_url")).toMatch(
            /\/api\/settings\/models\/workspace\/openrouter\/callback$/
        );

        const cookie = response.cookies.get(OPENROUTER_COOKIE)!;
        expect(cookie.httpOnly).toBe(true);
        const flow = decodeFlowCookie(cookie.value)!;
        expect(flow.c).toBe("5");
        expect(flow.s).toBe(target.searchParams.get("state"));
        expect(createHash("sha256").update(flow.v).digest("base64url")).toBe(
            target.searchParams.get("code_challenge")
        );
    });

    function callback(query: string, flow?: { v: string; s: string; c: string }) {
        return new Request(
            `http://localhost:3000/api/settings/models/workspace/openrouter/callback?${query}`,
            flow ? { headers: { cookie: `${OPENROUTER_COOKIE}=${encodeFlowCookie(flow)}` } } : {}
        );
    }

    const outcome = (response: Response) =>
        new URL(response.headers.get("location")!).searchParams.get("openrouter");

    it("refuses a return that doesn't match the flow", async () => {
        expect(
            outcome(
                await openRouterCallback(
                    callback("code=abc&state=forged", { v: "v", s: "real", c: "5" })
                )
            )
        ).toBe("expired");
        expect(outcome(await openRouterCallback(callback("code=abc&state=s")))).toBe("expired");
        expect(
            outcome(
                await openRouterCallback(callback("code=abc&state=s", { v: "v", s: "s", c: "9" }))
            )
        ).toBe("expired");
        expect(
            outcome(await openRouterCallback(callback("state=s", { v: "v", s: "s", c: "5" })))
        ).toBe("denied");
        expect(mockStore.save).not.toHaveBeenCalled();
    });

    it("trades the code for a key and stores it without switching models", async () => {
        const fetchSpy = jest
            .spyOn(global, "fetch")
            .mockResolvedValue(
                new Response(JSON.stringify({ key: "sk-or-v1-user-key" }), { status: 200 })
            );
        mockStore.row.mockResolvedValue(null);
        const response = await openRouterCallback(
            callback("code=abc&state=s", { v: "verifier", s: "s", c: "5" })
        );

        expect(outcome(response)).toBe("connected");
        expect(new URL(response.headers.get("location")!).hash).toBe("#models");
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe("https://openrouter.ai/api/v1/auth/keys");
        expect(JSON.parse(String(init?.body))).toEqual({
            code: "abc",
            code_verifier: "verifier",
            code_challenge_method: "S256",
        });
        expect(mockStore.save).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: "openrouter",
                baseUrl: "https://openrouter.ai/api/v1",
                apiKey: "sk-or-v1-user-key",
                models: null,
                connectedVia: "openrouter",
            })
        );
        expect(mockInvalidate).toHaveBeenCalledWith(BigInt(5));
    });

    it("keeps an OpenRouter workspace's models when it reconnects", async () => {
        jest.spyOn(global, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ key: "sk-or-v1-new" }), { status: 200 })
        );
        mockStore.row.mockResolvedValue({
            baseUrl: "https://openrouter.ai/api/v1",
            models: selection,
        });
        await openRouterCallback(callback("code=abc&state=s", { v: "v", s: "s", c: "5" }));
        expect(mockStore.save).toHaveBeenCalledWith(expect.objectContaining({ models: selection }));
    });

    it("reports a refused exchange", async () => {
        await expect(
            exchangeOpenRouterCode("abc", "v", async () => new Response("no", { status: 400 }))
        ).rejects.toThrow(/HTTP 400/);
        jest.spyOn(global, "fetch").mockResolvedValue(new Response("no", { status: 403 }));
        const response = await openRouterCallback(
            callback("code=abc&state=s", { v: "v", s: "s", c: "5" })
        );
        expect(outcome(response)).toBe("error");
        expect(mockStore.save).not.toHaveBeenCalled();
    });
});
