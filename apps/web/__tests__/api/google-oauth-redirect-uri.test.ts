/**
 * Google refuses a token exchange whose redirect_uri differs from the one the
 * consent request carried, so /start and /callback must build it the same
 * way: from the public origin, not the bind address a proxied request names.
 */
// Inline: route modules read env while the imports below load, before any
// top-level const here would be initialised.
jest.mock("~/env", () => ({
    env: {
        server: {
            // The services' fetch address; it must never reach Google.
            APP_PUBLIC_URL: "http://app:3000",
            GOOGLE_OAUTH_CLIENT_ID: "cid",
            GOOGLE_OAUTH_CLIENT_SECRET: "sec",
            GOOGLE_OAUTH_REDIRECT_URL: undefined,
            GMAIL_CONNECTOR_ENABLED: "true",
            EMBEDDING_SECRETS_KEY: "test-key",
        },
        client: {},
    },
}));
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/server/inngest/client", () => ({ inngest: { send: jest.fn() } }));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: jest.fn(),
    requireWorkspacePermission: jest.fn(),
}));
jest.mock("@launchstack/google-drive", () => ({
    ...jest.requireActual("@launchstack/google-drive"),
    exchangeAuthorizationCode: jest.fn(),
}));

import { exchangeAuthorizationCode } from "@launchstack/google-drive";

import { GET as callback } from "~/app/api/connectors/google/oauth/callback/route";
import { GET as start } from "~/app/api/connectors/google/oauth/start/route";
import {
    requireWorkspaceContext,
    requireWorkspacePermission,
} from "~/lib/require-workspace-context";
import {
    GMAIL_OAUTH_STATE_COOKIE,
    GMAIL_STATE_PREFIX,
} from "~/server/services/connectors/gmail/config";
import { GOOGLE_OAUTH_STATE_COOKIE } from "~/server/services/google-drive/config";

import { makeWorkspaceContext } from "../helpers/workspace-context";

/** What a route handler sees behind Caddy: the bind address, whatever the Host says. */
const PROXIED = "https://0.0.0.0:3000";
const CALLBACK = "https://app.example.com/api/connectors/google/oauth/callback";

const exchange = exchangeAuthorizationCode as jest.Mock;
const saved = process.env.BETTER_AUTH_URL;

beforeEach(() => {
    jest.clearAllMocks();
    process.env.BETTER_AUTH_URL = "https://app.example.com";
    const ctx = { success: true, data: makeWorkspaceContext({ role: "admin" }) };
    (requireWorkspaceContext as jest.Mock).mockResolvedValue(ctx);
    (requireWorkspacePermission as jest.Mock).mockResolvedValue(ctx);
    // Stop at the exchange: the redirect_uri it was handed is the point.
    exchange.mockRejectedValue(new Error("stop after exchange"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    jest.restoreAllMocks();
    if (saved === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = saved;
});

it.each([
    { flow: "Drive", query: "", cookie: GOOGLE_OAUTH_STATE_COOKIE, prefix: "" },
    {
        flow: "Gmail",
        query: "?provider=gmail",
        cookie: GMAIL_OAUTH_STATE_COOKIE,
        prefix: GMAIL_STATE_PREFIX,
    },
])(
    "$flow: sends Google the same public redirect_uri on consent and on the token exchange",
    async ({ query, cookie, prefix }) => {
        const consent = await start(
            new Request(`${PROXIED}/api/connectors/google/oauth/start${query}`)
        );
        expect(consent.status).toBe(307);
        const authorize = new URL(consent.headers.get("location") ?? "");
        expect(authorize.searchParams.get("redirect_uri")).toBe(CALLBACK);
        const state = authorize.searchParams.get("state") ?? "";
        expect(state.startsWith(prefix)).toBe(true);

        const back = await callback(
            new Request(`${PROXIED}/api/connectors/google/oauth/callback?code=c&state=${state}`, {
                headers: { cookie: `${cookie}=${state.slice(prefix.length)}` },
            })
        );

        expect(exchange).toHaveBeenCalledWith(expect.objectContaining({ redirectUri: CALLBACK }));
        expect(new URL(back.headers.get("location") ?? "").origin).toBe("https://app.example.com");
    }
);
