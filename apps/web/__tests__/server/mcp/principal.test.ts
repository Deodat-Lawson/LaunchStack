/**
 * Who is calling /api/mcp. An access key or an OAuth access token becomes one
 * member of one workspace with their live permissions — or a response MCP
 * clients understand: 401 with the RFC 9728 challenge (go sign in), 403 for
 * a credential whose person has left the workspace.
 */
import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockVerifyAccessKey = jest.fn();
const mockResolveMemberContext = jest.fn();
const mockHasLiveConsent = jest.fn();
const mockClientDisplayName = jest.fn();
let mockClaims: Record<string, unknown> | null = null;

jest.mock("~/server/auth", () => ({
    auth: {
        $context: Promise.resolve({
            baseURL: "http://localhost:3000/api/auth",
            internalAdapter: {},
        }),
    },
}));
jest.mock("better-auth/oauth2", () => ({ createDpopReplayStore: () => ({}) }));
jest.mock("@better-auth/mcp", () => ({
    // Stands in for better-auth's JWT check: hands the handler the claims a
    // test set, or answers like the library does for a bad token.
    createMcpProtectedRequestHandler:
        (_opts: unknown, handler: (r: Request, c: unknown) => Promise<Response>) =>
        async (request: Request) =>
            mockClaims
                ? handler(request, mockClaims)
                : new Response("{}", {
                      status: 401,
                      headers: { "WWW-Authenticate": 'Bearer resource_metadata="library"' },
                  }),
}));
jest.mock("~/server/mcp/access-keys", () => ({
    ...jest.requireActual("~/server/mcp/access-keys"),
    verifyAccessKey: (...args: unknown[]) => mockVerifyAccessKey(...args),
}));
jest.mock("~/lib/require-workspace-context", () => ({
    resolveMemberContext: (...args: unknown[]) => mockResolveMemberContext(...args),
}));
jest.mock("~/server/mcp/connections", () => ({
    ...jest.requireActual("~/server/mcp/connections"),
    hasLiveConsent: (...args: unknown[]) => mockHasLiveConsent(...args),
    clientDisplayName: (...args: unknown[]) => mockClientDisplayName(...args),
}));

// eslint-disable-next-line import/first
import { authenticateMcpRequest } from "~/server/mcp/principal";

const saved = { ...process.env };

function call(authorization?: string) {
    return authenticateMcpRequest(
        new Request("http://localhost:3000/api/mcp", {
            method: "POST",
            headers: authorization ? { authorization } : {},
        })
    );
}

beforeEach(() => {
    process.env = { ...saved, BETTER_AUTH_URL: "http://localhost:3000" };
    delete process.env.MCP_SERVER_ENABLED;
    mockClaims = null;
    for (const fn of [mockVerifyAccessKey, mockResolveMemberContext, mockHasLiveConsent, mockClientDisplayName]) {
        fn.mockReset();
    }
});

afterAll(() => {
    process.env = saved;
});

describe("authenticateMcpRequest", () => {
    it("answers 404 while the MCP server is off", async () => {
        process.env.MCP_SERVER_ENABLED = "false";
        const result = await call("Bearer lsk_anything");
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.response.status).toBe(404);
    });

    describe("with an access key", () => {
        it("challenges an unknown or revoked key the way MCP clients expect", async () => {
            mockVerifyAccessKey.mockResolvedValue(null);
            const result = await call("Bearer lsk_revoked");
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.response.status).toBe(401);
            expect(result.response.headers.get("www-authenticate")).toContain(
                'resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/api/mcp"'
            );
            expect(await result.response.json()).toMatchObject({
                jsonrpc: "2.0",
                error: { code: -32000 },
            });
        });

        it("answers 403 when the key's owner has left the workspace", async () => {
            mockVerifyAccessKey.mockResolvedValue({
                keyId: 7,
                keyName: "Nightly script",
                authUserId: "u1",
                companyId: BigInt(50),
                scopes: ["launchstack:read"],
            });
            mockResolveMemberContext.mockResolvedValue(null);
            const result = await call("Bearer lsk_live");
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.response.status).toBe(403);
        });

        it("resolves a live key to its owner in its workspace", async () => {
            const ctx = makeWorkspaceContext({ authUserId: "u1", companyId: BigInt(50) });
            mockVerifyAccessKey.mockResolvedValue({
                keyId: 7,
                keyName: "Gemini CLI",
                authUserId: "u1",
                companyId: BigInt(50),
                scopes: ["launchstack:read", "launchstack:write"],
            });
            mockResolveMemberContext.mockResolvedValue(ctx);
            const result = await call("Bearer lsk_live");
            expect(mockResolveMemberContext).toHaveBeenCalledWith("u1", BigInt(50));
            expect(result).toMatchObject({
                ok: true,
                principal: {
                    ctx,
                    credential: { kind: "key", keyId: 7 },
                    label: "Gemini CLI",
                    family: "gemini",
                    rateLimitKey: "mcp:u1:50",
                },
            });
            if (result.ok) expect([...result.principal.scopes]).toContain("launchstack:write");
        });
    });

    describe("with an OAuth access token", () => {
        const claims = {
            sub: "u1",
            azp: "client-1",
            scope: "openid launchstack:read",
            launchstack_workspace: "50",
        };

        it("passes the library's challenge through for a bad token", async () => {
            const result = await call("Bearer not-a-jwt");
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.response.status).toBe(401);
                expect(result.response.headers.get("www-authenticate")).toContain("library");
            }
        });

        it("rejects a valid token that is not bound to a workspace", async () => {
            mockClaims = { sub: "u1", azp: "client-1", scope: "openid" };
            const result = await call("Bearer jwt");
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.response.status).toBe(401);
            expect(mockHasLiveConsent).not.toHaveBeenCalled();
        });

        it("cuts off a token whose connection was revoked in Settings", async () => {
            mockClaims = claims;
            mockHasLiveConsent.mockResolvedValue(false);
            const result = await call("Bearer jwt");
            expect(mockHasLiveConsent).toHaveBeenCalledWith({
                authUserId: "u1",
                companyId: BigInt(50),
                clientId: "client-1",
            });
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.response.status).toBe(401);
        });

        it("answers 403 when the person is no longer a member", async () => {
            mockClaims = claims;
            mockHasLiveConsent.mockResolvedValue(true);
            mockResolveMemberContext.mockResolvedValue(null);
            const result = await call("Bearer jwt");
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.response.status).toBe(403);
        });

        it("resolves a live token to the member, scopes and assistant", async () => {
            mockClaims = claims;
            mockHasLiveConsent.mockResolvedValue(true);
            const ctx = makeWorkspaceContext({ authUserId: "u1", companyId: BigInt(50) });
            mockResolveMemberContext.mockResolvedValue(ctx);
            mockClientDisplayName.mockResolvedValue("Claude");
            const result = await call("Bearer jwt");
            expect(result).toMatchObject({
                ok: true,
                principal: {
                    ctx,
                    credential: { kind: "oauth", clientId: "client-1" },
                    label: "Claude",
                    family: "claude",
                    rateLimitKey: "mcp:u1:50",
                },
            });
            if (result.ok) {
                expect([...result.principal.scopes].sort()).toEqual(["launchstack:read", "openid"]);
            }
        });
    });
});
