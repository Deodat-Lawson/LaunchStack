/**
 * Revoking a deleted connection's grant is best effort and bounded: it
 * follows a change that already committed (a member's removal, a
 * disconnect), so a provider that throws or hangs reads as "not revoked"
 * and never holds the response up for longer than the timeout.
 */

const mockNotionRevoke = jest.fn<Promise<boolean>, [unknown, string]>();
const mockGoogleRevoke = jest.fn<Promise<boolean>, [string]>();

jest.mock("~/server/services/connectors/config", () => ({
    isOAuthProvider: (provider: string) =>
        ["slack", "github", "linkedin", "notion"].includes(provider),
    getConnectorConfig: () => ({ clientId: "id", clientSecret: "secret", redirectUri: "x" }),
    PROVIDER_MODULES: {
        notion: {
            revokeToken: (config: unknown, token: string) => mockNotionRevoke(config, token),
        },
    },
}));
jest.mock("~/server/services/connectors/gmail/connections", () => ({
    revokeGoogleToken: (token: string) => mockGoogleRevoke(token),
}));

import { revokeConnectionTokens } from "~/server/services/connectors/revoke";

const TOKENS = { accessToken: "access", refreshToken: "refresh" };

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("revokeConnectionTokens", () => {
    it("revokes a Notion grant with its access token", async () => {
        mockNotionRevoke.mockResolvedValue(true);

        await expect(revokeConnectionTokens("notion", TOKENS)).resolves.toBe(true);
        expect(mockNotionRevoke).toHaveBeenCalledWith(expect.anything(), "access");
    });

    it("revokes Gmail with its Google refresh token", async () => {
        mockGoogleRevoke.mockResolvedValue(true);

        await expect(revokeConnectionTokens("gmail", TOKENS)).resolves.toBe(true);
        expect(mockGoogleRevoke).toHaveBeenCalledWith("refresh");
    });

    it("reads a provider that throws as not revoked", async () => {
        mockNotionRevoke.mockRejectedValue(new Error("connection reset"));

        await expect(revokeConnectionTokens("notion", TOKENS)).resolves.toBe(false);
    });

    it("gives up on a provider that never answers", async () => {
        mockNotionRevoke.mockReturnValue(new Promise<boolean>(() => undefined));
        const started = Date.now();

        await expect(revokeConnectionTokens("notion", TOKENS, undefined, 30)).resolves.toBe(false);
        expect(Date.now() - started).toBeLessThan(1_000);
    });

    it("has nothing to revoke without tokens, or for Drive", async () => {
        await expect(revokeConnectionTokens("notion", null)).resolves.toBe(false);
        await expect(revokeConnectionTokens("google-drive", TOKENS)).resolves.toBe(false);
        expect(mockNotionRevoke).not.toHaveBeenCalled();
        expect(mockGoogleRevoke).not.toHaveBeenCalled();
    });
});
