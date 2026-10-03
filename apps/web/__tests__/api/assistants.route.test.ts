/**
 * Settings › Assistants (MCP) routes. What must not regress: every member
 * reaches only their own keys and connections, a key that saves needs
 * `documents.upload`, the OAuth-client routes are admins' alone, and a secret
 * leaves the server exactly once — in the response that created it.
 */

import type { NextResponse } from "next/server";

import type * as MockRequireWorkspaceContext from "../helpers/mock-require-workspace-context";
import { makeWorkspaceContext } from "../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);
jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<NextResponse>) =>
        handler(),
}));

const mockAvailability = jest.fn();
jest.mock("~/server/mcp/config", () => ({ mcpAvailability: () => mockAvailability() }));

class MockAccessKeyLimitError extends Error {}
const mockKeys = { list: jest.fn(), create: jest.fn(), revoke: jest.fn() };
jest.mock("~/server/mcp/access-keys", () => ({
    ACCESS_KEY_NAME_MAX: 80,
    // Getters: the factory runs before the classes above are initialised.
    get AccessKeyLimitError() {
        return MockAccessKeyLimitError;
    },
    listAccessKeys: (...args: unknown[]) => mockKeys.list(...args),
    createAccessKey: (...args: unknown[]) => mockKeys.create(...args),
    revokeAccessKey: (...args: unknown[]) => mockKeys.revoke(...args),
}));

const mockConnections = { list: jest.fn(), revoke: jest.fn() };
jest.mock("~/server/mcp/connections", () => ({
    listConnections: (...args: unknown[]) => mockConnections.list(...args),
    revokeConnection: (...args: unknown[]) => mockConnections.revoke(...args),
}));

class MockOAuthClientInputError extends Error {}
class MockOAuthClientLimitError extends Error {}
const mockClients = { list: jest.fn(), create: jest.fn(), remove: jest.fn() };
jest.mock("~/server/mcp/oauth-clients", () => ({
    GEMINI_ENTERPRISE_REDIRECT_URI: "https://vertexaisearch.cloud.google.com/oauth-redirect",
    MANUAL_CLIENT_AUTH_METHODS: ["client_secret_post", "client_secret_basic"],
    OAUTH_CLIENT_NAME_MAX: 80,
    OAUTH_CLIENT_REDIRECTS_MAX: 5,
    get OAuthClientInputError() {
        return MockOAuthClientInputError;
    },
    get OAuthClientLimitError() {
        return MockOAuthClientLimitError;
    },
    oauthEndpoints: (origin: string) => ({
        issuer: `${origin}/api/auth`,
        authorization: `${origin}/api/auth/oauth2/authorize`,
        token: `${origin}/api/auth/oauth2/token`,
        discovery: `${origin}/api/auth/.well-known/openid-configuration`,
        scopes: "openid offline_access launchstack:read launchstack:write",
    }),
    listManualClients: (...args: unknown[]) => mockClients.list(...args),
    createManualClient: (...args: unknown[]) => mockClients.create(...args),
    deleteManualClient: (...args: unknown[]) => mockClients.remove(...args),
}));

import { GET as getOverview } from "~/app/api/assistants/route";
import { POST as createKey } from "~/app/api/assistants/keys/route";
import { DELETE as revokeKey } from "~/app/api/assistants/keys/[id]/route";
import { DELETE as revokeConnection } from "~/app/api/assistants/connections/[clientId]/route";
import { GET as getClients, POST as createClient } from "~/app/api/assistants/clients/route";
import { DELETE as deleteClient } from "~/app/api/assistants/clients/[clientId]/route";

const ON = {
    enabled: true,
    origin: "https://app.example.com",
    resource: "https://app.example.com/api/mcp",
};

function signedInAs(role: string, overrides: { authUserId?: string; userPk?: bigint } = {}) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({
            authUserId: overrides.authUserId ?? "auth-dana",
            userPk: overrides.userPk ?? 41n,
            companyId: 50n,
            role,
        }),
    });
}

function signedOut() {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: false,
        response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    });
}

const json = (url: string, method: string, body: unknown) =>
    new Request(url, {
        method,
        headers: { "Content-Type": "application/json", cookie: "session=abc" },
        body: JSON.stringify(body),
    });

const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

/** Any field that would carry a secret ("client_secret_post" as a value is fine). */
const SECRET_FIELD = /"(secret|clientSecret|client_secret|secretHash)":/;

const KEY = {
    id: 3,
    name: "Nightly export",
    displayPrefix: "lsk_AbC123",
    access: "read",
    createdAt: "2026-10-16T10:00:00.000Z",
    lastUsedAt: null,
};

beforeEach(() => {
    jest.clearAllMocks();
    mockAvailability.mockReturnValue(ON);
    mockKeys.list.mockResolvedValue([KEY]);
    mockConnections.list.mockResolvedValue([]);
    mockClients.list.mockResolvedValue([]);
});

describe("GET /api/assistants", () => {
    it("answers 401 without a session and reads nothing", async () => {
        signedOut();
        const res = await getOverview(new Request("http://x/api/assistants"));
        expect(res.status).toBe(401);
        expect(mockKeys.list).not.toHaveBeenCalled();
        expect(mockConnections.list).not.toHaveBeenCalled();
    });

    it("lists only the caller's own keys and connections, in the active workspace", async () => {
        signedInAs("member");
        const res = await getOverview(new Request("http://x/api/assistants"));
        expect(res.status).toBe(200);
        expect(mockKeys.list).toHaveBeenCalledWith({ companyId: 50n, userPk: 41n });
        expect(mockConnections.list).toHaveBeenCalledWith({
            authUserId: "auth-dana",
            companyId: 50n,
        });
        const body = (await res.json()) as Record<string, unknown>;
        expect(body).toMatchObject({
            availability: { enabled: true, serverUrl: "https://app.example.com/api/mcp" },
            keys: [KEY],
            canSave: true,
            canManageClients: false,
        });
        // Listing never carries a secret.
        expect(JSON.stringify(body)).not.toMatch(SECRET_FIELD);
    });

    it("tells a Viewer they cannot save, and an admin they can manage clients", async () => {
        signedInAs("viewer");
        let body = (await (await getOverview(new Request("http://x"))).json()) as {
            canSave: boolean;
            canManageClients: boolean;
        };
        expect(body).toMatchObject({ canSave: false, canManageClients: false });

        signedInAs("admin");
        body = (await (await getOverview(new Request("http://x"))).json()) as typeof body;
        expect(body).toMatchObject({ canSave: true, canManageClients: true });
    });

    it("says why the server is off, and still lists keys so they can be revoked", async () => {
        signedInAs("member");
        mockAvailability.mockReturnValue({ enabled: false, reason: "insecure-base-url" });
        const body = (await (await getOverview(new Request("http://x"))).json()) as {
            availability: unknown;
            keys: unknown[];
        };
        expect(body.availability).toEqual({ enabled: false, reason: "insecure-base-url" });
        expect(body.keys).toHaveLength(1);
    });
});

describe("POST /api/assistants/keys", () => {
    const post = (body: unknown) => createKey(json("http://x/api/assistants/keys", "POST", body));

    it("creates a key for the caller and returns the secret in that response", async () => {
        signedInAs("member");
        mockKeys.create.mockResolvedValue({ key: KEY, secret: "lsk_secret" });
        const res = await post({ name: "  Nightly export ", access: "read" });
        expect(res.status).toBe(201);
        expect(mockKeys.create).toHaveBeenCalledWith({
            companyId: 50n,
            userPk: 41n,
            name: "Nightly export",
            access: "read",
        });
        expect(await res.json()).toEqual({ key: KEY, secret: "lsk_secret" });
    });

    it("refuses a saving key to someone without documents.upload, before creating anything", async () => {
        signedInAs("viewer");
        const res = await post({ name: "Saver", access: "read-write" });
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ permission: "documents.upload" });
        expect(mockKeys.create).not.toHaveBeenCalled();
    });

    it("lets that same Viewer create a read-only key", async () => {
        signedInAs("viewer");
        mockKeys.create.mockResolvedValue({ key: KEY, secret: "lsk_secret" });
        expect((await post({ name: "Reader", access: "read" })).status).toBe(201);
    });

    it("rejects a nameless key or an unknown access level", async () => {
        signedInAs("member");
        expect((await post({ name: "  ", access: "read" })).status).toBe(400);
        expect((await post({ name: "x", access: "admin" })).status).toBe(400);
        expect(mockKeys.create).not.toHaveBeenCalled();
    });

    it("answers 409 at the per-member limit, and while the server is off", async () => {
        signedInAs("member");
        mockKeys.create.mockRejectedValue(new MockAccessKeyLimitError("At most 20 keys."));
        const limited = await post({ name: "One more", access: "read" });
        expect(limited.status).toBe(409);
        expect(await limited.json()).toEqual({ error: "At most 20 keys." });

        mockKeys.create.mockReset();
        mockAvailability.mockReturnValue({ enabled: false, reason: "disabled" });
        expect((await post({ name: "Off", access: "read" })).status).toBe(409);
        expect(mockKeys.create).not.toHaveBeenCalled();
    });
});

describe("DELETE /api/assistants/keys/[id]", () => {
    it("revokes only within the caller's own keys", async () => {
        signedInAs("member", { userPk: 41n });
        mockKeys.revoke.mockResolvedValue(true);
        const res = await revokeKey(
            new Request("http://x", { method: "DELETE" }),
            params({ id: "3" })
        );
        expect(res.status).toBe(200);
        expect(mockKeys.revoke).toHaveBeenCalledWith({ companyId: 50n, userPk: 41n, keyId: 3 });
    });

    it("answers 404 for a key that is not the caller's (or not live)", async () => {
        signedInAs("owner", { userPk: 1n });
        mockKeys.revoke.mockResolvedValue(false);
        const res = await revokeKey(
            new Request("http://x", { method: "DELETE" }),
            params({ id: "3" })
        );
        expect(res.status).toBe(404);
        // Even an owner is matched against their own user id, never a colleague's.
        expect(mockKeys.revoke).toHaveBeenCalledWith({ companyId: 50n, userPk: 1n, keyId: 3 });
    });

    it("answers 400 for an id that is not a number", async () => {
        signedInAs("member");
        const res = await revokeKey(
            new Request("http://x", { method: "DELETE" }),
            params({ id: "3;drop" })
        );
        expect(res.status).toBe(400);
        expect(mockKeys.revoke).not.toHaveBeenCalled();
    });
});

describe("DELETE /api/assistants/connections/[clientId]", () => {
    it("disconnects the caller's own connection in the active workspace", async () => {
        signedInAs("member");
        mockConnections.revoke.mockResolvedValue(true);
        const res = await revokeConnection(
            new Request("http://x", { method: "DELETE" }),
            params({ clientId: encodeURIComponent("https://claude.ai/oauth/mcp-client.json") })
        );
        expect(res.status).toBe(200);
        expect(mockConnections.revoke).toHaveBeenCalledWith({
            authUserId: "auth-dana",
            companyId: 50n,
            clientId: "https://claude.ai/oauth/mcp-client.json",
        });
    });

    it("answers 404 when there was nothing of the caller's to revoke", async () => {
        signedInAs("member");
        mockConnections.revoke.mockResolvedValue(false);
        const res = await revokeConnection(
            new Request("http://x", { method: "DELETE" }),
            params({ clientId: "abc" })
        );
        expect(res.status).toBe(404);
    });
});

describe("OAuth clients (admins only)", () => {
    const createBody = {
        name: "Gemini Enterprise",
        redirectUris: ["https://vertexaisearch.cloud.google.com/oauth-redirect"],
    };
    const CLIENT = {
        clientId: "AbCdEf",
        name: "Gemini Enterprise",
        redirectUris: createBody.redirectUris,
        authMethod: "client_secret_post",
        createdAt: "2026-10-16T10:00:00.000Z",
    };

    it.each(["member", "viewer", "guest"])("refuses a %s on every route", async role => {
        signedInAs(role);
        expect((await getClients(new Request("http://x"))).status).toBe(403);
        expect(
            (await createClient(json("http://x/api/assistants/clients", "POST", createBody))).status
        ).toBe(403);
        expect(
            (
                await deleteClient(
                    new Request("http://x", { method: "DELETE" }),
                    params({ clientId: "AbCdEf" })
                )
            ).status
        ).toBe(403);
        expect(mockClients.list).not.toHaveBeenCalled();
        expect(mockClients.create).not.toHaveBeenCalled();
        expect(mockClients.remove).not.toHaveBeenCalled();
    });

    it("lists this workspace's clients with the endpoints to paste, and no secret", async () => {
        signedInAs("admin");
        mockClients.list.mockResolvedValue([CLIENT]);
        const res = await getClients(new Request("http://x"));
        expect(res.status).toBe(200);
        expect(mockClients.list).toHaveBeenCalledWith({ companyId: 50n });
        const body = (await res.json()) as Record<string, unknown>;
        expect(body).toMatchObject({
            clients: [CLIENT],
            endpoints: {
                authorization: "https://app.example.com/api/auth/oauth2/authorize",
                token: "https://app.example.com/api/auth/oauth2/token",
            },
            suggestedRedirectUri: "https://vertexaisearch.cloud.google.com/oauth-redirect",
        });
        expect(JSON.stringify(body)).not.toMatch(SECRET_FIELD);
    });

    it("creates a client with the admin's session headers and returns the secret once", async () => {
        signedInAs("admin");
        mockClients.create.mockResolvedValue({ client: CLIENT, clientSecret: "s3cret" });
        const res = await createClient(json("http://x/api/assistants/clients", "POST", createBody));
        expect(res.status).toBe(201);
        const call = mockClients.create.mock.calls[0]![0] as {
            headers: Headers;
            companyId: bigint;
            authMethod: string;
        };
        expect(call.companyId).toBe(50n);
        expect(call.authMethod).toBe("client_secret_post");
        expect(call.headers.get("cookie")).toBe("session=abc");
        expect(await res.json()).toMatchObject({
            client: CLIENT,
            clientSecret: "s3cret",
            serverUrl: "https://app.example.com/api/mcp",
        });
    });

    it("rejects a plain-http redirect and passes better-auth's refusals through as 400", async () => {
        signedInAs("owner");
        const insecure = await createClient(
            json("http://x/api/assistants/clients", "POST", {
                name: "X",
                redirectUris: ["http://example.com/cb"],
            })
        );
        expect(insecure.status).toBe(400);
        expect(mockClients.create).not.toHaveBeenCalled();

        mockClients.create.mockRejectedValue(new MockOAuthClientInputError("bad redirect"));
        const refused = await createClient(
            json("http://x/api/assistants/clients", "POST", createBody)
        );
        expect(refused.status).toBe(400);
        expect(await refused.json()).toEqual({ error: "bad redirect" });
    });

    it("deletes only within the workspace, 404 for anything else", async () => {
        signedInAs("admin");
        mockClients.remove.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        const ok = await deleteClient(
            new Request("http://x", { method: "DELETE" }),
            params({ clientId: "AbCdEf" })
        );
        expect(ok.status).toBe(200);
        expect(mockClients.remove).toHaveBeenCalledWith({ companyId: 50n, clientId: "AbCdEf" });
        const missing = await deleteClient(
            new Request("http://x", { method: "DELETE" }),
            params({ clientId: "Other" })
        );
        expect(missing.status).toBe(404);
    });
});
