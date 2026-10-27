/**
 * Workspace › Bring your own keys. What must not regress: only
 * `settings.manage` reaches any of it, the key goes in and never comes back
 * out, a stored key is never re-aimed at a new address, and the OpenRouter
 * return leg refuses anything but the flow it started.
 */

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";
import type * as StoreModule from "~/server/workspace-models/store";
import type * as CryptoModule from "@launchstack/store/crypto";
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
const mockServerEnv: { EMBEDDING_SECRETS_KEY?: string } = { EMBEDDING_SECRETS_KEY: "sealed" };
// A getter: the factory runs before the line above has initialised.
jest.mock("~/env", () => ({
    get env() {
        return { server: mockServerEnv };
    },
}));

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
    toEndpointView: jest.requireActual<typeof StoreModule>("~/server/workspace-models/store")
        .toEndpointView,
    get KeyNeededForNewAddressError() {
        return MockKeyNeededError;
    },
    NO_SECRETS_KEY_MESSAGE:
        "This server can't store API keys yet: whoever runs it needs to set EMBEDDING_SECRETS_KEY.",
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
                apiKeyCiphertext: "SEALED-FIXTURE",
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
        expect(JSON.stringify(view)).not.toContain("SEALED-FIXTURE");
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

describe("a server with no key to seal credentials", () => {
    it("says so instead of a bare 500 when saving", async () => {
        const { MissingSecretsKeyError } = jest.requireActual<typeof CryptoModule>(
            "@launchstack/store/crypto"
        );
        mockStore.save.mockRejectedValue(new MissingSecretsKeyError());
        const response = await PUT(
            json(
                {
                    provider: "openai",
                    baseUrl: "https://api.openai.com/v1",
                    apiKey: "sk-live-abcdefgh",
                    models: selection,
                },
                "PUT"
            )
        );
        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({
            error: expect.stringMatching(/EMBEDDING_SECRETS_KEY/),
        });
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
            selection,
            "en"
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

    it("says the server can't store keys before sending anyone to OpenRouter", async () => {
        mockServerEnv.EMBEDDING_SECRETS_KEY = undefined;
        try {
            const response = await startOpenRouter(new Request("http://localhost:3000/api/x"));
            const target = new URL(response.headers.get("location")!);
            expect(target.origin).toBe("http://localhost:3000");
            expect(target.searchParams.get("openrouter")).toBe("unavailable");
            expect(target.searchParams.get("feature")).toBe("workspace");
            expect(target.searchParams.get("at")).toBe("/byok");
        } finally {
            mockServerEnv.EMBEDDING_SECRETS_KEY = "sealed";
        }
    });

    describe("behind the proxy", () => {
        // The standalone server sees its bind address as `request.url`; the
        // browser must be sent to the address people reach the app at.
        const BEHIND_PROXY = "https://0.0.0.0:3000";
        const saved = { auth: process.env.BETTER_AUTH_URL, app: process.env.APP_PUBLIC_URL };
        beforeEach(() => {
            process.env.BETTER_AUTH_URL = "https://launchstack.example";
            // The services' own address: never where a browser is sent.
            process.env.APP_PUBLIC_URL = "http://app:3000";
        });
        afterEach(() => {
            // Assigning undefined to process.env stores the string "undefined".
            for (const [name, value] of [
                ["BETTER_AUTH_URL", saved.auth],
                ["APP_PUBLIC_URL", saved.app],
            ] as const) {
                if (value === undefined) delete process.env[name];
                else process.env[name] = value;
            }
        });

        it("asks OpenRouter to come back to the public origin", async () => {
            const response = await startOpenRouter(new Request(`${BEHIND_PROXY}/api/x`));
            const target = new URL(response.headers.get("location")!);
            expect(target.searchParams.get("callback_url")).toBe(
                "https://launchstack.example/api/settings/models/workspace/openrouter/callback"
            );
            expect(response.cookies.get(OPENROUTER_COOKIE)!.secure).toBe(true);
        });

        it("lands the return leg on Workspace › Bring your own keys at the public origin", async () => {
            const response = await openRouterCallback(
                new Request(
                    `${BEHIND_PROXY}/api/settings/models/workspace/openrouter/callback?state=s`
                )
            );
            const target = new URL(response.headers.get("location")!);
            expect(target.origin).toBe("https://launchstack.example");
            expect(target.pathname).toBe("/employer/documents");
            expect(target.searchParams.get("feature")).toBe("workspace");
            expect(target.searchParams.get("at")).toBe("/byok");
            expect(target.searchParams.get("openrouter")).toBe("denied");
        });
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
                new Response(JSON.stringify({ key: "openrouter-fixture-key" }), { status: 200 })
            );
        mockStore.row.mockResolvedValue(null);
        const response = await openRouterCallback(
            callback("code=abc&state=s", { v: "verifier", s: "s", c: "5" })
        );

        expect(outcome(response)).toBe("connected");
        const back = new URL(response.headers.get("location")!);
        expect(back.searchParams.get("feature")).toBe("workspace");
        expect(back.searchParams.get("at")).toBe("/byok");
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe("https://openrouter.ai/api/v1/auth/keys");
        expect(JSON.parse(init?.body as string)).toEqual({
            code: "abc",
            code_verifier: "verifier",
            code_challenge_method: "S256",
        });
        expect(mockStore.save).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: "openrouter",
                baseUrl: "https://openrouter.ai/api/v1",
                apiKey: "openrouter-fixture-key",
                models: null,
                connectedVia: "openrouter",
            })
        );
        expect(mockInvalidate).toHaveBeenCalledWith(BigInt(5));
    });

    it("keeps an OpenRouter workspace's models when it reconnects", async () => {
        jest.spyOn(global, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ key: "openrouter-fixture-key-2" }), { status: 200 })
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

    describe("behind the proxy", () => {
        /** What a route handler sees in the image: the bind address, whatever the Host says. */
        const PROXIED = "https://0.0.0.0:3000";
        const PUBLIC = "https://app.example.com";
        const saved = process.env.BETTER_AUTH_URL;

        beforeEach(() => {
            process.env.BETTER_AUTH_URL = PUBLIC;
        });
        afterEach(() => {
            if (saved === undefined) delete process.env.BETTER_AUTH_URL;
            else process.env.BETTER_AUTH_URL = saved;
        });

        const proxied = (path: string, init?: RequestInit) =>
            new Request(`${PROXIED}${path}`, {
                ...init,
                headers: { host: "app.example.com", ...init?.headers },
            });
        const location = (response: Response) => new URL(response.headers.get("location")!);

        it("sends OpenRouter back to the public origin", async () => {
            const response = await startOpenRouter(
                proxied("/api/settings/models/workspace/openrouter")
            );
            expect(location(response).searchParams.get("callback_url")).toBe(
                `${PUBLIC}/api/settings/models/workspace/openrouter/callback`
            );
            expect(response.cookies.get(OPENROUTER_COOKIE)!.secure).toBe(true);
        });

        it("says the server can't store keys on the public origin", async () => {
            mockServerEnv.EMBEDDING_SECRETS_KEY = undefined;
            try {
                const response = await startOpenRouter(
                    proxied("/api/settings/models/workspace/openrouter")
                );
                expect(location(response).origin).toBe(PUBLIC);
            } finally {
                mockServerEnv.EMBEDDING_SECRETS_KEY = "sealed";
            }
        });

        it("returns the admin to the public origin, not the bind address", async () => {
            jest.spyOn(global, "fetch").mockResolvedValue(
                new Response(JSON.stringify({ key: "openrouter-fixture-key" }), { status: 200 })
            );
            mockStore.row.mockResolvedValue(null);
            const flow = encodeFlowCookie({ v: "v", s: "s", c: "5" });
            const connected = await openRouterCallback(
                proxied("/api/settings/models/workspace/openrouter/callback?code=abc&state=s", {
                    headers: { cookie: `${OPENROUTER_COOKIE}=${flow}` },
                })
            );
            expect(location(connected).origin).toBe(PUBLIC);
            expect(outcome(connected)).toBe("connected");

            const denied = await openRouterCallback(
                proxied("/api/settings/models/workspace/openrouter/callback?state=s")
            );
            expect(location(denied).origin).toBe(PUBLIC);
        });
    });
});

describe("in the reader's language", () => {
    function chinese(body: unknown, method = "POST") {
        return new Request("http://localhost/api/settings/models/workspace", {
            method,
            headers: { "content-type": "application/json", cookie: "ls-locale=zh-CN.1" },
            body: JSON.stringify(body),
        });
    }

    it("words the address check, and keeps the English without the cookie", async () => {
        const body = { provider: "custom", baseUrl: "not a url", models: selection };
        const english = await PUT(json(body, "PUT"));
        await expect(english.json()).resolves.toEqual({
            error: "That isn't a web address. It should look like https://api.example.com/v1.",
        });
        const zh = await PUT(chinese(body, "PUT"));
        expect(zh.status).toBe(400);
        await expect(zh.json()).resolves.toEqual({
            error: "这不是一个网址。它应该类似 https://api.example.com/v1。",
        });
    });

    it("words a selection that can't work and a setup that isn't one", async () => {
        const noVision = await PUT(
            chinese(
                {
                    provider: "custom",
                    baseUrl: "https://a.b/v1",
                    models: { ...selection, vision: { id: "x", vision: false, reasoning: false } },
                },
                "PUT"
            )
        );
        await expect(noVision.json()).resolves.toEqual({
            error: "处理图片的模型必须能够读取图片。",
        });
        const invalid = await PUT(chinese({ nonsense: true }, "PUT"));
        await expect(invalid.json()).resolves.toEqual({ error: "这不是有效的模型设置。" });
    });

    it("words each failed model in a test", async () => {
        mockProbe.test.mockResolvedValue([
            {
                route: "default",
                modelId: "acme/chat",
                ok: false,
                latencyMs: 3,
                message: "The model answered with nothing. Check that it is a chat model.",
            },
        ]);
        const res = await testModels(
            chinese({
                provider: "openai",
                baseUrl: "https://a.b/v1",
                apiKey: "k",
                models: selection,
            })
        );
        const body = (await res.json()) as { results: { message?: string }[] };
        expect(body.results[0]?.message).toBe("模型没有返回任何内容。请确认它是一个对话模型。");
    });
});
