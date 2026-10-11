/**
 * LinkedIn OAuth 2.0 wire shapes with an injected fetch — no network. The
 * scopes come from the deployment (LinkedIn decides them per app); the
 * grant's identity is the member, read with the new token.
 */

const mockGetLinkedInMember = jest.fn();
jest.mock("@launchstack/tools/social-publish/linkedin", () => ({
    getLinkedInMember: (...args: unknown[]) => mockGetLinkedInMember(...args),
}));

import {
    buildAuthUrl,
    exchangeCode,
    LINKEDIN_DEFAULT_SCOPES,
    normalizeLinkedInScopes,
    refreshAccessToken,
    revokeToken,
} from "~/server/services/connectors/providers/linkedin";
import {
    ConnectorGrantRevokedError,
    ConnectorOAuthError,
    type FetchLike,
} from "~/server/services/connectors/providers/types";

const CONFIG = {
    clientId: "client-123",
    clientSecret: "secret-456",
    redirectUri: "https://app.test/api/connectors/linkedin/oauth/callback",
};

interface Call {
    url: string;
    body: URLSearchParams;
}

function recordingFetch(status: number, body: unknown): { fetch: FetchLike; calls: Call[] } {
    const calls: Call[] = [];
    return {
        calls,
        fetch: async (url, init) => {
            calls.push({ url, body: new URLSearchParams(String(init?.body ?? "")) });
            return new Response(JSON.stringify(body), {
                status,
                headers: { "Content-Type": "application/json" },
            });
        },
    };
}

beforeEach(() => {
    mockGetLinkedInMember.mockReset();
    mockGetLinkedInMember.mockResolvedValue({
        id: "abc123",
        urn: "urn:li:person:abc123",
        name: "Dana Okafor",
        email: "dana@example.com",
        pictureUrl: null,
    });
});

describe("linkedin buildAuthUrl", () => {
    it("asks for the self-serve scopes when the deployment names none", () => {
        const url = new URL(buildAuthUrl(CONFIG, "signed-state"));
        expect(url.origin + url.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
        expect(url.searchParams.get("response_type")).toBe("code");
        expect(url.searchParams.get("client_id")).toBe("client-123");
        expect(url.searchParams.get("redirect_uri")).toBe(CONFIG.redirectUri);
        expect(url.searchParams.get("state")).toBe("signed-state");
        expect(url.searchParams.get("scope")).toBe(LINKEDIN_DEFAULT_SCOPES.join(" "));
    });

    it("asks for exactly the deployment's scopes, at its auth base", () => {
        const url = new URL(
            buildAuthUrl(
                {
                    ...CONFIG,
                    authBaseUrl: "http://localhost:3042/dev/stand-ins/linkedin/oauth/v2/",
                    scopes: ["r_basicprofile", "w_organization_social", "rw_organization_admin"],
                },
                "s"
            )
        );
        expect(url.origin + url.pathname).toBe(
            "http://localhost:3042/dev/stand-ins/linkedin/oauth/v2/authorization"
        );
        expect(url.searchParams.get("scope")).toBe(
            "r_basicprofile w_organization_social rw_organization_admin"
        );
    });
});

describe("linkedin exchangeCode", () => {
    it("keys the grant on the member and keeps a refresh token when LinkedIn issues one", async () => {
        const { fetch, calls } = recordingFetch(200, {
            access_token: "AT",
            expires_in: 5_184_000,
            refresh_token: "RT",
            refresh_token_expires_in: 31_536_000,
            scope: "r_basicprofile,w_organization_social,rw_organization_admin",
        });
        const before = Date.now();
        const grant = await exchangeCode({ ...CONFIG, fetch }, "the-code");

        expect(calls[0]!.url).toBe("https://www.linkedin.com/oauth/v2/accessToken");
        expect(calls[0]!.body.get("grant_type")).toBe("authorization_code");
        expect(calls[0]!.body.get("code")).toBe("the-code");
        expect(calls[0]!.body.get("redirect_uri")).toBe(CONFIG.redirectUri);
        expect(calls[0]!.body.get("client_secret")).toBe("secret-456");
        expect(mockGetLinkedInMember).toHaveBeenCalledWith(
            expect.objectContaining({ accessToken: "AT" })
        );
        expect(grant.providerAccountId).toBe("abc123");
        expect(grant.displayName).toBe("Dana Okafor");
        expect(grant.scopes).toBe("r_basicprofile w_organization_social rw_organization_admin");
        expect(grant.refreshToken).toBe("RT");
        const expires = grant.accessTokenExpiresAt!.getTime();
        expect(expires).toBeGreaterThanOrEqual(before + 5_184_000_000);
    });

    it("falls back to the requested scopes when LinkedIn does not echo them", async () => {
        const { fetch } = recordingFetch(200, { access_token: "AT", expires_in: 60 });
        const grant = await exchangeCode(
            { ...CONFIG, fetch, scopes: ["openid", "w_member_social"] },
            "c"
        );
        expect(grant.scopes).toBe("openid w_member_social");
        expect(grant.refreshToken).toBeNull();
    });

    it("reports a refused code as an OAuth error", async () => {
        const { fetch } = recordingFetch(400, {
            error: "invalid_request",
            error_description:
                "Unable to retrieve access token: appid/redirect uri/code verifier does not match",
        });
        await expect(exchangeCode({ ...CONFIG, fetch }, "c")).rejects.toBeInstanceOf(
            ConnectorOAuthError
        );
        expect(mockGetLinkedInMember).not.toHaveBeenCalled();
    });
});

describe("linkedin refreshAccessToken", () => {
    it("trades the refresh token for a new access token", async () => {
        const { fetch, calls } = recordingFetch(200, {
            access_token: "AT2",
            expires_in: 5_184_000,
        });
        const refreshed = await refreshAccessToken({ ...CONFIG, fetch }, "RT");
        expect(calls[0]!.body.get("grant_type")).toBe("refresh_token");
        expect(calls[0]!.body.get("refresh_token")).toBe("RT");
        expect(refreshed.accessToken).toBe("AT2");
        // LinkedIn keeps the same refresh token; null means "keep what you have".
        expect(refreshed.refreshToken).toBeNull();
    });

    it("treats an invalid or expired refresh token as a dead grant", async () => {
        const { fetch } = recordingFetch(400, { error: "invalid_grant" });
        await expect(refreshAccessToken({ ...CONFIG, fetch }, "RT")).rejects.toBeInstanceOf(
            ConnectorGrantRevokedError
        );
    });
});

describe("linkedin revokeToken", () => {
    it("posts the token with the client pair", async () => {
        const { fetch, calls } = recordingFetch(200, {});
        await expect(revokeToken({ ...CONFIG, fetch }, "AT")).resolves.toBe(true);
        expect(calls[0]!.url).toBe("https://www.linkedin.com/oauth/v2/revoke");
        expect(calls[0]!.body.get("token")).toBe("AT");
        expect(calls[0]!.body.get("client_id")).toBe("client-123");
    });

    it("never throws", async () => {
        const fetch: FetchLike = () => Promise.reject(new Error("offline"));
        await expect(revokeToken({ ...CONFIG, fetch }, "AT")).resolves.toBe(false);
    });
});

describe("normalizeLinkedInScopes", () => {
    it("accepts comma or space separated scopes", () => {
        expect(normalizeLinkedInScopes("a,b c", [])).toBe("a b c");
        expect(normalizeLinkedInScopes(undefined, ["x"])).toBe("x");
    });
});
