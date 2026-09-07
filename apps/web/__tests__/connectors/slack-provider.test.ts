/**
 * Slack OAuth v2 wire shapes with an injected fetch — no network. Slack
 * answers 200 with {ok:false} on failure, so status codes are not signal;
 * the grant identity is the team, not the human who authorized.
 */

import {
    buildAuthUrl,
    exchangeCode,
    refreshAccessToken,
    revokeToken,
    SLACK_BOT_SCOPES,
} from "~/server/services/connectors/providers/slack";
import {
    ConnectorGrantRevokedError,
    ConnectorOAuthError,
    type FetchLike,
} from "~/server/services/connectors/providers/types";

const CONFIG = {
    clientId: "client-123",
    clientSecret: "secret-456",
    redirectUri: "http://localhost:3000/api/connectors/slack/oauth/callback",
};

function fetchReturning(status: number, body: unknown): { fetch: FetchLike } {
    return {
        fetch: async () =>
            new Response(JSON.stringify(body), {
                status,
                headers: { "Content-Type": "application/json" },
            }),
    };
}

describe("slack buildAuthUrl", () => {
    it("requests the bot scopes the collab client needs", () => {
        const url = new URL(buildAuthUrl(CONFIG, "signed-state"));

        expect(url.origin + url.pathname).toBe("https://slack.com/oauth/v2/authorize");
        expect(url.searchParams.get("client_id")).toBe(CONFIG.clientId);
        expect(url.searchParams.get("state")).toBe("signed-state");
        expect(url.searchParams.get("scope")).toBe(SLACK_BOT_SCOPES.join(","));
        expect(url.searchParams.get("scope")).toContain("chat:write");
    });
});

describe("slack exchangeCode", () => {
    it("returns a grant keyed on the team id", async () => {
        const { fetch } = fetchReturning(200, {
            ok: true,
            access_token: "xoxb-1",
            scope: "chat:write,channels:read",
            team: { id: "T123", name: "Acme" },
        });

        const grant = await exchangeCode({ ...CONFIG, fetch }, "code");

        expect(grant.providerAccountId).toBe("T123");
        expect(grant.displayName).toBe("Acme");
        expect(grant.accessToken).toBe("xoxb-1");
        // Non-rotating bot tokens: no expiry, no refresh token.
        expect(grant.accessTokenExpiresAt).toBeNull();
        expect(grant.refreshToken).toBeNull();
        // Comma-delimited from Slack, space-delimited in the store.
        expect(grant.scopes).toBe("chat:write channels:read");
    });

    it("carries rotation fields through when the Slack app rotates tokens", async () => {
        const { fetch } = fetchReturning(200, {
            ok: true,
            access_token: "xoxe-1",
            refresh_token: "xoxe-refresh",
            expires_in: 43200,
            team: { id: "T123", name: "Acme" },
        });

        const grant = await exchangeCode({ ...CONFIG, fetch }, "code");

        expect(grant.refreshToken).toBe("xoxe-refresh");
        expect(grant.accessTokenExpiresAt).toBeInstanceOf(Date);
    });

    it("treats ok:false as a failure despite HTTP 200", async () => {
        const { fetch } = fetchReturning(200, { ok: false, error: "invalid_code" });

        await expect(exchangeCode({ ...CONFIG, fetch }, "code")).rejects.toThrow("invalid_code");
        await expect(exchangeCode({ ...CONFIG, fetch }, "code")).rejects.toThrow(
            ConnectorOAuthError
        );
    });
});

describe("slack refreshAccessToken", () => {
    it("classifies a dead refresh token as a revoked grant", async () => {
        const { fetch } = fetchReturning(200, { ok: false, error: "invalid_refresh_token" });

        await expect(refreshAccessToken({ ...CONFIG, fetch }, "rt")).rejects.toThrow(
            ConnectorGrantRevokedError
        );
    });
});

describe("slack revokeToken", () => {
    it("reports Slack's ok flag", async () => {
        expect(await revokeToken(fetchReturning(200, { ok: true }), "t")).toBe(true);
        expect(await revokeToken(fetchReturning(200, { ok: false }), "t")).toBe(false);
        expect(await revokeToken(fetchReturning(500, {}), "t")).toBe(false);
    });
});
