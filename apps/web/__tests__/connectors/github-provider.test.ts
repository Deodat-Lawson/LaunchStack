/**
 * GitHub OAuth wire shapes with an injected fetch — no network. GitHub
 * answers 200 with {error} on failure; the exchange is two calls (token, then
 * viewer identity); revocation is the app-grant DELETE with Basic auth.
 */

import {
    buildAuthUrl,
    exchangeCode,
    GITHUB_SCOPES,
    refreshAccessToken,
    revokeToken,
} from "~/server/services/connectors/providers/github";
import {
    ConnectorGrantRevokedError,
    ConnectorOAuthError,
    type FetchLike,
} from "~/server/services/connectors/providers/types";

const CONFIG = {
    clientId: "client-123",
    clientSecret: "secret-456",
    redirectUri: "http://localhost:3000/api/connectors/github/oauth/callback",
};

/** Routes token-endpoint and api.github.com calls to different bodies. */
function fetchByUrl(responses: Record<string, { status: number; body: unknown }>): {
    fetch: FetchLike;
    urls: string[];
} {
    const urls: string[] = [];
    const fetch: FetchLike = async url => {
        urls.push(url);
        const match = Object.entries(responses).find(([prefix]) => url.startsWith(prefix));
        if (!match) throw new Error(`Unexpected URL in test: ${url}`);
        if (match[1].status === 204) return new Response(null, { status: 204 });
        return new Response(JSON.stringify(match[1].body), {
            status: match[1].status,
            headers: { "Content-Type": "application/json" },
        });
    };
    return { fetch, urls };
}

describe("github buildAuthUrl", () => {
    it("requests the repo scope with the signed state", () => {
        const url = new URL(buildAuthUrl(CONFIG, "signed-state"));

        expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
        expect(url.searchParams.get("client_id")).toBe(CONFIG.clientId);
        expect(url.searchParams.get("state")).toBe("signed-state");
        expect(url.searchParams.get("scope")).toBe(GITHUB_SCOPES.join(" "));
        expect(url.searchParams.get("scope")).toContain("repo");
    });
});

describe("github exchangeCode", () => {
    it("exchanges the code then resolves the viewer identity", async () => {
        const { fetch, urls } = fetchByUrl({
            "https://github.com/login/oauth/access_token": {
                status: 200,
                body: { access_token: "gho_1", scope: "repo,read:user" },
            },
            "https://api.github.com/user": {
                status: 200,
                body: { id: 98765, login: "octocat" },
            },
        });

        const grant = await exchangeCode({ ...CONFIG, fetch }, "code");

        expect(grant.providerAccountId).toBe("98765");
        expect(grant.displayName).toBe("octocat");
        expect(grant.accessToken).toBe("gho_1");
        // Classic OAuth tokens: no expiry, no refresh token.
        expect(grant.accessTokenExpiresAt).toBeNull();
        expect(grant.refreshToken).toBeNull();
        expect(grant.scopes).toBe("repo read:user");
        expect(urls[0]).toContain("github.com/login/oauth/access_token");
        expect(urls[1]).toContain("api.github.com/user");
    });

    it("treats an error payload as a failure despite HTTP 200", async () => {
        const { fetch } = fetchByUrl({
            "https://github.com/login/oauth/access_token": {
                status: 200,
                body: { error: "bad_verification_code", error_description: "The code is wrong" },
            },
        });

        await expect(exchangeCode({ ...CONFIG, fetch }, "code")).rejects.toThrow(
            "The code is wrong"
        );
        await expect(exchangeCode({ ...CONFIG, fetch }, "code")).rejects.toThrow(
            ConnectorOAuthError
        );
    });
});

describe("github refreshAccessToken", () => {
    it("classifies a dead refresh token as a revoked grant", async () => {
        const { fetch } = fetchByUrl({
            "https://github.com/login/oauth/access_token": {
                status: 200,
                body: { error: "bad_refresh_token" },
            },
        });

        await expect(refreshAccessToken({ ...CONFIG, fetch }, "rt")).rejects.toThrow(
            ConnectorGrantRevokedError
        );
    });
});

describe("github revokeToken", () => {
    it("accepts 204 and an already-gone 404 as success", async () => {
        const gone = fetchByUrl({
            "https://api.github.com/applications/": { status: 404, body: {} },
        });
        const ok = fetchByUrl({
            "https://api.github.com/applications/": { status: 204, body: {} },
        });
        const denied = fetchByUrl({
            "https://api.github.com/applications/": { status: 401, body: {} },
        });

        expect(await revokeToken({ ...CONFIG, fetch: ok.fetch }, "t")).toBe(true);
        expect(await revokeToken({ ...CONFIG, fetch: gone.fetch }, "t")).toBe(true);
        expect(await revokeToken({ ...CONFIG, fetch: denied.fetch }, "t")).toBe(false);
    });
});
