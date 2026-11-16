import type * as AuthModule from "~/server/auth";

const mockPostgres = jest.fn((..._args: unknown[]) => ({}));
const mockGetSession = jest.fn(async () => null);
const mockBetterAuth = jest.fn((..._args: unknown[]) => ({
    api: { getSession: mockGetSession },
    handler: jest.fn(),
}));
jest.mock("postgres", () => ({
    __esModule: true,
    default: (...args: unknown[]) => mockPostgres(...args),
}));
jest.mock("drizzle-orm/postgres-js", () => ({ drizzle: () => ({}) }));
jest.mock("better-auth", () => ({ betterAuth: (...args: unknown[]) => mockBetterAuth(...args) }));
jest.mock("better-auth/adapters/drizzle", () => ({ drizzleAdapter: jest.fn() }));
jest.mock("better-auth/api", () => ({ createAuthMiddleware: jest.fn() }));
jest.mock("better-auth/crypto", () => ({ hashPassword: jest.fn(), verifyPassword: jest.fn() }));
jest.mock("better-auth/next-js", () => ({ nextCookies: jest.fn() }));
jest.mock("better-auth/plugins", () => ({ jwt: jest.fn(), lastLoginMethod: jest.fn() }));
jest.mock("@better-auth/cimd", () => ({ cimd: jest.fn() }));
jest.mock("@better-auth/cimd/node", () => ({ fetchClientMetadataResource: jest.fn() }));
jest.mock("@better-auth/mcp", () => ({ mcp: jest.fn() }));
jest.mock("~/server/mcp/config", () => ({
    MCP_OAUTH_SCOPES: [],
    mcpAvailability: () => ({ enabled: false }),
}));
jest.mock("~/server/mcp/oauth-workspace", () => ({
    workspaceAccessTokenClaims: jest.fn(),
    workspacePostLogin: jest.fn(),
}));
jest.mock("~/server/auth/account-linking", () => ({ accountLinkingHooks: jest.fn() }));
jest.mock("~/server/auth/email", () => ({ sendAuthEmail: jest.fn() }));
jest.mock("~/server/auth/providers", () => ({ enabledSocialProviders: () => [] }));

function reloadAuth() {
    let authModule: typeof AuthModule;
    jest.isolateModules(() => {
        authModule = jest.requireActual<typeof AuthModule>("~/server/auth");
    });
    return authModule!;
}

describe("auth development pool lifetime", () => {
    beforeEach(() => {
        mockPostgres.mockClear();
        mockBetterAuth.mockClear();
        mockGetSession.mockReset();
        jest.replaceProperty(process, "env", {
            ...process.env,
            NODE_ENV: "development",
            DATABASE_URL: "postgres://synthetic:synthetic@localhost/auth-hmr",
            BETTER_AUTH_URL: "http://localhost:3199",
            BETTER_AUTH_ADDITIONAL_ORIGINS: "http://127.0.0.1:3199",
        });
    });
    afterEach(() => jest.restoreAllMocks());
    it("reuses the native pool after HMR and across origin wrappers", async () => {
        await reloadAuth().getSessionFromHeaders(new Headers({ host: "localhost:3199" }));
        const auth = reloadAuth();
        await auth.getSessionFromHeaders(new Headers({ host: "localhost:3199" }));
        await auth.getSessionFromHeaders(new Headers({ host: "127.0.0.1:3199" }));
        expect(mockPostgres).toHaveBeenCalledTimes(1);
        expect(mockPostgres).toHaveBeenCalledWith(process.env.DATABASE_URL, { max: 5 });
        expect(mockBetterAuth).toHaveBeenCalledTimes(3);
    });
    it("propagates a sanitized session failure rather than returning a valid session", async () => {
        mockGetSession.mockRejectedValue(
            new Error("query token=synthetic-private-session", {
                cause: { code: "53300", parameters: ["synthetic-private-session"] },
            })
        );
        const rejected = reloadAuth().getSessionFromHeaders(
            new Headers({ host: "localhost:3199" })
        );
        await expect(rejected).rejects.toMatchObject({
            message: "Authentication session lookup failed",
            code: "53300",
        });
        await rejected.catch((error: unknown) => {
            expect(JSON.stringify(error)).not.toContain("synthetic-private-session");
            expect(error).not.toHaveProperty("cause");
        });
    });
});
