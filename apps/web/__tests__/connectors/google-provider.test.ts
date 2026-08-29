/**
 * Google OAuth wire shapes with an injected fetch — no network. Covers the
 * auth URL, code exchange (refresh_token and sub required), refresh
 * (invalid_grant → typed revocation error), and revoke.
 */

import {
    buildAuthUrl,
    exchangeCode,
    GOOGLE_DRIVE_SCOPES,
    refreshAccessToken,
    revokeToken,
} from "~/server/services/connectors/providers/google";
import {
    ConnectorGrantRevokedError,
    ConnectorOAuthError,
    type FetchLike,
} from "~/server/services/connectors/providers/types";

const CONFIG = {
    clientId: "client-123",
    clientSecret: "secret-456",
    redirectUri: "http://localhost:3000/api/connectors/google-drive/oauth/callback",
};

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function fetchReturning(
    status: number,
    body: unknown
): { fetch: FetchLike; calls: URLSearchParams[] } {
    const calls: URLSearchParams[] = [];
    const fetch: FetchLike = async (_url, init) => {
        // postForm always sends a urlencoded string body.
        calls.push(new URLSearchParams((init?.body as string | undefined) ?? ""));
        return jsonResponse(status, body);
    };
    return { fetch, calls };
}

function idToken(claims: Record<string, unknown>): string {
    return `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
}

describe("google buildAuthUrl", () => {
    it("carries offline access, forced consent, and the drive.file scope", () => {
        const url = new URL(buildAuthUrl(CONFIG, "signed-state"));

        expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
        expect(url.searchParams.get("client_id")).toBe(CONFIG.clientId);
        expect(url.searchParams.get("redirect_uri")).toBe(CONFIG.redirectUri);
        expect(url.searchParams.get("access_type")).toBe("offline");
        expect(url.searchParams.get("prompt")).toBe("consent");
        expect(url.searchParams.get("state")).toBe("signed-state");
        expect(url.searchParams.get("scope")).toBe(GOOGLE_DRIVE_SCOPES.join(" "));
        expect(url.searchParams.get("scope")).toContain("drive.file");
    });
});

describe("google exchangeCode", () => {
    it("returns a grant keyed on the OIDC subject", async () => {
        const { fetch, calls } = fetchReturning(200, {
            access_token: "at",
            refresh_token: "rt",
            expires_in: 3599,
            scope: "scope-a scope-b",
            id_token: idToken({ email: "user@example.com", sub: "google-sub-1" }),
        });

        const grant = await exchangeCode({ ...CONFIG, fetch }, "the-code");

        expect(grant.providerAccountId).toBe("google-sub-1");
        expect(grant.displayName).toBe("user@example.com");
        expect(grant.accessToken).toBe("at");
        expect(grant.refreshToken).toBe("rt");
        expect(grant.scopes).toBe("scope-a scope-b");
        expect(grant.accessTokenExpiresAt).toBeInstanceOf(Date);
        expect(calls[0]?.get("grant_type")).toBe("authorization_code");
        expect(calls[0]?.get("code")).toBe("the-code");
    });

    it("fails loudly when Google returns no refresh_token", async () => {
        const { fetch } = fetchReturning(200, {
            access_token: "at",
            expires_in: 3599,
            id_token: idToken({ sub: "s" }),
        });

        await expect(exchangeCode({ ...CONFIG, fetch }, "code")).rejects.toThrow(
            ConnectorOAuthError
        );
    });

    it("surfaces Google's error description on failure", async () => {
        const { fetch } = fetchReturning(400, {
            error: "invalid_request",
            error_description: "Missing code verifier",
        });

        await expect(exchangeCode({ ...CONFIG, fetch }, "code")).rejects.toThrow(
            "Missing code verifier"
        );
    });
});

describe("google refreshAccessToken", () => {
    it("returns a fresh access token", async () => {
        const { fetch, calls } = fetchReturning(200, { access_token: "at2", expires_in: 3600 });

        const refreshed = await refreshAccessToken({ ...CONFIG, fetch }, "rt");

        expect(refreshed.accessToken).toBe("at2");
        expect(refreshed.refreshToken).toBeNull();
        expect(refreshed.accessTokenExpiresAt).toBeInstanceOf(Date);
        expect(calls[0]?.get("grant_type")).toBe("refresh_token");
    });

    it("classifies invalid_grant as a revoked grant", async () => {
        const { fetch } = fetchReturning(400, { error: "invalid_grant" });

        await expect(refreshAccessToken({ ...CONFIG, fetch }, "rt")).rejects.toThrow(
            ConnectorGrantRevokedError
        );
    });
});

describe("google revokeToken", () => {
    it("reports success and failure without throwing", async () => {
        expect(await revokeToken(fetchReturning(200, {}), "t")).toBe(true);
        expect(await revokeToken(fetchReturning(400, {}), "t")).toBe(false);
    });
});
