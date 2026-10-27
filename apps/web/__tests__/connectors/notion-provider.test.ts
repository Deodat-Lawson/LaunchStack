/**
 * Notion OAuth wire shapes with an injected fetch — no network. Notion's
 * token endpoints take HTTP Basic client auth and a JSON body, every call
 * carries Notion-Version, and the grant identity is the bot id (unique per
 * token), not the workspace.
 */

import {
    buildAuthUrl,
    exchangeCode,
    NOTION_API_VERSION,
    refreshAccessToken,
    revokeToken,
} from "~/server/services/connectors/providers/notion";
import {
    ConnectorGrantRevokedError,
    ConnectorOAuthError,
    type FetchLike,
} from "~/server/services/connectors/providers/types";

const CONFIG = {
    clientId: "client-123",
    clientSecret: "secret-456",
    redirectUri: "http://localhost:3000/api/connectors/notion/oauth/callback",
};

const BASIC = `Basic ${Buffer.from("client-123:secret-456").toString("base64")}`;

interface Captured {
    url: string;
    init: RequestInit | undefined;
}

function fetchReturning(status: number, body: unknown): { fetch: FetchLike; calls: Captured[] } {
    const calls: Captured[] = [];
    return {
        calls,
        fetch: async (url, init) => {
            calls.push({ url, init });
            return new Response(JSON.stringify(body), {
                status,
                headers: { "Content-Type": "application/json" },
            });
        },
    };
}

function headersOf(call: Captured): Record<string, string> {
    return call.init?.headers as Record<string, string>;
}

function bodyOf(call: Captured): unknown {
    return JSON.parse(call.init?.body as string);
}

const TOKEN_RESPONSE = {
    access_token: "ntn_access",
    token_type: "bearer",
    refresh_token: "ntn_refresh",
    bot_id: "bot-uuid-1",
    workspace_id: "ws-uuid-1",
    workspace_name: "Acme HQ",
    workspace_icon: null,
    owner: { type: "user", user: { object: "user", id: "user-uuid-1" } },
    duplicated_template_id: null,
    request_id: "req-1",
};

describe("notion buildAuthUrl", () => {
    it("asks Notion for a user-owned grant, with no scope parameter", () => {
        const url = new URL(buildAuthUrl(CONFIG, "signed-state"));

        expect(url.origin + url.pathname).toBe("https://api.notion.com/v1/oauth/authorize");
        expect(url.searchParams.get("owner")).toBe("user");
        expect(url.searchParams.get("response_type")).toBe("code");
        expect(url.searchParams.get("client_id")).toBe(CONFIG.clientId);
        expect(url.searchParams.get("redirect_uri")).toBe(CONFIG.redirectUri);
        expect(url.searchParams.get("state")).toBe("signed-state");
        expect(url.searchParams.has("scope")).toBe(false);
    });
});

describe("notion exchangeCode", () => {
    it("posts JSON with Basic client auth and the Notion-Version header", async () => {
        const { fetch, calls } = fetchReturning(200, TOKEN_RESPONSE);

        await exchangeCode({ ...CONFIG, fetch }, "code-1");

        expect(calls).toHaveLength(1);
        expect(calls[0]!.url).toBe("https://api.notion.com/v1/oauth/token");
        expect(calls[0]!.init?.method).toBe("POST");
        expect(headersOf(calls[0]!)).toMatchObject({
            Authorization: BASIC,
            "Content-Type": "application/json",
            "Notion-Version": NOTION_API_VERSION,
        });
        expect(bodyOf(calls[0]!)).toEqual({
            grant_type: "authorization_code",
            code: "code-1",
            redirect_uri: CONFIG.redirectUri,
        });
    });

    it("returns a grant keyed on the bot id, named for the workspace", async () => {
        const { fetch } = fetchReturning(200, TOKEN_RESPONSE);

        const grant = await exchangeCode({ ...CONFIG, fetch }, "code");

        expect(grant.providerAccountId).toBe("bot-uuid-1");
        expect(grant.displayName).toBe("Acme HQ");
        expect(grant.accessToken).toBe("ntn_access");
        expect(grant.refreshToken).toBe("ntn_refresh");
        // Notion grants no OAuth scopes and sends no expires_in.
        expect(grant.scopes).toBe("");
        expect(grant.accessTokenExpiresAt).toBeNull();
    });

    it("sets an expiry when Notion does send expires_in", async () => {
        const { fetch } = fetchReturning(200, { ...TOKEN_RESPONSE, expires_in: 3600 });

        const grant = await exchangeCode({ ...CONFIG, fetch }, "code");

        expect(grant.accessTokenExpiresAt).toBeInstanceOf(Date);
        expect(grant.accessTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it("surfaces Notion's error description on a failed exchange", async () => {
        const { fetch } = fetchReturning(400, {
            error: "invalid_grant",
            error_description: "Invalid code.",
        });

        await expect(exchangeCode({ ...CONFIG, fetch }, "code")).rejects.toThrow("Invalid code.");
        await expect(exchangeCode({ ...CONFIG, fetch }, "code")).rejects.toThrow(
            ConnectorOAuthError
        );
    });

    it("rejects a token response without a bot id", async () => {
        // JSON drops undefined, so the response simply has no bot_id.
        const { fetch } = fetchReturning(200, { ...TOKEN_RESPONSE, bot_id: undefined });

        await expect(exchangeCode({ ...CONFIG, fetch }, "code")).rejects.toThrow(
            ConnectorOAuthError
        );
    });
});

describe("notion refreshAccessToken", () => {
    it("sends the refresh grant and keeps the rotated refresh token", async () => {
        const { fetch, calls } = fetchReturning(200, {
            ...TOKEN_RESPONSE,
            access_token: "ntn_access_2",
            refresh_token: "ntn_refresh_2",
        });

        const refreshed = await refreshAccessToken({ ...CONFIG, fetch }, "ntn_refresh");

        expect(bodyOf(calls[0]!)).toEqual({
            grant_type: "refresh_token",
            refresh_token: "ntn_refresh",
        });
        expect(headersOf(calls[0]!)).toMatchObject({ Authorization: BASIC });
        expect(refreshed.accessToken).toBe("ntn_access_2");
        expect(refreshed.refreshToken).toBe("ntn_refresh_2");
        expect(refreshed.accessTokenExpiresAt).toBeNull();
    });

    it("classifies invalid_grant as a revoked grant", async () => {
        const { fetch } = fetchReturning(400, { error: "invalid_grant" });

        await expect(refreshAccessToken({ ...CONFIG, fetch }, "rt")).rejects.toThrow(
            ConnectorGrantRevokedError
        );
    });

    it("treats a server error as a failure, not a revocation", async () => {
        const { fetch } = fetchReturning(500, { error: "internal_server_error" });

        const error = await refreshAccessToken({ ...CONFIG, fetch }, "rt").catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ConnectorOAuthError);
        expect(error).not.toBeInstanceOf(ConnectorGrantRevokedError);
    });
});

describe("notion revokeToken", () => {
    it("posts the token to the revoke endpoint with Basic client auth", async () => {
        const { fetch, calls } = fetchReturning(200, { request_id: "req-2" });

        expect(await revokeToken({ ...CONFIG, fetch }, "ntn_access")).toBe(true);
        expect(calls[0]!.url).toBe("https://api.notion.com/v1/oauth/revoke");
        expect(headersOf(calls[0]!)).toMatchObject({
            Authorization: BASIC,
            "Notion-Version": NOTION_API_VERSION,
        });
        expect(bodyOf(calls[0]!)).toEqual({ token: "ntn_access" });
    });

    it("reports a refused revocation as false", async () => {
        const { fetch } = fetchReturning(401, { error: "invalid_client" });

        expect(await revokeToken({ ...CONFIG, fetch }, "ntn_access")).toBe(false);
    });
});
